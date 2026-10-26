import assert from 'node:assert/strict';
import { execFile as execute } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { activeRuntime, installRuntimeDistribution, installRuntimeDistributionInWorker, inspectRuntimeSource, listRuntimeDistributions, managerMustRestartForRuntime, publishRuntimeStage, readRuntimeRecoveryRecord, reconcileRuntimeRecoveryRecord, runtimeDiagnostic, writeRuntimeRecoveryRecord } from '../runtime-distribution.mjs';
import { managerPaths } from '../manager-storage.mjs';
import { hashDistribution } from '../installation-metadata.mjs';
import { listRuntimeSnapshotFiles, materializeRuntimeSnapshot } from '../runtime-manifest.mjs';
import { withRuntimeInstallLock } from '../runtime-install-lock.mjs';

const execFile = promisify(execute);
const sourceRoot = resolve(import.meta.dirname, '../../..');
const barrierTimeoutMs = 15_000;
const installJoinTimeoutMs = 300_000;

function withTimeout(promise, label, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

async function git(cwd, ...args) {
  return execFile('git', args, { cwd, encoding: 'utf8' });
}

test('Runtime installs once into the central version store and a failed update preserves the active version', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-runtime-distribution-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const environment = {
    ...process.env,
    XDG_DATA_HOME: join(directory, 'data'),
    XDG_STATE_HOME: join(directory, 'state'),
    XDG_CONFIG_HOME: join(directory, 'config')
  };

  const first = await installRuntimeDistribution(sourceRoot, { environment, homeDirectory: directory });
  assert.equal(first.changed, true);
  assert.ok((await readFile(join(first.path, 'operator/symphony/deps/bandit/mix.exs'), 'utf8')).includes('defmodule'));
  assert.ok((await readFile(join(first.path, 'operator/symphony/_build/dev/lib/symphony_elixir/ebin/symphony_elixir.app'), 'utf8')).includes('symphony_elixir'));
  assert.equal((await activeRuntime({ environment, homeDirectory: directory })).id, first.id);
  const repeated = await installRuntimeDistribution(sourceRoot, { environment, homeDirectory: directory });
  assert.equal(repeated.id, first.id);
  assert.equal(repeated.changed, false);

  const managedPaths = managerPaths({ environment, homeDirectory: directory });
  await mkdir(managedPaths.managerStateRoot, { recursive: true });
  await writeFile(managedPaths.managerServiceRecord, `${JSON.stringify({ runtime_version: first.id })}\n`, { mode: 0o600 });

  const activeFile = join(directory, 'config/leesh-loop/active-runtime.json');
  const runtimeCode = join(first.path, 'operator/app/manager.mjs');
  const originalCode = await readFile(runtimeCode);
  await writeFile(runtimeCode, `${originalCode}\n// tampered\n`);
  await assert.rejects(activeRuntime({ environment, homeDirectory: directory }), /contents do not match their immutable identity/);

  const recovered = await installRuntimeDistribution(sourceRoot, { environment, homeDirectory: directory });
  assert.equal(recovered.id, first.id);
  assert.equal(recovered.changed, true);
  assert.equal(recovered.recovered_from_invalid_active, true);
  assert.equal(recovered.repaired_distribution, true);
  assert.equal(JSON.parse(await readFile(managedPaths.managerServiceRecord, 'utf8')).manager_restart_required, true);
  assert.equal((await activeRuntime({ environment, homeDirectory: directory })).id, first.id);
  const runtimeRoot = join(directory, 'data/leesh-loop/runtimes');
  const damagedDistribution = (await readdir(runtimeRoot)).find(name => name.startsWith(`.damaged-${first.id}-`));
  assert.ok(damagedDistribution, 'the invalid immutable distribution is preserved for diagnosis');
  assert.equal(recovered.preserved_runtime_path, join(runtimeRoot, damagedDistribution));
  const recoveryRecord = JSON.parse(await readFile(managedPaths.runtimeRecovery, 'utf8'));
  assert.equal(recoveryRecord.status, 'active');
  assert.equal(recoveryRecord.runtime_id, first.id);
  assert.match(recoveryRecord.validation_error, /contents do not match their immutable identity/);
  assert.equal(recoveryRecord.preserved_runtime_path, recovered.preserved_runtime_path);
  assert.match(await readFile(join(runtimeRoot, damagedDistribution, 'operator/app/manager.mjs'), 'utf8'), /tampered/);

  const activeBeforeFailure = await readFile(activeFile, 'utf8');
  const badSource = join(directory, 'bad-source');
  await mkdir(badSource);
  await materializeRuntimeSnapshot(sourceRoot, badSource);
  const manifestFiles = listRuntimeSnapshotFiles(sourceRoot);
  assert.deepEqual(listRuntimeSnapshotFiles(badSource), manifestFiles, 'an installed package without .git can supply the next Runtime');
  assert.ok(manifestFiles.includes('operator/app/manager.mjs'));
  const packagePath = join(badSource, 'package.json');
  const packageManifest = JSON.parse(await readFile(packagePath, 'utf8'));
  packageManifest.version = '0.2.0';
  await writeFile(packagePath, `${JSON.stringify(packageManifest, null, 2)}\n`);
  await writeFile(join(badSource, 'operator/ui/package.json'), '{ invalid JSON\n');
  await git(badSource, 'init', '--quiet');
  await git(badSource, 'config', 'user.name', 'Runtime Test');
  await git(badSource, 'config', 'user.email', 'runtime-test@example.invalid');
  await git(badSource, 'add', '-A');
  await git(badSource, 'commit', '--quiet', '-m', 'broken Runtime update');

  await assert.rejects(installRuntimeDistribution(badSource, { environment, homeDirectory: directory }), /package|JSON|manifest/i);
  assert.equal(await readFile(activeFile, 'utf8'), activeBeforeFailure);
  assert.equal((await activeRuntime({ environment, homeDirectory: directory })).id, first.id);
  const distributions = await listRuntimeDistributions({ environment, homeDirectory: directory });
  assert.deepEqual(distributions.map(value => value.id), [first.id]);
});

