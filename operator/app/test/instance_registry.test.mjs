import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { listLoopInstances, registerLoop, registerLoopAfterStart, resolveLoopInstance } from '../instance-registry.mjs';

const cli = new URL('../../../bin/leesh-loop.mjs', import.meta.url).pathname;
const startScript = 'node operator/app/prepare-runtime.mjs && node operator/app/leesh-loop.mjs start project.toml';
const stopScript = 'node operator/app/leesh-loop.mjs stop project.toml';

async function makeLoop(parent, name, { port = 4100 } = {}) {
  const root = join(parent, name);
  await mkdir(root);
  await writeFile(join(root, 'package.json'), `${JSON.stringify({
    name: `${name}-loop`,
    private: true,
    scripts: { start: startScript, stop: stopScript }
  }, null, 2)}\n`);
  await writeFile(join(root, 'project.toml'), [
    'workflow_path = "WORKFLOW.md"',
    'symphony_workspace_root = ".runtime/workspaces"',
    'state_directory = ".runtime/state"',
    'github_repository_url = "https://github.com/example/project.git"',
    'github_base_branch = "main"',
    `symphony_port = ${port}`,
    `ui_port = ${port + 1}`,
    ''
  ].join('\n'));
  return root;
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-registry-'));
  const stateHome = join(directory, 'state-home');
  const environment = { ...process.env, XDG_STATE_HOME: stateHome };
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, stateHome, environment };
}

test('registration is stable, independent of cwd, and keeps concurrent Loop records', async t => {
  const { directory, environment } = await fixture(t);
  assert.deepEqual(await listLoopInstances({ environment }), []);
  const firstRoot = await makeLoop(directory, 'first');
  const first = await registerLoop({ cwd: firstRoot, environment });
  const repeated = await registerLoop({ cwd: firstRoot, environment });
  assert.equal(repeated.id, first.id);
  assert.equal((await listLoopInstances({ environment })).length, 1);

  const roots = await Promise.all(Array.from({ length: 8 }, (_, index) => makeLoop(directory, `parallel-${index}`)));
  await Promise.all(roots.map(cwd => registerLoop({ cwd, environment })));
  const listed = await listLoopInstances({ environment });
  assert.equal(listed.length, 9);
  assert.ok(listed.every(value => value.status === 'Stopped'));
  await rm(join(firstRoot, '.leesh-loop/instance.json'));
  await assert.rejects(registerLoop({ cwd: firstRoot, environment }), /refusing to create a duplicate/);
  const afterIdentityLoss = await listLoopInstances({ environment });
  assert.equal(afterIdentityLoss.length, 9);
  assert.equal(afterIdentityLoss.find(value => value.id === first.id).status, 'Unconfirmed');
});

test('the successful local start hook enrolls an existing generated Loop', async t => {
  const { directory, environment } = await fixture(t);
  const root = await makeLoop(directory, 'start-hook');
  const result = await registerLoopAfterStart({ cwd: root, environment });
  assert.equal(result.registered, true);
  assert.equal(result.instance.name, 'start-hook');
  assert.equal((await listLoopInstances({ environment }))[0].id, result.instance.id);
});

test('duplicate names require an ID and path identity changes are rejected', async t => {
  const { directory, environment } = await fixture(t);
  const left = await makeLoop(join(directory, 'left'), 'same-name').catch(async error => {
    if (error.code !== 'ENOENT') throw error;
    await mkdir(join(directory, 'left'));
    return makeLoop(join(directory, 'left'), 'same-name');
  });
  const rightParent = join(directory, 'right');
  await mkdir(rightParent);
  const right = await makeLoop(rightParent, 'same-name');
  const leftRecord = await registerLoop({ cwd: left, environment });
  const rightRecord = await registerLoop({ cwd: right, environment });
  const copiedParent = join(directory, 'copied');
  await mkdir(copiedParent);
  const copied = join(copiedParent, 'same-name-copy');
  await cp(left, copied, { recursive: true });
  await assert.rejects(registerLoop({ cwd: copied, environment }), /already registered at/);

  await assert.rejects(resolveLoopInstance('same-name', { environment }), /ambiguous/);
  assert.equal((await resolveLoopInstance(leftRecord.id, { environment })).path, left);
  assert.equal((await resolveLoopInstance(rightRecord.id, { environment })).path, right);

  const identityPath = join(left, '.leesh-loop', 'instance.json');
  const identity = JSON.parse(await readFile(identityPath, 'utf8'));
  identity.id = '11111111-1111-4111-8111-111111111111';
  await writeFile(identityPath, `${JSON.stringify(identity)}\n`);
  await assert.rejects(resolveLoopInstance(leftRecord.id, { environment }), /identity does not match/);
});

