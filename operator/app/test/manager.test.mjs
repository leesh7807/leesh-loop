import assert from 'node:assert/strict';
import { execFile as execute, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { createManagerController, ensureManagerService, managerApiToken, managerRequest } from '../manager-service.mjs';
import { createOperatorUiServer } from '../operator-ui-server.mjs';
import { hashDistribution } from '../installation-metadata.mjs';
import { allocatePort, discoverRunningLoops, loopInstanceStatus, startLoopInstance, stopLoopInstance } from '../manager-lifecycle.mjs';
import { createLoopInstance, listLoopInstances, managerPaths } from '../manager-storage.mjs';
import { activeRuntime, installRuntimeDistributionInWorker, writeRuntimeRecoveryRecord } from '../runtime-distribution.mjs';
import { openLoopTaskStore } from '../local-task-store-runtime.mjs';

const execFile = promisify(execute);
const sourceRoot = resolve(import.meta.dirname, '../../..');

function processStartTicks(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/)[19] || null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

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

async function startManagerFixture(t, paths, { runtimeId, lifecycle, sourceRoot: managerSourceRoot = sourceRoot, runtimeInstaller, taskStoreOpener, managerShutdown } = {}) {
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
    sourceRoot: managerSourceRoot,
    token,
    port,
    environment: paths.environment,
    homeDirectory: paths.homeDirectory,
    lifecycle,
    runtimeInstaller,
    managerShutdown,
    taskStoreOpener
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

async function installStopTestRuntime(paths) {
  const managedPaths = managerPaths(paths);
  const version = '0.1.0';
  const filename = 'operator/app/leesh-loop.mjs';
  const contents = Buffer.from(`const supported = ['start', 'stop', 'stop-owned', 'serve', 'serve-prepared'];
if (!supported.includes(process.argv[2])) {
  console.error('This pinned Runtime predates managed-stop support.');
  process.exitCode = 2;
}
`);
  const id = hashDistribution(version, [[filename, contents, 0o644]]);
  const runtimePath = join(managedPaths.runtimeRoot, id);
  const scriptPath = join(runtimePath, filename);
  await mkdir(managedPaths.configRoot, { recursive: true });
  await mkdir(join(runtimePath, 'operator/app'), { recursive: true });
  await writeFile(scriptPath, contents, { mode: 0o644 });
  await chmod(scriptPath, 0o644);
  await writeFile(join(runtimePath, '.distribution.json'), `${JSON.stringify({ schema_version: 1, id, version, path: runtimePath, files: [filename] })}\n`, { mode: 0o600 });
  await writeFile(managedPaths.activeRuntime, `${JSON.stringify({ schema_version: 1, id })}\n`, { mode: 0o600 });
  return { id, path: runtimePath };
}

async function installLifecycleTestRuntime(paths) {
  const managedPaths = managerPaths(paths);
  const version = '0.1.2';
  const filename = 'operator/app/leesh-loop.mjs';
  const contents = Buffer.from('setInterval(() => {}, 1000);\n');
  const mode = 0o644;
  const id = hashDistribution(version, [[filename, contents, mode]]);
  const runtimePath = join(managedPaths.runtimeRoot, id);
  const scriptPath = join(runtimePath, filename);
  await mkdir(paths.configRoot || managedPaths.configRoot, { recursive: true });
  await mkdir(join(runtimePath, 'operator/app'), { recursive: true });
  await writeFile(scriptPath, contents, { mode });
  await chmod(scriptPath, mode);
  await writeFile(join(runtimePath, '.distribution.json'), `${JSON.stringify({ schema_version: 1, id, version, path: runtimePath, files: [filename] })}\n`, { mode: 0o600 });
  await writeFile(managedPaths.activeRuntime, `${JSON.stringify({ schema_version: 1, id })}\n`, { mode: 0o600 });
  return { id, path: runtimePath };
}

async function installManagerServiceTestRuntime(paths) {
  const managedPaths = managerPaths(paths);
  const version = '0.1.3';
  const filename = 'operator/app/manager.mjs';
  const contents = Buffer.from(`import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const stateRoot = join(process.env.XDG_STATE_HOME, 'leesh-loop', 'manager');
const configRoot = join(process.env.XDG_CONFIG_HOME, 'leesh-loop');
const config = JSON.parse(readFileSync(join(configRoot, 'manager.json'), 'utf8'));
const active = JSON.parse(readFileSync(join(configRoot, 'active-runtime.json'), 'utf8'));
const master = readFileSync(join(stateRoot, 'api-master'), 'utf8').trim();
const token = createHmac('sha256', master).update('leesh-loop-manager-api:v1:' + active.id).digest('hex');
const stat = readFileSync('/proc/' + process.pid + '/stat', 'utf8');
const ticks = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\\s+/)[19];
const runtimePath = fileURLToPath(new URL('../..', import.meta.url));
const recordPath = join(stateRoot, 'service.json');
const server = createServer((request, response) => {
  response.setHeader('content-type', 'application/json');
  if (request.url === '/api/v1/manager' && request.headers['x-leesh-loop-token'] === token) {
    response.end(JSON.stringify({ status: 'Running' }));
  } else {
    response.statusCode = 403;
    response.end('{}');
  }
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(config.port, '127.0.0.1', resolve);
});
await writeFile(recordPath, JSON.stringify({ schema_version: 1, pid: process.pid, process_start_ticks: ticks, host: '127.0.0.1', port: config.port, runtime_path: runtimePath, runtime_version: active.id }), { mode: 0o600 });
process.once('SIGTERM', () => {
  server.close(() => {
    try {
      const current = JSON.parse(readFileSync(recordPath, 'utf8'));
      if (current.pid === process.pid) unlink(recordPath).catch(() => {});
    } catch {}
    process.exit(0);
  });
});
`);
  const mode = 0o644;
  const id = hashDistribution(version, [[filename, contents, mode]]);
  const runtimePath = join(managedPaths.runtimeRoot, id);
  const scriptPath = join(runtimePath, filename);
  await mkdir(managedPaths.configRoot, { recursive: true });
  await mkdir(join(runtimePath, 'operator/app'), { recursive: true });
  await writeFile(scriptPath, contents, { mode });
  await chmod(scriptPath, mode);
  await writeFile(join(runtimePath, '.distribution.json'), `${JSON.stringify({ schema_version: 1, id, version, path: runtimePath, files: [filename] })}\n`, { mode: 0o600 });
  await writeFile(managedPaths.activeRuntime, `${JSON.stringify({ schema_version: 1, id })}\n`, { mode: 0o600 });
  return { id, path: runtimePath };
}

async function unusedLoopbackPort() {
  const server = createHttpServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const port = server.address().port;
  await new Promise(resolveClose => server.close(resolveClose));
  return port;
}

async function stopRecordedProcess(pid, startTicks, signal = 'SIGTERM') {
  if (processStartTicks(pid) !== startTicks) return;
  try { process.kill(pid, signal); } catch (error) { if (error?.code !== 'ESRCH') throw error; }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (processStartTicks(pid) !== startTicks) return;
    await new Promise(resolveSleep => setTimeout(resolveSleep, 20));
  }
  assert.notEqual(processStartTicks(pid), startTicks, `process ${pid} did not exit after ${signal}`);
}

async function api(manager, path, { method = 'GET', instanceId, body, origin, timeoutMs } = {}) {
  const headers = { 'x-leesh-loop-token': manager.token, accept: 'application/json' };
  if (instanceId) headers['x-leesh-loop-instance-id'] = instanceId;
  if (origin) headers.origin = origin;
  const options = { method, headers };
  if (timeoutMs !== undefined) options.signal = AbortSignal.timeout(timeoutMs);
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${manager.url}${path}`, options);
  return { response, body: await response.json().catch(() => null) };
}

function awaitWithTimeout(operation, label, timeoutMs = 5_000) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not settle within ${timeoutMs} ms`)), timeoutMs);
  });
  return Promise.race([operation, timeout]).finally(() => clearTimeout(timer));
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
  const runtimeReadback = await api(manager, '/api/v1/runtime');
  assert.equal(runtimeReadback.response.status, 200);
  assert.equal(runtimeReadback.body.source.path, sourceRoot);
  assert.equal(runtimeReadback.body.source.version, JSON.parse(await readFile(join(sourceRoot, 'package.json'), 'utf8')).version);
  assert.match(runtimeReadback.body.source.id, /^[a-f0-9]{64}$/);
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
  assert.equal(wrongToken.status, 401);
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

test('Manager Runtime status and install action remain available with an empty registry', async t => {
  const paths = await fixture(t);
  let installedSource;
  const manager = await startManagerFixture(t, paths, {
    runtimeInstaller: async source => {
      installedSource = source;
      return { id: 'a'.repeat(64), version: '0.1.0', path: join(paths.directory, 'installed-runtime'), changed: true };
    }
  });

  assert.deepEqual(await listLoopInstances(paths), []);
  const runtime = await api(manager, '/api/v1/runtime');
  assert.equal(runtime.response.status, 200);
  assert.equal(runtime.body.source.path, sourceRoot);
  assert.match(runtime.body.source.id, /^[a-f0-9]{64}$/);
  assert.equal(runtime.body.active, null);
  assert.equal(runtime.body.manager_runtime_version, null);

  const installed = await api(manager, '/api/v1/runtime/update', { method: 'POST', origin: manager.url });
  assert.equal(installed.response.status, 200);
  assert.equal(installedSource, sourceRoot);
  assert.equal(installed.body.active.id, 'a'.repeat(64));
  assert.equal(installed.body.manager_restart_required, true);
  assert.deepEqual(await listLoopInstances(paths), []);
});

test('Manager Runtime update can select a validated Runtime when the active distribution is invalid', async t => {
  const paths = await fixture(t);
  const invalidRuntime = await installTestRuntime(paths, 'corrupt-active-runtime');
  const replacement = await installTestRuntime(paths, 'validated-replacement-runtime');
  const activeFile = managerPaths(paths).activeRuntime;
  await writeFile(join(invalidRuntime.path, 'runtime-fixture.mjs'), 'corrupt active contents');
  await writeFile(activeFile, `${JSON.stringify({ schema_version: 1, id: invalidRuntime.id })}\n`);
  await assert.rejects(activeRuntime(paths), /contents do not match/);

  let installerCalled = false;
  const manager = await startManagerFixture(t, paths, {
    runtimeInstaller: async () => {
      installerCalled = true;
      await writeFile(activeFile, `${JSON.stringify({ schema_version: 1, id: replacement.id })}\n`);
      return { ...replacement, changed: true, recovered_from_invalid_active: true };
    }
  });

  const recovered = await api(manager, '/api/v1/runtime/update', { method: 'POST', origin: manager.url });
  assert.equal(recovered.response.status, 200);
  assert.equal(installerCalled, true);
  assert.equal(recovered.body.previous, null);
  assert.equal(recovered.body.active.id, replacement.id);
  assert.equal(recovered.body.recovered_from_invalid_active, true);
  assert.equal(recovered.body.manager_restart_required, true);
  assert.equal((await activeRuntime(paths)).id, replacement.id);
  assert.equal(await readFile(join(invalidRuntime.path, 'runtime-fixture.mjs'), 'utf8'), 'corrupt active contents');
});

test('Manager Runtime status keeps valid alternatives visible when the active distribution is invalid', async t => {
  const paths = await fixture(t);
  const invalidRuntime = await installTestRuntime(paths, 'invalid-active-runtime');
  const validAlternative = await installTestRuntime(paths, 'valid-alternative-runtime');
  const activeFile = managerPaths(paths).activeRuntime;
  await writeFile(join(invalidRuntime.path, 'runtime-fixture.mjs'), 'corrupt active contents');
  await writeFile(activeFile, `${JSON.stringify({ schema_version: 1, id: invalidRuntime.id })}\n`);

  const manager = await startManagerFixture(t, paths);
  const runtime = await api(manager, '/api/v1/runtime');

  assert.equal(runtime.response.status, 200);
  assert.equal(runtime.body.active, null);
  assert.match(runtime.body.active_error, /contents do not match/);
  assert.ok(runtime.body.distributions.some(value => value.id === validAlternative.id));
  assert.ok(runtime.body.distributions.every(value => value.active === false));
});