test('concurrent same-ID Runtime installers serialize before inspecting and replacing the destination', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-runtime-concurrent-recovery-'));
  t.after(() => withTimeout(rm(directory, { recursive: true, force: true }), 'concurrent installer test teardown', barrierTimeoutMs));
  const environment = {
    ...process.env,
    XDG_DATA_HOME: join(directory, 'data'),
    XDG_STATE_HOME: join(directory, 'state'),
    XDG_CONFIG_HOME: join(directory, 'config')
  };
  const options = { environment, homeDirectory: directory };
  const first = await installRuntimeDistribution(sourceRoot, options);
  const damagedFile = join(first.path, 'operator/app/manager.mjs');
  const originalContents = await readFile(damagedFile);
  await writeFile(damagedFile, `${originalContents}\n// concurrent repair fixture\n`);
  await assert.rejects(activeRuntime(options), /contents do not match their immutable identity/);

  let continueFirstInstaller;
  const firstInstallerGate = new Promise(resolveGate => { continueFirstInstaller = resolveGate; });
  let signalFirstSnapshot;
  const firstSnapshotReady = new Promise(resolveSnapshot => { signalFirstSnapshot = resolveSnapshot; });
  const firstInstaller = installRuntimeDistribution(sourceRoot, options, {
    afterRecoverySnapshot: async snapshot => {
      signalFirstSnapshot(snapshot);
      await firstInstallerGate;
    }
  });
  const firstInstallerOutcome = firstInstaller.then(
    value => ({ status: 'fulfilled', value }),
    reason => ({ status: 'rejected', reason })
  );

  let secondInstallerOutcome;
  let secondInstaller;
  let barrierError;
  try {
    const firstSnapshotOrExit = await withTimeout(Promise.race([
      firstSnapshotReady.then(snapshot => ({ type: 'snapshot', snapshot })),
      firstInstallerOutcome.then(outcome => ({ type: 'exit', outcome }))
    ]), 'first installer snapshot', barrierTimeoutMs);
    assert.equal(firstSnapshotOrExit.type, 'snapshot', firstSnapshotOrExit.outcome?.reason?.stack ?? 'first installer exited before exposing its recovery snapshot');
    assert.equal(firstSnapshotOrExit.snapshot.recoveryRecord, null);
    assert.equal(firstSnapshotOrExit.snapshot.previousActive, null);
    assert.match(firstSnapshotOrExit.snapshot.previousActiveError, /contents do not match their immutable identity/);

    let signalSecondWait;
    const secondWaitStarted = new Promise(resolveWait => { signalSecondWait = resolveWait; });
    secondInstaller = installRuntimeDistributionInWorker(sourceRoot, options, { onInstallLockWait: signalSecondWait });
    secondInstallerOutcome = secondInstaller.then(
      value => ({ status: 'fulfilled', value }),
      reason => ({ status: 'rejected', reason })
    );
    const secondWaitOrExit = await withTimeout(Promise.race([
      secondWaitStarted.then(() => ({ type: 'waiting' })),
      secondInstallerOutcome.then(outcome => ({ type: 'exit', outcome }))
    ]), 'Worker installer lock contention signal', barrierTimeoutMs);
    assert.equal(secondWaitOrExit.type, 'waiting', secondWaitOrExit.outcome?.reason?.stack ?? 'Worker installer exited before reporting lock contention');
  } catch (error) {
    barrierError = error;
  } finally {
    // Always let the direct installer finish, even when a contention signal fails.
    continueFirstInstaller();
  }

  const settledInstallers = await withTimeout(Promise.all([
    firstInstallerOutcome,
    ...(secondInstallerOutcome ? [secondInstallerOutcome] : [])
  ]), 'installer completion after releasing the test barrier', installJoinTimeoutMs);
  if (barrierError) throw barrierError;
  const firstOutcome = settledInstallers[0];
  assert.equal(firstOutcome.status, 'fulfilled', firstOutcome.reason?.stack ?? 'first installer failed');
  const firstResult = firstOutcome.value;
  assert.equal(firstResult.repaired_distribution, true);
  assert.ok(firstResult.preserved_runtime_path);
  assert.match(await readFile(join(firstResult.preserved_runtime_path, 'operator/app/manager.mjs'), 'utf8'), /concurrent repair fixture/);

  const secondOutcome = settledInstallers[1];
  assert.equal(secondOutcome?.status, 'fulfilled', secondOutcome?.reason?.stack ?? 'Worker installer failed');
  const secondResult = secondOutcome.value;
  assert.equal(secondResult.recovered_from_invalid_active, false);
  assert.equal(secondResult.repaired_distribution, false);
  assert.equal(secondResult.changed, false);
  const recovery = (await readRuntimeRecoveryRecord(options)).record;
  assert.equal(recovery.status, 'active');
  assert.equal(recovery.runtime_id, first.id);
  assert.equal(recovery.preserved_runtime_path, firstResult.preserved_runtime_path);
});

