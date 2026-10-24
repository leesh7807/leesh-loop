import assert from 'node:assert/strict';
import { execFile as execute } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createManagerController, ensureManagerService, managerApiToken, managerBrowserBootstrapHtml, managerRequest } from '../manager-service.mjs';
import { createOperatorUiServer } from '../operator-ui-server.mjs';
import { hashDistribution } from '../installation-metadata.mjs';
import { allocatePort, loopInstanceStatus, stopLoopInstance } from '../manager-lifecycle.mjs';
import { createLoopInstance, listLoopInstances, managerPaths } from '../manager-storage.mjs';

const execFile = promisify(execute);
const sourceRoot = resolve(import.meta.dirname, '../../..');

async function git(cwd, ...args) {
  return execFile('git', args, { cwd, encoding: 'utf8' });
}

async function makeRepository(root, name) {
  const repository = join(root, name);
  await mkdir(repository, { recursive: true });
  await git(repository, 'init', '--quiet', '-b', 'main');
  await git(repository, 'config', 'user.name', 'Manager Test');
  await git(repository, 'config', 'user.email', 'manager-test@example.invalid');
  await writeFile(join(repository, 'README.md'), `# ${name}\n`);
  await git(repository, 'add', 'README.md');
  await git(repository, 'commit', '--quiet', '-m', 'test repository');
  await git(repository, 'remote', 'add', 'origin', `https://github.com/example/${name}.git`);
  const head = (await git(repository, 'rev-parse', 'HEAD')).stdout.trim();
  await git(repository, 'update-ref', 'refs/remotes/origin/main', head);
  await git(repository, 'config', 'branch.main.remote', 'origin');
  await git(repository, 'config', 'branch.main.merge', 'refs/heads/main');
  return repository;
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-manager-'));
  const environment = {
    ...process.env,
    XDG_DATA_HOME: join(directory, 'xdg-data'),
    XDG_STATE_HOME: join(directory, 'xdg-state'),
    XDG_CONFIG_HOME: join(directory, 'xdg-config')
  };
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, environment, homeDirectory: directory };
}

async function startManagerFixture(t, paths, { runtimeId, lifecycle } = {}) {
  const reservation = createHttpServer();
  await new Promise((resolveListen, rejectListen) => {
    reservation.once('error', rejectListen);
    reservation.listen(0, '127.0.0.1', resolveListen);
  });
  const port = reservation.address().port;
  await new Promise(resolveClose => reservation.close(resolveClose));

  const root = join(paths.directory, 'web-root');
  await mkdir(join(root, 'operator/ui/dist'), { recursive: true });
  await writeFile(join(root, 'operator/ui/dist/index.html'), '<h1>Manager</h1>');
  const masterToken = 'a'.repeat(64);
  const token = runtimeId ? managerApiToken(masterToken, runtimeId) : masterToken;
  const managerController = createManagerController({
    runtimeRoot: sourceRoot,
    sourceRoot,
    token,
    port,
    environment: paths.environment,
    homeDirectory: paths.homeDirectory,
    lifecycle
  });
  const server = await createOperatorUiServer({ root, managerController, managerToken: token, managerPort: port });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, '127.0.0.1', resolveListen);
  });
  t.after(() => new Promise(resolveClose => {
    server.close(resolveClose);
    server.closeAllConnections();
  }));
  return { port, token, masterToken, url: `http://127.0.0.1:${port}`, controller: managerController };
}

async function installTestRuntime(paths, directoryName = 'fixture-runtime') {
  const managedPaths = managerPaths(paths);
  const version = '0.1.0';
  const filename = 'runtime-fixture.mjs';
  const contents = Buffer.from(`${directoryName}\n`);
  const mode = 0o644;
  const id = hashDistribution(version, [[filename, contents, mode]]);
  const runtimePath = join(managedPaths.runtimeRoot, id);
  await mkdir(managedPaths.configRoot, { recursive: true });
  await mkdir(runtimePath, { recursive: true });
  const codePath = join(runtimePath, filename);
  await writeFile(codePath, contents, { mode });
  await chmod(codePath, mode);
  await writeFile(join(runtimePath, '.distribution.json'), `${JSON.stringify({ schema_version: 1, id, version, path: runtimePath, files: [filename] })}\n`, { mode: 0o600 });
  await writeFile(managedPaths.activeRuntime, `${JSON.stringify({ schema_version: 1, id })}\n`, { mode: 0o600 });
  return { id, path: runtimePath };
}