test('Manager Runtime status retains a pending quarantine target until activation is confirmed', async t => {
  const paths = await fixture(t);
  const runtime = await installTestRuntime(paths, 'pending-runtime-recovery');
  const managedPaths = managerPaths(paths);
  const quarantineTarget = join(managedPaths.runtimeRoot, `.damaged-${runtime.id}-pending-fixture`);
  await writeFile(managedPaths.activeRuntime, `${JSON.stringify({ schema_version: 1, id: 'f'.repeat(64) })}\n`, { mode: 0o600 });
  await writeRuntimeRecoveryRecord({
    runtime_id: runtime.id,
    status: 'activation-pending',
    validation_error: 'Runtime distribution contents do not match their immutable identity.',
    preserved_runtime_path: quarantineTarget
  }, paths);

  const manager = await startManagerFixture(t, paths);
  const status = await api(manager, '/api/v1/runtime');

  assert.equal(status.response.status, 200);
  assert.equal(status.body.active, null);
  assert.equal(status.body.last_recovery.status, 'activation-pending');
  assert.equal(status.body.last_recovery.preserved_runtime_path, quarantineTarget);
  await assert.rejects(lstat(quarantineTarget), { code: 'ENOENT' });
  assert.equal((await readFile(managedPaths.runtimeRecovery, 'utf8')).includes(quarantineTarget), true);
});

test('same-ID Runtime recovery retry preserves its quarantined path and Manager restart requirement', async t => {
  const paths = await fixture(t);
  const runtime = await installTestRuntime(paths, 'same-id-runtime-repair');
  const managedPaths = managerPaths(paths);
  const preservedRuntimePath = join(managedPaths.runtimeRoot, `.damaged-${runtime.id}-repair-fixture`);
  await mkdir(preservedRuntimePath, { recursive: true });
  await writeFile(join(preservedRuntimePath, 'runtime-fixture.mjs'), 'corrupt prior distribution');
  await writeFile(managedPaths.activeRuntime, `${JSON.stringify({ schema_version: 1, id: 'f'.repeat(64) })}\n`, { mode: 0o600 });
  await writeRuntimeRecoveryRecord({
    runtime_id: runtime.id,
    status: 'activation-pending',
    validation_error: 'Runtime distribution contents do not match their immutable identity.',
    preserved_runtime_path: preservedRuntimePath
  }, paths);
  await mkdir(managedPaths.managerStateRoot, { recursive: true });
  const manager = await startManagerFixture(t, paths, {
    runtimeId: runtime.id,
    runtimeInstaller: async () => {
      await writeFile(managedPaths.activeRuntime, `${JSON.stringify({ schema_version: 1, id: runtime.id })}\n`, { mode: 0o600 });
      return {
        ...runtime,
        changed: true,
        recovered_from_invalid_active: true,
        previous_active_error: 'Runtime distribution contents do not match their immutable identity.',
        repaired_distribution: false,
        preserved_runtime_path: null
      };
    }
  });
  await writeFile(managedPaths.managerApiMaster, `${'a'.repeat(64)}\n`, { mode: 0o600 });
  await writeFile(managedPaths.managerConfiguration, `${JSON.stringify({ schema_version: 1, port: manager.port, symphony_port_min: 4200, symphony_port_max: 4209 })}\n`, { mode: 0o600 });
  await writeFile(managedPaths.managerServiceRecord, `${JSON.stringify({
    schema_version: 1,
    pid: process.pid,
    process_start_ticks: processStartTicks(process.pid),
    host: '127.0.0.1',
    port: manager.port,
    runtime_path: runtime.path,
    runtime_version: runtime.id,
    manager_restart_required: true
  })}\n`, { mode: 0o600 });

  const recovered = await api(manager, '/api/v1/runtime/update', { method: 'POST', origin: manager.url });
  assert.equal(recovered.response.status, 200);
  assert.equal(recovered.body.active.id, runtime.id);
  assert.equal(recovered.body.manager_runtime_version, runtime.id);
  assert.equal(recovered.body.manager_restart_required, true);
  assert.equal(recovered.body.repaired_distribution, false);
  assert.equal(recovered.body.preserved_runtime_path, preservedRuntimePath);
  assert.match(recovered.body.active_runtime_error, /ENOENT/);

  const service = JSON.parse(await readFile(managedPaths.managerServiceRecord, 'utf8'));
  assert.equal(service.runtime_version, runtime.id);
  assert.equal(service.manager_restart_required, true);
  const readback = await api(manager, '/api/v1/runtime');
  assert.equal(readback.body.manager_restart_required, true);
  assert.equal(readback.body.last_recovery.runtime_id, runtime.id);
  assert.equal(readback.body.last_recovery.status, 'active');
  assert.equal(readback.body.last_recovery.validation_error, 'Runtime distribution contents do not match their immutable identity.');
  assert.equal(readback.body.last_recovery.preserved_runtime_path, preservedRuntimePath);

  const reopen = await ensureManagerService({ sourceRoot, environment: paths.environment, homeDirectory: paths.homeDirectory });
  assert.equal(reopen.alreadyRunning, true);
  assert.equal(reopen.managerRestartRequired, true);

  delete service.manager_restart_required;
  await writeFile(managedPaths.managerServiceRecord, `${JSON.stringify(service)}\n`, { mode: 0o600 });
  const afterManagerReopen = await api(manager, '/api/v1/runtime');
  assert.equal(afterManagerReopen.body.manager_restart_required, false);
  assert.equal(afterManagerReopen.body.last_recovery.preserved_runtime_path, preservedRuntimePath);
});

test('Manager unregisters a Stopped or confirmed process-absent Failed instance and preserves its repository and Task Store', async t => {
  const paths = await fixture(t);
  const repositoryRoot = join(paths.directory, 'repositories');
  const firstRoot = await makeRepository(repositoryRoot, 'unregister-first');
  const secondRoot = await makeRepository(repositoryRoot, 'unregister-second');
  const first = await createLoopInstance(firstRoot, { sourceRoot, ...paths });
  const second = await createLoopInstance(secondRoot, { sourceRoot, ...paths });
  const manager = await startManagerFixture(t, paths);

  const firstPublication = await api(manager, '/api/v1/publish', {
    method: 'POST', instanceId: first.id, origin: manager.url,
    body: { plan: '# Preserve first task\n\n## Objective\nKeep this task after unregistration.', state: 'Ready' }
  });
  const secondPublication = await api(manager, '/api/v1/publish', {
    method: 'POST', instanceId: second.id, origin: manager.url,
    body: { plan: '# Preserve second task\n\n## Objective\nKeep this other instance isolated.', state: 'Ready' }
  });
  assert.equal(firstPublication.response.status, 201);
  assert.equal(secondPublication.response.status, 201);
  assert.equal((await api(manager, '/api/v1/tasks', { instanceId: first.id })).response.status, 200);
  assert.equal((await api(manager, '/api/v1/tasks', { instanceId: second.id })).response.status, 200);

  const executionDirectory = join(managerPaths(paths).loopExecutionRoot, first.id);
  await mkdir(executionDirectory, { recursive: true });
  const executionPath = join(executionDirectory, 'execution.json');
  await writeFile(executionPath, `${JSON.stringify({
    schema_version: 1,
    id: first.id,
    status: 'Starting',
    started_at: new Date().toISOString(),
    port: 4181
  })}\n`);
  const refused = await api(manager, `/api/v1/instances/${first.id}`, { method: 'DELETE', origin: manager.url });
  assert.equal(refused.response.status, 409);
  assert.match(refused.body.error, /confirms a Failed Loop has no active processes/);
  assert.equal((await listLoopInstances(paths)).length, 2);

  await writeFile(executionPath, `${JSON.stringify({
    schema_version: 1,
    id: first.id,
    status: 'Failed',
    detail: 'startup failed while the recorded launcher is still present',
    launcher_pid: process.pid
  })}\n`);
  const uncertainFailure = await api(manager, `/api/v1/instances/${first.id}`);
  assert.equal(uncertainFailure.body.instance.status, 'Failed');
  assert.equal(uncertainFailure.body.instance.can_update_workflow, undefined);
  assert.equal(uncertainFailure.body.instance.process_absence_confirmed, undefined);
  const refusedFailed = await api(manager, `/api/v1/instances/${first.id}`, { method: 'DELETE', origin: manager.url });
  assert.equal(refusedFailed.response.status, 409);
  assert.match(refusedFailed.body.error, /Current status: Failed/);
  assert.equal((await listLoopInstances(paths)).length, 2);

  await writeFile(executionPath, `${JSON.stringify({ schema_version: 1, id: first.id, status: 'Failed', detail: 'startup failed before a process was launched' })}\n`);
  const confirmedFailure = await api(manager, `/api/v1/instances/${first.id}`);
  assert.equal(confirmedFailure.body.instance.status, 'Failed');
  assert.equal(confirmedFailure.body.instance.can_update_workflow, true);
  assert.equal(confirmedFailure.body.instance.process_absence_confirmed, true);
  const removed = await api(manager, `/api/v1/instances/${first.id}`, { method: 'DELETE', origin: manager.url });
  assert.equal(removed.response.status, 200);
  assert.equal(removed.body.repository_preserved, true);
  assert.equal(removed.body.data_preserved, true);
  assert.equal(removed.body.instance.id, first.id);
  assert.equal(removed.body.instance.data_directory, first.data_directory);
  assert.deepEqual((await listLoopInstances(paths)).map(value => value.id), [second.id]);

  assert.equal(await readFile(join(firstRoot, 'README.md'), 'utf8'), '# unregister-first\n');
  assert.match(await readFile(join(first.data_directory, 'WORKFLOW.md'), 'utf8'), /Repository workflow/);
  const preservedStore = await openLoopTaskStore(join(first.data_directory, 'state'));
  try {
    assert.deepEqual(preservedStore.listTasks().map(task => task.id), [firstPublication.body.page_id]);
  } finally { preservedStore.close(); }
  const removedStoreRequest = await api(manager, '/api/v1/tasks', { instanceId: first.id });
  assert.equal(removedStoreRequest.response.status, 404);
  const otherTasks = await api(manager, '/api/v1/tasks', { instanceId: second.id });
  assert.deepEqual(otherTasks.body.tasks.map(task => task.id), [secondPublication.body.page_id]);
  const remainingStatus = await api(manager, `/api/v1/instances/${second.id}`);
  assert.equal(remainingStatus.body.instance.status, 'Stopped');

  const reRegistered = await api(manager, '/api/v1/instances', {
    method: 'POST', origin: manager.url, body: { repositoryPath: firstRoot }
  });
  assert.equal(reRegistered.response.status, 201);
  assert.notEqual(reRegistered.body.instance.id, first.id);
  assert.equal(reRegistered.body.instance.repository_root, firstRoot);
  assert.notEqual(reRegistered.body.instance.data_directory, first.data_directory);
  assert.deepEqual((await listLoopInstances(paths)).map(value => value.id).sort(), [second.id, reRegistered.body.instance.id].sort());
});

