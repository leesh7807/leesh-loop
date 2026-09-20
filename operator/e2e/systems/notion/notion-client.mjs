import { paragraphText, relationIds, selectValue, textValue } from './notion-property-readers.mjs';

const API = 'https://api.notion.com/v1';
const PLAN_PROPERTY = 'Plan';
const PAGE_SIZE = 100;

export class NotionClient {
  constructor({ token = process.env.NOTION_TOKEN, fetcher = globalThis.fetch } = {}) {
    if (!token) throw new Error('NOTION_TOKEN is required for the E2E Notion client');
    this.token = token;
    this.fetcher = fetcher;
    this.bindings = new Map();
  }

  async request(method, path, body, signal) {
    let response;
    try {
      response = await this.fetcher(`${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal || AbortSignal.timeout(15_000)
      });
    } catch (error) {
      throw new Error(`Notion ${method} ${path} transport failed: ${error instanceof Error ? error.message : error}`);
    }
    if (!response.ok) throw new Error(`Notion ${method} ${path} failed with HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
    try { return await response.json(); }
    catch { throw new Error(`Notion ${method} ${path} returned invalid JSON`); }
  }

  async resolveE2ENotionDatabaseBinding(databaseUrl, signal) {
    if (this.bindings.has(databaseUrl)) return this.bindings.get(databaseUrl);
    const databaseId = new URL(databaseUrl).pathname.split('/').pop();
    const database = await this.request('GET', `/databases/${databaseId}`, undefined, signal);
    if (!Array.isArray(database.data_sources)) throw new Error('Notion database returned no data sources');
    const sources = [];
    for (const source of database.data_sources) {
      if (typeof source?.id !== 'string') throw new Error('Notion database returned malformed data-source metadata');
      sources.push({ id: source.id, schema: await this.request('GET', `/data_sources/${source.id}`, undefined, signal) });
    }
    const plans = sources.filter(source => this.isPlanSchema(source.schema));
    const tasks = sources.filter(source => this.isTaskSchema(source.schema, source.id));
    if (sources.length === 1 && this.isPristineSchema(sources[0].schema)) return { databaseId, pristine: true, pristineTaskDataSourceId: sources[0].id };
    if (plans.length !== 1 || tasks.length !== 1) throw new Error('fixed E2E Notion database does not have one canonical task source and one Plan source');
    const task = tasks[0];
    if (task.schema.properties.Plan?.relation?.data_source_id !== plans[0].id) throw new Error('E2E task Plan relation points outside the canonical Plan source');
    const binding = { databaseId, taskDataSourceId: task.id, planDataSourceId: plans[0].id };
    this.bindings.set(databaseUrl, binding);
    return binding;
  }

  isPristineSchema(schema) {
    const properties = schema?.properties || {};
    return Object.keys(properties).length === 1 && Object.values(properties)[0]?.type === 'title';
  }

  invalidateDatabaseBinding(databaseUrl) { this.bindings.delete(databaseUrl); }

  isPlanSchema(schema) {
    const properties = schema?.properties;
    return properties && properties.Identifier?.type === 'rich_text' && properties.Title?.type === 'title' && Object.keys(properties).length === 2;
  }

  isTaskSchema(schema, sourceId) {
    const properties = schema?.properties || {};
    const expected = { Identifier: 'rich_text', Title: 'title', State: 'select', Priority: 'number', Labels: 'multi_select', 'Blocked By': 'relation', Plan: 'relation' };
    return Object.entries(expected).every(([name, type]) => properties[name]?.type === type)
      && properties['Blocked By']?.relation?.data_source_id === sourceId
      && !properties['Blocked By']?.relation?.dual_property
      && !properties.Plan?.relation?.dual_property;
  }

  async queryDataSource(dataSourceId, body = {}, signal) {
    const pages = [];
    let cursor;
    do {
      const response = await this.request('POST', `/data_sources/${dataSourceId}/query`, { page_size: PAGE_SIZE, ...body, ...(cursor ? { start_cursor: cursor } : {}) }, signal);
      if (!Array.isArray(response?.results) || typeof response.has_more !== 'boolean') throw new Error('Notion query returned malformed pagination data');
      pages.push(...response.results);
      cursor = response.has_more ? response.next_cursor : undefined;
      if (response.has_more && !cursor) throw new Error('Notion query omitted next_cursor');
    } while (cursor);
    return pages;
  }

  async readPageBlocks(id, signal) {
    const blocks = [];
    let cursor;
    do {
      const response = await this.request('GET', `/blocks/${id}/children?page_size=${PAGE_SIZE}${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`, undefined, signal);
      if (!Array.isArray(response?.results) || typeof response.has_more !== 'boolean') throw new Error('Notion block response was malformed');
      blocks.push(...response.results);
      cursor = response.has_more ? response.next_cursor : undefined;
      if (response.has_more && !cursor) throw new Error('Notion block response omitted next_cursor');
    } while (cursor);
    return blocks;
  }

  summarizeTaskPage(page) {
    return {
      id: page?.id ?? null,
      url: page?.url ?? null,
      identifier: textValue(page?.properties?.Identifier),
      title: textValue(page?.properties?.Title),
      state: selectValue(page?.properties?.State),
      created_at: page?.created_time ?? null,
      updated_at: page?.last_edited_time ?? null
    };
  }

  async readTask(databaseUrl, identifierOrId, signal) {
    const binding = await this.resolveE2ENotionDatabaseBinding(databaseUrl, signal);
    if (binding.pristine) throw new Error('fixed E2E Notion database is still pristine; the production Publisher must bootstrap it before task readback');
    let page;
    if (/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(identifierOrId)) {
      page = await this.request('GET', `/pages/${identifierOrId}`, undefined, signal);
    } else {
      const rows = await this.queryDataSource(binding.taskDataSourceId, { filter: { property: 'Identifier', rich_text: { equals: identifierOrId } } }, signal);
      if (rows.length !== 1) throw new Error(`Notion task identifier ${identifierOrId} resolved to ${rows.length} pages`);
      page = await this.request('GET', `/pages/${rows[0].id}`, undefined, signal);
    }
    if (page?.parent?.type !== 'data_source_id' || page.parent.data_source_id !== binding.taskDataSourceId) throw new Error('Notion page is outside the fixed E2E task data source');
    const summary = this.summarizeTaskPage(page);
    const planIds = relationIds(page.properties?.[PLAN_PROPERTY]);
    if (!planIds || planIds.length !== 1) throw new Error('E2E task Plan relation is not exactly one page');
    const planPage = await this.request('GET', `/pages/${planIds[0]}`, undefined, signal);
    if (planPage?.parent?.type !== 'data_source_id' || planPage.parent.data_source_id !== binding.planDataSourceId) throw new Error('E2E task Plan points outside the fixed Plan data source');
    const [planBlocks, workpadBlocks] = await Promise.all([this.readPageBlocks(planIds[0], signal), this.readPageBlocks(page.id, signal)]);
    return {
      ...summary,
      plan_id: planIds[0],
      plan_identifier: textValue(planPage.properties?.Identifier),
      accepted_plan: paragraphText(planBlocks),
      workpad: paragraphText(workpadBlocks),
      properties: page.properties,
      parent_data_source_id: page.parent.data_source_id
    };
  }

  async listTasks(databaseUrl, signal) {
    const binding = await this.resolveE2ENotionDatabaseBinding(databaseUrl, signal);
    if (binding.pristine) {
      const pages = await this.queryDataSource(binding.pristineTaskDataSourceId, {}, signal);
      if (pages.length) throw new Error('fixed E2E Notion database is pristine but already contains pages; canonical binding cannot be established safely');
      return [];
    }
    const pages = await this.queryDataSource(binding.taskDataSourceId, {}, signal);
    return pages.map(page => this.summarizeTaskPage(page));
  }

  async listTasksForPlanIdentifier(databaseUrl, planIdentifier, signal) {
    const binding = await this.resolveE2ENotionDatabaseBinding(databaseUrl, signal);
    if (binding.pristine) return [];
    const plans = await this.queryDataSource(binding.planDataSourceId, { filter: { property: 'Identifier', rich_text: { equals: planIdentifier } } }, signal);
    if (plans.length > 1) throw new Error(`Notion Plan identifier ${planIdentifier} resolved to ${plans.length} pages`);
    if (!plans.length) return [];
    const tasks = await this.queryDataSource(binding.taskDataSourceId, { filter: { property: 'Plan', relation: { contains: plans[0].id } } }, signal);
    return tasks.map(page => this.summarizeTaskPage(page));
  }

  async updateTaskState(databaseUrl, pageId, state, signal) {
    await this.request('PATCH', `/pages/${pageId}`, { properties: { State: { select: { name: state } } } }, signal);
    return this.readTask(databaseUrl, pageId, signal);
  }

  async appendWorkpad(pageId, text) {
    const chunks = [];
    let current = '';
    for (const point of text) {
      if (current && current.length + point.length > 1_900) { chunks.push(current); current = ''; }
      current += point;
    }
    if (current || chunks.length === 0) chunks.push(current);
    for (let index = 0; index < chunks.length; index += 50) {
      await this.request('PATCH', `/blocks/${pageId}/children`, { children: chunks.slice(index, index + 50).map(content => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content } }] } })) });
    }
  }
}
