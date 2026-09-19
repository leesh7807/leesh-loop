import test from 'node:test';
import assert from 'node:assert/strict';
import { NotionCapability } from '../notion.mjs';

const databaseUrl = 'https://app.notion.com/p/studyleesh/3e08a2658625805cad23fe1137be4a1e?v=3e08a26586258042a8e4000c945e56e7';

function response(body, ok = true) {
  return { ok, status: ok ? 200 : 400, async json() { return body; }, async text() { return JSON.stringify(body); } };
}

test('admission accepts an empty pristine database for Publisher bootstrap', async () => {
  const fetcher = async url => {
    if (url.includes('/databases/')) return response({ data_sources: [{ id: 'task-source', name: 'Leesh Loop' }] });
    if (url.endsWith('/data_sources/task-source')) return response({ properties: { 이름: { type: 'title' } } });
    if (url.includes('/data_sources/task-source/query')) return response({ results: [], has_more: false, next_cursor: null });
    throw new Error(`unexpected URL ${url}`);
  };
  const notion = new NotionCapability({ token: 'test-token', fetcher });
  assert.deepEqual(await notion.listTasks(databaseUrl), []);
});

test('admission rejects a nonempty pristine database instead of guessing ownership', async () => {
  const fetcher = async url => {
    if (url.includes('/databases/')) return response({ data_sources: [{ id: 'task-source', name: 'Leesh Loop' }] });
    if (url.endsWith('/data_sources/task-source')) return response({ properties: { 이름: { type: 'title' } } });
    if (url.includes('/data_sources/task-source/query')) return response({ results: [{ id: 'page-1' }], has_more: false, next_cursor: null });
    throw new Error(`unexpected URL ${url}`);
  };
  const notion = new NotionCapability({ token: 'test-token', fetcher });
  await assert.rejects(() => notion.listTasks(databaseUrl), /already contains pages/);
});
