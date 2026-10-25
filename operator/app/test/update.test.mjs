import assert from 'node:assert/strict';
import { execFile as execute } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { activeRuntime, installRuntimeDistribution, listRuntimeDistributions, managerMustRestartForRuntime, readRuntimeRecoveryRecord, runtimeDiagnostic, writeRuntimeRecoveryRecord } from '../runtime-distribution.mjs';
import { managerPaths } from '../manager-storage.mjs';
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
  const record = await writeRuntimeRecoveryRecord({ runtime_id: 'a'.repeat(64), status: 'active', validation_error: 'damaged file', preserved_runtime_path: join(directory, '.damaged-runtime') }, options);
  assert.equal(record.status, 'active');
  assert.equal((await readRuntimeRecoveryRecord(options)).record.preserved_runtime_path, record.preserved_runtime_path);
  await assert.rejects(writeRuntimeRecoveryRecord({ runtime_id: 'a'.repeat(64), status: 'active', preserved_runtime_path: 'relative/path' }, options), /path is invalid/);
  await writeFile(managerPaths(options).runtimeRecovery, `${JSON.stringify({ ...record, validation_error: 'x'.repeat(401) })}\n`);
  assert.deepEqual(await readRuntimeRecoveryRecord(options), { record: null, error: 'Runtime recovery record is invalid.' });
});