test('stale recovery-lock cleanup preserves a replacement generation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-runtime-recovery-generation-'));
  t.after(() => withTimeout(rm(directory, { recursive: true, force: true }), 'recovery-generation test teardown', barrierTimeoutMs));
  const runtimeRoot = join(directory, 'runtimes');
  const lockPath = join(runtimeRoot, '.runtime-install.lock');
  const recoveryPath = `${lockPath}.recovery`;
  await mkdir(recoveryPath, { recursive: true });
  await writeFile(join(recoveryPath, 'owner.json'), `${JSON.stringify({
    pid: 999999999,
    process_start_ticks: null,
    token: 'abandoned-recovery-owner',
    created_at: Date.now()
  })}\n`);

  let releaseSnapshot;
  const snapshotGate = new Promise(resolveGate => { releaseSnapshot = resolveGate; });
  let signalSnapshot;
  const staleSnapshotReady = new Promise(resolveSnapshot => { signalSnapshot = resolveSnapshot; });
  let paused = false;
  let signalWait;
  const waitStarted = new Promise(resolveWait => { signalWait = resolveWait; });
  let entered = false;
  const lockOperation = withRuntimeInstallLock(runtimeRoot, async () => { entered = true; }, {
    onWait: signalWait,
    afterRecoveryLockSnapshot: async () => {
      if (paused) return;
      paused = true;
      signalSnapshot();
      await snapshotGate;
    }
  });
  const lockOutcome = lockOperation.then(
    value => ({ status: 'fulfilled', value }),
    reason => ({ status: 'rejected', reason })
  );

  try {
    await withTimeout(staleSnapshotReady, 'stale recovery-lock snapshot', barrierTimeoutMs);
    await rm(recoveryPath, { recursive: true, force: true });
    await mkdir(recoveryPath);
    const replacementOwner = {
      pid: process.pid,
      process_start_ticks: null,
      token: 'replacement-recovery-owner',
      created_at: Date.now()
    };
    await writeFile(join(recoveryPath, 'owner.json'), `${JSON.stringify(replacementOwner)}\n`);
    releaseSnapshot();

    await withTimeout(waitStarted, 'replacement recovery-owner wait', barrierTimeoutMs);
    assert.deepEqual(JSON.parse(await readFile(join(recoveryPath, 'owner.json'), 'utf8')), replacementOwner);
    assert.equal(entered, false, 'installer must wait while the replacement recovery owner is live');
    const claims = (await readdir(runtimeRoot)).filter(name => name.includes('.recovery-claim-'));
    assert.deepEqual(claims, [], 'the replacement generation should be restored to the canonical path');

    await rm(recoveryPath, { recursive: true, force: true });
    const outcome = await withTimeout(lockOutcome, 'installer after releasing replacement recovery owner', barrierTimeoutMs);
    assert.equal(outcome.status, 'fulfilled', outcome.reason?.stack ?? 'installer failed');
    assert.equal(entered, true);
  } finally {
    releaseSnapshot();
    await rm(recoveryPath, { recursive: true, force: true });
    await withTimeout(lockOutcome, 'lock operation cleanup', barrierTimeoutMs).catch(() => {});
  }
});

