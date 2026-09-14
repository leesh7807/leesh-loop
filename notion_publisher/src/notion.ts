import {
  NOTION_APPEND_BATCH_SIZE,
  PLAN_PROPERTY,
  Policy,
  PublicationError,
  PUBLISHER_PENDING_STATE,
  PUBLISHER_READY_STATE,
  buildPlanBlocks,
  buildPlanProperties
} from "./core.js";

const PLAN_IDENTIFIER = "Identifier";
const PLAN_TITLE = "Title";
const PLAN_FORBIDDEN_PROPERTIES = ["State", "Priority", "Labels", "Blocked By", PLAN_PROPERTY, "Workpad", "Description", "Plan Source", "branch_name", "assignee_id", "native_ref"];

export type DatabaseBinding = { taskDataSourceId: string; planDataSourceId: string };
export type Publication = { pageId: string; url?: string; complete: boolean };

const richText = (value: any): string => Array.isArray(value) ? value.map((part: any) => part?.plain_text ?? part?.text?.content ?? "").join("") : "";
const propertyText = (property: any, type: string): string | null => property?.type === type && Array.isArray(property[type]) ? richText(property[type]) : null;
const relationTarget = (property: any): string | null => property?.type === "relation" && typeof property.relation?.data_source_id === "string" ? property.relation.data_source_id : null;
const relationIds = (property: any): string[] | null => {
  if (property?.type !== "relation" || !Array.isArray(property.relation)) return null;
  const ids = property.relation.map((item: any) => item?.id);
  return ids.every((id: any): id is string => typeof id === "string") ? ids : null;
};
const hasSingleProperty = (relation: any): boolean => Boolean(relation) && !relation?.dual_property;

export class NotionClient {
  static readonly version = "2025-09-03";
  constructor(private readonly token: string, private readonly fetcher = globalThis.fetch) {}

