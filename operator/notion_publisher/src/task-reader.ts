import { PUBLISHER_PENDING_STATE, type Policy, PublicationError, resolvePublishDatabase } from "./core.js";
import { NotionClient } from "./notion.js";

export type BlockerSummary = { title: string; state: string; url: string };
export type TaskSummary = {
  title: string;
  state: string;
  blockedBy: BlockerSummary[];
  priority: number | null;
  labels: string[];
  identifier: string;
  taskUrl: string;
  planUrl: string | null;
};

const text = (items: any): string => Array.isArray(items) ? items.map((item: any) => item?.plain_text ?? item?.text?.content ?? "").join("") : "";
const titleOf = (page: any, property: string): string => text(page?.properties?.[property]?.title);
const stateOf = (page: any, property: string): string => typeof page?.properties?.[property]?.select?.name === "string" ? page.properties[property].select.name : "—";

export class NotionTaskReader {
  private binding?: ReturnType<NotionClient["existingDatabaseBinding"]>;
  private planPageUrls?: Promise<Map<string, string>>;
  private readonly resolvedPlanUrls = new Map<string, Promise<string>>();

  constructor(private readonly client: NotionClient, private readonly databaseUrl: string, private readonly policy: Policy) {}

  private databaseBinding() {
    if (!this.binding) {
      this.binding = this.client.existingDatabaseBinding(resolvePublishDatabase(this.databaseUrl).databaseId, this.policy).catch(error => {
        this.binding = undefined;
        throw error;
      });
    }
    return this.binding;
  }

