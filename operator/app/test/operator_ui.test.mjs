import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { execFile as execute } from 'node:child_process';
import { promisify } from 'node:util';
import { createOperatorUiServer, readRequestBody } from '../operator-ui-server.mjs';
import { effective, ensurePublisher, loadConfig as loadOperatorConfig, openProjectSurfaces, projectSurfaces, projectWindowNeedsOpening, uiIdentity, uiRuntimeSourceFiles } from '../leesh-loop.mjs';

const execFile = promisify(execute);
const root = resolve(import.meta.dirname, '../../..');
const cli = join(root, 'operator/app/leesh-loop.mjs');
const databaseUrl = 'https://notion.example/project-surface-test';

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

test('Publisher preparation keeps build output off the Operator JSON stdout channel', async () => {
  const moduleUrl = new URL('../leesh-loop.mjs', import.meta.url).href;
  const source = `import { ensurePublisher } from ${JSON.stringify(moduleUrl)}; ensurePublisher(); console.log(JSON.stringify({ ready: true }));`;
  const { stdout } = await execFile(process.execPath, ['--input-type=module', '-e', source], { cwd: root });
  assert.equal(stdout.trim(), '{"ready":true}');
});

test('task refresh errors do not own or block the independent publication route', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-ui-api-'));
  const calls = [];
  let reads = 0;
  const server = await createOperatorUiServer({
    root,
    config: { notion_database_url: 'https://www.notion.so/example', ui_port: 4310, symphony_port: 4100 },
    stateDirectory: directory,
    publisherConfigPath: join(root, 'operator/notion_publisher/examples/publisher-config.json'),
    publisherState: { states: ['Backlog', 'Ready', 'Human Review'], defaultState: 'Ready' },
    notionToken: 'server-only-fixture-token',
    loadTaskReader: async token => {
      assert.equal(token, 'server-only-fixture-token');
      return { listTasks: async () => {
        reads += 1;
        if (reads === 2) throw new Error('temporary Notion read failure');
        return [{ title: reads === 1 ? 'Last successful task' : 'Recovered task', state: 'Backlog', blockedBy: [], priority: 3, labels: [], identifier: 'PLAN-EXAMPLE', taskUrl: 'https://www.notion.so/task', planUrl: 'https://www.notion.so/plan' }];
      } };
    },
    runPublisher: async input => { calls.push(input); return { identifier: 'PLAN-PUBLISHED', state: input.state || 'Ready', url: 'https://www.notion.so/published' }; }
  });
  server.listen(0, '127.0.0.1');
  await new Promise((resolveListen, rejectListen) => { server.once('listening', resolveListen); server.once('error', rejectListen); });
  t.after(() => new Promise(resolveClose => { server.closeAllConnections(); server.close(resolveClose); }));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  const config = await fetch(`${base}/api/v1/config`).then(response => response.json());
  assert.deepEqual(config.states, ['Backlog', 'Ready', 'Human Review']);
  assert.equal(config.defaultState, 'Ready');
  assert.equal(config.dashboardUrl, 'http://127.0.0.1:4100');

  const first = await fetch(`${base}/api/v1/tasks`);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).tasks[0].title, 'Last successful task');
  const failed = await fetch(`${base}/api/v1/tasks`);
  assert.equal(failed.status, 503);
  assert.match((await failed.json()).error, /temporary Notion read failure/);

  const publication = await fetch(`${base}/api/v1/publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ plan: '# Keep this Plan\n\n## Work', state: 'Human Review', blockedBy: ['task-a', 'task-b'] })
  });
  assert.equal(publication.status, 200);
  assert.equal((await publication.json()).identifier, 'PLAN-PUBLISHED');
  assert.deepEqual(calls, [{ plan: '# Keep this Plan\n\n## Work', state: 'Human Review', blockedBy: ['task-a', 'task-b'] }]);

  const invalidBlockers = await fetch(`${base}/api/v1/publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ plan: '# Invalid blocker list', state: 'Ready', blockedBy: ['task-a', 2] })
  });
  assert.equal(invalidBlockers.status, 400);
  assert.equal(calls.length, 1);

  const withoutBlockers = await fetch(`${base}/api/v1/publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ plan: '# Keep the old path', state: '' })
  });
  assert.equal(withoutBlockers.status, 200);
  assert.deepEqual(calls[1], { plan: '# Keep the old path', state: '' });

  const recovered = await fetch(`${base}/api/v1/tasks`);
  assert.equal(recovered.status, 200);
  assert.equal((await recovered.json()).tasks[0].title, 'Recovered task');
});

test('the desktop browser path opens only the Operator UI', { concurrency: false }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-browser-'));
  const bin = join(directory, 'bin');
  const log = join(directory, 'openers.log');
  await writeFile(join(directory, 'xdg-open'), `#!/bin/sh\nprintf 'xdg-open %s\\n' "$1" >> "$LEESH_LOOP_TEST_LOG"\ncase "$1" in *43445*) sleep 2;; *43446*) exit 7;; *43447*) kill -TERM $$;; esac\n`);
  await writeFile(join(directory, 'override'), `#!/bin/sh\nprintf 'override %s\\n' "$*" >> "$LEESH_LOOP_TEST_LOG"\n`);
  await mkdir(bin);
  await writeFile(join(bin, 'xdg-open'), await readFile(join(directory, 'xdg-open')));
  await writeFile(join(bin, 'override'), await readFile(join(directory, 'override')));
  await Promise.all([chmod(join(bin, 'xdg-open'), 0o755), chmod(join(bin, 'override'), 0o755)]);
  const originalPath = process.env.PATH;
  const originalLog = process.env.LEESH_LOOP_TEST_LOG;
  const originalOverride = process.env.LEESH_LOOP_BROWSER_COMMAND;
  process.env.PATH = `${bin}:${originalPath}`;
  process.env.LEESH_LOOP_TEST_LOG = log;
  delete process.env.LEESH_LOOP_BROWSER_COMMAND;
  t.after(() => {
    process.env.PATH = originalPath;
    if (originalLog === undefined) delete process.env.LEESH_LOOP_TEST_LOG; else process.env.LEESH_LOOP_TEST_LOG = originalLog;
    if (originalOverride === undefined) delete process.env.LEESH_LOOP_BROWSER_COMMAND; else process.env.LEESH_LOOP_BROWSER_COMMAND = originalOverride;
  });

  assert.deepEqual(projectSurfaces({ ui_port: 43445, notion_database_url: 'https://notion.example' }, 'http://dashboard.example'), ['http://127.0.0.1:43445']);
  const started = Date.now();
  await openProjectSurfaces({ ui_port: 43445, notion_database_url: 'https://notion.example', browser_acknowledgement_timeout_ms: 80 }, 'http://dashboard.example/hang');
  assert.ok(Date.now() - started < 500, 'a running xdg-open is a successful handoff after the acknowledgement bound');
  let lines = (await readFile(log, 'utf8')).trim().split('\n');
  assert.deepEqual(lines, ['xdg-open http://127.0.0.1:43445']);

  await assert.rejects(openProjectSurfaces({ ui_port: 43446, browser_acknowledgement_timeout_ms: 80 }, 'http://dashboard.example'), /exited with status 7/);
  await assert.rejects(openProjectSurfaces({ ui_port: 43447, browser_acknowledgement_timeout_ms: 80 }, 'http://dashboard.example'), /terminated by SIGTERM/);
  process.env.PATH = directory;
  await assert.rejects(openProjectSurfaces({ ui_port: 43448 }, 'http://dashboard.example'), /could not launch xdg-open/);
  process.env.PATH = `${bin}:${originalPath}`;
  process.env.LEESH_LOOP_BROWSER_COMMAND = 'override';
  await openProjectSurfaces({ ui_port: 43449 }, 'http://dashboard.example');
  for (let attempt = 0; attempt < 20; attempt += 1) {
    lines = (await readFile(log, 'utf8')).trim().split('\n');
    if (lines.some(line => line.startsWith('override '))) break;
    await new Promise(done => setTimeout(done, 10));
  }
  lines = (await readFile(log, 'utf8')).trim().split('\n');
  assert.equal(lines.filter(line => line.startsWith('override ')).length, 1);
  assert.equal(lines.at(-1), 'override http://127.0.0.1:43449');
});

