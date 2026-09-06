import { Client } from '@notionhq/client';
import { Policy, schemaProperties } from './policy.js';

export type NotionApi = { request(args: { path: string; method: string; query?: Record<string, string>; body?: unknown }): Promise<any> };
export class NotionError extends Error { constructor(public category: string, message: string) { super(`${category}: ${message}`); } }

export function notionClient(token: string): NotionApi {
  if (!token?.trim()) throw new NotionError('authentication failure', 'NOTION_TOKEN is missing or empty');
  return new Client({ auth: token, notionVersion: '2025-09-03' }) as unknown as NotionApi;
}

async function request(api: NotionApi, args: { path: string; method: string; body?: unknown }) {
  const [rawPath, queryString] = args.path.split('?');
  const path = rawPath.replace(/^\/+/, '');
  const query = queryString ? Object.fromEntries(new URLSearchParams(queryString)) : undefined;
  try { return await api.request({ ...args, path, query }); } catch (error: any) {
    const code = error?.code ?? error?.status;
    if (code === 'unauthorized' || code === 401) throw new NotionError('authentication failure', 'Notion rejected the token');
    if (code === 'object_not_found' || code === 404) throw new NotionError('target inaccessible', 'Notion target was not found or is not shared');
    throw new NotionError('provider/API failure', error?.message ?? String(error));
  }
}

export async function getParent(api: NotionApi, pageId: string) { return request(api, { path: `/pages/${pageId}`, method: 'get' }); }

export async function findDataSource(api: NotionApi, parentId: string, policy: Policy): Promise<any | null> {
  const children: any[] = [];
  let cursor: string | undefined;
  do {
    const query = new URLSearchParams({ page_size: '100' });
    if (cursor) query.set('start_cursor', cursor);
    const result = await request(api, { path: `/blocks/${parentId}/children?${query}`, method: 'get' });
    children.push(...(result.results ?? []));
    cursor = result.has_more ? result.next_cursor : undefined;
  } while (cursor);
  const child = children.find((x: any) => x.type === 'child_database' && x.child_database?.title === policy.dataSourceName);
  if (!child) return null;
  const db = await request(api, { path: `/databases/${child.id}`, method: 'get' });
  const source = db.data_sources?.[0];
  if (source?.id) return request(api, { path: `/data_sources/${source.id}`, method: 'get' });
  return { id: child.id, database_id: child.id, properties: db.properties };
}

export async function bootstrap(api: NotionApi, parentId: string, policy: Policy): Promise<any> {
  const existing = await findDataSource(api, parentId, policy);
  if (existing) { validateSchema(existing, policy); return existing; }
  const database = await request(api, { path: '/databases', method: 'post', body: {
    parent: { type: 'page_id', page_id: parentId }, title: [{ type: 'text', text: { content: policy.dataSourceName } }],
    initial_data_source: { properties: schemaProperties(policy) }
  } });
  const ds = database.data_sources?.[0] ?? database;
  const relation = await request(api, { path: `/data_sources/${ds.id}`, method: 'patch', body: { properties: { [policy.properties.blockedBy]: { relation: { data_source_id: ds.id, type: 'single_property', single_property: {} } } } } });
  const full = await request(api, { path: `/data_sources/${ds.id}`, method: 'get' });
  return { ...full, properties: { ...(full.properties ?? {}), ...(relation.properties ?? {}) } };
}

const typeFor = (property: any) => property?.type;
export function validateSchema(dataSource: any, policy: Policy): void {
  const p = dataSource.properties ?? {};
  const expected: Record<string, string> = { [policy.properties.title]: 'title', [policy.properties.identifier]: 'rich_text', [policy.properties.state]: 'select', [policy.properties.priority]: 'number', [policy.properties.labels]: 'multi_select', [policy.properties.blockedBy]: 'relation', [policy.properties.planSource]: 'url', [policy.properties.created]: 'created_time', [policy.properties.updated]: 'last_edited_time' };
  for (const [name, type] of Object.entries(expected)) if (!p[name] || typeFor(p[name]) !== type) throw new NotionError('incompatible schema', `Property ${name} must have type ${type}`);
  const relation = p[policy.properties.blockedBy].relation;
  if (!relation || relation.data_source_id !== dataSource.id) throw new NotionError('incompatible schema', `${policy.properties.blockedBy} must be a self-relation to Tasks`);
}

export async function queryByIdentifier(api: NotionApi, dataSourceId: string, property: string, identifier: string): Promise<any[]> {
  const r = await request(api, { path: `/data_sources/${dataSourceId}/query`, method: 'post', body: { filter: { property, rich_text: { equals: identifier } } } });
  return r.results ?? [];
}

function richText(content: string) { return [{ type: 'text', text: { content } }]; }
function heading(content: string) { return { object: 'block', type: 'heading_2', heading_2: { rich_text: richText(content) } }; }
function paragraph(content: string) { return { object: 'block', type: 'paragraph', paragraph: { rich_text: content ? richText(content) : [] } }; }
function markdownBlocks(markdown: string) { return markdown.split(/\r?\n/).map(line => paragraph(line)); }

export function taskProperties(policy: Policy, meta: { title: string; identifier: string; state: string; priority: number | null; labels: string[]; planSource: string | null }) {
  const p = policy.properties;
  return { [p.title]: { title: richText(meta.title) }, [p.identifier]: { rich_text: richText(meta.identifier) }, [p.state]: { select: { name: meta.state } }, [p.priority]: { number: meta.priority }, [p.labels]: { multi_select: meta.labels.map(name => ({ name })) }, [p.blockedBy]: { relation: [] }, [p.planSource]: { url: meta.planSource } };
}

export async function publishTask(api: NotionApi, dataSourceId: string, policy: Policy, meta: { title: string; identifier: string; state: string; priority: number | null; labels: string[]; planSource: string | null }, plan: string): Promise<any> {
  let page: any;
  try {
    page = await request(api, { path: '/pages', method: 'post', body: { parent: { type: 'data_source_id', data_source_id: dataSourceId }, properties: taskProperties(policy, meta) } });
    const blocks = [heading(policy.pageHeadings.plan), ...markdownBlocks(plan), heading(policy.pageHeadings.workpad)];
    for (let offset = 0; offset < blocks.length; offset += 100) {
      await request(api, { path: `/blocks/${page.id}/children`, method: 'patch', body: { children: blocks.slice(offset, offset + 100) } });
    }
    return page;
  } catch (error) {
    if (page?.id) { try { await request(api, { path: `/pages/${page.id}`, method: 'patch', body: { archived: true } }); } catch { /* best effort cleanup */ } }
    throw error;
  }
}