async function api(manager, path, { method = 'GET', instanceId, body, origin } = {}) {
  const headers = { 'x-leesh-loop-token': manager.token, accept: 'application/json' };
  if (instanceId) headers['x-leesh-loop-instance-id'] = instanceId;
  if (origin) headers.origin = origin;
  const options = { method, headers };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${manager.url}${path}`, options);
  return { response, body: await response.json().catch(() => null) };
}

test('managed instances share one Runtime and keep their files and Task Stores isolated', async t => {
  const paths = await fixture(t);
  const repositories = join(paths.directory, 'repositories');
  const firstRoot = await makeRepository(repositories, 'first-project');
  const secondRoot = await makeRepository(repositories, 'second-project');

  const first = await createLoopInstance(firstRoot, { sourceRoot, ...paths });
  const second = await createLoopInstance(secondRoot, { sourceRoot, ...paths });
  assert.notEqual(first.id, second.id);
  assert.equal((await listLoopInstances(paths)).length, 2);
  await assert.rejects(createLoopInstance(firstRoot, { sourceRoot, ...paths }), /already managed/);

  for (const instance of [first, second]) {
    const files = await readdir(instance.data_directory);
    assert.ok(files.includes('project.toml'));
    assert.ok(files.includes('WORKFLOW.md'));
    assert.ok(!files.includes('.env.example'));
    assert.ok(!files.includes('operator'));
    assert.match(await readFile(join(instance.data_directory, 'project.toml'), 'utf8'), /github_base_branch = "main"/);
    assert.doesNotMatch(await readFile(join(instance.data_directory, 'project.toml'), 'utf8'), /ui_port|symphony_port/);
  }
  const managerPathsForUser = managerPaths(paths);
  assert.ok(managerPathsForUser.runtimeRoot.startsWith(managerPathsForUser.dataRoot));
  assert.equal((await readdir(managerPathsForUser.runtimeRoot).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error))).length, 0);

  const manager = await startManagerFixture(t, paths);
  const relativeRepository = await api(manager, '/api/v1/instances', {
    method: 'POST', origin: manager.url,
    body: { repositoryPath: 'repositories/third-project' }
  });
  assert.equal(relativeRepository.response.status, 400);
  const thirdRoot = await makeRepository(repositories, 'third-project');
  const createdThroughManager = await api(manager, '/api/v1/instances', {
    method: 'POST', origin: manager.url,
    body: { repositoryPath: thirdRoot }
  });
  assert.equal(createdThroughManager.response.status, 201);
  assert.equal(createdThroughManager.body.instance.repository_root, thirdRoot);

  const publishedFirst = await api(manager, '/api/v1/publish', {
    method: 'POST', instanceId: first.id, origin: manager.url,
    body: { plan: '# First project task\n\n## Objective\nKeep this task in the first store.', state: 'Ready' }
  });
  const publishedSecond = await api(manager, '/api/v1/publish', {
    method: 'POST', instanceId: second.id, origin: manager.url,
    body: { plan: '# Second project task\n\n## Objective\nKeep this task in the second store.', state: 'Backlog' }
  });
  assert.equal(publishedFirst.response.status, 201);
  assert.equal(publishedSecond.response.status, 201);

  const firstTasks = await api(manager, '/api/v1/tasks', { instanceId: first.id });
  const secondTasks = await api(manager, '/api/v1/tasks', { instanceId: second.id });
  assert.deepEqual(firstTasks.body.tasks.map(task => task.id), [publishedFirst.body.page_id]);
  assert.deepEqual(secondTasks.body.tasks.map(task => task.id), [publishedSecond.body.page_id]);
  assert.equal(firstTasks.body.tasks[0].state, 'Ready');
  assert.equal(secondTasks.body.tasks[0].state, 'Backlog');

  const wrongToken = await fetch(`${manager.url}/api/v1/instances`, { headers: { host: `127.0.0.1:${manager.port}` } });
  assert.equal(wrongToken.status, 403);
  const crossOrigin = await api(manager, `/api/v1/tasks/${encodeURIComponent(publishedFirst.body.page_id)}/state`, {
    method: 'PUT', instanceId: first.id, origin: 'http://outside.example', body: { state: 'Cancelled' }
  });
  assert.equal(crossOrigin.response.status, 403);

  const taskReadback = await api(manager, `/api/v1/tasks/${encodeURIComponent(publishedFirst.body.page_id)}`, { instanceId: first.id });
  assert.equal(taskReadback.body.task.state, 'Ready');
  assert.equal(taskReadback.body.comments.length, 0);

  const page = await fetch(manager.url);
  const pageText = await page.text();
  assert.equal(page.status, 200);
  assert.equal(pageText, '<h1>Manager</h1>');
  assert.ok(!pageText.includes(manager.token));
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('Manager Host validation rejects an unauthorized Host header', async t => {
  const paths = await fixture(t);
  const manager = await startManagerFixture(t, paths);
  const response = await new Promise((resolveResponse, rejectResponse) => {
    const request = httpRequest({
      hostname: '127.0.0.1',
      port: manager.port,
      path: '/api/v1/manager',
      method: 'GET',
      headers: { host: `localhost:${manager.port}`, 'x-leesh-loop-token': manager.token }
    }, resolveResponse);
    request.once('error', rejectResponse);
    request.end();
  });
  assert.equal(response.statusCode, 403);
});

test('Manager API token is bound to the immutable Runtime and rejects the persisted master token', async t => {
  const paths = await fixture(t);
  const masterToken = 'c'.repeat(64);
  const token = managerApiToken(masterToken, 'runtime-version-2');
  const controller = createManagerController({
    runtimeRoot: sourceRoot,
    token,
    port: 4320,
    environment: paths.environment,
    homeDirectory: paths.homeDirectory
  });
  const request = candidate => ({ headers: { host: '127.0.0.1:4320', 'x-leesh-loop-token': candidate } });

  assert.notEqual(token, masterToken);
  assert.notEqual(token, managerApiToken(masterToken, 'runtime-version-1'));
  assert.equal(await controller.authorize(request(token)), true);
  assert.equal(await controller.authorize(request(masterToken)), false);
});

test('Manager browser bootstrap keeps its credential in the private local bootstrap document', () => {
  const token = 'd'.repeat(64);
  const html = managerBrowserBootstrapHtml('http://127.0.0.1:4320', token);

  assert.match(html, new RegExp(`location\\.replace\\("http://127\\.0\\.0\\.1:4320/#manager-token=${token}"\\)`));
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /no-referrer/);
});

test('Manager serializes start and stop requests for the same instance', async t => {
  const paths = await fixture(t);
  let resolveStart;
  let signalStart;
  const startEntered = new Promise(resolve => { signalStart = resolve; });
  let stopStarted = false;
  const manager = await startManagerFixture(t, paths, {
    lifecycle: {
      start: id => {
        signalStart();
        return new Promise(resolve => { resolveStart = () => resolve({ id, status: 'Starting' }); });
      },
      stop: async id => { stopStarted = true; return { id, status: 'Stopped', stopped: true }; }
    }
  });
  const instanceId = '123e4567-e89b-42d3-a456-426614174000';

  const startRequest = api(manager, `/api/v1/instances/${instanceId}/start`, { method: 'POST' });
  await startEntered;
  const stopRequest = api(manager, `/api/v1/instances/${instanceId}/stop`, { method: 'POST' });
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(stopStarted, false);

  resolveStart();
  const [started, stopped] = await Promise.all([startRequest, stopRequest]);
  assert.equal(started.response.status, 202);
  assert.equal(started.body.instance.status, 'Starting');
  assert.equal(stopped.response.status, 200);
  assert.equal(stopped.body.instance.stopped, true);
  assert.equal(stopStarted, true);
});

test('Manager serializes Workflow replacement with start for the same instance', async t => {
  const paths = await fixture(t);
  let resolveUpdate;
  let signalUpdate;
  const updateEntered = new Promise(resolve => { signalUpdate = resolve; });
  let startStarted = false;
  const manager = await startManagerFixture(t, paths, {
    lifecycle: {
      updateWorkflow: id => {
        signalUpdate();
        return new Promise(resolve => { resolveUpdate = () => resolve({ id, updated: true, changed: true }); });
      },
      start: async id => { startStarted = true; return { id, status: 'Starting' }; }
    }
  });
  const instanceId = '123e4567-e89b-42d3-a456-426614174000';

  const updateRequest = api(manager, `/api/v1/instances/${instanceId}/workflow`, {
    method: 'PUT', body: { confirm: true, expectedCurrent: 'reviewed workflow' }
  });
  await updateEntered;
  const startRequest = api(manager, `/api/v1/instances/${instanceId}/start`, { method: 'POST' });
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(startStarted, false);

  resolveUpdate();
  const [updated, started] = await Promise.all([updateRequest, startRequest]);
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.updated, true);
  assert.equal(started.response.status, 202);
  assert.equal(startStarted, true);
});

test('Manager CLI recognizes a previous Runtime through its legacy credential so update can restart it', async t => {
  const paths = await fixture(t);
  const runtime = await installTestRuntime(paths, 'cli-fixture-runtime');
  const manager = await startManagerFixture(t, paths);
  const managedPaths = managerPaths(paths);
  await mkdir(managedPaths.configRoot, { recursive: true });
  await mkdir(managedPaths.managerStateRoot, { recursive: true });
  await writeFile(managedPaths.managerToken, `${manager.masterToken}\n`, { mode: 0o600 });
  await writeFile(managedPaths.managerConfiguration, `${JSON.stringify({ schema_version: 1, port: manager.port, symphony_port_min: 4200, symphony_port_max: 4209 })}\n`, { mode: 0o600 });
  const processStat = readFileSync(`/proc/${process.pid}/stat`, 'utf8');
  const processStartTicks = processStat.slice(processStat.lastIndexOf(')') + 1).trim().split(/\s+/)[19];
  await writeFile(managedPaths.managerServiceRecord, `${JSON.stringify({
    schema_version: 1,
    pid: process.pid,
    process_start_ticks: processStartTicks,
    host: '127.0.0.1',
    port: manager.port,
    runtime_path: runtime.path,
    runtime_version: 'legacy-runtime-id'
  })}\n`, { mode: 0o600 });

  const confirmed = await ensureManagerService({ sourceRoot, environment: paths.environment, homeDirectory: paths.homeDirectory });

  assert.equal(confirmed.alreadyRunning, true);
  assert.equal(confirmed.token, manager.masterToken);
  assert.equal(confirmed.managerRestartRequired, true);
  assert.equal(confirmed.managerRuntimeVersion, 'legacy-runtime-id');
  await assert.rejects(managerRequest(confirmed, '/api/v1/instances'), /only be used to restart/);
  const replacementMaster = (await readFile(managedPaths.managerApiMaster, 'utf8')).trim();
  assert.match(replacementMaster, /^[a-f0-9]{64}$/);
  assert.notEqual(replacementMaster, manager.masterToken);
});

test('port allocation skips externally occupied ports and reports an exhausted range', async t => {
  const paths = await fixture(t);
  const externalPort = createNetServer();
  let occupiedRange;
  t.after(async () => {
    for (const server of [externalPort, occupiedRange]) {
      if (server?.listening) await new Promise(resolveClose => server.close(resolveClose));
    }
  });
  await new Promise((resolveListen, rejectListen) => {
    externalPort.once('error', rejectListen);
    externalPort.listen(0, '127.0.0.1', resolveListen);
  });
  const first = externalPort.address().port;
  assert.ok(first < 65535);
  const nextPortProbe = createNetServer();
  await new Promise((resolveListen, rejectListen) => {
    nextPortProbe.once('error', rejectListen);
    nextPortProbe.listen(first + 1, '127.0.0.1', resolveListen);
  });
  await new Promise(resolveClose => nextPortProbe.close(resolveClose));

  const managerState = managerPaths(paths);
  assert.equal(await allocatePort(managerState, { minPort: first, maxPort: first + 1 }), first + 1);
  occupiedRange = createNetServer();
  await new Promise((resolveListen, rejectListen) => {
    occupiedRange.once('error', rejectListen);
    occupiedRange.listen(first + 1, '127.0.0.1', resolveListen);
  });
  await assert.rejects(allocatePort(managerState, { minPort: first, maxPort: first + 1 }), /no available Symphony port/);
  await new Promise(resolveClose => occupiedRange.close(resolveClose));
  await new Promise(resolveClose => externalPort.close(resolveClose));
});

test('port allocation releases ports held only by stale execution records', async t => {
  const paths = await fixture(t);
  const firstRoot = await makeRepository(join(paths.directory, 'repositories'), 'stale-port-owner');
  const secondRoot = await makeRepository(join(paths.directory, 'repositories'), 'next-port-user');
  const first = await createLoopInstance(firstRoot, { sourceRoot, ...paths });
  await createLoopInstance(secondRoot, { sourceRoot, ...paths });
  const portProbe = createNetServer();
  await new Promise((resolveListen, rejectListen) => {
    portProbe.once('error', rejectListen);
    portProbe.listen(0, '127.0.0.1', resolveListen);
  });
  const port = portProbe.address().port;
  await new Promise(resolveClose => portProbe.close(resolveClose));

  const managerState = managerPaths(paths);
  const executionDirectory = join(managerState.loopExecutionRoot, first.id);
  await mkdir(executionDirectory, { recursive: true });
  await writeFile(join(executionDirectory, 'execution.json'), `${JSON.stringify({
    schema_version: 1,
    id: first.id,
    status: 'Running',
    port,
    runtime_path: join(paths.directory, 'missing-runtime'),
    runtime_version: 'stale-runtime'
  })}\n`);

  assert.equal(await allocatePort(managerState, { minPort: port, maxPort: port, ...paths }), port);
  const reconciled = JSON.parse(await readFile(join(executionDirectory, 'execution.json'), 'utf8'));
  assert.equal(reconciled.status, 'Failed');
});

test('Running requires a matching process identity, ownership, dispatch acknowledgement, and runtime API', async t => {
  const paths = await fixture(t);
  const repository = await makeRepository(join(paths.directory, 'repositories'), 'running-project');
  const instance = await createLoopInstance(repository, { sourceRoot, ...paths });
  const managerState = managerPaths(paths);
  const runtime = await installTestRuntime(paths, 'status-fixture-runtime');
  const runtimeId = runtime.id;
  const runtimePath = runtime.path;

  const runtimeApi = createHttpServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ runtime_id: 'runtime-running-1', pid: process.pid, dispatch_capable: true }));
  });
  await new Promise(resolveListen => runtimeApi.listen(0, '127.0.0.1', resolveListen));
  t.after(() => new Promise(resolveClose => runtimeApi.close(resolveClose)));
  const port = runtimeApi.address().port;
  const processStat = readFileSync(`/proc/${process.pid}/stat`, 'utf8');
  const startTicks = processStat.slice(processStat.lastIndexOf(')') + 1).trim().split(/\s+/)[19];
  const executionDirectory = join(managerState.loopExecutionRoot, instance.id);
  await mkdir(executionDirectory, { recursive: true });
  const runtimeStatePath = join(executionDirectory, 'runtime.json');
  const ownershipPath = join(executionDirectory, 'ownership.json');
  const acknowledgementPath = join(executionDirectory, 'dispatch-acknowledgement.json');
  await writeFile(ownershipPath, `${JSON.stringify({ project_root: runtimePath, runtime_id: 'runtime-running-1', pid: process.pid, process_start_ticks: startTicks })}\n`);
  await writeFile(acknowledgementPath, `${JSON.stringify({ runtime_id: 'runtime-running-1', pid: process.pid, dispatch_capable: true })}\n`);
  await writeFile(runtimeStatePath, `${JSON.stringify({
    status: 'running',
    runtime_id: 'runtime-running-1',
    pid: process.pid,
    process_start_ticks: startTicks,
    effective: { dashboard: `http://127.0.0.1:${port}` },
    ownership_path: ownershipPath,
    acknowledgement_path: acknowledgementPath
  })}\n`);
  await writeFile(join(executionDirectory, 'execution.json'), `${JSON.stringify({ schema_version: 1, id: instance.id, status: 'Starting', runtime_path: runtimePath, runtime_version: runtimeId, port })}\n`);

  const observed = await loopInstanceStatus(instance.id, paths);
  assert.equal(observed.status, 'Running');
  assert.equal(observed.port, port);
  const executionPath = join(executionDirectory, 'execution.json');
  const execution = JSON.parse(await readFile(executionPath, 'utf8'));
  await writeFile(executionPath, `${JSON.stringify({ ...execution, status: 'Stopping' })}\n`);
  assert.equal((await loopInstanceStatus(instance.id, { ...paths, isLifecycleOperationActive: () => true })).status, 'Stopping');
  assert.equal((await loopInstanceStatus(instance.id, paths)).status, 'Running');
  const state = JSON.parse(await readFile(runtimeStatePath, 'utf8'));
  await writeFile(runtimeStatePath, `${JSON.stringify({ ...state, process_start_ticks: 'reused-pid' })}\n`);
  const replaced = await loopInstanceStatus(instance.id, paths);
  assert.equal(replaced.status, 'Unconfirmed');
  assert.match(replaced.detail, /PID .* reused/);
});

test('a stale Starting record without launcher identity remains Unconfirmed', async t => {
  const paths = await fixture(t);
  const repository = await makeRepository(join(paths.directory, 'repositories'), 'unconfirmed-project');
  const instance = await createLoopInstance(repository, { sourceRoot, ...paths });
  const executionDirectory = join(managerPaths(paths).loopExecutionRoot, instance.id);
  await mkdir(executionDirectory, { recursive: true });
  await writeFile(join(executionDirectory, 'execution.json'), `${JSON.stringify({
    schema_version: 1,
    id: instance.id,
    status: 'Starting',
    runtime_path: '/missing-runtime',
    runtime_version: 'unknown',
    port: 4199,
    started_at: new Date(Date.now() - 20_000).toISOString()
  })}\n`);

  const observed = await loopInstanceStatus(instance.id, paths);
  assert.equal(observed.status, 'Unconfirmed');
  assert.match(observed.detail, /identity was not recorded/);
});

test('stop does not report success while a recorded launcher is still starting', async t => {
  const paths = await fixture(t);
  const repository = await makeRepository(join(paths.directory, 'repositories'), 'starting-project');
  const instance = await createLoopInstance(repository, { sourceRoot, ...paths });
  const managerState = managerPaths(paths);
  const executionDirectory = join(managerState.loopExecutionRoot, instance.id);
  await mkdir(executionDirectory, { recursive: true });
  const processStat = readFileSync(`/proc/${process.pid}/stat`, 'utf8');
  const startTicks = processStat.slice(processStat.lastIndexOf(')') + 1).trim().split(/\s+/)[19];
  const executionPath = join(executionDirectory, 'execution.json');
  await writeFile(executionPath, `${JSON.stringify({
    schema_version: 1,
    id: instance.id,
    status: 'Starting',
    launcher_pid: process.pid,
    launcher_start_ticks: startTicks,
    started_at: new Date().toISOString(),
    port: 4199
  })}\n`);

  await assert.rejects(stopLoopInstance(instance.id, { ...paths, timeoutMs: 20 }), /startup remains Starting/);
  assert.equal(JSON.parse(await readFile(executionPath, 'utf8')).status, 'Starting');
});

test('CLI init and list use the same central instance registry as the Manager UI', async t => {
  const paths = await fixture(t);
  const runtime = await installTestRuntime(paths, 'cli-fixture-runtime');
  const manager = await startManagerFixture(t, paths, { runtimeId: runtime.id });
  const managedPaths = managerPaths(paths);
  const runtimeId = runtime.id;
  const runtimePath = runtime.path;
  await mkdir(managedPaths.configRoot, { recursive: true });
  await mkdir(managedPaths.managerStateRoot, { recursive: true });
  await writeFile(managedPaths.managerApiMaster, `${manager.masterToken}\n`, { mode: 0o600 });
  await writeFile(managedPaths.managerConfiguration, `${JSON.stringify({ schema_version: 1, port: manager.port, symphony_port_min: 4200, symphony_port_max: 4209 })}\n`, { mode: 0o600 });
  const processStat = readFileSync(`/proc/${process.pid}/stat`, 'utf8');
  const processStartTicks = processStat.slice(processStat.lastIndexOf(')') + 1).trim().split(/\s+/)[19];
  await writeFile(managedPaths.managerServiceRecord, `${JSON.stringify({
    schema_version: 1,
    pid: process.pid,
    process_start_ticks: processStartTicks,
    host: '127.0.0.1',
    port: manager.port,
    runtime_path: runtimePath,
    runtime_version: runtimeId
  })}\n`, { mode: 0o600 });

  const browserCapture = join(paths.directory, 'browser-argument.txt');
  const browserCommand = join(paths.directory, 'capture-browser.mjs');
  await writeFile(browserCommand, `#!/usr/bin/env node\nimport { writeFile } from 'node:fs/promises';\nawait writeFile(${JSON.stringify(browserCapture)}, process.argv[2] || '');\n`, { mode: 0o700 });
  await chmod(browserCommand, 0o700);
  paths.environment.LEESH_LOOP_BROWSER_COMMAND = browserCommand;
  await ensureManagerService({ sourceRoot, openBrowser: true, environment: paths.environment, homeDirectory: paths.homeDirectory });
  let browserArgument;
  for (let attempt = 0; attempt < 50 && browserArgument === undefined; attempt += 1) {
    browserArgument = await readFile(browserCapture, 'utf8').catch(error => error?.code === 'ENOENT' ? undefined : Promise.reject(error));
    if (browserArgument === undefined) await new Promise(resolveSleep => setTimeout(resolveSleep, 20));
  }
  assert.ok(browserArgument);
  assert.equal(new URL(browserArgument).protocol, 'file:');
  assert.ok(!browserArgument.includes(manager.token));
  const bootstrapPath = fileURLToPath(new URL(browserArgument));
  const bootstrapHtml = await readFile(bootstrapPath, 'utf8');
  assert.ok(bootstrapHtml.includes(`#manager-token=${manager.token}`));
  assert.equal((await lstat(bootstrapPath)).mode & 0o077, 0);

  const repository = await makeRepository(join(paths.directory, 'repositories'), 'cli-project');
  const cli = resolve(import.meta.dirname, '../../../bin/leesh-loop.mjs');
  const initialized = await execFile(process.execPath, [cli, 'init'], { cwd: repository, env: paths.environment, encoding: 'utf8', timeout: 10_000 });
  assert.match(initialized.stdout, /Leesh Loop instance created: cli-project/);
  const listed = await execFile(process.execPath, [cli, 'list'], { cwd: paths.directory, env: paths.environment, encoding: 'utf8', timeout: 10_000 });
  assert.match(listed.stdout, /cli-project/);
  assert.match(listed.stdout, new RegExp(repository.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(listed.stdout, /r\s+e\s+p\s+o\s+i\s+t/);

  const uiList = await api(manager, '/api/v1/instances');
  assert.deepEqual(uiList.body.instances.map(instance => instance.repository_root), [repository]);
});

test('Workflow updates require a stopped selected instance and preserve the prior file', async t => {
  const paths = await fixture(t);
  const repository = await makeRepository(join(paths.directory, 'repositories'), 'workflow-project');
  const instance = await createLoopInstance(repository, { sourceRoot, ...paths });
  const manager = await startManagerFixture(t, paths);
  const workflowPath = join(instance.data_directory, 'WORKFLOW.md');
  const current = `${await readFile(workflowPath, 'utf8')}\nUser additions remain until an explicit update.\n`;
  await writeFile(workflowPath, current);

  const comparison = await api(manager, `/api/v1/instances/${instance.id}/workflow`);
  assert.equal(comparison.response.status, 200);
  assert.equal(comparison.body.changed, true);
  const missingConfirmation = await api(manager, `/api/v1/instances/${instance.id}/workflow`, {
    method: 'PUT', body: { expectedCurrent: current }
  });
  assert.equal(missingConfirmation.response.status, 400);

  const applied = await api(manager, `/api/v1/instances/${instance.id}/workflow`, {
    method: 'PUT', origin: manager.url, body: { confirm: true, expectedCurrent: current }
  });
  assert.equal(applied.response.status, 200);
  assert.equal(applied.body.updated, true);
  assert.notEqual(await readFile(workflowPath, 'utf8'), current);
  assert.equal(await readFile(applied.body.backup, 'utf8'), current);
});