test('a prior multi-surface startup marker does not suppress the new Operator UI surface', () => {
  assert.equal(projectWindowNeedsOpening({ project_window_opened_at: '2026-09-26T00:00:00.000Z' }), true);
  assert.equal(projectWindowNeedsOpening({ project_window_surfaces: ['operator-ui-v1'] }), false);
});

test('Operator UI reuse identity follows imported modules and served Publisher/UI artifacts', () => {
  const sources = new Set(uiRuntimeSourceFiles().map(path => path.replaceAll('\\', '/')));
  assert.ok(sources.has(`${root}/operator/local-environment.mjs`));
  assert.ok(sources.has(`${root}/operator/app/operator-ui-server.mjs`));
  assert.ok([...sources].some(path => path.endsWith('/operator/notion_publisher/dist/src/task-reader.js')));
  assert.ok([...sources].some(path => path.endsWith('/operator/ui/dist/index.html')));
  assert.equal(uiIdentity({ notion_database_url: 'https://notion.example/db', ui_port: 4310, symphony_port: 4101 }).dashboard_port, 4101);
});

test('start skips desktop dispatch without recording an opening, then opens the Operator UI once when enabled', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-surface-policy-'));
  const stateDirectory = join(directory, 'state');
  const workspaceRoot = join(directory, 'workspaces');
  const configPath = join(directory, 'project.json');
  const runtimeId = 'surface-policy-runtime';
  const dashboardServer = createServer((request, response) => {
    if (request.url === '/api/v1/runtime') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ pid: process.pid, runtime_id: runtimeId, dispatch_capable: true }));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise(resolveListen => dashboardServer.listen(0, '127.0.0.1', resolveListen));
  const dashboardPort = dashboardServer.address().port;
  const temporaryUiServer = createServer();
  await new Promise(resolveListen => temporaryUiServer.listen(0, '127.0.0.1', resolveListen));
  const uiPort = temporaryUiServer.address().port;
  await new Promise(resolveClose => temporaryUiServer.close(resolveClose));

  const browserLog = join(directory, 'browser-dispatch.log');
  const browserCommand = join(directory, 'browser-test-double');
  await writeFile(browserCommand, '#!/bin/sh\nprintf \'%s\\n\' "$@" >> "$LEESH_LOOP_TEST_BROWSER_LOG"\n');
  await chmod(browserCommand, 0o755);
  const project = {
    workflow_path: join(root, 'WORKFLOW.md'),
    symphony_workspace_root: workspaceRoot,
    github_repository_url: 'https://github.com/example/repository.git',
    github_base_branch: 'main',
    open_project_surfaces: false,
    state_directory: stateDirectory,
    symphony_port: dashboardPort,
    ui_port: uiPort,
    workspace_files: []
  };
  await writeFile(configPath, JSON.stringify(project));
  const config = await loadOperatorConfig(configPath, {
    environment: { LEESH_LOOP_NOTION_DATABASE_URL: databaseUrl },
    envFile: join(directory, 'missing.env')
  });
  const acknowledgementPath = join(stateDirectory, 'dispatch-acknowledgement.json');
  await mkdir(stateDirectory, { recursive: true });
  await writeFile(acknowledgementPath, JSON.stringify({ runtime_id: runtimeId, pid: process.pid, dispatch_capable: true }));
  const running = {
    status: 'running',
    runtime_id: runtimeId,
    pid: process.pid,
    effective: effective(config, runtimeId, dashboardPort),
    acknowledgement_path: acknowledgementPath
  };
  await writeFile(join(stateDirectory, 'runtime.json'), JSON.stringify(running));
  const environment = {
    ...process.env,
    LEESH_LOOP_NOTION_DATABASE_URL: databaseUrl,
    LEESH_LOOP_BROWSER_COMMAND: browserCommand,
    LEESH_LOOP_TEST_BROWSER_LOG: browserLog
  };
  t.after(async () => {
    dashboardServer.close();
    await rm(join(stateDirectory, 'runtime.json'), { force: true });
    await execFile(process.execPath, [cli, 'stop', configPath], { env: environment }).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  });

  const disabledStart = await execFile(process.execPath, [cli, 'start', configPath], { env: environment, timeout: 60_000 });
  assert.equal(JSON.parse(disabledStart.stdout).reused, true);
  await assert.rejects(readFile(browserLog, 'utf8'), { code: 'ENOENT' });
  const disabledState = JSON.parse(await readFile(join(stateDirectory, 'runtime.json'), 'utf8'));
  assert.equal(Object.hasOwn(disabledState, 'project_window_opened_at'), false);
  assert.equal(Object.hasOwn(disabledState, 'project_window_surfaces'), false);
  assert.equal((await fetch(`http://127.0.0.1:${uiPort}`)).status, 200);
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${dashboardPort}/api/v1/runtime`)).json(), { pid: process.pid, runtime_id: runtimeId, dispatch_capable: true });

  delete project.open_project_surfaces;
  await writeFile(configPath, JSON.stringify(project));
  const enabledStart = await execFile(process.execPath, [cli, 'start', configPath], { env: environment, timeout: 60_000 });
  assert.equal(JSON.parse(enabledStart.stdout).reused, true);
  let launches = [];
  for (let attempt = 0; attempt < 30; attempt += 1) {
    launches = (await readFile(browserLog, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean);
    if (launches.length === 1) break;
    await new Promise(done => setTimeout(done, 20));
  }
  assert.deepEqual(launches, [`http://127.0.0.1:${uiPort}`]);
  const enabledState = JSON.parse(await readFile(join(stateDirectory, 'runtime.json'), 'utf8'));
  assert.ok(enabledState.project_window_opened_at);
  assert.deepEqual(enabledState.project_window_surfaces, ['operator-ui-v1']);

  await execFile(process.execPath, [cli, 'start', configPath], { env: environment, timeout: 60_000 });
  await new Promise(done => setTimeout(done, 30));
  launches = (await readFile(browserLog, 'utf8')).trim().split('\n').filter(Boolean);
  assert.equal(launches.length, 1);
});