test('Manager drains an in-flight Task request before unregistering its instance', async t => {
  const paths = await fixture(t);
  const repositoryRoot = join(paths.directory, 'repositories');
  const repository = await makeRepository(repositoryRoot, 'unregister-drains-task-request');
  const otherRepository = await makeRepository(repositoryRoot, 'register-during-unregister-drain');
  const instance = await createLoopInstance(repository, { sourceRoot, ...paths });
  let allowStoreOpen;
  let signalStoreOpen;
  const storeOpen = new Promise(resolve => { signalStoreOpen = resolve; });
  const storeOpenGate = new Promise(resolve => { allowStoreOpen = resolve; });
  let storeClosed = false;
  const pendingOperations = [];
  const track = operation => {
    pendingOperations.push(operation);
    void operation.catch(() => {});
    return operation;
  };
  const manager = await startManagerFixture(t, paths, {
    taskStoreOpener: async stateDirectory => {
      const store = await openLoopTaskStore(stateDirectory);
      signalStoreOpen();
      await storeOpenGate;
      const close = store.close.bind(store);
      store.close = async () => {
        storeClosed = true;
        await close();
      };
      return store;
    }
  });

  try {
    const taskRead = track(api(manager, '/api/v1/tasks', { instanceId: instance.id }));
    await awaitWithTimeout(storeOpen, 'Loop A Task Store opener held-open signal');
    let unregisterFinished = false;
    const unregister = track(api(manager, `/api/v1/instances/${instance.id}`, { method: 'DELETE', origin: manager.url })
      .then(result => { unregisterFinished = true; return result; }));
    let unregisterReservation;
    const reservationDeadline = Date.now() + 5_000;
    while (!unregisterReservation && Date.now() < reservationDeadline) {
      try {
        const currentTaskRequest = await api(manager, '/api/v1/tasks', { instanceId: instance.id, timeoutMs: 250 });
        if (currentTaskRequest.response.status === 409) unregisterReservation = currentTaskRequest;
      } catch (error) {
        if (!['AbortError', 'TimeoutError'].includes(error?.name)) throw error;
      }
      if (!unregisterReservation) await new Promise(resolveSleep => setTimeout(resolveSleep, 10));
    }
    assert.ok(unregisterReservation, 'a fresh Task request must observe the unregister reservation before testing independent registry progress');
    assert.match(unregisterReservation.body.error, /being unregistered/);
    assert.equal(unregisterFinished, false, 'unregistration must wait for a Task request that already acquired the instance context');

    const registration = track(api(manager, '/api/v1/instances', {
      method: 'POST', origin: manager.url, body: { repositoryPath: otherRepository }
    }));
    let registrationTimeout;
    const registrationWhileDrainWaits = await Promise.race([
      registration.then(result => ({ completed: true, result })),
      new Promise(resolveTimeout => { registrationTimeout = setTimeout(() => resolveTimeout({ completed: false }), 5_000); })
    ]);
    clearTimeout(registrationTimeout);

    allowStoreOpen();
    const [read, removed, registered] = await Promise.all([
      awaitWithTimeout(taskRead, 'Loop A held Task request'),
      awaitWithTimeout(unregister, 'Loop A unregister after Task drain'),
      awaitWithTimeout(registration, 'Loop B registration after Task drain')
    ]);
    assert.equal(read.response.status, 200, JSON.stringify(read.body));
    assert.equal(removed.response.status, 200);
    assert.equal(registrationWhileDrainWaits.completed, true, 'an unrelated repository registration must not wait for this Loop Task drain');
    assert.equal(registrationWhileDrainWaits.result.response.status, 201);
    assert.equal(registered.response.status, 201);
    assert.equal(storeClosed, true);
    assert.deepEqual((await listLoopInstances(paths)).map(value => value.id), [registered.body.instance.id]);
    assert.equal((await api(manager, '/api/v1/tasks', { instanceId: registered.body.instance.id, timeoutMs: 5_000 })).response.status, 200);
    assert.equal(await readFile(join(instance.data_directory, 'WORKFLOW.md'), 'utf8').then(value => value.includes('Repository workflow')), true);
  } finally {
    allowStoreOpen();
    let cleanupTimeout;
    await Promise.race([
      Promise.allSettled(pendingOperations),
      new Promise(resolveTimeout => { cleanupTimeout = setTimeout(resolveTimeout, 5_000); })
    ]);
    clearTimeout(cleanupTimeout);
  }
});

test('Manager log reads return bounded tails and preserve the other log when one is large', async t => {
  const paths = await fixture(t);
  const repository = await makeRepository(join(paths.directory, 'repositories'), 'large-manager-log-project');
  const instance = await createLoopInstance(repository, { sourceRoot, ...paths });
  const manager = await startManagerFixture(t, paths);
  const executionDirectory = join(managerPaths(paths).loopExecutionRoot, instance.id);
  await mkdir(executionDirectory, { recursive: true });
  await writeFile(join(executionDirectory, 'start-command.log'), Buffer.concat([
    Buffer.from('PREFIX-MUST-BE-OMITTED\n'),
    Buffer.alloc(2_500_000, 0x78),
    Buffer.from('\nLARGE-LOG-TAIL-MARKER')
  ]));
  await writeFile(join(executionDirectory, 'symphony-startup.log'), 'SMALL-LOG-REMAINS-VISIBLE');

  const { response, body } = await api(manager, '/api/v1/instances/' + instance.id + '/logs');
  assert.equal(response.status, 200);
  assert.ok(body.logs.includes('LARGE-LOG-TAIL-MARKER'));
  assert.ok(body.logs.includes('SMALL-LOG-REMAINS-VISIBLE'));
  assert.ok(body.logs.includes('Earlier log output omitted'));
  assert.ok(!body.logs.includes('PREFIX-MUST-BE-OMITTED'));
  assert.ok(body.logs.length < 105_000);
});

test('Manager log read reports one unavailable file and returns the other', async t => {
  const paths = await fixture(t);
  const repository = await makeRepository(join(paths.directory, 'repositories'), 'partial-manager-log-project');
  const instance = await createLoopInstance(repository, { sourceRoot, ...paths });
  const manager = await startManagerFixture(t, paths);
  const executionDirectory = join(managerPaths(paths).loopExecutionRoot, instance.id);
  await mkdir(join(executionDirectory, 'start-command.log'), { recursive: true });
  await writeFile(join(executionDirectory, 'symphony-startup.log'), 'AVAILABLE-LOG-CONTENT');

  const { response, body } = await api(manager, '/api/v1/instances/' + instance.id + '/logs');
  assert.equal(response.status, 200);
  assert.match(body.logs, /start-command\.log[\s\S]*Log unavailable: UNSAFE_FILE/);
  assert.ok(body.logs.includes('AVAILABLE-LOG-CONTENT'));
});

test('Manager Task Store and Loop start reject a state path owned by another instance', async t => {
  const paths = await fixture(t);
  const repositories = join(paths.directory, 'repositories');
  const first = await createLoopInstance(await makeRepository(repositories, 'state-owner-first'), { sourceRoot, ...paths });
  const second = await createLoopInstance(await makeRepository(repositories, 'state-owner-second'), { sourceRoot, ...paths });
  const projectFile = join(first.data_directory, 'project.toml');
  const project = await readFile(projectFile, 'utf8');
  const stateDirectory = /^state_directory = "([^"]+)"$/m.exec(project);
  assert.ok(stateDirectory);
  const redirectedProject = project.replace(stateDirectory[0], 'state_directory = "' + join(second.data_directory, 'state') + '"');
  await writeFile(projectFile, redirectedProject);
  const openedStores = [];
  const manager = await startManagerFixture(t, paths, {
    taskStoreOpener: async statePath => {
      openedStores.push(statePath);
      return { listTasks: () => [], close: () => {} };
    }
  });

  const redirectedTasks = await api(manager, '/api/v1/tasks', { instanceId: first.id });
  assert.equal(redirectedTasks.response.status, 409);
  assert.match(redirectedTasks.body.error, /state_directory must match its managed per-instance state directory/);
  assert.deepEqual(openedStores, []);
  await assert.rejects(startLoopInstance(first.id, paths), /state_directory must match its managed per-instance state directory/);

  await writeFile(projectFile, project);
  const firstTasks = await api(manager, '/api/v1/tasks', { instanceId: first.id });
  assert.equal(firstTasks.response.status, 200);
  assert.deepEqual(openedStores, [join(first.data_directory, 'state')]);

  await writeFile(projectFile, redirectedProject);
  const redirectedAfterCache = await api(manager, '/api/v1/tasks', { instanceId: first.id });
  assert.equal(redirectedAfterCache.response.status, 409);
  assert.deepEqual(openedStores, [join(first.data_directory, 'state')]);

  await writeFile(projectFile, await readFile(join(second.data_directory, 'project.toml'), 'utf8'));
  const secondTasks = await api(manager, '/api/v1/tasks', { instanceId: second.id });
  assert.equal(secondTasks.response.status, 200);
  assert.deepEqual(openedStores, [join(first.data_directory, 'state'), join(second.data_directory, 'state')]);
});

test('Manager Loop start rejects a workspace root owned by another instance', async t => {
  const paths = await fixture(t);
  const repositories = join(paths.directory, 'repositories');
  const first = await createLoopInstance(await makeRepository(repositories, 'workspace-owner-first'), { sourceRoot, ...paths });
  const second = await createLoopInstance(await makeRepository(repositories, 'workspace-owner-second'), { sourceRoot, ...paths });
  const projectFile = join(first.data_directory, 'project.toml');
  const project = await readFile(projectFile, 'utf8');
  const workspaceRoot = /^symphony_workspace_root = "([^"]+)"$/m.exec(project);
  assert.ok(workspaceRoot);
  await writeFile(projectFile, project.replace(workspaceRoot[0], 'symphony_workspace_root = "' + join(second.data_directory, 'workspaces') + '"'));

  await assert.rejects(startLoopInstance(first.id, paths), /symphony_workspace_root must match its managed per-instance workspace directory/);
});

test('Manager rejects stale Task Store configuration until it restarts', async t => {
  const paths = await fixture(t);
  const repository = await makeRepository(join(paths.directory, 'repositories'), 'task-store-config-drift-project');
  const instance = await createLoopInstance(repository, { sourceRoot, ...paths });
  const manager = await startManagerFixture(t, paths, {
    taskStoreOpener: async () => ({ listTasks: () => [], close: () => {} })
  });

  const initialConfig = await api(manager, '/api/v1/config', { instanceId: instance.id });
  assert.equal(initialConfig.response.status, 200);
  const projectFile = join(instance.data_directory, 'project.toml');
  const project = await readFile(projectFile, 'utf8');
  const repositoryUrl = /^github_repository_url = "([^"]+)"$/m.exec(project);
  assert.ok(repositoryUrl);
  const changedProject = project.replace(repositoryUrl[0], 'github_repository_url = "https://github.com/config-drift/changed.git"');
  await writeFile(projectFile, changedProject);

  const [config, tasks] = await Promise.all([
    api(manager, '/api/v1/config', { instanceId: instance.id }),
    api(manager, '/api/v1/tasks', { instanceId: instance.id })
  ]);
  assert.equal(config.response.status, 409);
  assert.equal(tasks.response.status, 409);
  assert.match(config.body.error, /project.toml changed.*Restart the Manager/);
  assert.match(tasks.body.error, /project.toml changed.*Restart the Manager/);
});

test('concurrent first-use config and task reads share and close one Task Store', async t => {
  const paths = await fixture(t);
  const repository = await makeRepository(join(paths.directory, 'repositories'), 'concurrent-task-store-project');
  const instance = await createLoopInstance(repository, { sourceRoot, ...paths });
  let opens = 0;
  let closes = 0;
  const manager = await startManagerFixture(t, paths, {
    taskStoreOpener: async () => {
      opens += 1;
      await new Promise(resolveOpen => setTimeout(resolveOpen, 40));
      return { listTasks: () => [], close: () => { closes += 1; } };
    }
  });

  const [config, tasks] = await Promise.all([
    api(manager, '/api/v1/config', { instanceId: instance.id }),
    api(manager, '/api/v1/tasks', { instanceId: instance.id })
  ]);
  assert.equal(config.response.status, 200);
  assert.equal(tasks.response.status, 200);
  assert.deepEqual(tasks.body.tasks, []);
  assert.equal(opens, 1);
  await manager.controller.closeTaskStores();
  await manager.controller.closeTaskStores();
  assert.equal(closes, 1);
});

