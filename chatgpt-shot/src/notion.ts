import { Client } from '@notionhq/client';
import { fail, ShotError } from './errors.js';

export const STATES = ['pending', 'in_progress', 'completed', 'failed'] as const;
export type State = typeof STATES[number];
export type Invocation = { id: string; pageId: string; state: State; error: string };
const properties = {
  ID: { title: {} }, State: { select: { options: STATES.map(name => ({ name })) } }, Error: { rich_text: {} },
  'Created At': { created_time: {} }, 'Updated At': { last_edited_time: {} }
};
const text = (value: any) => Array.isArray(value) ? value.map((x: any) => x.plain_text ?? x.text?.content ?? '').join('') : '';
export function pageIdFromUrl(value: string): string {
  const matched = value.match(/[0-9a-f]{32}(?:[?#].*)?$/i)?.[0]?.slice(0, 32) ?? value.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)?.[0];
  if (!matched) fail('NOTION_PARENT_PAGE_INVALID', 'The Notion page URL does not contain a page ID.');
  return matched!.replace(/-/g, '');
}
export class NotionStore {
  readonly client: Client;
  constructor(token: string) { this.client = new Client({ auth: token }); }
  async pageAccessible(pageId: string): Promise<void> { try { await this.client.pages.retrieve({ page_id: pageId }); } catch (e) { fail('NOTION_PARENT_PAGE_INACCESSIBLE', 'Configured integration cannot access the parent Notion page.', e); } }
  async database(id: string): Promise<any> { try { return await this.client.databases.retrieve({ database_id: id }); } catch (e) { return fail('NOTION_UNAVAILABLE', 'Configured Invocation database is inaccessible.', e); } }
  validateSchema(database: any): void {
    for (const [name, type] of [['ID','title'],['State','select'],['Error','rich_text'],['Created At','created_time'],['Updated At','last_edited_time']] as const) if (database.properties?.[name]?.type !== type) fail('NOTION_SCHEMA_INVALID', `Required ${name} property is missing or incompatible.`);
    const options = database.properties.State.select.options.map((x: any) => x.name);
    if (!STATES.every(state => options.includes(state))) fail('NOTION_SCHEMA_INVALID', 'State is missing one or more required options.');
  }
  async createDatabase(parentPageId: string): Promise<any> { try { return await this.client.databases.create({ parent: { type: 'page_id', page_id: parentPageId }, title: [{ type: 'text', text: { content: 'ChatGPT Shot Invocations' } }], properties } as any); } catch (e) { return fail('NOTION_INIT_FAILED', 'Could not create Invocation database.', e); } }
  async createInvocation(databaseId: string, id: string): Promise<Invocation> { try { const page: any = await this.client.pages.create({ parent: { database_id: databaseId }, properties: { ID: { title: [{ text: { content: id } }] }, State: { select: { name: 'pending' } }, Error: { rich_text: [] } } }); return { id, pageId: page.id, state: 'pending', error: '' }; } catch (e) { return fail('INVOCATION_CREATE_FAILED', 'Could not create pending invocation.', e); } }
  async readInvocation(pageId: string, id: string): Promise<Invocation> { try { const page: any = await this.client.pages.retrieve({ page_id: pageId }); const state = page.properties?.State?.select?.name; if (!STATES.includes(state)) return fail('INVALID_INVOCATION_STATE', `Invocation ${id} has invalid State.`); return { id, pageId, state, error: text(page.properties?.Error?.rich_text) }; } catch (e) { if (e instanceof ShotError) throw e; return fail('NOTION_UNAVAILABLE', `Could not read invocation ${id}.`, e); } }
  async children(pageId: string): Promise<any[]> { try { let cursor: string | undefined; const all: any[] = []; do { const r: any = await this.client.blocks.children.list({ block_id: pageId, start_cursor: cursor, page_size: 100 }); all.push(...r.results); cursor = r.has_more ? r.next_cursor : undefined; } while(cursor); return all; } catch (e) { return fail('RESULT_READ_FAILED', 'Could not read invocation Result.', e); } }
}