test('stale recovery-lock cleanup retries when a replacement owner releases its claimed generation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-runtime-recovery-release-'));
  t.after(() => withTimeout(rm(directory, { recursive: true, force: true }), 'recovery-release test teardown', barrierTimeoutMs));
  const runtimeRoot = join(directory, 'runtimes');
  const lockPath = join(runtimeRoot, '.runtime-install.lock');
  const recoveryPath = `${lockPath}.recovery`;
  await mkdir(recoveryPath, { recursive: true });
  await writeFile(join(recoveryPath, 'owner.json'), `${JSON.stringify({
    pid: 999999999,
    process_start_ticks: null,
    token: 'abandoned-recovery-owner',
    created_at: Date.now()
  })}\n`);

  let releaseSnapshot;
  const snapshotGate = new Promise(resolveGate => { releaseSnapshot = resolveGate; });
  let signalSnapshot;
  const staleSnapshotReady = new Promise(resolveSnapshot => { signalSnapshot = resolveSnapshot; });
  let pausedSnapshot = false;
  let releaseClaim;
  const claimGate = new Promise(resolveGate => { releaseClaim = resolveGate; });
  let signalClaim;
  const claimedGenerationReady = new Promise(resolveClaim => { signalClaim = resolveClaim; });
  let entered = false;
  const lockOperation = withRuntimeInstallLock(runtimeRoot, async () => { entered = true; }, {
    afterRecoveryLockSnapshot: async () => {
      if (pausedSnapshot) return;
      pausedSnapshot = true;
      signalSnapshot();
      await snapshotGate;
    },
    afterRecoveryLockClaim: async claimPath => {
      signalClaim(claimPath);
      await claimGate;
    }
  });
  const lockOutcome = lockOperation.then(
    value => ({ status: 'fulfilled', value }),
    reason => ({ status: 'rejected', reason })
  );

  try {
    await withTimeout(staleSnapshotReady, 'stale recovery-lock snapshot', barrierTimeoutMs);
    await rm(recoveryPath, { recursive: true, force: true });
    await mkdir(recoveryPath);
    await writeFile(join(recoveryPath, 'owner.json'), `${JSON.stringify({
      pid: process.pid,
      process_start_ticks: null,
      token: 'replacement-recovery-owner',
      created_at: Date.now()
    })}\n`);
    releaseSnapshot();

    const claimPath = await withTimeout(claimedGenerationReady, 'replacement recovery generation claim', barrierTimeoutMs);
    assert.match(claimPath, /\.recovery-claim-/);
    assert.equal(JSON.parse(await readFile(join(claimPath, 'owner.json'), 'utf8')).token, 'replacement-recovery-owner');
    await rm(claimPath, { recursive: true, force: true });
    releaseClaim();

    const outcome = await withTimeout(lockOutcome, 'installer retry after recovery-owner release', barrierTimeoutMs);
    assert.equal(outcome.status, 'fulfilled', outcome.reason?.stack ?? 'installer failed after claim release');
    assert.equal(entered, true);
  } finally {
    releaseSnapshot();
    releaseClaim();
    await rm(recoveryPath, { recursive: true, force: true });
    await withTimeout(lockOutcome, 'lock operation cleanup', barrierTimeoutMs).catch(() => {});
  }
});

test('Runtime installation lock reclaims an abandoned process owner', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-runtime-install-lock-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runtimeRoot = join(directory, 'runtimes');
  const lockPath = join(runtimeRoot, '.runtime-install.lock');
  await mkdir(lockPath, { recursive: true });
  await writeFile(join(lockPath, 'owner.json'), `${JSON.stringify({ pid: 999999999, process_start_ticks: null, token: 'abandoned', created_at: Date.now() })}\n`);

  let entered = false;
  await withRuntimeInstallLock(runtimeRoot, async () => { entered = true; });

  assert.equal(entered, true);
  await assert.rejects(lstat(lockPath), { code: 'ENOENT' });
});

