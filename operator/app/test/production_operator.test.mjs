import assert from 'node:assert/strict';
import test from 'node:test';
import { NotionProductionOperator } from '../production-operator.mjs';

const headA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const headB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const databaseUrl = 'https://app.notion.com/p/3df8a265862580cfb1ebda7e3337d9fa?v=3df8a26586258035be00000c6e5832e9';

function page(state = 'Human Review') {
  return {
    id: 'task',
    parent: { type: 'data_source_id', data_source_id: 'source' },
    properties: {
      Identifier: { type: 'rich_text', rich_text: [{ plain_text: 'SELF-1' }] },
      Title: { type: 'title', title: [{ plain_text: 'Investigation' }] },
      State: { type: 'select', select: { name: state } },
      Priority: { type: 'number', number: 3 },
      Labels: { type: 'multi_select', multi_select: [] },
      'Blocked By': { type: 'relation', relation: [] },
      Plan: { type: 'relation', relation: [{ id: 'plan' }] }
    }
  };
}

function fakeNotion(initialState = 'Human Review') {
  const current = page(initialState);
  const schema = {
    properties: {
      Identifier: { type: 'rich_text' }, Title: { type: 'title' }, State: { type: 'select' },
      Priority: { type: 'number' }, Labels: { type: 'multi_select' },
      'Blocked By': { type: 'relation' }, Plan: { type: 'relation' }
    }
  };
  const calls = [];
  const fetcher = async (url, options) => {
    const path = new URL(url).pathname.replace('/v1', '');
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ method: options.method, path, body });
    let value;
    if (options.method === 'GET' && path === '/databases/3df8a265862580cfb1ebda7e3337d9fa') value = { data_sources: [{ id: 'source' }] };
    else if (options.method === 'GET' && path === '/data_sources/source') value = schema;
    else if (options.method === 'PATCH' && path === '/data_sources/source') { Object.assign(schema.properties, body.properties); value = schema; }
    else if (options.method === 'GET' && path === '/pages/task') value = structuredClone(current);
    else if (options.method === 'PATCH' && path === '/pages/task') { for (const [name, property] of Object.entries(body.properties || {})) current.properties[name] = property; value = structuredClone(current); }
    else if (options.method === 'PATCH' && path === '/blocks/task/children') value = { results: [] };
    else throw new Error(`unexpected Notion request ${options.method} ${path}`);
    return { ok: true, status: 200, json: async () => value, text: async () => JSON.stringify(value) };
  };
  return { fetcher, current, calls };
}

test('Human Review approval validates exact review identity, records approved HEAD, and reads back Merging', async () => {
  const fake = fakeNotion();
  const operator = new NotionProductionOperator({
    token: 'token', databaseUrl, fetcher: fake.fetcher,
    readPullRequest: async () => ({ state: 'OPEN', headRefOid: headA }),
    readReviewJob: async () => ({ id: 'job-1', state: 'completed', targetHead: headA, result: '# Verdict\n\nPASS' })
  });
  const result = await operator.approveHumanReview({ taskId: 'task', deliveredPr: 'https://github.com/example/project/pull/1', deliveredHead: headA, reviewTargetHead: headA, reviewJobId: 'job-1' });
  assert.equal(result.outcome, 'approved');
  assert.equal(fake.current.properties.State.select.name, 'Merging');
  assert.equal(fake.current.properties['Approved HEAD'].rich_text[0].text.content, headA);
});

test('Human Review approval does not retain an approval when the PR head changes during mutation', async () => {
  const fake = fakeNotion();
  let reads = 0;
  const operator = new NotionProductionOperator({
    token: 'token', databaseUrl, fetcher: fake.fetcher,
    readPullRequest: async () => ({ state: 'OPEN', headRefOid: ++reads === 1 ? headA : headB }),
    readReviewJob: async () => ({ id: 'job-1', state: 'completed', targetHead: headA, result: 'PASS' })
  });
  const result = await operator.approveHumanReview({ taskId: 'task', deliveredPr: '1', deliveredHead: headA, reviewTargetHead: headA, reviewJobId: 'job-1' });
  assert.equal(result.outcome, 'stale_approval');
  assert.equal(fake.current.properties.State.select.name, 'Rework');
  assert.deepEqual(fake.current.properties['Approved HEAD'].rich_text, []);
});

test('Merging rejects a changed PR HEAD and transitions to Rework instead of reusing stale approval', async () => {
  const fake = fakeNotion('Ready');
  fake.current.properties = { ...page('Merging').properties, 'Approved HEAD': { type: 'rich_text', rich_text: [{ plain_text: headA }] } };
  const operator = new NotionProductionOperator({ token: 'token', databaseUrl, fetcher: fake.fetcher });
  const result = await operator.verifyMergingApproval({ taskId: 'task', deliveredPr: '1', readPullRequest: async () => ({ headRefOid: headB }) });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'stale_approval');
  assert.equal(fake.current.properties.State.select.name, 'Rework');
});

test('stranded closure fences dispatch before terminal transition and refuses a scheduler-ownership race', async () => {
  const fake = fakeNotion('Ready');
  const operator = new NotionProductionOperator({ token: 'token', databaseUrl, fetcher: fake.fetcher });
  let reads = 0;
  const closed = await operator.closeStrandedTask({ taskId: 'task', readExecutionOwnership: async () => { reads += 1; return []; } });
  assert.equal(closed.closed, true);
  assert.equal(fake.current.properties.State.select.name, 'Cancelled');
  assert.ok(fake.current.properties['Dispatch Fence']);
  assert.equal(reads, 2);

  const raceFake = fakeNotion('Ready');
  const raceOperator = new NotionProductionOperator({ token: 'token', databaseUrl, fetcher: raceFake.fetcher });
  let raceReads = 0;
  const raced = await raceOperator.closeStrandedTask({ taskId: 'task', readExecutionOwnership: async () => (++raceReads === 1 ? [] : [{ id: 'execution' }]) });
  assert.equal(raced.closed, false);
  assert.equal(raceFake.current.properties.State.select.name, 'Ready');
  assert.deepEqual(raceFake.current.properties['Dispatch Fence']?.rich_text || [], []);
});
