import { NOTION_APPEND_BATCH_SIZE, Policy, PublicationError } from "./core.js";

export const PENDING_PUBLICATION_MARKER = "Publisher: publication pending";
const blockText = (block: any) => {
  const heading = block?.heading_1 ?? block?.heading_2;
  return heading?.rich_text?.map((rich: any) => rich.plain_text ?? rich.text?.content ?? "").join("");
};
const propertyText = (property: any) => property?.rich_text?.map((rich: any) => rich.plain_text ?? rich.text?.content ?? "").join("") ?? "";
export function isPendingPublication(children: any[]): boolean {
  return children.some((block) => block.type === "heading_2" && blockText(block) === PENDING_PUBLICATION_MARKER);
}
function isPendingPublicationBlock(block: any): boolean {
  return block?.type === "heading_2" && blockText(block) === PENDING_PUBLICATION_MARKER;
}
export function pendingPublicationBlock(): Record<string, unknown> {
  return { object: "block", type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: PENDING_PUBLICATION_MARKER } }] } };
}

export class NotionClient {
  static readonly version = "2025-09-03";
  static readonly marker = "Publisher-owned Symphony coordination surface v1";
  static readonly pendingMarker = `${NotionClient.marker}; bootstrap=pending`;
  static readonly completeMarker = `${NotionClient.marker}; bootstrap=complete`;
  constructor(private readonly token: string, private readonly fetcher = globalThis.fetch) {}

