import { Client } from "@notionhq/client";
import { canonicalProperties, Policy } from "./policy.js";
import { Config, PlanArtifact, parseNotionPageId } from "./domain.js";

type AnyClient = any;
const MAX_CHILDREN_PER_REQUEST = 100;
export type PublishedTask = { id: string; url: string; identifier: string; title: string };
export type NotionPage = { id: string; url?: string; properties: Record<string, any> };

export class PublicationError extends Error { constructor(public readonly category: string, message: string) { super(`${category}: ${message}`); } }

function richText(content: string) { return [{ type: "text", text: { content } }]; }
function chunks(value: string, size = 1900): string[] { const result: string[] = []; for (let i = 0; i < value.length; i += size) result.push(value.slice(i, i + size)); return result; }
function pageId(value: string) { return value.replace(/-/g, ""); }

export function sectionBlocks(policy: Policy, plan: string, workpad = ""): any[] {
  const result: any[] = [{ object: "block", type: "heading_2", heading_2: { rich_text: richText(policy.sectionHeadings.plan) } }];
  for (const part of chunks(plan)) result.push({ object: "block", type: "code", code: { language: "markdown", rich_text: richText(part) } });
  result.push({ object: "block", type: "heading_2", heading_2: { rich_text: richText(policy.sectionHeadings.workpad) } });
  for (const part of chunks(workpad)) result.push({ object: "block", type: "paragraph", paragraph: { rich_text: richText(part) } });
  return result;
}

function batches<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
  return result;
}

export function validateDataSourceSchema(source: any, policy: Policy): void {
  const properties = source?.properties ?? {};
  const expected: Record<string, string> = {
    [policy.propertyNames.title]: "title", [policy.propertyNames.identifier]: "rich_text", [policy.propertyNames.state]: "select",
    [policy.propertyNames.priority]: "number", [policy.propertyNames.labels]: "multi_select", [policy.propertyNames.blockedBy]: "relation",
    [policy.propertyNames.planSource]: "url", [policy.propertyNames.created]: "created_time", [policy.propertyNames.updated]: "last_edited_time"
  };
  for (const [name, type] of Object.entries(expected)) if (properties[name]?.type !== type) throw new PublicationError("schema compatibility", `property '${name}' must be type ${type}`);
  const relation = properties[policy.propertyNames.blockedBy]?.relation;
  const targets = [relation?.database_id, relation?.data_source_id].filter(Boolean);
  if (!targets.some(target => pageId(target) === pageId(source.id))) throw new PublicationError("schema compatibility", `property '${policy.propertyNames.blockedBy}' must relate to Tasks itself`);
}

export function classifyNotionError(error: any): PublicationError {
  const status = error?.status;
  if (status === 401) return new PublicationError("authentication failure", "Notion rejected NOTION_TOKEN");
  if (status === 403) return new PublicationError("target inaccessible", "the integration cannot access the configured parent or data source");
  if (status === 404) return new PublicationError("target inaccessible", "the configured Notion target was not found or is not shared with the integration");
  return new PublicationError("provider/API failure", error?.message ?? "Notion request failed");
}

async function allPages(list: (cursor?: string) => Promise<any>): Promise<any[]> {
  const result: any[] = []; let cursor: string | undefined;
  do { const page = await list(cursor); result.push(...(page.results ?? [])); cursor = page.has_more ? page.next_cursor : undefined; } while (cursor);
  return result;
}

export class NotionPublisher {
  constructor(private readonly client: AnyClient, private readonly policy: Policy) {}

  private surfaceApi() {
    const dataSources = this.client.dataSources;
    return dataSources ? { api: dataSources, object: "data_source", idKey: "data_source_id", parentKey: "data_source_id" } :
      { api: this.client.databases, object: "database", idKey: "database_id", parentKey: "database_id" };
  }

  async findOrBootstrap(parentUrl: string): Promise<any> {
    const parentId = parseNotionPageId(parentUrl);
    const surface = this.surfaceApi();
    let sources: any[];
    try {
      sources = await allPages((cursor) => this.client.search({ query: this.policy.surfaceName, filter: { property: "object", value: surface.object }, start_cursor: cursor }));
    } catch (error) { throw classifyNotionError(error); }
    const matching = sources.find(source => source.object === surface.object &&
      pageId(source.parent?.page_id ?? "") === pageId(parentId) &&
      source.title?.some((item: any) => item.plain_text === this.policy.surfaceName));
    if (matching) {
      try { const source = await surface.api.retrieve({ [surface.idKey]: matching.id }); validateDataSourceSchema(source, this.policy); return source; } catch (error) { if (error instanceof PublicationError) throw error; throw classifyNotionError(error); }
    }
    try {
      const source = await surface.api.create({ parent: { type: "page_id", page_id: parentId }, title: richText(this.policy.surfaceName), properties: canonicalProperties(this.policy) });
      const updated = await surface.api.update({ [surface.idKey]: source.id, properties: {
        [this.policy.propertyNames.blockedBy]: { relation: { [surface.parentKey]: source.id, type: "single_property", single_property: {} } }
      } });
      validateDataSourceSchema(updated, this.policy);
      return updated;
    } catch (error) { if (error instanceof PublicationError) throw error; throw classifyNotionError(error); }
  }

