import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { createOperatorUiServer, readRequestBody, WORKFLOW_STATES } from '../operator-ui-server.mjs';
import { openLocalTaskStore } from '../../local_task_store/src/local-task-store.mjs';

const root = resolve(import.meta.dirname, '../../..');

async function listen(server) {
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function testServer(t) {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-operator-test-'));
  const store = await openLocalTaskStore(join(directory, 'local-task-store.sqlite'));
  const server = await createOperatorUiServer({
    root,
    config: { github_repository_url: 'https://github.com/example/project.git' },
    stateDirectory: join(directory, 'state'),
    taskStore: store
  });
  const base = await listen(server);
  t.after(async () => {
    await new Promise(resolveClose => server.close(resolveClose));
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return base;
}

async function request(base, path, options) {
  const response = await fetch(`${base}${path}`, options);
  return { response, body: await response.json() };
}

function json(method, value) {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) };
}

test('request decoding preserves Unicode across byte chunk boundaries', async () => {
  const plan = '# 한국어 😀 café — 𐐷\nentity text: &#x1F600; & <tag>';
  const bytes = Buffer.from(plan, 'utf8');
  const emojiOffset = bytes.indexOf(Buffer.from('😀', 'utf8'));
  const request = (async function* () {
    yield bytes.subarray(0, emojiOffset + 1);
    yield bytes.subarray(emojiOffset + 1);
  })();

  assert.equal(await readRequestBody(request), plan);
  await assert.rejects(
    readRequestBody((async function* () { yield Buffer.from([0x23, 0xf0, 0x28, 0x8c, 0xbc]); })()),
    /encoding|UTF-8/i
  );
});

test('Operator exposes one Local Task Store configuration with no Notion Task links', async t => {
  const base = await testServer(t);
  const { response, body } = await request(base, '/api/v1/config');
  assert.equal(response.status, 200);
  assert.equal(body.defaultState, 'Ready');
  assert.deepEqual(body.states, WORKFLOW_STATES);
  assert.equal(body.githubRepositoryName, 'project');
  assert.equal(body.githubBrowserRepositoryUrl, 'https://github.com/example/project');
  assert.equal(Object.hasOwn(body, 'notionTasksUrl'), false);
  assert.equal(Object.hasOwn(body, 'dashboardUrl'), false);
  assert.deepEqual((await request(base, '/api/v1/tasks')).body.tasks, []);
});

test('Operator publication, ordered records, State, and Blocked By use Local Publisher and Store boundaries', async t => {
  const base = await testServer(t);
  const blockerPlan = '# 2026-10-13-smoke-blocker\n\n## Objective\n\nA Local blocker.';
  const plan = '# 2026-10-13-smoke-review\n\n## Objective\n\nA review task with Korean content: 확인합니다.';
  const blockerPublication = await request(base, '/api/v1/publish', json('POST', {
    plan: blockerPlan, state: 'Backlog', blockedBy: []
  }));
  assert.equal(blockerPublication.response.status, 201);
  const blockerId = blockerPublication.body.page_id;
  const publication = await request(base, '/api/v1/publish', json('POST', {
    plan, state: 'Ready', blockedBy: [blockerId]
  }));
  assert.equal(publication.response.status, 201);
  assert.equal(publication.body.task.acceptedPlan, plan);
  assert.equal(publication.body.task.title, '# 2026-10-13-smoke-review ## Objective A review task with Korean content: 확인합니다.');
  const taskId = publication.body.page_id;

  const list = await request(base, '/api/v1/tasks');
  const listed = list.body.tasks.find(task => task.id === taskId);
  assert.equal(listed.blockedBy[0].taskId, blockerId);
  assert.equal(listed.blockedBy[0].title, '# 2026-10-13-smoke-blocker ## Objective A Local blocker.');
  assert.equal(listed.blockedBy[0].state, 'Backlog');

  const detail = await request(base, `/api/v1/tasks/${taskId}`);
  assert.equal(detail.body.task.acceptedPlan, plan);
  assert.deepEqual(detail.body.workpad, []);
  assert.deepEqual(detail.body.comments, []);

  const comment1 = await request(base, `/api/v1/tasks/${taskId}/comments`, json('POST', { content: '첫 검토 입력입니다.' }));
  const comment2 = await request(base, `/api/v1/tasks/${taskId}/comments`, json('POST', { content: 'Second review input.' }));
  assert.equal(comment1.response.status, 201);
  assert.equal(comment2.response.status, 201);
  const comments = (await request(base, `/api/v1/tasks/${taskId}`)).body.comments;
  assert.deepEqual(comments.map(comment => comment.id), [comment1.body.comment.id, comment2.body.comment.id]);
  assert.deepEqual(comments.map(comment => comment.content), ['첫 검토 입력입니다.', 'Second review input.']);

  const state = await request(base, `/api/v1/tasks/${taskId}/state`, json('PUT', { state: 'Human Review' }));
  assert.equal(state.body.task.state, 'Human Review');
  const blockers = await request(base, `/api/v1/tasks/${taskId}/blocked-by`, json('PUT', { blockedBy: [] }));
  assert.deepEqual(blockers.body.task.blockedBy, []);
  assert.equal((await request(base, `/api/v1/tasks/${taskId}`)).body.task.acceptedPlan, plan);

  const invalid = await request(base, `/api/v1/tasks/${taskId}/blocked-by`, json('PUT', { blockedBy: ['missing-task-id'] }));
  assert.equal(invalid.response.status, 400);
  assert.deepEqual((await request(base, `/api/v1/tasks/${taskId}`)).body.task.blockedBy, []);
  const selfBlocked = await request(base, `/api/v1/tasks/${taskId}/blocked-by`, json('PUT', { blockedBy: [taskId] }));
  assert.equal(selfBlocked.response.status, 400);
  assert.equal((await request(base, `/api/v1/tasks/${taskId}`)).body.task.state, 'Human Review');
});

test('H1-free repeated publication creates independent tasks and blank plans fail explicitly', async t => {
  const base = await testServer(t);
  const plan = '  A plain-language task plan\n\n  with details.  ';
  const first = await request(base, '/api/v1/publish', json('POST', { plan, state: 'Ready' }));
  const second = await request(base, '/api/v1/publish', json('POST', { plan, state: 'Ready' }));
  assert.equal(first.response.status, 201);
  assert.equal(second.response.status, 201);
  assert.notEqual(first.body.page_id, second.body.page_id);
  assert.notEqual(first.body.identifier, second.body.identifier);
  assert.equal(first.body.task.title, 'A plain-language task plan with details.');
  assert.equal(second.body.task.title, 'A plain-language task plan with details. (1)');
  assert.equal(first.body.task.acceptedPlan, plan);
  assert.equal(second.body.task.acceptedPlan, plan);
  assert.equal((await request(base, '/api/v1/tasks')).body.tasks.length, 2);

  const badPlan = await request(base, '/api/v1/publish', json('POST', { plan: ' \n\t ', state: 'Ready' }));
  assert.equal(badPlan.response.status, 400);
  assert.match(badPlan.body.error, /Plan must be a non-empty string/);
  const missing = await request(base, '/api/v1/tasks/missing-task-id');
  assert.equal(missing.response.status, 404);
});

test('Local Task mutations reject cross-origin browser requests and non-JSON bodies', async t => {
  const base = await testServer(t);
  const plan = '# 2026-10-13-operator-origin-check\n\n## Objective\n\nKeep browser writes on the Local Operator origin.';
  const publication = await request(base, '/api/v1/publish', json('POST', { plan, state: 'Ready' }));
  assert.equal(publication.response.status, 201);
  const taskId = publication.body.page_id;
  const crossOrigin = {
    origin: 'https://attacker.example',
    'sec-fetch-site': 'cross-site'
  };

  const crossOriginPublish = await request(base, '/api/v1/publish', {
    method: 'POST',
    headers: { ...crossOrigin, 'content-type': 'text/plain' },
    body: JSON.stringify({ plan: '# 2026-10-13-cross-origin\n\nUnauthorized task.', state: 'Ready' })
  });
  assert.equal(crossOriginPublish.response.status, 403);

  const crossOriginComment = await request(base, `/api/v1/tasks/${taskId}/comments`, {
    method: 'POST',
    headers: { ...crossOrigin, 'content-type': 'text/plain' },
    body: JSON.stringify({ content: 'Unauthorized comment.' })
  });
  assert.equal(crossOriginComment.response.status, 403);

  const crossOriginState = await request(base, `/api/v1/tasks/${taskId}/state`, {
    ...json('PUT', { state: 'Human Review' }),
    headers: { ...crossOrigin, 'content-type': 'application/json' }
  });
  assert.equal(crossOriginState.response.status, 403);

  const crossOriginBlocker = await request(base, `/api/v1/tasks/${taskId}/blocked-by`, {
    ...json('PUT', { blockedBy: [] }),
    headers: { ...crossOrigin, 'content-type': 'application/json' }
  });
  assert.equal(crossOriginBlocker.response.status, 403);

  const nonJsonComment = await request(base, `/api/v1/tasks/${taskId}/comments`, {
    method: 'POST',
    headers: { origin: base, 'content-type': 'text/plain' },
    body: JSON.stringify({ content: 'Wrong media type.' })
  });
  assert.equal(nonJsonComment.response.status, 415);

  const unchanged = await request(base, `/api/v1/tasks/${taskId}`);
  assert.equal((await request(base, '/api/v1/tasks')).body.tasks.length, 1);
  assert.equal(unchanged.body.task.state, 'Ready');
  assert.deepEqual(unchanged.body.task.blockedBy, []);
  assert.deepEqual(unchanged.body.comments, []);

  const sameOriginState = await request(base, `/api/v1/tasks/${taskId}/state`, {
    ...json('PUT', { state: 'Human Review' }),
    headers: { origin: base, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }
  });
  assert.equal(sameOriginState.response.status, 200);
  assert.equal(sameOriginState.body.task.state, 'Human Review');
});

test('rendered UI source keeps Task actions, manager hierarchy, state cues, and responsive styles', async () => {
  const source = await readFile(join(root, 'operator/ui/src/main.jsx'), 'utf8');
  const styles = await readFile(join(root, 'operator/ui/src/style.css'), 'utf8');
  assert.match(source, /Human Review/);
  assert.match(source, /taskGroup\('Active work', groups\.activeWork/);
  assert.match(source, /Accepted Plan/);
  assert.match(source, /publicationReceipt\?\.page_id === taskId/);
  assert.match(source, /Task ID/);
  assert.match(source, /Workpad/);
  assert.match(source, /className="state-toolbar"/);
  assert.match(source, /Save State/);
  assert.match(source, /Save Blocked By/);
  assert.match(source, /Add comment/);
  assert.match(source, /<details className="detail-section accepted-plan-section"/);
  assert.match(source, /Find a task by title, identifier, or State/);
  assert.match(source, /Review selected blockers/);
  assert.match(source, /Show \{remainingBlockers.length\} more/);
  assert.match(source, /className="manager-management"/);
  assert.match(source, /Add a Git repository/);
  assert.match(source, /Unregister Loop/);
  assert.match(source, /Available when Manager confirms Stopped, or confirms a Failed Loop has no active process/i);
  assert.match(source, /Review failure/);
  assert.match(source, /Review ownership/);
  assert.match(source, /selected\.status === 'Failed' \? 'Retry Loop' : 'Start Loop'/);
  assert.match(source, /manager-action manager-recovery-action/);
  assert.match(source, /function openLifecycleDiagnostics\(\)/);
  assert.match(source, /setManagementOpen\(true\)/);
  assert.match(source, /setLogsOpen\(true\)/);
  assert.match(source, /setDiagnosisOpen\(Boolean\(selected\?\.detail\)\)/);
  assert.match(source, /if \(selected\?\.status === 'Unconfirmed' && selected\.detail\)/);
  assert.match(source, /diagnosisSummaryRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /scrollIntoView\(\{ behavior: 'smooth', block: 'nearest' \}\)/);
  assert.match(source, /aria-controls=\{selected\.detail \? 'manager-status-diagnosis manager-logs' : 'manager-logs'\}/);
  assert.match(source, /Lifecycle actions wait for confirmed process ownership/);
  assert.match(source, /The Loop failed and no active process remains\. Review diagnosis and logs before restarting\./);
  assert.doesNotMatch(source, /Startup failed and no active Loop process is confirmed/);
  assert.match(source, /verify which process owns/);
  assert.match(source, /Open Loop logs/);
  assert.match(source, /const runtimePanel = \(/);
  assert.match(source, /<details className="manager-management manager-runtime-empty" open>/);
  assert.match(source, /<summary><span>Manage Runtime<\/span>/);
  assert.match(source, /aria-label="Manager Runtime controls">\{runtimePanel\}<\/div>/);
  assert.match(source, /\{runtimePanel\}/);
  assert.match(source, /Active for new starts/);
  assert.doesNotMatch(source, /Notion|Symphony Dashboard|notionTasksUrl/);
  assert.match(styles, /@media \(max-width: 960px\)/);
  assert.match(styles, /\.state-toolbar \{ position: sticky/);
  assert.match(styles, /\.manager-status\.status-running::before \{ background: #347a54; \}/);
  assert.match(styles, /\.manager-status\.status-starting::before, \.manager-status\.status-stopping::before \{ background: #aa782c; \}/);
  assert.match(styles, /\.manager-status\.status-failed::before, \.manager-status\.status-unconfirmed::before \{ background: #9b4242; \}/);
  assert.match(styles, /\.manager-management > summary/);
  assert.match(styles, /\.manager-runtime-source/);
  assert.match(styles, /\.workflow-diff-line\.added \{ background: #e4eee6; \}/);
  assert.match(styles, /\.workflow-diff-line\.removed \{ background: #f1e5e5; \}/);
});

test('Task detail and list wire the tested serialized refresh queue', async () => {
  const source = await readFile(join(root, 'operator/ui/src/main.jsx'), 'utf8');
  const detail = source.slice(source.indexOf('function TaskDetail'), source.indexOf('function App'));
  const app = source.slice(source.indexOf('function OperatorApp('));

  assert.match(detail, /detailRefreshQueue = useRef\(null\)/);
  assert.match(detail, /detailRefreshQueue\.current = createSerializedRefreshQueue\(\)/);
  assert.match(detail, /detailRefreshQueue\.current\.begin\(\)/);
  assert.match(detail, /detailRefreshQueue\.current\.isCurrent\(requestVersion\)/);
  assert.match(detail, /detailRefreshQueue\.current\.finish\(requestVersion\)/);
  assert.match(detail, /detailRefreshQueue\.current\.invalidate\(\)/);
  assert.match(detail, /void currentRefresh\.current\?\.\(\)/);
  assert.match(detail, /async function saveState\(event\)[\s\S]*?detailRefreshQueue\.current\.invalidate\(\)[\s\S]*?finally \{[\s\S]*?detailRefreshQueue\.current\.invalidate\(\)/);
  assert.match(detail, /const mutationInFlight = useRef\(false\)/);
  assert.equal((detail.match(/if \(mutationInFlight\.current\) return/g) || []).length, 3);
  assert.match(detail, /disabled=\{Boolean\(saving\)\}/);
  assert.match(detail, /disabled=\{Boolean\(saving\) \|\| !commentDraft\.trim\(\)\}/);
  assert.match(app, /taskListRefreshQueue = useRef\(null\)/);
  assert.match(app, /taskListRefreshQueue\.current = createSerializedRefreshQueue\(\)/);
  assert.match(app, /taskListRefreshQueue\.current\.begin\(\)/);
  assert.match(app, /taskListRefreshQueue\.current\.markQueued\(\)/);
  assert.match(app, /taskListRefreshQueue\.current\.finish\(requestVersion\)/);
  assert.match(app, /taskListRefreshQueue\.current\.invalidate\(\)/);
});