  async request(method: string, path: string, body?: unknown): Promise<any> {
    let response: Response;
    try {
      response = await this.fetcher(`https://api.notion.com/v1${path}`, { method, headers: { Authorization: `Bearer ${this.token}`, "Notion-Version": NotionClient.version, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown transport error";
      throw new PublicationError(`provider/API transport failure: ${detail}`);
    }
    if (!response.ok) {
      if (response.status === 401) throw new PublicationError("authentication failure: NOTION_TOKEN was rejected");
      if (response.status === 403 || response.status === 404) throw new PublicationError("target inaccessible to the integration: share the parent page and grant read/insert access");
      throw new PublicationError(`provider/API failure (${response.status}): ${(await response.text()).slice(0, 300)}`);
    }
    try { return await response.json(); }
    catch (error) { throw new PublicationError(`provider/API failure: invalid JSON response (${error instanceof Error ? error.message : "invalid JSON response"})`); }
  }

  async ensureSurface(parentId: string, policy: Policy): Promise<string> {
    const candidates: any[] = [];
    let cursor: string | undefined;
    do {
      const q = await this.request("GET", `/blocks/${parentId}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`);
      for (const block of q.results ?? []) if (block.type === "child_database" && block.child_database?.title === policy.surfaceName) candidates.push(block);
      if (q.has_more && !q.next_cursor) throw new PublicationError("provider/API failure: surface discovery response omitted next_cursor");
      cursor = q.has_more ? q.next_cursor : undefined;
    } while (cursor);
    if (!candidates.length) return this.bootstrap(parentId, policy);
    const owned: any[] = [];
    for (const candidate of candidates) {
      const db = await this.request("GET", `/databases/${candidate.id}`);
      const description = (db.description ?? []).map((part: any) => part.plain_text ?? "").join(" ");
      if (!description.includes(NotionClient.marker)) throw new PublicationError("incompatible schema: a same-named database exists but is not publisher-owned");
      owned.push({ db, description });
    }
    if (owned.length !== 1) throw new PublicationError("incompatible schema: multiple publisher-owned coordination surfaces have the same name");
    const { db, description } = owned[0];
    const dataSource = db.data_sources?.[0]?.id;
    if (!dataSource) {
      if (description.includes(NotionClient.completeMarker)) throw new PublicationError("incompatible schema: complete coordination surface has no data source");
      return this.recoverPendingDataSource(db.id, policy);
    }
    const schema = await this.request("GET", `/data_sources/${dataSource}`);
    if (description.includes(NotionClient.completeMarker)) { this.validateSchema(schema, policy, dataSource); return dataSource; }
    await this.completeBootstrap(schema, dataSource, policy);
    await this.markComplete(db.id);
    return dataSource;
  }

  private async bootstrap(parentId: string, policy: Policy): Promise<string> {
    const schema = this.baseSchema(policy);
    const db = await this.request("POST", "/databases", { parent: { type: "page_id", page_id: parentId }, title: [{ text: { content: policy.surfaceName } }], description: [{ text: { content: NotionClient.pendingMarker } }], initial_data_source: { properties: schema } });
    const full = await this.request("GET", `/databases/${db.id}`);
    const dataSource = full.data_sources?.[0]?.id;
    if (!dataSource) throw new PublicationError("provider/API failure: created surface did not expose its data source");
    await this.request("PATCH", `/data_sources/${dataSource}`, { properties: { [policy.blockedBy]: { relation: { data_source_id: dataSource, single_property: {} } } } });
    await this.markComplete(db.id);
    return dataSource;
  }

  private baseSchema(policy: Policy): Record<string, unknown> {
    return { [policy.identifier]: { rich_text: {} }, [policy.title]: { title: {} }, [policy.state]: { select: { options: policy.bootstrapStates.map((name) => ({ name })) } }, [policy.priority]: { number: {} }, [policy.labels]: { multi_select: {} }, [policy.description]: { rich_text: {} }, [policy.source]: { url: {} } };
  }
  private async recoverPendingDataSource(databaseId: string, policy: Policy): Promise<string> {
    const created = await this.request("POST", "/data_sources", { parent: { database_id: databaseId }, title: [{ text: { content: policy.surfaceName } }], properties: this.baseSchema(policy) });
    const dataSource = created.id;
    if (!dataSource) throw new PublicationError("provider/API failure: pending surface recovery did not expose its data source");
    await this.request("PATCH", `/data_sources/${dataSource}`, { properties: { [policy.blockedBy]: { relation: { data_source_id: dataSource, single_property: {} } } } });
    await this.markComplete(databaseId);
    return dataSource;
  }
  private markComplete(databaseId: string) { return this.request("PATCH", `/databases/${databaseId}`, { description: [{ text: { content: NotionClient.completeMarker } }] }); }
  validateSchema(data: any, policy: Policy, dataSource?: string): void {
    const expected: Record<string, string> = { [policy.identifier]: "rich_text", [policy.title]: "title", [policy.state]: "select", [policy.priority]: "number", [policy.labels]: "multi_select", [policy.blockedBy]: "relation", [policy.description]: "rich_text", [policy.source]: "url" };
    for (const [name, type] of Object.entries(expected)) if (data.properties?.[name]?.type !== type) throw new PublicationError(`incompatible schema: property ${name} must be ${type}`);
    const relation = data.properties[policy.blockedBy].relation ?? {};
    if (dataSource && (relation.data_source_id !== dataSource || !relation.single_property || relation.dual_property)) throw new PublicationError(`incompatible schema: property ${policy.blockedBy} must be a self-relation with single_property shape`);
  }
  private async completeBootstrap(data: any, dataSource: string, policy: Policy) {
    const definitions: Record<string, any> = { ...this.baseSchema(policy), [policy.blockedBy]: { relation: { data_source_id: dataSource, single_property: {} } } };
    const missing: Record<string, unknown> = {};
    for (const [name, definition] of Object.entries(definitions)) {
      const existing = data.properties?.[name];
      if (!existing) { missing[name] = definition; continue; }
      const expected = name === policy.blockedBy ? "relation" : Object.keys(definition)[0];
      if (existing.type !== expected) throw new PublicationError(`incompatible schema: property ${name} has the wrong type`);
      if (name === policy.blockedBy) { const relation = existing.relation ?? {}; if (relation.data_source_id !== dataSource || !relation.single_property || relation.dual_property) throw new PublicationError(`incompatible schema: property ${policy.blockedBy} must be a self-relation with single_property shape`); }
    }
    if (Object.keys(missing).length) await this.request("PATCH", `/data_sources/${dataSource}`, { properties: missing });
  }
  async duplicate(dataSource: string, policy: Policy, identifier: string) { const result = await this.request("POST", `/data_sources/${dataSource}/query`, { filter: { property: policy.identifier, rich_text: { equals: identifier } } }); return (result.results ?? []).length > 0; }
  async listChildren(parentId: string): Promise<any[]> { const all: any[] = []; let cursor: string | undefined; do { const page = await this.request("GET", `/blocks/${parentId}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`); all.push(...(page.results ?? [])); cursor = page.has_more ? page.next_cursor : undefined; if (page.has_more && !cursor) throw new PublicationError("provider/API failure: paginated children response omitted next_cursor"); } while (cursor); return all; }
  async findPublication(dataSource: string, policy: Policy, identifier: string): Promise<{ pageId: string; url?: string; complete: boolean } | null> { const result = await this.request("POST", `/data_sources/${dataSource}/query`, { filter: { property: policy.identifier, rich_text: { equals: identifier } } }); const row = result.results?.[0]; if (!row) return null; const children = await this.listChildren(row.id); const pending = isPendingPublication(children) || propertyText(row.properties?.[policy.description]) === PENDING_PUBLICATION_MARKER; return { pageId: row.id, url: row.url, complete: !pending }; }
  createTask(dataSource: string, properties: Record<string, unknown>) { return this.request("POST", "/pages", { parent: { type: "data_source_id", data_source_id: dataSource }, properties }); }
  async appendBlocks(pageId: string, blocks: Record<string, unknown>[]) { for (let i = 0; i < blocks.length; i += NOTION_APPEND_BATCH_SIZE) await this.request("PATCH", `/blocks/${pageId}/children`, { children: blocks.slice(i, i + NOTION_APPEND_BATCH_SIZE) }); }
  async repairIncomplete(pageId: string, blocks: Record<string, unknown>[], policy?: Policy) { const children = await this.listChildren(pageId); const pending = children.find(isPendingPublicationBlock); for (const block of children) if (block !== pending) await this.request("PATCH", `/blocks/${block.id}`, { archived: true }); await this.appendBlocks(pageId, blocks); if (pending) await this.request("PATCH", `/blocks/${pending.id}`, { archived: true }); if (policy) await this.finalizePublication(pageId, policy); }
  async finalizePublication(pageId: string, policy: Policy) {
    const children = await this.listChildren(pageId);
    for (const block of children) if (isPendingPublicationBlock(block)) await this.request("PATCH", `/blocks/${block.id}`, { archived: true });
    await this.request("PATCH", `/pages/${pageId}`, { properties: { [policy.description]: { rich_text: [{ type: "text", text: { content: "Completed plan artifact; see Plan section." } }] } } });
  }
}