  async publish(config: Config, plan: PlanArtifact): Promise<PublishedTask> {
    const source = await this.findOrBootstrap(config.parentUrl);
    const surface = this.surfaceApi();
    const identifierName = config.policy.propertyNames.identifier;
    try {
      const duplicates = await surface.api.query({ [surface.idKey]: source.id, filter: { property: identifierName, rich_text: { equals: plan.identifier } } });
      if (duplicates.results?.length) throw new PublicationError("duplicate publication", `Identifier '${plan.identifier}' already exists`);
      const n = config.policy.propertyNames;
      const properties: Record<string, any> = {
        [n.title]: { title: richText(plan.title) },
        [n.identifier]: { rich_text: richText(plan.identifier) },
        [n.state]: { select: { name: config.policy.initialState } },
        [n.priority]: { number: config.policy.defaultPriority },
        [n.labels]: { multi_select: config.policy.defaultLabels.map(name => ({ name })) },
        [n.blockedBy]: { relation: [] },
        [n.planSource]: { url: config.planSourceUrl }
      };
      const blocks = sectionBlocks(config.policy, plan.content);
      const [initialChildren, ...remainingChildren] = batches(blocks, MAX_CHILDREN_PER_REQUEST);
      const page = await this.client.pages.create({ parent: { type: surface.parentKey, [surface.parentKey]: source.id }, properties, children: initialChildren });
      for (const children of remainingChildren) await this.client.blocks.children.append({ block_id: page.id, children });
      return { id: page.id, url: page.url, identifier: plan.identifier, title: plan.title };
    } catch (error) { if (error instanceof PublicationError) throw error; throw classifyNotionError(error); }
  }

  async readSection(pageIdValue: string, heading: string): Promise<string> {
    try {
      const blocks = await allPages((cursor) => this.client.blocks.children.list({ block_id: pageIdValue, start_cursor: cursor }));
      const start = blocks.findIndex(block => block.type === "heading_2" && block.heading_2.rich_text?.map((x: any) => x.plain_text).join("") === heading);
      if (start < 0) throw new PublicationError("schema compatibility", `page is missing '${heading}' section`);
      const content: string[] = [];
      for (const block of blocks.slice(start + 1)) {
        if (block.type === "heading_2") break;
        const payload = block[block.type];
        content.push(...(payload?.rich_text ?? []).map((x: any) => x.plain_text ?? x.text?.content ?? ""));
      }
      return content.join("");
    } catch (error) { if (error instanceof PublicationError) throw error; throw classifyNotionError(error); }
  }

  async updateWorkpad(pageIdValue: string, content: string): Promise<void> {
    try {
      const blocks = await allPages((cursor) => this.client.blocks.children.list({ block_id: pageIdValue, start_cursor: cursor }));
      const start = blocks.findIndex(block => block.type === "heading_2" && block.heading_2.rich_text?.map((x: any) => x.plain_text).join("") === this.policy.sectionHeadings.workpad);
      if (start < 0) throw new PublicationError("schema compatibility", "page is missing 'Workpad' section");
      const end = blocks.slice(start + 1).findIndex(block => block.type === "heading_2");
      const old = blocks.slice(start + 1, end < 0 ? undefined : start + 1 + end);
      for (const block of old) await this.client.blocks.delete({ block_id: block.id });
      const children = chunks(content).map(part => ({ object: "block", type: "paragraph", paragraph: { rich_text: richText(part) } }));
      if (children.length) await this.client.blocks.children.append({ block_id: pageIdValue, children });
    } catch (error) { if (error instanceof PublicationError) throw error; throw classifyNotionError(error); }
  }
}

export function createPublisher(token: string, policy: Policy): NotionPublisher {
  if (!token?.trim()) throw new PublicationError("missing NOTION_TOKEN", "set NOTION_TOKEN before publication");
  return new NotionPublisher(new Client({ auth: token }), policy);
}