test('Manager restart is required when a damaged Runtime is repaired under the same identity', () => {
  const runtime = { id: 'a'.repeat(64), repaired_distribution: true };
  assert.equal(managerMustRestartForRuntime(runtime.id, runtime), true);
  assert.equal(managerMustRestartForRuntime('previous-runtime', runtime), true);
  assert.equal(managerMustRestartForRuntime(runtime.id, { id: runtime.id, repaired_distribution: false }), false);
});

test('Runtime diagnostics are bounded before they reach the UI or CLI', () => {
  const detail = runtimeDiagnostic(new Error('x'.repeat(800)));
  assert.equal(detail.length, 398);
  assert.ok(detail.endsWith('…'));
});

test('Runtime recovery readback rejects malformed diagnostic fields', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-runtime-recovery-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const environment = {
    ...process.env,
    XDG_DATA_HOME: join(directory, 'data'),
    XDG_STATE_HOME: join(directory, 'state'),
    XDG_CONFIG_HOME: join(directory, 'config')
  };
  const options = { environment, homeDirectory: directory };
  const id = 'a'.repeat(64);
  const preservedPath = join(managerPaths(options).runtimeRoot, `.damaged-${id}-fixture`);
  const record = await writeRuntimeRecoveryRecord({ runtime_id: id, status: 'active', validation_error: 'damaged file', preserved_runtime_path: preservedPath }, options);
  assert.equal(record.status, 'active');
  assert.equal((await readRuntimeRecoveryRecord(options)).record.preserved_runtime_path, record.preserved_runtime_path);
  await assert.rejects(writeRuntimeRecoveryRecord({ runtime_id: id, status: 'active', preserved_runtime_path: 'relative/path' }, options), /path is invalid/);
  await assert.rejects(writeRuntimeRecoveryRecord({ runtime_id: id, status: 'active', preserved_runtime_path: join(managerPaths(options).runtimeRoot, '.damaged-other-id-fixture') }, options), /path is invalid/);
  await writeFile(managerPaths(options).runtimeRecovery, `${JSON.stringify({ ...record, validation_error: 'x'.repeat(401) })}\n`);
  assert.deepEqual(await readRuntimeRecoveryRecord(options), { record: null, error: 'Runtime recovery record is invalid.' });
});

test('pending Runtime recovery reconciles against a validated active distribution', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-runtime-reconcile-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const environment = {
    ...process.env,
    XDG_DATA_HOME: join(directory, 'data'),
    XDG_STATE_HOME: join(directory, 'state'),
    XDG_CONFIG_HOME: join(directory, 'config')
  };
  const options = { environment, homeDirectory: directory };
  const paths = managerPaths(options);
  const version = '0.1.0';
  const filename = 'runtime-fixture.mjs';
  const contents = Buffer.from('export {};\n');
  const mode = 0o644;
  const id = hashDistribution(version, [[filename, contents, mode]]);
  const runtimePath = join(paths.runtimeRoot, id);
  await mkdir(runtimePath, { recursive: true });
  await mkdir(paths.configRoot, { recursive: true });
  await writeFile(join(runtimePath, filename), contents, { mode });
  await chmod(join(runtimePath, filename), mode);
  await writeFile(join(runtimePath, '.distribution.json'), `${JSON.stringify({ schema_version: 1, id, version, path: runtimePath, files: [filename] })}\n`, { mode: 0o600 });
  await writeFile(paths.activeRuntime, `${JSON.stringify({ schema_version: 1, id })}\n`, { mode: 0o600 });

  const absentQuarantine = join(paths.runtimeRoot, `.damaged-${id}-not-created`);
  await writeRuntimeRecoveryRecord({ runtime_id: id, status: 'activation-pending', validation_error: 'prior Runtime mismatch', preserved_runtime_path: absentQuarantine }, options);
  const recovered = await reconcileRuntimeRecoveryRecord(options);
  assert.equal(recovered.error, null);
  assert.equal(recovered.record.status, 'active');
  assert.equal(recovered.record.preserved_runtime_path, null);

  const retainedQuarantine = join(paths.runtimeRoot, `.damaged-${id}-retained`);
  await mkdir(retainedQuarantine);
  await writeRuntimeRecoveryRecord({ runtime_id: id, status: 'activation-pending', validation_error: 'prior Runtime mismatch', preserved_runtime_path: retainedQuarantine }, options);
  const retained = await reconcileRuntimeRecoveryRecord(options);
  assert.equal(retained.record.status, 'active');
  assert.equal(retained.record.preserved_runtime_path, retainedQuarantine);
});