test('Manager accepts localhost for local use and rejects an unapproved Host header', async t => {
  const paths = await fixture(t);
  const manager = await startManagerFixture(t, paths);
  const localResponse = await new Promise((resolveResponse, rejectResponse) => {
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
  assert.equal(localResponse.statusCode, 200);
  const reboundResponse = await new Promise((resolveResponse, rejectResponse) => {
    const request = httpRequest({
      hostname: '127.0.0.1',
      port: manager.port,
      path: '/api/v1/manager',
      method: 'GET',
      headers: { host: `attacker.example:${manager.port}`, 'x-leesh-loop-token': manager.token }
    }, resolveResponse);
    request.once('error', rejectResponse);
    request.end();
  });
  assert.equal(reboundResponse.statusCode, 403);
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
  const request = candidate => ({ headers: { host: '127.0.0.1:4320', 'x-leesh-loop-token': candidate }, socket: { remoteAddress: '127.0.0.1' } });

  assert.notEqual(token, masterToken);
  assert.notEqual(token, managerApiToken(masterToken, 'runtime-version-1'));
  assert.equal(await controller.authorize(request(token)), true);
  assert.equal(await controller.authorize(request(masterToken)), false);
});

test('web Runtime installation runs on a worker while the Manager serves other requests', async t => {
  const paths = await fixture(t);
  const previousRuntime = await installTestRuntime(paths, 'responsive-runtime-before');
  const workerStartedPath = join(paths.directory, 'runtime-worker-started');
  const installerModulePath = join(paths.directory, 'blocking-runtime-installer.mjs');
  paths.environment.LEESH_LOOP_TEST_RUNTIME_WORKER_MARKER = workerStartedPath;
  await writeFile(installerModulePath, `
import { writeFileSync } from 'node:fs';
import '${pathToFileURL(join(sourceRoot, 'operator/app/runtime-distribution.mjs')).href}';

export function installRuntimeDistribution(sourceRoot, { environment }) {
  writeFileSync(environment.LEESH_LOOP_TEST_RUNTIME_WORKER_MARKER, 'started');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
  return { id: '${'f'.repeat(64)}', version: '0.2.0', path: sourceRoot, changed: true };
}
`);
  const moduleUrl = pathToFileURL(installerModulePath).toString();
  const manager = await startManagerFixture(t, paths, {
    runtimeInstaller: (root, options) => installRuntimeDistributionInWorker(root, options, { moduleUrl })
  });

  const updateResult = api(manager, '/api/v1/runtime/update', { method: 'POST', origin: manager.url });
  let marker = '';
  for (let attempt = 0; attempt < 200 && !marker; attempt += 1) {
    marker = await readFile(workerStartedPath, 'utf8').catch(error => error?.code === 'ENOENT' ? '' : Promise.reject(error));
    if (!marker) await new Promise(resolveSleep => setTimeout(resolveSleep, 10));
  }
  assert.equal(marker, 'started', 'the Runtime installation worker must enter its synchronous build step');

  const probeStarted = Date.now();
  const health = await api(manager, '/api/v1/manager');
  const probeElapsed = Date.now() - probeStarted;
  assert.equal(health.response.status, 200);
  assert.ok(probeElapsed < 1_000, `Manager health request took ${probeElapsed} ms while Runtime installation was active`);

  const updated = await updateResult;
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.previous.id, previousRuntime.id);
  assert.equal(updated.body.active.id, 'f'.repeat(64));
  assert.equal(updated.body.changed, true);
});

test('browser session credentials require a same-origin loopback fetch and manager stop leaves Loops untouched', async t => {
  let shutdowns = 0;
  const paths = await fixture(t);
  const manager = await startManagerFixture(t, paths, { managerShutdown: () => { shutdowns += 1; } });
  const credential = await fetch(`${manager.url}/api/v1/session`, {
    headers: {
      origin: manager.url,
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty'
    }
  });
  assert.equal(credential.status, 200);
  assert.equal((await credential.json()).token, manager.token);

  const crossOrigin = await fetch(`${manager.url}/api/v1/session`, {
    headers: {
      origin: 'https://attacker.example',
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty'
    }
  });
  assert.equal(crossOrigin.status, 403);

  const stopped = await api(manager, '/api/v1/manager/stop', { method: 'POST', origin: manager.url });
  assert.equal(stopped.response.status, 202);
  assert.equal(stopped.body.loops_continue, true);
  assert.equal(shutdowns, 0);
  await new Promise(resolveSleep => setTimeout(resolveSleep, 350));
  assert.equal(shutdowns, 1);
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
    method: 'PUT', body: { confirm: true, expectedCurrent: 'reviewed workflow', expectedCandidateDigest: 'a'.repeat(64) }
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

test('port allocation releases ports held only by stale execution records without rewriting them', async t => {
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
  assert.equal(reconciled.status, 'Running');
});

test('Running remains observable through its pinned Runtime when the Active Runtime is damaged', async t => {
  const paths = await fixture(t);
  const repository = await makeRepository(join(paths.directory, 'repositories'), 'running-project');
  const instance = await createLoopInstance(repository, { sourceRoot, ...paths });
  const managerState = managerPaths(paths);
  const runtime = await installTestRuntime(paths, 'status-fixture-runtime-v1');
  const activeVersion = await installTestRuntime(paths, 'status-fixture-runtime-v2');
  await writeFile(join(activeVersion.path, 'runtime-fixture.mjs'), 'damaged active Runtime contents');
  await assert.rejects(activeRuntime(paths), /contents do not match/);
  const runtimeId = runtime.id;
  const runtimePath = runtime.path;

  let runtimeResponse = { runtime_id: 'runtime-running-1', pid: process.pid, dispatch_capable: true };
  const runtimeApi = createHttpServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(runtimeResponse));
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
  runtimeResponse = { runtime_id: 'another-loop-runtime', pid: process.pid, dispatch_capable: true };
  const differentRuntime = await loopInstanceStatus(instance.id, paths);
  assert.equal(differentRuntime.status, 'Unconfirmed');
  assert.match(differentRuntime.detail, /different Loop runtime/);
  assert.equal(JSON.parse(await readFile(executionPath, 'utf8')).status, 'Running');
  runtimeResponse = { runtime_id: 'runtime-running-1', pid: process.pid, dispatch_capable: true };
  await writeFile(executionPath, `${JSON.stringify({ ...execution, status: 'Stopping' })}\n`);
  assert.equal((await loopInstanceStatus(instance.id, { ...paths, isLifecycleOperationActive: () => true })).status, 'Stopping');
  assert.equal((await loopInstanceStatus(instance.id, paths)).status, 'Running');
  const state = JSON.parse(await readFile(runtimeStatePath, 'utf8'));
  await writeFile(runtimeStatePath, `${JSON.stringify({ ...state, process_start_ticks: 'reused-pid' })}\n`);
  const replaced = await loopInstanceStatus(instance.id, paths);
  assert.equal(replaced.status, 'Unconfirmed');
  assert.match(replaced.detail, /PID .* reused/);
});

test('a delayed read-only Manager status probe cannot replace a Stop completed during the probe', async t => {
  const paths = await fixture(t);
  const repository = await makeRepository(join(paths.directory, 'repositories'), 'status-stop-race-project');
  const instance = await createLoopInstance(repository, { sourceRoot, ...paths });
  const manager = await startManagerFixture(t, paths);
  const runtime = await installTestRuntime(paths, 'status-stop-race-runtime');
  const child = spawn('sleep', ['30'], { stdio: 'ignore' });
  await new Promise((resolveSpawn, rejectSpawn) => {
    child.once('spawn', resolveSpawn);
    child.once('error', rejectSpawn);
  });
  const childTicks = processStartTicks(child.pid);
  t.after(() => stopRecordedProcess(child.pid, childTicks));

  let releaseRuntimeResponse;
  let markRuntimeRequest;
  const runtimeRequestSeen = new Promise(resolveRequest => { markRuntimeRequest = resolveRequest; });
  const runtimeApi = createHttpServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    releaseRuntimeResponse = () => response.end(JSON.stringify({ runtime_id: 'race-runtime', pid: child.pid, dispatch_capable: true }));
    markRuntimeRequest();
  });
  await new Promise((resolveListen, rejectListen) => {
    runtimeApi.once('error', rejectListen);
    runtimeApi.listen(0, '127.0.0.1', resolveListen);
  });
  t.after(() => new Promise(resolveClose => {
    runtimeApi.close(resolveClose);
    runtimeApi.closeAllConnections();
  }));

  const port = runtimeApi.address().port;
  const executionDirectory = join(managerPaths(paths).loopExecutionRoot, instance.id);
  const runtimeStatePath = join(executionDirectory, 'runtime.json');
  const ownershipPath = join(executionDirectory, 'ownership.json');
  const acknowledgementPath = join(executionDirectory, 'dispatch-acknowledgement.json');
  await mkdir(executionDirectory, { recursive: true });
  await writeFile(join(executionDirectory, 'execution.json'), `${JSON.stringify({
    schema_version: 1,
    id: instance.id,
    status: 'Running',
    runtime_path: runtime.path,
    runtime_version: runtime.id,
    port,
    pid: child.pid,
    process_start_ticks: childTicks,
    started_at: new Date().toISOString()
  })}\n`);
  await writeFile(ownershipPath, `${JSON.stringify({ project_root: runtime.path, runtime_id: 'race-runtime', pid: child.pid, process_start_ticks: childTicks })}\n`);
  await writeFile(acknowledgementPath, `${JSON.stringify({ runtime_id: 'race-runtime', pid: child.pid, dispatch_capable: true })}\n`);
  await writeFile(runtimeStatePath, `${JSON.stringify({
    status: 'running',
    runtime_id: 'race-runtime',
    pid: child.pid,
    process_start_ticks: childTicks,
    effective: { dashboard: `http://127.0.0.1:${port}` },
    ownership_path: ownershipPath,
    acknowledgement_path: acknowledgementPath
  })}\n`);

  const responsePromise = api(manager, '/api/v1/instances', { origin: manager.url });
  await runtimeRequestSeen;
  const executionPath = join(executionDirectory, 'execution.json');
  const stopping = JSON.parse(await readFile(executionPath, 'utf8'));
  await writeFile(executionPath, `${JSON.stringify({ ...stopping, status: 'Stopped', stopped_at: new Date().toISOString() })}\n`);
  const childExited = new Promise(resolveExit => child.once('exit', resolveExit));
  child.kill('SIGTERM');
  await childExited;
  await rm(runtimeStatePath, { force: true });
  releaseRuntimeResponse();

  const { response, body } = await responsePromise;
  assert.equal(response.status, 200);
  assert.equal(body.instances.find(value => value.id === instance.id).status, 'Stopped');
  assert.equal(JSON.parse(await readFile(executionPath, 'utf8')).status, 'Stopped');
});

test('a stopped execution record stays Stopped when its former PID has been reused', async t => {
  const paths = await fixture(t);
  const repository = await makeRepository(join(paths.directory, 'repositories'), 'stopped-project');
  const instance = await createLoopInstance(repository, { sourceRoot, ...paths });
  const executionDirectory = join(managerPaths(paths).loopExecutionRoot, instance.id);
  await mkdir(executionDirectory, { recursive: true });
  await writeFile(join(executionDirectory, 'execution.json'), `${JSON.stringify({
    schema_version: 1,
    id: instance.id,
    status: 'Stopped',
    pid: process.pid,
    process_start_ticks: 'old-process-identity',
    port: 4180
  })}\n`);

  const observed = await loopInstanceStatus(instance.id, paths);
  assert.equal(observed.status, 'Stopped');
  assert.equal(observed.port, 4180);

  const liveRepository = await makeRepository(join(paths.directory, 'repositories'), 'still-live-project');
  const liveInstance = await createLoopInstance(liveRepository, { sourceRoot, ...paths });
  const liveExecutionDirectory = join(managerPaths(paths).loopExecutionRoot, liveInstance.id);
  await mkdir(liveExecutionDirectory, { recursive: true });
  const processStat = readFileSync(`/proc/${process.pid}/stat`, 'utf8');
  const currentProcessTicks = processStat.slice(processStat.lastIndexOf(')') + 1).trim().split(/\s+/)[19];
  await writeFile(join(liveExecutionDirectory, 'execution.json'), `${JSON.stringify({
    schema_version: 1,
    id: liveInstance.id,
    status: 'Stopped',
    pid: process.pid,
    process_start_ticks: currentProcessTicks,
    port: 4181
  })}\n`);

  const stillAlive = await loopInstanceStatus(liveInstance.id, paths);
  assert.equal(stillAlive.status, 'Unconfirmed');
  assert.match(stillAlive.detail, /Stopped record still matches live Loop process/);
});

test('Loop restart reconciles a reused PID after the recorded runtime disappears', async t => {
  const paths = await fixture(t);
  const repository = await makeRepository(join(paths.directory, 'repositories'), 'reused-runtime-project');
  const instance = await createLoopInstance(repository, { sourceRoot, ...paths });
  const runtime = await installLifecycleTestRuntime(paths);
  const managed = managerPaths(paths);
  const executionDirectory = join(managed.loopExecutionRoot, instance.id);
  const port = await unusedLoopbackPort();
  const obsoleteTicks = `${processStartTicks(process.pid)}-obsolete`;
  const ownershipPath = join(executionDirectory, 'ownership.json');
  const acknowledgementPath = join(executionDirectory, 'dispatch-acknowledgement.json');
  await mkdir(executionDirectory, { recursive: true });
  await writeFile(join(executionDirectory, 'execution.json'), `${JSON.stringify({
    schema_version: 1,
    id: instance.id,
    status: 'Running',
    runtime_path: runtime.path,
    runtime_version: runtime.id,
    port,
    pid: process.pid,
    process_start_ticks: obsoleteTicks
  })}\n`);
  await writeFile(ownershipPath, `${JSON.stringify({ project_root: runtime.path, runtime_id: 'obsolete-runtime', pid: process.pid, process_start_ticks: obsoleteTicks })}\n`);
  await writeFile(acknowledgementPath, `${JSON.stringify({ runtime_id: 'obsolete-runtime', pid: process.pid, dispatch_capable: true })}\n`);
  await writeFile(join(executionDirectory, 'runtime.json'), `${JSON.stringify({
    status: 'running',
    runtime_id: 'obsolete-runtime',
    pid: process.pid,
    process_start_ticks: obsoleteTicks,
    effective: { dashboard: `http://127.0.0.1:${port}` },
    ownership_path: ownershipPath,
    acknowledgement_path: acknowledgementPath
  })}\n`);

  const recoveredStatus = await loopInstanceStatus(instance.id, paths);
  assert.equal(recoveredStatus.status, 'Failed');
  assert.match(recoveredStatus.detail, /exited without a confirmed stop request/);
  const started = await startLoopInstance(instance.id, { ...paths, minPort: port, maxPort: port });
  assert.equal(started.status, 'Starting');
  const replacement = JSON.parse(await readFile(join(executionDirectory, 'execution.json'), 'utf8'));
  assert.equal(replacement.status, 'Starting');
  assert.equal(replacement.port, port);
  assert.notEqual(replacement.launcher_pid, process.pid);
  assert.equal(processStartTicks(replacement.launcher_pid), replacement.launcher_start_ticks);
  for (const name of ['runtime.json', 'ownership.json', 'dispatch-authorization.json', 'dispatch-acknowledgement.json', 'startup-status']) {
    await assert.rejects(readFile(join(executionDirectory, name), 'utf8'), { code: 'ENOENT' });
  }
  t.after(() => stopRecordedProcess(replacement.launcher_pid, replacement.launcher_start_ticks));
});

test('Loop restart reconciles a reused PID with missing runtime state only when its port refuses connections', async t => {
  const paths = await fixture(t);
  const repository = await makeRepository(join(paths.directory, 'repositories'), 'reused-runtime-without-state-project');
  const instance = await createLoopInstance(repository, { sourceRoot, ...paths });
  await installLifecycleTestRuntime(paths);
  const managed = managerPaths(paths);
  const executionDirectory = join(managed.loopExecutionRoot, instance.id);
  const port = await unusedLoopbackPort();
  await mkdir(executionDirectory, { recursive: true });
  await writeFile(join(executionDirectory, 'execution.json'), `${JSON.stringify({
    schema_version: 1,
    id: instance.id,
    status: 'Running',
    runtime_path: '/previous-runtime',
    runtime_version: 'previous-runtime-id',
    port,
    pid: process.pid,
    process_start_ticks: `${processStartTicks(process.pid)}-obsolete`
  })}\n`);

  const observed = await loopInstanceStatus(instance.id, paths);
  assert.equal(observed.status, 'Failed');
  const started = await startLoopInstance(instance.id, { ...paths, minPort: port, maxPort: port });
  assert.equal(started.status, 'Starting');
  const replacement = JSON.parse(await readFile(join(executionDirectory, 'execution.json'), 'utf8'));
  assert.equal(replacement.status, 'Starting');
  assert.notEqual(replacement.launcher_pid, process.pid);
  t.after(() => stopRecordedProcess(replacement.launcher_pid, replacement.launcher_start_ticks));
});

test('a reused Loop PID can be reconciled when a different identified runtime owns its old port', async t => {
  const paths = await fixture(t);
  const repository = await makeRepository(join(paths.directory, 'repositories'), 'reused-runtime-with-other-service-project');
  const instance = await createLoopInstance(repository, { sourceRoot, ...paths });
  const runtime = await installLifecycleTestRuntime(paths);
  const runtimeApi = createHttpServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ runtime_id: 'replacement-runtime', pid: process.pid, dispatch_capable: true }));
  });
  await new Promise((resolveListen, rejectListen) => {
    runtimeApi.once('error', rejectListen);
    runtimeApi.listen(0, '127.0.0.1', resolveListen);
  });
  t.after(() => new Promise(resolveClose => {
    runtimeApi.close(resolveClose);
    runtimeApi.closeAllConnections();
  }));
  const port = runtimeApi.address().port;
  const executionDirectory = join(managerPaths(paths).loopExecutionRoot, instance.id);
  const ownershipPath = join(executionDirectory, 'ownership.json');
  const acknowledgementPath = join(executionDirectory, 'dispatch-acknowledgement.json');
  const currentTicks = processStartTicks(process.pid);
  const obsoleteTicks = `${currentTicks}-obsolete`;
  await mkdir(executionDirectory, { recursive: true });
  await writeFile(join(executionDirectory, 'execution.json'), `${JSON.stringify({
    schema_version: 1,
    id: instance.id,
    status: 'Running',
    runtime_path: runtime.path,
    runtime_version: runtime.id,
    port,
    pid: process.pid,
    process_start_ticks: obsoleteTicks
  })}\n`);
  await writeFile(ownershipPath, `${JSON.stringify({ project_root: runtime.path, runtime_id: 'obsolete-runtime', pid: process.pid, process_start_ticks: obsoleteTicks })}\n`);
  await writeFile(acknowledgementPath, `${JSON.stringify({ runtime_id: 'obsolete-runtime', pid: process.pid, dispatch_capable: true })}\n`);
  await writeFile(join(executionDirectory, 'runtime.json'), `${JSON.stringify({
    status: 'running',
    runtime_id: 'obsolete-runtime',
    pid: process.pid,
    process_start_ticks: obsoleteTicks,
    effective: { dashboard: `http://127.0.0.1:${port}` },
    ownership_path: ownershipPath,
    acknowledgement_path: acknowledgementPath
  })}\n`);

  const observed = await loopInstanceStatus(instance.id, paths);

  assert.equal(observed.status, 'Failed');
  assert.match(observed.detail, /exited without a confirmed stop request/);
  assert.equal(runtimeApi.listening, true);
  assert.equal(processStartTicks(process.pid), currentTicks);
});

test('a reused Loop PID remains Unconfirmed when its assigned port still responds', async t => {
  const paths = await fixture(t);
  const repository = await makeRepository(join(paths.directory, 'repositories'), 'reused-runtime-occupied-port-project');
  const instance = await createLoopInstance(repository, { sourceRoot, ...paths });
  const runtimeApi = createHttpServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ runtime_id: 'some-other-runtime', pid: process.pid, dispatch_capable: true }));
  });
  await new Promise((resolveListen, rejectListen) => {
    runtimeApi.once('error', rejectListen);
    runtimeApi.listen(0, '127.0.0.1', resolveListen);
  });
  t.after(() => new Promise(resolveClose => {
    runtimeApi.close(resolveClose);
    runtimeApi.closeAllConnections();
  }));
  const port = runtimeApi.address().port;
  const executionDirectory = join(managerPaths(paths).loopExecutionRoot, instance.id);
  await mkdir(executionDirectory, { recursive: true });
  await writeFile(join(executionDirectory, 'execution.json'), `${JSON.stringify({
    schema_version: 1,
    id: instance.id,
    status: 'Running',
    runtime_path: '/previous-runtime',
    runtime_version: 'previous-runtime-id',
    port,
    pid: process.pid,
    process_start_ticks: `${processStartTicks(process.pid)}-obsolete`
  })}\n`);

  const observed = await loopInstanceStatus(instance.id, paths);
  assert.equal(observed.status, 'Unconfirmed');
  assert.match(observed.detail, /Loop runtime absence is not confirmed/);
  assert.equal(runtimeApi.listening, true);
});

test('instance discovery isolates malformed dashboards and unavailable Runtime distributions', async t => {
  const paths = await fixture(t);
  const managed = managerPaths(paths);
  const dashboardRepository = await makeRepository(join(paths.directory, 'repositories'), 'bad-dashboard-project');
  const runtimeRepository = await makeRepository(join(paths.directory, 'repositories'), 'missing-runtime-project');
  const stoppedRepository = await makeRepository(join(paths.directory, 'repositories'), 'healthy-stopped-project');
  const dashboardInstance = await createLoopInstance(dashboardRepository, { sourceRoot, ...paths });
  const missingRuntimeInstance = await createLoopInstance(runtimeRepository, { sourceRoot, ...paths });
  const stoppedInstance = await createLoopInstance(stoppedRepository, { sourceRoot, ...paths });
  const runtime = await installTestRuntime(paths, 'malformed-state-runtime');
  const dashboardExecutionDirectory = join(managed.loopExecutionRoot, dashboardInstance.id);
  await mkdir(dashboardExecutionDirectory, { recursive: true });
  const ownershipPath = join(dashboardExecutionDirectory, 'ownership.json');
  const acknowledgementPath = join(dashboardExecutionDirectory, 'dispatch-acknowledgement.json');
  const currentTicks = processStartTicks(process.pid);
  await writeFile(join(dashboardExecutionDirectory, 'execution.json'), `${JSON.stringify({
    schema_version: 1,
    id: dashboardInstance.id,
    status: 'Running',
    runtime_path: runtime.path,
    runtime_version: runtime.id,
    port: 4180,
    pid: process.pid,
    process_start_ticks: currentTicks
  })}\n`);
  await writeFile(ownershipPath, `${JSON.stringify({ project_root: runtime.path, runtime_id: 'broken-dashboard-runtime', pid: process.pid, process_start_ticks: currentTicks })}\n`);
  await writeFile(acknowledgementPath, `${JSON.stringify({ runtime_id: 'broken-dashboard-runtime', pid: process.pid, dispatch_capable: true })}\n`);
  await writeFile(join(dashboardExecutionDirectory, 'runtime.json'), `${JSON.stringify({
    status: 'running',
    runtime_id: 'broken-dashboard-runtime',
    pid: process.pid,
    process_start_ticks: currentTicks,
    effective: { dashboard: 'http://[' },
    ownership_path: ownershipPath,
    acknowledgement_path: acknowledgementPath
  })}\n`);

  const missingRuntimeDirectory = join(managed.loopExecutionRoot, missingRuntimeInstance.id);
  await mkdir(missingRuntimeDirectory, { recursive: true });
  await writeFile(join(missingRuntimeDirectory, 'execution.json'), `${JSON.stringify({
    schema_version: 1,
    id: missingRuntimeInstance.id,
    status: 'Running',
    runtime_path: join(paths.directory, 'removed-runtime'),
    runtime_version: 'removed-runtime-id',
    port: 4181,
    pid: 2_000_000_000,
    process_start_ticks: 'former-process-identity'
  })}\n`);
  await writeFile(join(missingRuntimeDirectory, 'runtime.json'), `${JSON.stringify({
    status: 'running',
    runtime_id: 'removed-runtime-id',
    pid: 2_000_000_000,
    process_start_ticks: 'former-process-identity',
    effective: { dashboard: 'http://127.0.0.1:4181' },
    ownership_path: join(missingRuntimeDirectory, 'ownership.json'),
    acknowledgement_path: join(missingRuntimeDirectory, 'dispatch-acknowledgement.json')
  })}\n`);

  const instances = await discoverRunningLoops({ ...paths, persistObservedStatus: false });
  assert.equal(instances.length, 3);
  assert.equal(instances.find(value => value.id === dashboardInstance.id).status, 'Unconfirmed');
  assert.match(instances.find(value => value.id === dashboardInstance.id).detail, /dashboard address is invalid/);
  assert.equal(instances.find(value => value.id === missingRuntimeInstance.id).status, 'Unconfirmed');
  assert.equal(instances.find(value => value.id === stoppedInstance.id).status, 'Stopped');
});

test('Manager stops an orphaned runtime through its current CLI when the pinned Runtime predates managed stop', async t => {
  const paths = await fixture(t);
  const repository = await makeRepository(join(paths.directory, 'repositories'), 'orphan-project');
  const instance = await createLoopInstance(repository, { sourceRoot, ...paths });
  const runtime = await installStopTestRuntime(paths);
  const executionDirectory = join(managerPaths(paths).loopExecutionRoot, instance.id);
  await mkdir(executionDirectory, { recursive: true });
  const portProbe = createNetServer();
  await new Promise((resolveListen, rejectListen) => {
    portProbe.once('error', rejectListen);
    portProbe.listen(0, '127.0.0.1', resolveListen);
  });
  const port = portProbe.address().port;
  await new Promise(resolveClose => portProbe.close(resolveClose));
  const ownedProcess = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  await new Promise((resolveSpawn, rejectSpawn) => {
    ownedProcess.once('spawn', resolveSpawn);
    ownedProcess.once('error', rejectSpawn);
  });
  const exited = new Promise(resolveExit => ownedProcess.once('exit', resolveExit));
  t.after(() => {
    if (ownedProcess.exitCode === null && ownedProcess.signalCode === null) ownedProcess.kill('SIGKILL');
  });
  const processStat = readFileSync(`/proc/${ownedProcess.pid}/stat`, 'utf8');
  const processStartTicks = processStat.slice(processStat.lastIndexOf(')') + 1).trim().split(/\s+/)[19];
  const ownershipPath = join(executionDirectory, 'ownership.json');
  const acknowledgementPath = join(executionDirectory, 'dispatch-acknowledgement.json');
  const runtimeId = '123e4567-e89b-42d3-a456-426614174000';
  await writeFile(ownershipPath, `${JSON.stringify({ project_root: runtime.path, runtime_id: runtimeId, pid: ownedProcess.pid, process_start_ticks: processStartTicks })}\n`);
  await writeFile(acknowledgementPath, `${JSON.stringify({ runtime_id: 'not-ready', pid: ownedProcess.pid, dispatch_capable: false })}\n`);
  await writeFile(join(executionDirectory, 'runtime.json'), `${JSON.stringify({
    status: 'provisional',
    runtime_id: runtimeId,
    pid: ownedProcess.pid,
    process_start_ticks: processStartTicks,
    effective: { dashboard: `http://127.0.0.1:${port}` },
    ownership_path: ownershipPath,
    acknowledgement_path: acknowledgementPath
  })}\n`);
  const executionPath = join(executionDirectory, 'execution.json');
  await writeFile(executionPath, `${JSON.stringify({
    schema_version: 1,
    id: instance.id,
    status: 'Starting',
    runtime_path: runtime.path,
    runtime_version: runtime.id,
    runtime_id: runtimeId,
    pid: ownedProcess.pid,
    process_start_ticks: processStartTicks,
    launcher_pid: 2147483647,
    launcher_start_ticks: 'exited-launcher',
    port,
    started_at: new Date(Date.now() - 20_000).toISOString()
  })}\n`);

  const observed = await loopInstanceStatus(instance.id, paths);
  assert.equal(observed.status, 'Failed', observed.detail);
  assert.equal(observed.can_stop, true);
  assert.match(observed.detail, /startup launcher exited/);
  assert.equal(JSON.parse(await readFile(executionPath, 'utf8')).status, 'Failed');
  await assert.rejects(allocatePort(managerPaths(paths), { minPort: port, maxPort: port, ...paths }), /no available Symphony port/);

  const stopped = await stopLoopInstance(instance.id, paths);
  await exited;
  assert.equal(stopped.status, 'Stopped');
  assert.equal(stopped.stopped, true);
  assert.equal(JSON.parse(await readFile(executionPath, 'utf8')).status, 'Stopped');
  assert.equal(await allocatePort(managerPaths(paths), { minPort: port, maxPort: port, ...paths }), port);
});

test('an orphaned Loop without a matching ownership record cannot be stopped', async t => {
  const paths = await fixture(t);
  const repository = await makeRepository(join(paths.directory, 'repositories'), 'unowned-orphan-project');
  const instance = await createLoopInstance(repository, { sourceRoot, ...paths });
  const runtime = await installTestRuntime(paths, 'unowned-orphan-fixture-runtime');
  const executionDirectory = join(managerPaths(paths).loopExecutionRoot, instance.id);
  await mkdir(executionDirectory, { recursive: true });
  const ownedProcess = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  await new Promise((resolveSpawn, rejectSpawn) => {
    ownedProcess.once('spawn', resolveSpawn);
    ownedProcess.once('error', rejectSpawn);
  });
  t.after(() => {
    if (ownedProcess.exitCode === null && ownedProcess.signalCode === null) ownedProcess.kill('SIGKILL');
  });
  const processStat = readFileSync(`/proc/${ownedProcess.pid}/stat`, 'utf8');
  const processStartTicks = processStat.slice(processStat.lastIndexOf(')') + 1).trim().split(/\s+/)[19];
  const runtimeId = 'orphan-without-owner-1';
  const ownershipPath = join(executionDirectory, 'ownership.json');
  const acknowledgementPath = join(executionDirectory, 'dispatch-acknowledgement.json');
  await writeFile(ownershipPath, `${JSON.stringify({ project_root: runtime.path, runtime_id: runtimeId, pid: ownedProcess.pid, process_start_ticks: 'mismatched-start-ticks' })}\n`);
  await writeFile(acknowledgementPath, `${JSON.stringify({ runtime_id: runtimeId, pid: ownedProcess.pid, dispatch_capable: false })}\n`);
  await writeFile(join(executionDirectory, 'runtime.json'), `${JSON.stringify({
    status: 'provisional',
    runtime_id: runtimeId,
    pid: ownedProcess.pid,
    process_start_ticks: processStartTicks,
    effective: { dashboard: 'http://127.0.0.1:4197' },
    ownership_path: ownershipPath,
    acknowledgement_path: acknowledgementPath
  })}\n`);
  await writeFile(join(executionDirectory, 'execution.json'), `${JSON.stringify({
    schema_version: 1,
    id: instance.id,
    status: 'Starting',
    runtime_path: runtime.path,
    runtime_version: runtime.id,
    runtime_id: runtimeId,
    pid: ownedProcess.pid,
    process_start_ticks: processStartTicks,
    launcher_pid: 2147483647,
    launcher_start_ticks: 'exited-launcher',
    port: 4197,
    started_at: new Date(Date.now() - 20_000).toISOString()
  })}\n`);

  const observed = await loopInstanceStatus(instance.id, paths);
  assert.equal(observed.status, 'Unconfirmed');
  assert.equal(observed.can_stop, undefined);
  assert.match(observed.detail, /ownership identity does not match/);
  await assert.rejects(stopLoopInstance(instance.id, paths), /process ownership is unconfirmed/);
  assert.equal(ownedProcess.exitCode, null);
  assert.equal(ownedProcess.signalCode, null);
});

test('unexpected Loop exits report Failed while a confirmed stop reports Stopped', async t => {
  const paths = await fixture(t);
  const runtime = await installTestRuntime(paths, 'exit-fixture-runtime');
  const repositoryRoot = join(paths.directory, 'repositories');
  const running = await createLoopInstance(await makeRepository(repositoryRoot, 'crashed-project'), { sourceRoot, ...paths });
  const stopping = await createLoopInstance(await makeRepository(repositoryRoot, 'stopping-project'), { sourceRoot, ...paths });

  async function seedExitedRuntime(instance, status, port) {
    const executionDirectory = join(managerPaths(paths).loopExecutionRoot, instance.id);
    await mkdir(executionDirectory, { recursive: true });
    const runtimeId = `dead-${instance.id}`;
    const pid = 2147483647;
    const processStartTicks = 'former-process-identity';
    const ownershipPath = join(executionDirectory, 'ownership.json');
    const acknowledgementPath = join(executionDirectory, 'dispatch-acknowledgement.json');
    await writeFile(ownershipPath, `${JSON.stringify({ project_root: runtime.path, runtime_id: runtimeId, pid, process_start_ticks: processStartTicks })}\n`);
    await writeFile(acknowledgementPath, `${JSON.stringify({ runtime_id: runtimeId, pid, dispatch_capable: true })}\n`);
    await writeFile(join(executionDirectory, 'runtime.json'), `${JSON.stringify({
      status: 'running',
      runtime_id: runtimeId,
      pid,
      process_start_ticks: processStartTicks,
      effective: { dashboard: `http://127.0.0.1:${port}` },
      ownership_path: ownershipPath,
      acknowledgement_path: acknowledgementPath
    })}\n`);
    await writeFile(join(executionDirectory, 'execution.json'), `${JSON.stringify({
      schema_version: 1,
      id: instance.id,
      status,
      runtime_path: runtime.path,
      runtime_version: runtime.id,
      runtime_id: runtimeId,
      pid,
      process_start_ticks: processStartTicks,
      port
    })}\n`);
  }

  async function closedPort() {
    const server = createNetServer();
    await new Promise((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(0, '127.0.0.1', resolveListen);
    });
    const port = server.address().port;
    await new Promise(resolveClose => server.close(resolveClose));
    return port;
  }

  await seedExitedRuntime(running, 'Running', await closedPort());
  await seedExitedRuntime(stopping, 'Stopping', await closedPort());

  const unexpected = await loopInstanceStatus(running.id, paths);
  const expected = await loopInstanceStatus(stopping.id, paths);
  assert.equal(unexpected.status, 'Failed');
  assert.match(unexpected.detail, /without a confirmed stop request/);
  assert.equal(unexpected.can_update_workflow, undefined);
  assert.equal(unexpected.process_absence_confirmed, undefined);
  assert.equal(unexpected.can_stop, undefined);
  assert.equal(JSON.parse(await readFile(join(managerPaths(paths).loopExecutionRoot, running.id, 'execution.json'), 'utf8')).status, 'Failed');
  assert.equal(expected.status, 'Stopped');
  assert.equal(JSON.parse(await readFile(join(managerPaths(paths).loopExecutionRoot, stopping.id, 'execution.json'), 'utf8')).status, 'Stopped');
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

test('Manager startup replaces a service record whose PID has been reused', async t => {
  const paths = await fixture(t);
  const runtime = await installManagerServiceTestRuntime(paths);
  const managed = managerPaths(paths);
  const port = await unusedLoopbackPort();
  await mkdir(managed.configRoot, { recursive: true });
  await writeFile(managed.managerConfiguration, `${JSON.stringify({ schema_version: 1, port, symphony_port_min: 4200, symphony_port_max: 4209 })}\n`, { mode: 0o600 });
  const children = new Map();
  t.after(async () => {
    for (const [pid, ticks] of children) await stopRecordedProcess(pid, ticks);
  });

  const first = await ensureManagerService({ sourceRoot, environment: paths.environment, homeDirectory: paths.homeDirectory });
  const firstRecord = JSON.parse(await readFile(managed.managerServiceRecord, 'utf8'));
  children.set(firstRecord.pid, firstRecord.process_start_ticks);
  assert.equal(firstRecord.runtime_version, runtime.id);
  await stopRecordedProcess(firstRecord.pid, firstRecord.process_start_ticks, 'SIGKILL');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await fetch(`${first.url}/api/v1/manager`, { signal: AbortSignal.timeout(100) });
    } catch (error) {
      if (error?.cause?.code === 'ECONNREFUSED') break;
    }
    if (attempt === 99) assert.fail('first Manager did not release its loopback port');
    await new Promise(resolveSleep => setTimeout(resolveSleep, 20));
  }
  const currentTicks = processStartTicks(process.pid);
  await writeFile(managed.managerServiceRecord, `${JSON.stringify({ ...firstRecord, pid: process.pid, process_start_ticks: `${currentTicks}-obsolete` })}\n`, { mode: 0o600 });

  const restarted = await ensureManagerService({ sourceRoot, environment: paths.environment, homeDirectory: paths.homeDirectory });
  const replacement = JSON.parse(await readFile(managed.managerServiceRecord, 'utf8'));
  children.set(replacement.pid, replacement.process_start_ticks);
  assert.equal(restarted.alreadyRunning, false);
  assert.notEqual(replacement.pid, process.pid);
  assert.notEqual(replacement.pid, firstRecord.pid);
  assert.equal(replacement.runtime_version, runtime.id);
  assert.equal(processStartTicks(replacement.pid), replacement.process_start_ticks);
  const health = await fetch(`${restarted.url}/api/v1/manager`, { headers: { 'x-leesh-loop-token': restarted.token } });
  assert.equal(health.status, 200);
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
    const captured = await readFile(browserCapture, 'utf8').catch(error => error?.code === 'ENOENT' ? undefined : Promise.reject(error));
    if (captured) browserArgument = captured;
    if (browserArgument === undefined) await new Promise(resolveSleep => setTimeout(resolveSleep, 20));
  }
  assert.ok(browserArgument);
  assert.equal(new URL(browserArgument).protocol, 'http:');
  assert.ok(!browserArgument.includes(manager.token));
  assert.equal(browserArgument, manager.url);
  await assert.rejects(lstat(managedPaths.managerBrowserBootstrap), { code: 'ENOENT' });

  const repository = await makeRepository(join(paths.directory, 'repositories'), 'cli-project');
  const cli = resolve(import.meta.dirname, '../../../bin/leesh-loop.mjs');
  const initialized = await execFile(process.execPath, [cli, 'init'], { cwd: repository, env: paths.environment, encoding: 'utf8', timeout: 10_000 });
  assert.match(initialized.stdout, /Added project cli-project/);
  const listed = await execFile(process.execPath, [cli, 'list'], { cwd: paths.directory, env: paths.environment, encoding: 'utf8', timeout: 10_000 });
  assert.match(listed.stdout, /cli-project/);
  assert.match(listed.stdout, new RegExp(repository.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(listed.stdout, /r\s+e\s+p\s+o\s+i\s+t/);

  const nestedDirectory = join(repository, 'nested');
  await mkdir(nestedDirectory);
  const stoppedFromNestedDirectory = await execFile(process.execPath, [cli, 'stop', nestedDirectory], { cwd: paths.directory, env: paths.environment, encoding: 'utf8', timeout: 10_000 });
  assert.match(stoppedFromNestedDirectory.stdout, new RegExp(`cli-project at ${repository.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}: Loop Stopped`));

  const duplicateRepository = await makeRepository(join(paths.directory, 'second-team'), 'cli-project');
  const addedByPath = await execFile(process.execPath, [cli, 'add', duplicateRepository], { cwd: paths.directory, env: paths.environment, encoding: 'utf8', timeout: 10_000 });
  assert.match(addedByPath.stdout, /Project: cli-project/);
  assert.ok(addedByPath.stdout.includes(duplicateRepository));
  const duplicateNames = await execFile(process.execPath, [cli, 'start', 'cli-project'], { cwd: paths.directory, env: paths.environment, encoding: 'utf8', timeout: 10_000 })
    .then(result => ({ result }), error => ({ error }));
  assert.equal(duplicateNames.error?.code, 1);
  assert.match(duplicateNames.error.stderr, /Project name 'cli-project' is ambiguous/);
  assert.ok(duplicateNames.error.stderr.includes(repository));
  assert.ok(duplicateNames.error.stderr.includes(duplicateRepository));
  assert.doesNotMatch(duplicateNames.error.stderr, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);

  paths.environment.LEESH_LOOP_BROWSER_COMMAND = join(paths.directory, 'missing-browser-command');
  const openAttempt = await execFile(process.execPath, [cli], { cwd: paths.directory, env: paths.environment, encoding: 'utf8', timeout: 10_000 })
    .then(result => ({ result }), error => ({ error }));
  assert.equal(openAttempt.error?.code, 1);
  assert.match(openAttempt.error.stderr, /Manager is running at http:\/\/127\.0\.0\.1:/);
  assert.match(openAttempt.error.stderr, /browser could not be opened/);
  assert.match(openAttempt.error.stderr, /Open this local address in a browser: http:\/\/127\.0\.0\.1:/);
  assert.doesNotMatch(openAttempt.error.stderr, /file:\/\//);
  assert.equal((await api(manager, '/api/v1/manager')).response.status, 200);

  const failingBrowserCommand = join(paths.directory, 'failing-browser.mjs');
  await writeFile(failingBrowserCommand, '#!/usr/bin/env node\nprocess.exit(23);\n', { mode: 0o700 });
  await chmod(failingBrowserCommand, 0o700);
  paths.environment.LEESH_LOOP_BROWSER_COMMAND = failingBrowserCommand;
  const failedDispatch = await execFile(process.execPath, [cli], { cwd: paths.directory, env: paths.environment, encoding: 'utf8', timeout: 10_000 })
    .then(result => ({ result }), error => ({ error }));
  assert.equal(failedDispatch.error?.code, 1);
  assert.match(failedDispatch.error.stderr, /exited unsuccessfully with status 23/);
  assert.match(failedDispatch.error.stderr, /Open this local address in a browser: http:\/\/127\.0\.0\.1:/);
  assert.doesNotMatch(failedDispatch.error.stderr, /file:\/\//);
  assert.equal((await api(manager, '/api/v1/manager')).response.status, 200);

  const uiList = await api(manager, '/api/v1/instances');
  assert.deepEqual(uiList.body.instances.map(instance => instance.repository_root).sort(), [repository, duplicateRepository].sort());
  assert.equal(new Set(uiList.body.instances.map(instance => instance.data_directory)).size, 2);
  const stoppedAll = await execFile(process.execPath, [cli, 'stop', '--all'], { cwd: paths.directory, env: paths.environment, encoding: 'utf8', timeout: 10_000 });
  assert.match(stoppedAll.stdout, /No active project Loops to stop/);
});

test('Workflow review and apply follow a custom instance-owned workflow_path', async t => {
  const paths = await fixture(t);
  const repository = await makeRepository(join(paths.directory, 'repositories'), 'custom-workflow-project');
  const instance = await createLoopInstance(repository, { sourceRoot, ...paths });
  const defaultWorkflowPath = join(instance.data_directory, 'WORKFLOW.md');
  const defaultWorkflow = await readFile(defaultWorkflowPath, 'utf8');
  const customWorkflowPath = join(instance.data_directory, 'custom', 'WORKFLOW.md');
  await mkdir(join(instance.data_directory, 'custom'), { recursive: true });
  const customWorkflow = defaultWorkflow + '\nCustom workflow content remains until approved.\n';
  await writeFile(customWorkflowPath, customWorkflow);
  const projectFile = join(instance.data_directory, 'project.toml');
  const project = await readFile(projectFile, 'utf8');
  const workflowPath = /^workflow_path = "([^"]+)"$/m.exec(project);
  assert.ok(workflowPath);
  await writeFile(projectFile, project.replace(workflowPath[0], 'workflow_path = "custom/WORKFLOW.md"'));
  const manager = await startManagerFixture(t, paths);

  const comparison = await api(manager, '/api/v1/instances/' + instance.id + '/workflow');
  assert.equal(comparison.response.status, 200);
  assert.equal(comparison.body.current, customWorkflow);
  assert.equal(comparison.body.changed, true);
  const applied = await api(manager, '/api/v1/instances/' + instance.id + '/workflow', {
    method: 'PUT', origin: manager.url,
    body: { confirm: true, expectedCurrent: customWorkflow, expectedCandidateDigest: comparison.body.candidate_digest }
  });
  assert.equal(applied.response.status, 200);
  assert.equal(await readFile(customWorkflowPath, 'utf8'), comparison.body.candidate);
  assert.equal(await readFile(defaultWorkflowPath, 'utf8'), defaultWorkflow);
  assert.equal(await readFile(applied.body.backup, 'utf8'), customWorkflow);

  const outsideWorkflowPath = join(paths.directory, 'outside-workflow.md');
  await writeFile(outsideWorkflowPath, 'outside the instance');
  const currentProject = await readFile(projectFile, 'utf8');
  await writeFile(projectFile, currentProject.replace('workflow_path = "custom/WORKFLOW.md"', 'workflow_path = "' + outsideWorkflowPath + '"'));
  const rejected = await api(manager, '/api/v1/instances/' + instance.id + '/workflow');
  assert.equal(rejected.response.status, 409);
  assert.match(rejected.body.error, /workflow_path must point to a regular file inside its managed data directory/);

  const projectWithOutsideWorkflow = await readFile(projectFile, 'utf8');
  await writeFile(projectFile, projectWithOutsideWorkflow.replace(/^workflow_path = .+$/m, 'workflow_path = "project.toml"'));
  const projectBefore = await readFile(projectFile);
  const reservedProject = await api(manager, '/api/v1/instances/' + instance.id + '/workflow');
  assert.equal(reservedProject.response.status, 409);
  assert.match(reservedProject.body.error, /dedicated Markdown file/);
  assert.deepEqual(await readFile(projectFile), projectBefore);

  const databasePath = join(instance.data_directory, 'state', 'local-task-store', 'local-task-store.sqlite');
  const databaseBefore = await readFile(databasePath);
  const projectWithReservedDatabase = await readFile(projectFile, 'utf8');
  await writeFile(projectFile, projectWithReservedDatabase.replace(/^workflow_path = .+$/m, 'workflow_path = "state/local-task-store/local-task-store.sqlite"'));
  const reservedDatabase = await api(manager, '/api/v1/instances/' + instance.id + '/workflow');
  assert.equal(reservedDatabase.response.status, 409);
  assert.match(reservedDatabase.body.error, /dedicated Markdown file/);
  assert.deepEqual(await readFile(databasePath), databaseBefore);
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
  assert.match(comparison.body.candidate_digest, /^[0-9a-f]{64}$/);
  const missingConfirmation = await api(manager, `/api/v1/instances/${instance.id}/workflow`, {
    method: 'PUT', body: { expectedCurrent: current }
  });
  assert.equal(missingConfirmation.response.status, 400);
  const missingCandidateDigest = await api(manager, `/api/v1/instances/${instance.id}/workflow`, {
    method: 'PUT', origin: manager.url, body: { confirm: true, expectedCurrent: current }
  });
  assert.equal(missingCandidateDigest.response.status, 400);

  const applied = await api(manager, `/api/v1/instances/${instance.id}/workflow`, {
    method: 'PUT', origin: manager.url,
    body: { confirm: true, expectedCurrent: current, expectedCandidateDigest: comparison.body.candidate_digest }
  });
  assert.equal(applied.response.status, 200);
  assert.equal(applied.body.updated, true);
  assert.notEqual(await readFile(workflowPath, 'utf8'), current);
  assert.equal(await readFile(applied.body.backup, 'utf8'), current);
});

test('Workflow Apply rejects a template candidate changed after comparison until the new diff is reviewed', async t => {
  const paths = await fixture(t);
  const repository = await makeRepository(join(paths.directory, 'repositories'), 'workflow-candidate-project');
  const instance = await createLoopInstance(repository, { sourceRoot, ...paths });
  const workflowPath = join(instance.data_directory, 'WORKFLOW.md');
  const current = `${await readFile(workflowPath, 'utf8')}\nPreserve this user edit.\n`;
  await writeFile(workflowPath, current);

  const managerSourceRoot = join(paths.directory, 'manager-source');
  const templatePath = join(managerSourceRoot, 'docs/WORKFLOW_TEMPLATE.md');
  await mkdir(join(managerSourceRoot, 'docs'), { recursive: true });
  await writeFile(templatePath, 'Template A: reviewed workflow instructions.\n');
  const manager = await startManagerFixture(t, paths, { sourceRoot: managerSourceRoot });

  const reviewed = await api(manager, `/api/v1/instances/${instance.id}/workflow`);
  assert.match(reviewed.body.candidate, /Template A/);
  assert.match(reviewed.body.candidate_digest, /^[0-9a-f]{64}$/);
  await writeFile(templatePath, 'Template B: changed after the comparison.\n');

  const staleApproval = await api(manager, `/api/v1/instances/${instance.id}/workflow`, {
    method: 'PUT', origin: manager.url,
    body: { confirm: true, expectedCurrent: current, expectedCandidateDigest: reviewed.body.candidate_digest }
  });
  assert.equal(staleApproval.response.status, 409);
  assert.match(staleApproval.body.error, /template changed since it was reviewed/);
  assert.equal(await readFile(workflowPath, 'utf8'), current);
  await assert.rejects(readdir(join(instance.data_directory, 'workflow-backups')), { code: 'ENOENT' });

  const refreshed = await api(manager, `/api/v1/instances/${instance.id}/workflow`);
  assert.notEqual(refreshed.body.candidate_digest, reviewed.body.candidate_digest);
  assert.match(refreshed.body.candidate, /Template B/);
  const applied = await api(manager, `/api/v1/instances/${instance.id}/workflow`, {
    method: 'PUT', origin: manager.url,
    body: { confirm: true, expectedCurrent: current, expectedCandidateDigest: refreshed.body.candidate_digest }
  });
  assert.equal(applied.response.status, 200);
  assert.equal(applied.body.updated, true);
  assert.equal(await readFile(workflowPath, 'utf8'), refreshed.body.candidate);
  assert.equal(await readFile(applied.body.backup, 'utf8'), current);
});

test('Workflow repair is available after a failed launcher exits and remains blocked while a failed runtime is alive', async t => {
  const paths = await fixture(t);
  const repositoryRoot = join(paths.directory, 'repositories');
  const failed = await createLoopInstance(await makeRepository(repositoryRoot, 'failed-workflow-project'), { sourceRoot, ...paths });
  const activeFailure = await createLoopInstance(await makeRepository(repositoryRoot, 'active-failed-workflow-project'), { sourceRoot, ...paths });
  const manager = await startManagerFixture(t, paths);

  const failedWorkflowPath = join(failed.data_directory, 'WORKFLOW.md');
  const failedCurrent = `${await readFile(failedWorkflowPath, 'utf8')}\nKeep this failed-start workflow change.\n`;
  await writeFile(failedWorkflowPath, failedCurrent);
  const failedExecutionDirectory = join(managerPaths(paths).loopExecutionRoot, failed.id);
  await mkdir(failedExecutionDirectory, { recursive: true });
  await writeFile(join(failedExecutionDirectory, 'execution.json'), `${JSON.stringify({
    schema_version: 1,
    id: failed.id,
    status: 'Starting',
    launcher_pid: 2147483647,
    launcher_start_ticks: 'exited-launcher-identity',
    port: 4181
  })}\n`);

  const failedList = await api(manager, '/api/v1/instances');
  const failedStatus = failedList.body.instances.find(value => value.id === failed.id);
  assert.equal(failedStatus.status, 'Failed');
  assert.equal(failedStatus.can_update_workflow, true);
  assert.equal(failedStatus.process_absence_confirmed, true);
  const failedComparison = await api(manager, `/api/v1/instances/${failed.id}/workflow`);
  const repaired = await api(manager, `/api/v1/instances/${failed.id}/workflow`, {
    method: 'PUT', origin: manager.url,
    body: { confirm: true, expectedCurrent: failedCurrent, expectedCandidateDigest: failedComparison.body.candidate_digest }
  });
  assert.equal(repaired.response.status, 200);
  assert.equal(repaired.body.updated, true);
  assert.equal(await readFile(repaired.body.backup, 'utf8'), failedCurrent);

  const liveRuntime = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  await new Promise((resolveSpawn, rejectSpawn) => {
    liveRuntime.once('spawn', resolveSpawn);
    liveRuntime.once('error', rejectSpawn);
  });
  t.after(() => {
    if (liveRuntime.exitCode === null && liveRuntime.signalCode === null) liveRuntime.kill('SIGKILL');
  });
  const processStat = readFileSync(`/proc/${liveRuntime.pid}/stat`, 'utf8');
  const processTicks = processStat.slice(processStat.lastIndexOf(')') + 1).trim().split(/\s+/)[19];
  const activeExecutionDirectory = join(managerPaths(paths).loopExecutionRoot, activeFailure.id);
  await mkdir(activeExecutionDirectory, { recursive: true });
  const activeCurrentPath = join(activeFailure.data_directory, 'WORKFLOW.md');
  const activeCurrent = `${await readFile(activeCurrentPath, 'utf8')}\nKeep this active failure unchanged.\n`;
  await writeFile(activeCurrentPath, activeCurrent);
  await writeFile(join(activeExecutionDirectory, 'execution.json'), `${JSON.stringify({
    schema_version: 1,
    id: activeFailure.id,
    status: 'Starting',
    launcher_pid: 2147483647,
    launcher_start_ticks: 'exited-launcher-identity',
    port: 4182
  })}\n`);
  await writeFile(join(activeExecutionDirectory, 'runtime.json'), `${JSON.stringify({
    status: 'failed',
    pid: liveRuntime.pid,
    process_start_ticks: processTicks,
    detail: 'startup failed while the Loop process remains alive'
  })}\n`);

  const activeList = await api(manager, '/api/v1/instances');
  const activeStatus = activeList.body.instances.find(value => value.id === activeFailure.id);
  assert.equal(activeStatus.status, 'Unconfirmed');
  assert.equal(activeStatus.can_update_workflow, undefined);
  assert.equal(activeStatus.process_absence_confirmed, undefined);
  const activeComparison = await api(manager, `/api/v1/instances/${activeFailure.id}/workflow`);
  const refused = await api(manager, `/api/v1/instances/${activeFailure.id}/workflow`, {
    method: 'PUT', origin: manager.url,
    body: { confirm: true, expectedCurrent: activeCurrent, expectedCandidateDigest: activeComparison.body.candidate_digest }
  });
  assert.equal(refused.response.status, 409);
  assert.equal(await readFile(activeCurrentPath, 'utf8'), activeCurrent);
});

test('Workflow repair recovers a confirmed-exited pre-ready runtime without its readiness acknowledgement', async t => {
  const paths = await fixture(t);
  const repository = await makeRepository(join(paths.directory, 'repositories'), 'unacknowledged-workflow-project');
  const instance = await createLoopInstance(repository, { sourceRoot, ...paths });
  const manager = await startManagerFixture(t, paths);
  const runtime = await installTestRuntime(paths, 'unacknowledged-runtime-fixture');
  const probe = createNetServer();
  await new Promise((resolveListen, rejectListen) => {
    probe.once('error', rejectListen);
    probe.listen(0, '127.0.0.1', resolveListen);
  });
  const port = probe.address().port;
  await new Promise(resolveClose => probe.close(resolveClose));

  const executionDirectory = join(managerPaths(paths).loopExecutionRoot, instance.id);
  await mkdir(executionDirectory, { recursive: true });
  const runtimeId = 'runtime-before-readiness-ack';
  const pid = 2147483647;
  const processTicks = 'exited-before-readiness';
  const ownershipPath = join(executionDirectory, 'ownership.json');
  const acknowledgementPath = join(executionDirectory, 'dispatch-acknowledgement.json');
  await writeFile(ownershipPath, `${JSON.stringify({
    project_root: runtime.path,
    runtime_id: runtimeId,
    pid,
    process_start_ticks: processTicks
  })}\n`);
  await writeFile(join(executionDirectory, 'runtime.json'), `${JSON.stringify({
    status: 'provisional',
    runtime_id: runtimeId,
    pid,
    process_start_ticks: processTicks,
    effective: { dashboard: `http://127.0.0.1:${port}` },
    ownership_path: ownershipPath,
    acknowledgement_path: acknowledgementPath
  })}\n`);
  await writeFile(join(executionDirectory, 'execution.json'), `${JSON.stringify({
    schema_version: 1,
    id: instance.id,
    status: 'Starting',
    runtime_path: runtime.path,
    runtime_version: runtime.id,
    runtime_id: runtimeId,
    pid,
    process_start_ticks: processTicks,
    launcher_pid: 2147483646,
    launcher_start_ticks: 'exited-launcher-identity',
    port
  })}\n`);

  const listed = await api(manager, '/api/v1/instances');
  const status = listed.body.instances.find(value => value.id === instance.id);
  assert.equal(status.status, 'Failed');
  assert.equal(status.can_update_workflow, true);
  assert.equal(status.process_absence_confirmed, true);

  const workflowPath = join(instance.data_directory, 'WORKFLOW.md');
  const current = `${await readFile(workflowPath, 'utf8')}\nKeep this pre-ready repair input.\n`;
  await writeFile(workflowPath, current);
  const comparison = await api(manager, `/api/v1/instances/${instance.id}/workflow`);
  const repaired = await api(manager, `/api/v1/instances/${instance.id}/workflow`, {
    method: 'PUT', origin: manager.url,
    body: { confirm: true, expectedCurrent: current, expectedCandidateDigest: comparison.body.candidate_digest }
  });
  assert.equal(repaired.response.status, 200);
  assert.equal(repaired.body.updated, true);
  assert.equal(await readFile(repaired.body.backup, 'utf8'), current);
});
