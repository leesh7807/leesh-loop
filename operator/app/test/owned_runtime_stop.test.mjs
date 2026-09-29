import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { once } from 'node:events';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const cli = join(root, 'operator/app/leesh-loop.mjs');

function processStartTicks(pid) {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  return stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/)[19];
}

async function startOwnedProcess(t) {
  const child = spawn('sleep', ['30'], { stdio: 'ignore' });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  });
  return { child, pid: child.pid, process_start_ticks: processStartTicks(child.pid) };
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-stop-owned-'));
  const stateDirectory = join(directory, 'runtime');
  const configPath = join(directory, 'project.json');
  await writeFile(configPath, JSON.stringify({
    workflow_path: join(root, 'WORKFLOW.md'),
    symphony_workspace_root: join(directory, 'workspaces'),
    github_repository_url: 'https://github.com/example/repository.git',
    github_base_branch: 'main',
    open_project_surfaces: false,
    state_directory: stateDirectory,
    workspace_files: []
  }));
  return { directory, stateDirectory, configPath };
}

async function runtimeServer(t, runtimeId, { hang = false } = {}) {
  const server = createServer((_request, response) => {
    if (hang) return;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ runtime_id: runtimeId }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('conditional runtime stop leaves a replacement runtime and its state untouched', async t => {
  const { directory, stateDirectory, configPath } = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { child, pid, process_start_ticks } = await startOwnedProcess(t);
  await mkdir(stateDirectory, { recursive: true });
  const runtimeState = { runtime_id: 'replacement-runtime', pid, process_start_ticks };
  await writeFile(join(stateDirectory, 'runtime.json'), JSON.stringify(runtimeState));
  const ownershipState = { runtime_id: 'replacement-runtime', pid, process_start_ticks };
  await writeFile(join(stateDirectory, 'ownership.json'), JSON.stringify(ownershipState));
  await writeFile(join(stateDirectory, 'publish-ui.json'), JSON.stringify({ pid: 999999, process_start_ticks: 'unrelated' }));

  const { stdout } = await execFileAsync(process.execPath, [cli, 'stop-owned', configPath, 'recorded-run-runtime'], { timeout: 10_000 });

  assert.deepEqual(JSON.parse(stdout), {
    stopped: false,
    identity_mismatch: true,
    expected_runtime_id: 'recorded-run-runtime',
    observed_runtime_id: 'replacement-runtime'
  });
  assert.deepEqual(JSON.parse(await readFile(join(stateDirectory, 'runtime.json'), 'utf8')), runtimeState);
  assert.deepEqual(JSON.parse(await readFile(join(stateDirectory, 'ownership.json'), 'utf8')), ownershipState);
  assert.deepEqual(JSON.parse(await readFile(join(stateDirectory, 'publish-ui.json'), 'utf8')), { pid: 999999, process_start_ticks: 'unrelated' });
  assert.equal(child.exitCode, null);
});

test('conditional runtime stop preserves ownership when the recorded PID identity no longer matches', async t => {
  const { directory, stateDirectory, configPath } = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { child, pid, process_start_ticks } = await startOwnedProcess(t);
  await mkdir(stateDirectory, { recursive: true });
  const runtimeState = { runtime_id: 'recorded-run-runtime', pid, process_start_ticks: `${process_start_ticks}-replacement` };
  const ownershipState = { runtime_id: 'recorded-run-runtime', pid, process_start_ticks: runtimeState.process_start_ticks };
  await writeFile(join(stateDirectory, 'runtime.json'), JSON.stringify(runtimeState));
  await writeFile(join(stateDirectory, 'ownership.json'), JSON.stringify(ownershipState));

  const { stdout } = await execFileAsync(process.execPath, [cli, 'stop-owned', configPath, 'recorded-run-runtime'], { timeout: 10_000 });

  assert.deepEqual(JSON.parse(stdout), {
    stopped: false,
    process_identity_mismatch: true,
    expected_runtime_id: 'recorded-run-runtime'
  });
  assert.deepEqual(JSON.parse(await readFile(join(stateDirectory, 'runtime.json'), 'utf8')), runtimeState);
  assert.deepEqual(JSON.parse(await readFile(join(stateDirectory, 'ownership.json'), 'utf8')), ownershipState);
  assert.equal(child.exitCode, null);
});

test('conditional runtime stop cleans the state only for the matching runtime identity', async t => {
  const { directory, stateDirectory, configPath } = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { child, pid, process_start_ticks } = await startOwnedProcess(t);
  const dashboard = await runtimeServer(t, 'replacement-runtime');
  await mkdir(stateDirectory, { recursive: true });
  await writeFile(join(stateDirectory, 'runtime.json'), JSON.stringify({ runtime_id: 'recorded-run-runtime', pid, process_start_ticks, effective: { dashboard } }));
  await writeFile(join(stateDirectory, 'ownership.json'), JSON.stringify({ runtime_id: 'recorded-run-runtime', pid, process_start_ticks }));

  const { stdout } = await execFileAsync(process.execPath, [cli, 'stop-owned', configPath, 'recorded-run-runtime'], { timeout: 10_000 });

  assert.deepEqual(JSON.parse(stdout), { stopped: true, runtime_id: 'recorded-run-runtime' });
  await assert.rejects(readFile(join(stateDirectory, 'runtime.json'), 'utf8'), { code: 'ENOENT' });
  await assert.rejects(readFile(join(stateDirectory, 'ownership.json'), 'utf8'), { code: 'ENOENT' });
  if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
});

test('run-owned stop preserves runtime ownership when the dashboard still reports that runtime', async t => {
  const { directory, stateDirectory, configPath } = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { child, pid, process_start_ticks } = await startOwnedProcess(t);
  const dashboard = await runtimeServer(t, 'recorded-run-runtime');
  const runtimeState = { runtime_id: 'recorded-run-runtime', pid, process_start_ticks, effective: { dashboard } };
  const ownershipState = { runtime_id: 'recorded-run-runtime', pid, process_start_ticks };
  await mkdir(stateDirectory, { recursive: true });
  await writeFile(join(stateDirectory, 'runtime.json'), JSON.stringify(runtimeState));
  await writeFile(join(stateDirectory, 'ownership.json'), JSON.stringify(ownershipState));

  const { stdout } = await execFileAsync(process.execPath, [cli, 'stop-owned', configPath, 'recorded-run-runtime'], { timeout: 10_000 });

  assert.deepEqual(JSON.parse(stdout), {
    stopped: false,
    runtime_still_present: true,
    expected_runtime_id: 'recorded-run-runtime',
    observed_runtime_id: 'recorded-run-runtime'
  });
  assert.deepEqual(JSON.parse(await readFile(join(stateDirectory, 'runtime.json'), 'utf8')), runtimeState);
  assert.deepEqual(JSON.parse(await readFile(join(stateDirectory, 'ownership.json'), 'utf8')), ownershipState);
  if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
});

test('run-owned stop preserves runtime ownership when dashboard confirmation times out', async t => {
  const { directory, stateDirectory, configPath } = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { child, pid, process_start_ticks } = await startOwnedProcess(t);
  const dashboard = await runtimeServer(t, 'recorded-run-runtime', { hang: true });
  const runtimeState = { runtime_id: 'recorded-run-runtime', pid, process_start_ticks, effective: { dashboard } };
  const ownershipState = { runtime_id: 'recorded-run-runtime', pid, process_start_ticks };
  await mkdir(stateDirectory, { recursive: true });
  await writeFile(join(stateDirectory, 'runtime.json'), JSON.stringify(runtimeState));
  await writeFile(join(stateDirectory, 'ownership.json'), JSON.stringify(ownershipState));

  const { stdout } = await execFileAsync(process.execPath, [cli, 'stop-owned', configPath, 'recorded-run-runtime'], { timeout: 10_000 });

  const result = JSON.parse(stdout);
  assert.equal(result.stopped, false);
  assert.equal(result.runtime_unconfirmed, true);
  assert.equal(result.expected_runtime_id, 'recorded-run-runtime');
  assert.ok(result.error);
  assert.deepEqual(JSON.parse(await readFile(join(stateDirectory, 'runtime.json'), 'utf8')), runtimeState);
  assert.deepEqual(JSON.parse(await readFile(join(stateDirectory, 'ownership.json'), 'utf8')), ownershipState);
  if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
});

test('Operator start reconciliation retains ownership when the recorded runtime still responds', async t => {
  const { directory, stateDirectory, configPath } = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { child, pid, process_start_ticks } = await startOwnedProcess(t);
  const dashboard = await runtimeServer(t, 'runtime-to-reconcile');
  const runtimeState = { status: 'running', runtime_id: 'runtime-to-reconcile', pid, process_start_ticks, effective: { dashboard } };
  const ownershipState = { runtime_id: runtimeState.runtime_id, pid, process_start_ticks };
  await mkdir(stateDirectory, { recursive: true });
  await writeFile(join(stateDirectory, 'runtime.json'), JSON.stringify(runtimeState));
  await writeFile(join(stateDirectory, 'ownership.json'), JSON.stringify(ownershipState));
  const env = { ...process.env, LEESH_LOOP_NOTION_DATABASE_URL: 'https://notion.example/database' };

  await assert.rejects(execFileAsync(process.execPath, [cli, 'start', configPath], { env, timeout: 10_000 }), error => {
    assert.match(error.stderr, /run-owned Symphony runtime runtime-to-reconcile still responds after stop/);
    return true;
  });

  assert.deepEqual(JSON.parse(await readFile(join(stateDirectory, 'runtime.json'), 'utf8')), runtimeState);
  assert.deepEqual(JSON.parse(await readFile(join(stateDirectory, 'ownership.json'), 'utf8')), ownershipState);
  if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
});

test('Operator stop retains ownership when the recorded runtime still responds', async t => {
  const { directory, stateDirectory, configPath } = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { child, pid, process_start_ticks } = await startOwnedProcess(t);
  const dashboard = await runtimeServer(t, 'runtime-to-stop');
  const runtimeState = { status: 'running', runtime_id: 'runtime-to-stop', pid, process_start_ticks, effective: { dashboard } };
  const ownershipState = { runtime_id: runtimeState.runtime_id, pid, process_start_ticks };
  await mkdir(stateDirectory, { recursive: true });
  await writeFile(join(stateDirectory, 'runtime.json'), JSON.stringify(runtimeState));
  await writeFile(join(stateDirectory, 'ownership.json'), JSON.stringify(ownershipState));
  const env = { ...process.env, LEESH_LOOP_NOTION_DATABASE_URL: 'https://notion.example/database' };

  await assert.rejects(execFileAsync(process.execPath, [cli, 'stop', configPath], { env, timeout: 10_000 }), error => {
    assert.match(error.stderr, /run-owned Symphony runtime runtime-to-stop still responds after stop/);
    return true;
  });

  assert.deepEqual(JSON.parse(await readFile(join(stateDirectory, 'runtime.json'), 'utf8')), runtimeState);
  assert.deepEqual(JSON.parse(await readFile(join(stateDirectory, 'ownership.json'), 'utf8')), ownershipState);
  if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
});
