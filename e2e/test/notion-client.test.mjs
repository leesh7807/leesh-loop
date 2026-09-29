import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NotionClient } from '../systems/notion/notion-client.mjs';

const databaseUrl = `https://app.notion.com/${randomUUID()}`;

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
  const notion = new NotionClient({ token: 'test-token', fetcher });
  assert.deepEqual(await notion.listTasks(databaseUrl), []);
});

test('admission rejects a nonempty pristine database instead of guessing ownership', async () => {
  const fetcher = async url => {
    if (url.includes('/databases/')) return response({ data_sources: [{ id: 'task-source', name: 'Leesh Loop' }] });
    if (url.endsWith('/data_sources/task-source')) return response({ properties: { 이름: { type: 'title' } } });
    if (url.includes('/data_sources/task-source/query')) return response({ results: [{ id: 'page-1' }], has_more: false, next_cursor: null });
    throw new Error(`unexpected URL ${url}`);
  };
  const notion = new NotionClient({ token: 'test-token', fetcher });
  await assert.rejects(() => notion.listTasks(databaseUrl), /already contains pages/);
});

test('Notion requests retry a rate-limited response within the request deadline', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    if (calls === 1) return {
      ok: false,
      status: 429,
      headers: { get: () => null },
      async text() { return JSON.stringify({ additional_data: { retry_after: '0' } }); }
    };
    return response({ id: 'page-1' });
  };
  const notion = new NotionClient({ token: 'test-token', fetcher });
  assert.deepEqual(await notion.request('GET', '/pages/page-1'), { id: 'page-1' });
  assert.equal(calls, 2);
});

test('Notion requests stop after the bounded rate-limit retry count', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return {
      ok: false,
      status: 429,
      headers: { get: () => null },
      async text() { return JSON.stringify({ additional_data: { retry_after: '0' } }); }
    };
  };
  const notion = new NotionClient({ token: 'test-token', fetcher });
  await assert.rejects(() => notion.request('POST', '/data_sources/tasks/query', {}), /failed with HTTP 429/);
  assert.equal(calls, 3);
});
