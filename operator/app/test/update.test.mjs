import assert from 'node:assert/strict';
import { execFile as execute } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { activeRuntime, installRuntimeDistribution, listRuntimeDistributions, managerMustRestartForRuntime, publishRuntimeStage, readRuntimeRecoveryRecord, reconcileRuntimeRecoveryRecord, runtimeDiagnostic, writeRuntimeRecoveryRecord } from '../runtime-distribution.mjs';
import { managerPaths } from '../manager-storage.mjs';
import { hashDistribution } from '../installation-metadata.mjs';
import { listRuntimeSnapshotFiles, materializeRuntimeSnapshot } from '../runtime-manifest.mjs';

const execFile = promisify(execute);
const sourceRoot = resolve(import.meta.dirname, '../../..');

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