test('list reports Missing and Unconfirmed without rewriting runtime state', async t => {
  const { directory, environment } = await fixture(t);
  const root = await makeLoop(directory, 'missing-soon');
  const record = await registerLoop({ cwd: root, environment });
  await rm(root, { recursive: true });
  assert.equal((await listLoopInstances({ environment }))[0].status, 'Missing');

  const uncertainRoot = await makeLoop(directory, 'uncertain');
  const uncertain = await registerLoop({ cwd: uncertainRoot, environment });
  const stoppedRoot = await makeLoop(directory, 'known-stopped');
  const stopped = await registerLoop({ cwd: stoppedRoot, environment });
  const statePath = join(uncertainRoot, '.runtime/state/runtime.json');
  await mkdir(join(uncertainRoot, '.runtime/state'), { recursive: true });
  const state = { status: 'starting', runtime_id: 'runtime-pending' };
  await writeFile(statePath, `${JSON.stringify(state)}\n`);
  const before = await readFile(statePath);
  const listed = await listLoopInstances({ environment });
  assert.equal(listed.find(value => value.id === uncertain.id).status, 'Unconfirmed');
  assert.equal(listed.find(value => value.id === stopped.id).status, 'Stopped');
  assert.equal(listed.find(value => value.id === record.id).status, 'Missing');
  assert.deepEqual(await readFile(statePath), before);
});

test('Running requires matching process, ownership, readiness, and runtime API identity', async t => {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ pid: process.pid, runtime_id: 'runtime-owned', dispatch_capable: true }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const { directory, environment } = await fixture(t);
  const root = await makeLoop(directory, 'running', { port });
  const record = await registerLoop({ cwd: root, environment });
  const stateDirectory = join(root, '.runtime/state');
  await mkdir(stateDirectory, { recursive: true });
  const stat = await readFile(`/proc/${process.pid}/stat`, 'utf8');
  const startTicks = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/)[19];
  await writeFile(join(stateDirectory, 'runtime.json'), `${JSON.stringify({
    status: 'running',
    runtime_id: 'runtime-owned',
    pid: process.pid,
    process_start_ticks: startTicks,
    effective: { dashboard: `http://127.0.0.1:${port}` }
  })}\n`);
  await writeFile(join(stateDirectory, 'ownership.json'), `${JSON.stringify({
    project_root: root,
    runtime_id: 'runtime-owned',
    pid: process.pid,
    process_start_ticks: startTicks
  })}\n`);
  await writeFile(join(stateDirectory, 'dispatch-acknowledgement.json'), `${JSON.stringify({
    runtime_id: 'runtime-owned', pid: process.pid, dispatch_capable: true
  })}\n`);
  const listed = await listLoopInstances({ environment });
  assert.equal(listed.find(value => value.id === record.id).status, 'Running');
});

test('global CLI delegates to npm in the selected directory and preserves its exit status', async t => {
  const { directory, environment } = await fixture(t);
  const root = await makeLoop(directory, 'delegate');
  const record = await registerLoop({ cwd: root, environment });
  const unrelated = join(directory, 'elsewhere');
  const fakeBin = join(directory, 'bin');
  const calls = join(directory, 'npm-calls.log');
  await mkdir(unrelated);
  await mkdir(fakeBin);
  const npm = join(fakeBin, 'npm');
  await writeFile(npm, `#!/bin/sh\nprintf '%s|%s\\n' "$PWD" "$*" >> '${calls}'\necho delegated-output\nexit "${'${FAKE_NPM_EXIT:-0}'}"\n`);
  const { chmod } = await import('node:fs/promises');
  await chmod(npm, 0o755);
  const invocation = { ...environment, PATH: `${fakeBin}:${process.env.PATH}`, FAKE_NPM_EXIT: '0' };
  const listed = spawnSync(process.execPath, [cli, 'list'], { cwd: unrelated, env: invocation, encoding: 'utf8' });
  assert.equal(listed.status, 0);
  assert.match(listed.stdout, new RegExp(record.id));
  assert.match(listed.stdout, /Stopped/);

  const started = spawnSync(process.execPath, [cli, 'start', record.id], { cwd: unrelated, env: invocation, encoding: 'utf8' });
  assert.equal(started.status, 0);
  assert.match(started.stdout, /delegated-output/);
  assert.ok((await readFile(calls, 'utf8')).includes(`${root}|start`));

  const failed = spawnSync(process.execPath, [cli, 'stop', record.id], { cwd: unrelated, env: { ...invocation, FAKE_NPM_EXIT: '23' }, encoding: 'utf8' });
  assert.equal(failed.status, 23);
  const afterStop = spawnSync(process.execPath, [cli, 'list'], { cwd: unrelated, env: invocation, encoding: 'utf8' });
  assert.equal(afterStop.status, 0);
  assert.equal(afterStop.stdout.match(new RegExp(record.id, 'g'))?.length, 1);
});