  private async readAllPages(dataSourceId: string): Promise<any[]> {
    const rows: any[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.client.request("POST", `/data_sources/${dataSourceId}/query`, { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
      if (!Array.isArray(page?.results) || typeof page.has_more !== "boolean") throw new PublicationError("provider/API failure: task query returned malformed results");
      rows.push(...page.results);
      if (page.has_more && typeof page.next_cursor !== "string") throw new PublicationError("provider/API failure: paginated task query omitted next_cursor");
      cursor = page.has_more ? page.next_cursor : undefined;
    } while (cursor);
    return rows;
  }

  private async relationIds(page: any, propertyName: string): Promise<string[]> {
    const property = page?.properties?.[propertyName];
    if (property?.type !== "relation" || !Array.isArray(property.relation)) throw new PublicationError(`provider/API failure: task relation ${propertyName} was malformed`);
    const rawIds: unknown[] = property.relation.map((item: any) => item?.id);
    if (rawIds.some(id => typeof id !== "string")) throw new PublicationError(`provider/API failure: task relation ${propertyName} contained a malformed page`);
    const ids = rawIds as string[];
    if (property.has_more !== true) return [...new Set(ids)];
    if (typeof page?.id !== "string" || typeof property.id !== "string") throw new PublicationError(`provider/API failure: task relation ${propertyName} omitted its pagination identity`);
    let cursor: string | undefined;
    do {
      const suffix = cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : "";
      const result = await this.client.request("GET", `/pages/${page.id}/properties/${property.id}?page_size=100${suffix}`);
      if (!Array.isArray(result?.results) || typeof result.has_more !== "boolean") throw new PublicationError(`provider/API failure: paginated task relation ${propertyName} was malformed`);
      for (const item of result.results) {
        const id = item?.relation?.id ?? item?.id;
        if (typeof id !== "string") throw new PublicationError(`provider/API failure: task relation ${propertyName} contained a malformed page`);
        ids.push(id);
      }
      if (result.has_more && typeof result.next_cursor !== "string") throw new PublicationError(`provider/API failure: paginated task relation ${propertyName} omitted next_cursor`);
      cursor = result.has_more ? result.next_cursor : undefined;
    } while (cursor);
    return [...new Set(ids)];
  }

  private async pageSummary(page: any, binding: { taskDataSourceId: string }, taskPages: Map<string, any>): Promise<BlockerSummary> {
    const canonical = taskPages.get(page.id) ?? page;
    if (canonical?.parent?.type !== "data_source_id" || canonical.parent.data_source_id !== binding.taskDataSourceId) throw new PublicationError("provider/API failure: Blocked By relation target is outside the canonical task source");
    if (typeof canonical.url !== "string" || !canonical.url) throw new PublicationError("provider/API failure: Blocked By task has no Notion page URL");
    const title = titleOf(canonical, this.policy.title) || "(Untitled)";
    return { title, state: stateOf(canonical, this.policy.state), url: canonical.url };
  }

  private async loadPlanPageUrls(dataSourceId: string): Promise<Map<string, string>> {
    if (!this.planPageUrls) {
      this.planPageUrls = this.readAllPages(dataSourceId).then(rows => {
        const urls = new Map<string, string>();
        for (const row of rows) {
          if (typeof row?.id !== "string" || typeof row.url !== "string" || !row.url) throw new PublicationError("provider/API failure: Plan page metadata was malformed");
          urls.set(row.id, row.url);
        }
        return urls;
      }).catch(error => { this.planPageUrls = undefined; throw error; });
    }
    return this.planPageUrls;
  }

  private async planUrl(pageId: string, planDataSourceId: string): Promise<string> {
    if (this.resolvedPlanUrls.has(pageId)) return this.resolvedPlanUrls.get(pageId)!;
    const resolved = (async () => {
      const urls = await this.loadPlanPageUrls(planDataSourceId);
      const listed = urls.get(pageId);
      if (listed) return listed;
      const page = await this.client.request("GET", `/pages/${pageId}`);
      if (page?.parent?.type !== "data_source_id" || page.parent.data_source_id !== planDataSourceId || typeof page.url !== "string" || !page.url) throw new PublicationError("provider/API failure: canonical Plan relation target was inaccessible");
      urls.set(pageId, page.url);
      return page.url;
    })();
    this.resolvedPlanUrls.set(pageId, resolved);
    try { return await resolved; }
    catch (error) { this.resolvedPlanUrls.delete(pageId); throw error; }
  }

  async listTasks(): Promise<TaskSummary[]> {
    const binding = await this.databaseBinding();
    const rows = await this.readAllPages(binding.taskDataSourceId);
    const byId = new Map<string, any>();
    for (const row of rows) {
      if (typeof row?.id !== "string") throw new PublicationError("provider/API failure: task query returned a page without an id");
      byId.set(row.id, row);
    }

    const visibleRows = rows.filter(row => {
      const state = stateOf(row, this.policy.state);
      return state !== "Cancelled" && state !== PUBLISHER_PENDING_STATE;
    });
    const result: TaskSummary[] = [];
    for (const row of visibleRows) {
      const title = titleOf(row, this.policy.title);
      if (typeof row.url !== "string" || !row.url) throw new PublicationError("provider/API failure: task page has no Notion URL");
      const blockedIds = await this.relationIds(row, this.policy.blockedBy);
      const planIds = await this.relationIds(row, "Plan");
      const blockerRows: any[] = [];
      for (const id of blockedIds) blockerRows.push(byId.get(id) ?? await this.client.request("GET", `/pages/${id}`));
      const blockedBy = await Promise.all(blockerRows.map(page => this.pageSummary(page, binding, byId)));
      const planUrl = planIds.length === 1 ? await this.planUrl(planIds[0], binding.planDataSourceId) : null;
      const priority = row.properties?.[this.policy.priority];
      const labels = row.properties?.[this.policy.labels];
      const identifier = row.properties?.[this.policy.identifier];
      result.push({
        title,
        state: stateOf(row, this.policy.state),
        blockedBy,
        priority: priority?.type === "number" && typeof priority.number === "number" ? priority.number : null,
        labels: labels?.type === "multi_select" && Array.isArray(labels.multi_select) ? labels.multi_select.map((item: any) => item?.name).filter((name: any): name is string => typeof name === "string") : [],
        identifier: identifier?.type === "rich_text" ? text(identifier.rich_text) : "",
        taskUrl: row.url,
        planUrl
      });
    }
    return result;
  }
}
