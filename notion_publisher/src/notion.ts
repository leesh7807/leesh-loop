import { NOTION_APPEND_BATCH_SIZE, Policy, PublicationError, PUBLISHER_PENDING_STATE, buildPlanBlocks } from "./core.js";

const PLAN_PAGE = "Plan";
const WORKPAD_PAGE = "Workpad";
const richText = (value: any) => value?.map((part: any) => part.plain_text ?? part.text?.content ?? "").join("") ?? "";
const selectName = (property: any) => property?.select?.name ?? "";

export class NotionClient {
  static readonly version = "2025-09-03";
  constructor(private readonly token: string, private readonly fetcher = globalThis.fetch) {}

  async request(method: string, path: string, body?: unknown): Promise<any> {
    let response: Response;
    try { response = await this.fetcher(`https://api.notion.com/v1${path}`, { method, headers: { Authorization: `Bearer ${this.token}`, "Notion-Version": NotionClient.version, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch (error) { throw new PublicationError(`provider/API transport failure: ${error instanceof Error ? error.message : "unknown transport error"}`); }
    if (!response.ok) {
      if (response.status === 401) throw new PublicationError("authentication failure: NOTION_TOKEN was rejected");
      if (response.status === 403 || response.status === 404) throw new PublicationError("configured database is inaccessible to the integration: share the database and grant read/insert access");
      throw new PublicationError(`provider/API failure (${response.status}): ${(await response.text()).slice(0, 300)}`);
    }
    try { return await response.json(); }
    catch (error) { throw new PublicationError(`provider/API failure: invalid JSON response (${error instanceof Error ? error.message : "invalid JSON response"})`); }
  }

  async ensureDatabase(databaseId: string, policy: Policy): Promise<string> {
    const database = await this.request("GET", `/databases/${databaseId}`);
    const dataSources = database.data_sources ?? [];
    if (dataSources.length !== 1 || !dataSources[0]?.id) throw new PublicationError("incompatible database: configured database must expose exactly one usable data source");
    const dataSource = dataSources[0].id;
    await this.ensureSchema(await this.request("GET", `/data_sources/${dataSource}`), dataSource, policy);
    return dataSource;
  }

  private baseSchema(policy: Policy): Record<string, unknown> {
    return { [policy.identifier]: { rich_text: {} }, [policy.title]: { title: {} }, [policy.state]: { select: { options: [...new Set([...policy.bootstrapStates, PUBLISHER_PENDING_STATE])].map((name) => ({ name })) } }, [policy.priority]: { number: {} }, [policy.labels]: { multi_select: {} } };
  }
  validateSchema(data: any, policy: Policy, dataSource?: string): void {
    const expected: Record<string, string> = { [policy.identifier]: "rich_text", [policy.title]: "title", [policy.state]: "select", [policy.priority]: "number", [policy.labels]: "multi_select", [policy.blockedBy]: "relation" };
    for (const [name, type] of Object.entries(expected)) if (data.properties?.[name]?.type !== type) throw new PublicationError(`incompatible schema: property ${name} must be ${type}`);
    const relation = data.properties[policy.blockedBy].relation ?? {};
    if (dataSource && (relation.data_source_id !== dataSource || !relation.single_property || relation.dual_property)) throw new PublicationError(`incompatible schema: property ${policy.blockedBy} must be a self-relation with single_property shape`);
  }
  private async ensureSchema(data: any, dataSource: string, policy: Policy) {
    const definitions: Record<string, any> = { ...this.baseSchema(policy), [policy.blockedBy]: { relation: { data_source_id: dataSource, single_property: {} } } };
    const missing: Record<string, unknown> = {};
    const titleEntry = (Object.entries(data.properties ?? {}) as [string, any][]).find(([, property]) => property.type === "title");

    if (!data.properties?.[policy.title] && titleEntry) {
      const [name, property] = titleEntry;
      missing[property.id ?? name] = { title: {}, name: policy.title };
      data = { ...data, properties: { ...data.properties, [policy.title]: { ...property, name: policy.title } } };
    }

    for (const [name, definition] of Object.entries(definitions)) {
      const existing = data.properties?.[name];
      if (!existing) { missing[name] = definition; continue; }
      const expected = name === policy.blockedBy ? "relation" : Object.keys(definition)[0];
      if (existing.type !== expected) throw new PublicationError(`incompatible schema: property ${name} has the wrong type`);
      if (name === policy.blockedBy) { const relation = existing.relation ?? {}; if (relation.data_source_id !== dataSource || !relation.single_property || relation.dual_property) throw new PublicationError(`incompatible schema: property ${policy.blockedBy} must be a self-relation with single_property shape`); }
    }
    if (Object.keys(missing).length) await this.request("PATCH", `/data_sources/${dataSource}`, { properties: missing });
  }

  async listChildren(parentId: string): Promise<any[]> {
    const all: any[] = []; let cursor: string | undefined;
    do { const page = await this.request("GET", `/blocks/${parentId}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`); all.push(...(page.results ?? [])); cursor = page.has_more ? page.next_cursor : undefined; if (page.has_more && !cursor) throw new PublicationError("provider/API failure: paginated children response omitted next_cursor"); } while (cursor);
    return all;
  }

  async findPublication(dataSource: string, policy: Policy, identifier: string): Promise<{ pageId: string; url?: string; complete: boolean } | null> {
    const rows: any[] = []; let cursor: string | undefined;
    do { const result = await this.request("POST", `/data_sources/${dataSource}/query`, { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}), filter: { property: policy.identifier, rich_text: { equals: identifier } } }); rows.push(...(result.results ?? [])); if (result.has_more && !result.next_cursor) throw new PublicationError("provider/API failure: publication query response omitted next_cursor"); cursor = result.has_more ? result.next_cursor : undefined; } while (cursor);
    if (!rows.length) return null;
    if (rows.length > 1) throw new PublicationError(`Identifier invariant violation: ${identifier} matches ${rows.length} task pages`);
    const row = rows[0];
    return { pageId: row.id, url: row.url, complete: selectName(row.properties?.[policy.state]) !== PUBLISHER_PENDING_STATE };
  }

  createTask(dataSource: string, properties: Record<string, unknown>) { return this.request("POST", "/pages", { parent: { type: "data_source_id", data_source_id: dataSource }, properties }); }
  async appendBlocks(pageId: string, blocks: Record<string, unknown>[]) { for (let i = 0; i < blocks.length; i += NOTION_APPEND_BATCH_SIZE) await this.request("PATCH", `/blocks/${pageId}/children`, { children: blocks.slice(i, i + NOTION_APPEND_BATCH_SIZE) }); }
  private async createChildPage(parentId: string, title: string): Promise<string> {
    const page = await this.request("POST", "/pages", {
      parent: { type: "page_id", page_id: parentId },
      properties: { title: { title: [{ type: "text", text: { content: title } }] } }
    });
    if (!page?.id) throw new PublicationError(`provider/API failure: creating ${title} child page returned no page id`);
    return page.id;
  }
  private namedChildPages(children: any[], title: string): any[] { return children.filter((child) => child.type === "child_page" && child.child_page?.title === title); }
  private async ensureChildPage(parentId: string, title: string): Promise<string> {
    const matches = this.namedChildPages(await this.listChildren(parentId), title);
    if (matches.length > 1) throw new PublicationError(`incomplete publication has multiple ${title} child pages`);
    return matches[0]?.id ?? this.createChildPage(parentId, title);
  }
  private async ensurePlanContent(planId: string, plan: string): Promise<void> {
    const expected = buildPlanBlocks(plan) as any[];
    const existing = await this.listChildren(planId);
    const existingText = existing.map((block) => block.type === "paragraph" ? richText(block.paragraph?.rich_text) : undefined);
    if (existingText.some((value) => value === undefined) || existingText.length > expected.length || existingText.some((value, index) => value !== richText(expected[index].paragraph.rich_text))) throw new PublicationError("incomplete publication Plan content differs from the accepted Plan");
    if (existingText.length < expected.length) await this.appendBlocks(planId, expected.slice(existingText.length));
  }
  async ensureCanonicalRepresentation(pageId: string, plan: string): Promise<void> {
    if (!plan.trim()) throw new PublicationError("Plan content must be non-empty");
    const planId = await this.ensureChildPage(pageId, PLAN_PAGE);
    await this.ensurePlanContent(planId, plan);
    await this.ensureChildPage(pageId, WORKPAD_PAGE);
    await this.validateCanonicalRepresentation(pageId, plan);
  }
  async validateCanonicalRepresentation(pageId: string, plan: string): Promise<void> {
    const children = await this.listChildren(pageId);
    const plans = this.namedChildPages(children, PLAN_PAGE);
    const workpads = this.namedChildPages(children, WORKPAD_PAGE);
    if (plans.length !== 1 || workpads.length !== 1) throw new PublicationError("canonical representation requires exactly one Plan and one Workpad child page");
    const content = await this.listChildren(plans[0].id);
    const actual = content.map((block) => block.type === "paragraph" ? richText(block.paragraph?.rich_text) : undefined);
    const expected = buildPlanBlocks(plan) as any[];
    if (!plan.trim() || actual.length !== expected.length || actual.some((value, index) => value === undefined || value !== richText(expected[index].paragraph.rich_text))) throw new PublicationError("canonical Plan child page does not contain the complete accepted Plan");
  }
  async repairIncomplete(pageId: string, plan: string): Promise<void> { await this.ensureCanonicalRepresentation(pageId, plan); }
  async finalizePublication(pageId: string, policy: Policy) { await this.request("PATCH", `/pages/${pageId}`, { properties: { [policy.state]: { select: { name: policy.defaultState } } } }); }
}