  async request(method: string, path: string, body?: unknown): Promise<any> {
    let response: Response;
    try {
      response = await this.fetcher(`https://api.notion.com/v1${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Notion-Version": NotionClient.version,
          "Content-Type": "application/json"
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (error) {
      throw new PublicationError(`provider/API transport failure: ${error instanceof Error ? error.message : "unknown transport error"}`);
    }
    if (!response.ok) {
      if (response.status === 401) throw new PublicationError("authentication failure: NOTION_TOKEN was rejected");
      if (response.status === 403 || response.status === 404) throw new PublicationError("configured database is inaccessible to the integration: share the database and grant read/insert access");
      throw new PublicationError(`provider/API failure (${response.status}): ${(await response.text()).slice(0, 300)}`);
    }
    try {
      return await response.json();
    } catch (error) {
      throw new PublicationError(`provider/API failure: invalid JSON response (${error instanceof Error ? error.message : "invalid JSON response"})`);
    }
  }

  async ensureDatabase(databaseId: string, policy: Policy): Promise<DatabaseBinding> {
    const database = await this.request("GET", `/databases/${databaseId}`);
    const entries = database.data_sources;
    if (!Array.isArray(entries) || entries.some((entry: any) => typeof entry?.id !== "string")) throw new PublicationError("incompatible database: provider returned malformed data-source metadata");
    const sources: { id: string; schema: any }[] = [];
    for (const entry of entries) sources.push({ id: entry.id, schema: await this.request("GET", `/data_sources/${entry.id}`) });

    const planCandidates = sources.filter(({ schema }) => this.isPlanSchema(schema));
    if (planCandidates.length > 1) throw new PublicationError("incompatible database: multiple structurally compatible Plan data sources exist");

    const taskCandidates = sources.filter(({ id, schema }) => this.isTaskSchema(schema, id, policy));
    const task = taskCandidates.length === 1 ? taskCandidates[0] : taskCandidates.length > 1 ? null : this.bootstrapTaskSource(sources, policy);
    if (!task) throw new PublicationError(taskCandidates.length > 1 ? "incompatible database: multiple structurally compatible task data sources exist" : "incompatible database: no structurally identifiable task data source exists");

    const plan = planCandidates[0] ?? await this.createPlanDataSource(databaseId);
    this.validatePlanSchema(plan.schema);
    await this.ensureTaskSchema(task.schema, task.id, policy, plan.id);
    return { taskDataSourceId: task.id, planDataSourceId: plan.id };
  }

  private bootstrapTaskSource(sources: { id: string; schema: any }[], policy: Policy): { id: string; schema: any } | null {
    const candidates = sources.filter(({ schema }) => {
      const properties = schema?.properties;
      if (!properties || this.isPlanSchema(schema)) return false;
      if (properties[policy.title]?.type === "title") return true;
      return Object.keys(properties).some((name) => [policy.identifier, policy.state, policy.priority, policy.labels, policy.blockedBy, PLAN_PROPERTY].includes(name));
    });
    return candidates.length === 1 ? candidates[0] : null;
  }

  private isPlanSchema(data: any): boolean {
    const properties = data?.properties;
    if (!properties || properties[PLAN_IDENTIFIER]?.type !== "rich_text" || properties[PLAN_TITLE]?.type !== "title") return false;
    return Object.keys(properties).length === 2 && !PLAN_FORBIDDEN_PROPERTIES.some((name) => Object.prototype.hasOwnProperty.call(properties, name));
  }

  private isTaskSchema(data: any, dataSource: string, policy: Policy): boolean {
    const properties = data?.properties ?? {};
    const metadata = [policy.identifier, policy.title, policy.state, policy.priority, policy.labels, policy.blockedBy].every((name) => Boolean(properties[name]));
    const blockedBy = properties[policy.blockedBy];
    return metadata && properties[PLAN_PROPERTY]?.type === "relation" && blockedBy?.type === "relation" && relationTarget(blockedBy) === dataSource && hasSingleProperty(blockedBy.relation);
  }

  private async createPlanDataSource(databaseId: string): Promise<{ id: string; schema: any }> {
    const result = await this.request("POST", "/data_sources", {
      parent: { database_id: databaseId },
      title: [{ type: "text", text: { content: "Plans" } }],
      properties: { Identifier: { rich_text: {} }, Title: { title: {} } }
    });
    if (typeof result?.id !== "string") throw new PublicationError("provider/API failure: creating the Plan data source returned no data-source id");
    return { id: result.id, schema: await this.request("GET", `/data_sources/${result.id}`) };
  }

  private validatePlanSchema(data: any): void {
    if (!this.isPlanSchema(data)) throw new PublicationError("incompatible schema: Plan data source must contain Identifier rich_text and Title title without task or Symphony-only fields");
  }

  private taskDefinitions(policy: Policy, dataSource: string, planDataSource: string): Record<string, any> {
    return {
      [policy.identifier]: { rich_text: {} },
      [policy.title]: { title: {} },
      [policy.state]: { rich_text: {} },
      [policy.priority]: { number: {} },
      [policy.labels]: { multi_select: {} },
      [policy.blockedBy]: { relation: { data_source_id: dataSource, single_property: {} } },
      [PLAN_PROPERTY]: { relation: { data_source_id: planDataSource, single_property: {} } }
    };
  }

  private validateTaskSchema(data: any, dataSource: string, policy: Policy, planDataSource: string): void {
    const properties = data?.properties ?? {};
    const expected: Record<string, string> = {
      [policy.identifier]: "rich_text",
      [policy.title]: "title",
      [policy.state]: "rich_text",
      [policy.priority]: "number",
      [policy.labels]: "multi_select",
      [policy.blockedBy]: "relation",
      [PLAN_PROPERTY]: "relation"
    };
    for (const [name, type] of Object.entries(expected)) if (properties[name]?.type !== type) throw new PublicationError(`incompatible schema: property ${name} must be ${type}`);
    const blockedBy = properties[policy.blockedBy].relation ?? {};
    if (relationTarget(properties[policy.blockedBy]) !== dataSource || !hasSingleProperty(blockedBy)) throw new PublicationError(`incompatible schema: property ${policy.blockedBy} must be a non-dual self-relation`);
    const plan = properties[PLAN_PROPERTY].relation ?? {};
    if (relationTarget(properties[PLAN_PROPERTY]) !== planDataSource || !hasSingleProperty(plan)) throw new PublicationError(`incompatible schema: property ${PLAN_PROPERTY} must target the Plan data source as a non-dual relation`);
  }

  private async ensureTaskSchema(data: any, dataSource: string, policy: Policy, planDataSource: string): Promise<void> {
    const definitions = this.taskDefinitions(policy, dataSource, planDataSource);
    const missing: Record<string, unknown> = {};
    const properties = { ...(data?.properties ?? {}) };
    const titleEntry = (Object.entries(properties) as [string, any][]).find(([, property]) => property?.type === "title");

    if (!properties[policy.title] && titleEntry) {
      const [name, property] = titleEntry;
      missing[property.id ?? name] = { title: {}, name: policy.title };
      properties[policy.title] = { ...property, name: policy.title };
    }

    for (const [name, definition] of Object.entries(definitions)) {
      const existing = properties[name];
      if (!existing) {
        missing[name] = definition;
        continue;
      }
      const expected = name === policy.blockedBy || name === PLAN_PROPERTY ? "relation" : Object.keys(definition)[0];
      if (existing.type !== expected) throw new PublicationError(`incompatible schema: property ${name} has the wrong type`);
    }

    const current = { ...data, properties };
    if (Object.keys(missing).length) {
      await this.request("PATCH", `/data_sources/${dataSource}`, { properties: missing });
      const refreshed = await this.request("GET", `/data_sources/${dataSource}`);
      this.validateTaskSchema(refreshed, dataSource, policy, planDataSource);
    } else {
      this.validateTaskSchema(current, dataSource, policy, planDataSource);
    }
  }

  async listChildren(parentId: string): Promise<any[]> {
    const all: any[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.request("GET", `/blocks/${parentId}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (!Array.isArray(page?.results) || typeof page.has_more !== "boolean") throw new PublicationError("provider/API failure: children response was malformed");
      all.push(...page.results);
      cursor = page.has_more ? page.next_cursor : undefined;
      if (page.has_more && !cursor) throw new PublicationError("provider/API failure: paginated children response omitted next_cursor");
    } while (cursor);
    return all;
  }

  private async queryByIdentifier(dataSource: string, propertyName: string, identifier: string): Promise<any[]> {
    const rows: any[] = [];
    let cursor: string | undefined;
    do {
      const result = await this.request("POST", `/data_sources/${dataSource}/query`, {
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
        filter: { property: propertyName, rich_text: { equals: identifier } }
      });
      if (!Array.isArray(result?.results) || typeof result.has_more !== "boolean") throw new PublicationError("provider/API failure: publication query returned malformed results");
      rows.push(...result.results);
      if (result.has_more && !result.next_cursor) throw new PublicationError("provider/API failure: publication query response omitted next_cursor");
      cursor = result.has_more ? result.next_cursor : undefined;
    } while (cursor);
    return rows;
  }

  async findPublication(dataSource: string, policy: Policy, identifier: string): Promise<Publication | null> {
    const rows = await this.queryByIdentifier(dataSource, policy.identifier, identifier);
    if (!rows.length) return null;
    if (rows.length > 1) throw new PublicationError(`Identifier invariant violation: ${identifier} matches ${rows.length} task pages`);
    const row = rows[0];
    if (typeof row?.id !== "string") throw new PublicationError("provider/API failure: publication query returned a task without an id");
    const state = propertyText(row.properties?.[policy.state], "rich_text");
    if (state === null) throw new PublicationError("provider/API failure: publication query returned a task with malformed State");
    return { pageId: row.id, url: row.url, complete: state !== PUBLISHER_PENDING_STATE };
  }

  async createTask(dataSource: string, properties: Record<string, unknown>): Promise<any> {
    return this.request("POST", "/pages", { parent: { type: "data_source_id", data_source_id: dataSource }, properties });
  }

  private async createPlanPage(dataSource: string, identifier: string, title: string): Promise<string> {
    const page = await this.request("POST", "/pages", {
      parent: { type: "data_source_id", data_source_id: dataSource },
      properties: buildPlanProperties(identifier, title)
    });
    if (typeof page?.id !== "string") throw new PublicationError("provider/API failure: creating the Plan page returned no page id");
    return page.id;
  }

  private async findOrCreatePlanPage(dataSource: string, identifier: string, title: string): Promise<string> {
    const rows = await this.queryByIdentifier(dataSource, PLAN_IDENTIFIER, identifier);
    if (rows.length > 1) throw new PublicationError(`Identifier invariant violation: ${identifier} matches ${rows.length} Plan pages`);
    if (!rows.length) return this.createPlanPage(dataSource, identifier, title);
    if (typeof rows[0]?.id !== "string") throw new PublicationError("provider/API failure: Plan query returned a page without an id");
    return rows[0].id;
  }

  async appendBlocks(pageId: string, blocks: Record<string, unknown>[]): Promise<void> {
    for (let i = 0; i < blocks.length; i += NOTION_APPEND_BATCH_SIZE) await this.request("PATCH", `/blocks/${pageId}/children`, { children: blocks.slice(i, i + NOTION_APPEND_BATCH_SIZE) });
  }

  private async assertPlanIdentity(planPageId: string, binding: DatabaseBinding, identifier: string, title: string): Promise<any> {
    const page = await this.request("GET", `/pages/${planPageId}`);
    if (page?.parent?.type !== "data_source_id" || page.parent.data_source_id !== binding.planDataSourceId) throw new PublicationError("canonical Plan relation points outside the expected Plan data source");
    const actualIdentifier = propertyText(page.properties?.[PLAN_IDENTIFIER], "rich_text");
    if (actualIdentifier !== identifier) throw new PublicationError("canonical Plan relation has a mismatched publication Identifier");
    const actualTitle = propertyText(page.properties?.[PLAN_TITLE], "title");
    if (actualTitle !== title) throw new PublicationError("canonical Plan page title differs from the accepted publication title");
    return page;
  }

  private async ensurePlanContent(planPageId: string, plan: string): Promise<void> {
    const expected = buildPlanBlocks(plan) as any[];
    const existing = await this.listChildren(planPageId);
    if (existing.length > expected.length || existing.some((block, index) => block?.type !== "paragraph" || richText(block.paragraph?.rich_text) !== richText(expected[index].paragraph.rich_text))) throw new PublicationError("pending Plan content differs from the accepted Plan");
    if (existing.length < expected.length) await this.appendBlocks(planPageId, expected.slice(existing.length));
  }

  private async validatePlanContent(planPageId: string, plan: string): Promise<void> {
    const expected = buildPlanBlocks(plan) as any[];
    const actual = await this.listChildren(planPageId);
    if (actual.length !== expected.length || actual.some((block, index) => block?.type !== "paragraph" || richText(block.paragraph?.rich_text) !== richText(expected[index].paragraph.rich_text))) throw new PublicationError("canonical Plan page does not contain the complete accepted Plan");
  }

  async lockPlanPage(planPageId: string): Promise<void> {
    await this.request("PATCH", `/pages/${planPageId}`, { is_locked: true });
  }

  async setTaskPlanRelation(taskPageId: string, planPageId: string): Promise<void> {
    await this.request("PATCH", `/pages/${taskPageId}`, { properties: { [PLAN_PROPERTY]: { relation: [{ id: planPageId }] } } });
  }

  private async relationPlanPage(taskPage: any, binding: DatabaseBinding, identifier: string, title: string): Promise<string | null> {
    const property = taskPage?.properties?.[PLAN_PROPERTY];
    const ids = relationIds(property);
    if (ids === null || ids.length > 1) throw new PublicationError("canonical task Plan property must be a relation containing exactly one page");
    if (!ids.length) return null;
    await this.assertPlanIdentity(ids[0], binding, identifier, title);
    return ids[0];
  }

  async ensureCanonicalRepresentation(pageId: string, plan: string, binding: DatabaseBinding, identifier: string, title: string, identifierProperty: string): Promise<void> {
    if (!plan.trim()) throw new PublicationError("Plan content must be non-empty");
    const task = await this.request("GET", `/pages/${pageId}`);
    if (task?.parent?.type !== "data_source_id" || task.parent.data_source_id !== binding.taskDataSourceId) throw new PublicationError("pending task is outside the expected task data source");
    let planPageId = await this.relationPlanPage(task, binding, identifier, title);
    if (!planPageId) planPageId = await this.findOrCreatePlanPage(binding.planDataSourceId, identifier, title);
    await this.assertPlanIdentity(planPageId, binding, identifier, title);
    const planPage = await this.request("GET", `/pages/${planPageId}`);
    if (!planPage.is_locked) {
      await this.ensurePlanContent(planPageId, plan);
      await this.validatePlanContent(planPageId, plan);
      await this.lockPlanPage(planPageId);
    } else {
      await this.validatePlanContent(planPageId, plan);
    }
    await this.setTaskPlanRelation(pageId, planPageId);
    await this.validateCanonicalRepresentation(pageId, plan, binding, identifier, title, identifierProperty);
  }

  async validateCanonicalRepresentation(pageId: string, plan: string, binding: DatabaseBinding, identifier: string, title: string, identifierProperty: string): Promise<void> {
    const task = await this.request("GET", `/pages/${pageId}`);
    if (task?.parent?.type !== "data_source_id" || task.parent.data_source_id !== binding.taskDataSourceId) throw new PublicationError("canonical task is outside the expected task data source");
    if (propertyText(task.properties?.[identifierProperty], "rich_text") !== identifier) throw new PublicationError("canonical task has a mismatched publication Identifier");
    const planPageId = await this.relationPlanPage(task, binding, identifier, title);
    if (!planPageId) throw new PublicationError("canonical task Plan property must contain exactly one Plan page");
    const planPage = await this.assertPlanIdentity(planPageId, binding, identifier, title);
    if (planPage.is_locked !== true) throw new PublicationError("canonical Plan page must be locked");
    await this.validatePlanContent(planPageId, plan);
  }

  async repairIncomplete(pageId: string, plan: string, binding: DatabaseBinding, identifier: string, title: string, identifierProperty: string): Promise<void> {
    await this.ensureCanonicalRepresentation(pageId, plan, binding, identifier, title, identifierProperty);
  }

  async finalizePublication(pageId: string, policy: Policy): Promise<void> {
    await this.request("PATCH", `/pages/${pageId}`, { properties: { [policy.state]: { rich_text: [{ type: "text", text: { content: PUBLISHER_READY_STATE } }] } } });
  }
}
