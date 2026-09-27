import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { execFile as execute } from 'node:child_process';
import { promisify } from 'node:util';
import { effective, ensurePublisher, loadConfig as loadOperatorConfig, openProjectSurfaces, readRequestBody } from '../leesh-loop.mjs';

const execFile = promisify(execute);
const root = resolve(import.meta.dirname, '../../..');
const cli = join(root, 'operator/app/leesh-loop.mjs');
const databaseUrl = 'https://notion.example/project-surface-test';

test('publish request decoding preserves Unicode across byte chunk boundaries', async () => {
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

test('the publish surface orders Plan, publication decision, and secondary navigation in a monochrome responsive layout', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-ui-'));
  const port = 43_500 + Math.floor(Math.random() * 500);
  const config = join(directory, 'project.json');
  const bindingUrl = 'https://www.notion.so/example';
  await writeFile(config, JSON.stringify({
    workflow_path: join(root, 'WORKFLOW.md'),
    symphony_workspace_root: join(directory, 'workspaces'),
    github_repository_url: 'https://github.com/example/repository.git',
    github_base_branch: 'main',
    ui_port: port
  }));
  const child = spawn(process.execPath, [cli, 'serve', config], { stdio: 'ignore', env: { ...process.env, LEESH_LOOP_NOTION_DATABASE_URL: bindingUrl } });
  t.after(() => child.kill('SIGTERM'));
  let response;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { response = await fetch(`http://127.0.0.1:${port}`); break; } catch { await new Promise(done => setTimeout(done, 100)); }
  }
  assert.equal(response?.status, 200);
  const page = await response.text();
  assert.match(page, /<title>Publish a Plan · Leesh Loop<\/title>/);
  assert.match(page, /<meta charset="utf-8">/i);
  assert.match(page, /<form class="plan-workspace" accept-charset="UTF-8" method="post">/i);
  assert.match(response.headers.get('content-type') || '', /text\/html; charset=utf-8/i);
  assert.ok(page.includes(bindingUrl));
  assert.match(page, /Symphony Dashboard/);
  assert.match(page, /Review the Plan/);
  assert.match(page, /Choose publication State/);
  assert.match(page, /Publish Plan/);
  assert.match(page, /Leaving the Publisher default selected keeps the existing Ready default/);
  const publisherConfig = JSON.parse(await readFile(join(root, 'operator/notion_publisher/examples/publisher-config.json'), 'utf8'));
  const renderedStates = [...page.matchAll(/<option value="([^"]*)"/g)].map(([, value]) => value);
  assert.deepEqual(renderedStates, ['', ...publisherConfig.state_seeds]);
  assert.ok(page.indexOf('id="plan-heading"') < page.indexOf('id="decision-heading"'));
  assert.match(page, /@media \(max-width: 44rem\)/);
  assert.match(page, /aria-label="Related work"/);
  assert.doesNotMatch(page, /linear-gradient|box-shadow|accent-color/i);
});

test('the system browser path dispatches every project surface before bounded acknowledgement', { concurrency: false }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-browser-'));
  const bin = join(directory, 'bin');
  const log = join(directory, 'openers.log');
  await writeFile(join(directory, 'xdg-open'), `#!/bin/sh\nprintf 'xdg-open %s\\n' "$1" >> "$LEESH_LOOP_TEST_LOG"\ncase "$1" in *hang*) sleep 2;; *failure*) exit 7;; *signal*) kill -TERM $$;; esac\n`);
  await writeFile(join(directory, 'override'), `#!/bin/sh\nprintf 'override %s\\n' "$*" >> "$LEESH_LOOP_TEST_LOG"\n`);
  await mkdir(bin);
  // The executable names deliberately contain neither Chrome nor Chromium.
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
  const base = { notion_database_url: 'https://notion.example/surface', ui_port: 43444, browser_acknowledgement_timeout_ms: 80 };
  const started = Date.now();
  await openProjectSurfaces({ ...base, ui_port: 43445 }, 'http://dashboard.example/hang');
  assert.ok(Date.now() - started < 500, 'a running xdg-open is a successful handoff after the acknowledgement bound');
  let lines = (await readFile(log, 'utf8')).trim().split('\n');
  assert.deepEqual(lines.sort(), [
    'xdg-open http://127.0.0.1:43445',
    'xdg-open http://dashboard.example/hang',
    'xdg-open https://notion.example/surface'
  ].sort());
  await assert.rejects(openProjectSurfaces({ ...base, notion_database_url: 'https://notion.example/failure' }, 'http://dashboard.example'), /exited with status 7/);
  await assert.rejects(openProjectSurfaces({ ...base, notion_database_url: 'https://notion.example/signal' }, 'http://dashboard.example'), /terminated by SIGTERM/);
  process.env.PATH = directory;
  await assert.rejects(openProjectSurfaces(base, 'http://dashboard.example'), /could not launch xdg-open/);
  process.env.PATH = `${bin}:${originalPath}`;
  process.env.LEESH_LOOP_BROWSER_COMMAND = 'override';
  await openProjectSurfaces(base, 'http://dashboard.example');
  for (let attempt = 0; attempt < 20; attempt += 1) {
    lines = (await readFile(log, 'utf8')).trim().split('\n');
    if (lines.some(line => line.startsWith('override '))) break;
    await new Promise(done => setTimeout(done, 10));
  }
  lines = (await readFile(log, 'utf8')).trim().split('\n');
  assert.equal(lines.filter(line => line.startsWith('override ')).length, 1);
  assert.match(lines.at(-1), /override http:\/\/127\.0\.0\.1:43444 https:\/\/notion\.example\/surface http:\/\/dashboard\.example/);
});

test('start skips desktop dispatch without recording an opening, then opens once when enabled on the same runtime', async t => {
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
  assert.equal((await fetch(`http://127.0.0.1:${uiPort}`)).status, 200);
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${dashboardPort}/api/v1/runtime`)).json(), { pid: process.pid, runtime_id: runtimeId, dispatch_capable: true });

  delete project.open_project_surfaces;
  await writeFile(configPath, JSON.stringify(project));
  const enabledStart = await execFile(process.execPath, [cli, 'start', configPath], { env: environment, timeout: 60_000 });
  assert.equal(JSON.parse(enabledStart.stdout).reused, true);
  let launches = [];
  for (let attempt = 0; attempt < 30; attempt += 1) {
    launches = (await readFile(browserLog, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean);
    if (launches.length === 3) break;
    await new Promise(done => setTimeout(done, 20));
  }
  assert.deepEqual(launches.sort(), [
    `http://127.0.0.1:${uiPort}`,
    databaseUrl,
    `http://127.0.0.1:${dashboardPort}`
  ].sort());
  const enabledState = JSON.parse(await readFile(join(stateDirectory, 'runtime.json'), 'utf8'));
  assert.ok(enabledState.project_window_opened_at);

  await execFile(process.execPath, [cli, 'start', configPath], { env: environment, timeout: 60_000 });
  await new Promise(done => setTimeout(done, 30));
  launches = (await readFile(browserLog, 'utf8')).trim().split('\n').filter(Boolean);
  assert.equal(launches.length, 3);
});