test('Runtime repair intent is durable before a damaged distribution is moved', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-runtime-publication-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const environment = {
    ...process.env,
    XDG_DATA_HOME: join(directory, 'data'),
    XDG_STATE_HOME: join(directory, 'state'),
    XDG_CONFIG_HOME: join(directory, 'config')
  };
  const options = { environment, homeDirectory: directory };
  const paths = managerPaths(options);
  const id = 'c'.repeat(64);
  const destination = join(paths.runtimeRoot, id);
  const stage = join(paths.runtimeRoot, '.stage-fixture');
  await mkdir(destination, { recursive: true });
  await mkdir(stage, { recursive: true });
  await writeFile(join(destination, 'damaged.marker'), 'preserve me');
  await writeFile(join(stage, 'replacement.marker'), 'validated replacement');

  await assert.rejects(publishRuntimeStage(stage, destination, id, {
    beforePreserve: async preservedPath => {
      await writeRuntimeRecoveryRecord({ runtime_id: id, status: 'activation-pending', validation_error: 'content mismatch', preserved_runtime_path: preservedPath }, options);
      const statusRead = await reconcileRuntimeRecoveryRecord(options);
      assert.equal(statusRead.record.status, 'activation-pending');
      assert.equal(statusRead.record.preserved_runtime_path, preservedPath);
      throw new Error('simulated interruption after recovery intent');
    }
  }), /simulated interruption/);
  const intent = (await readRuntimeRecoveryRecord(options)).record;
  assert.equal(intent.status, 'activation-pending');
  assert.equal(await readFile(join(destination, 'damaged.marker'), 'utf8'), 'preserve me');
  await assert.rejects(readFile(intent.preserved_runtime_path), { code: 'ENOENT' });

  const published = await publishRuntimeStage(stage, destination, id, {
    beforePreserve: async preservedPath => writeRuntimeRecoveryRecord({
      ...intent,
      status: 'activation-pending',
      preserved_runtime_path: preservedPath
    }, options)
  });
  assert.equal(published.repaired, true);
  assert.equal(await readFile(join(published.preservedPath, 'damaged.marker'), 'utf8'), 'preserve me');
  assert.equal(await readFile(join(destination, 'replacement.marker'), 'utf8'), 'validated replacement');
  assert.equal((await readRuntimeRecoveryRecord(options)).record.preserved_runtime_path, published.preservedPath);
});

test('restoring a missing same-ID Runtime records the Manager restart obligation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-missing-runtime-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const environment = {
    ...process.env,
    XDG_DATA_HOME: join(directory, 'data'),
    XDG_STATE_HOME: join(directory, 'state'),
    XDG_CONFIG_HOME: join(directory, 'config')
  };
  const options = { environment, homeDirectory: directory };
  const paths = managerPaths(options);
  const source = await inspectRuntimeSource(sourceRoot);
  await mkdir(paths.configRoot, { recursive: true });
  await mkdir(paths.managerStateRoot, { recursive: true });
  await writeFile(paths.activeRuntime, `${JSON.stringify({ schema_version: 1, id: source.id })}\n`, { mode: 0o600 });
  await writeFile(paths.managerServiceRecord, `${JSON.stringify({ schema_version: 1, runtime_version: source.id })}\n`, { mode: 0o600 });
  await assert.rejects(activeRuntime(options), /ENOENT/);

  const restored = await installRuntimeDistribution(sourceRoot, options);
  assert.equal(restored.id, source.id);
  assert.equal(restored.recovered_from_invalid_active, true);
  assert.equal(restored.repaired_distribution, true);
  assert.equal(managerMustRestartForRuntime(source.id, restored), true);
  assert.equal(JSON.parse(await readFile(paths.managerServiceRecord, 'utf8')).manager_restart_required, true);
  assert.equal((await activeRuntime(options)).id, source.id);
  const recovery = (await readRuntimeRecoveryRecord(options)).record;
  assert.equal(recovery.runtime_id, source.id);
  assert.equal(recovery.status, 'active');
  assert.equal(recovery.preserved_runtime_path, null);
});
