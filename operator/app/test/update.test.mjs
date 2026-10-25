import assert from 'node:assert/strict';
import { execFile as execute } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { activeRuntime, installRuntimeDistribution, listRuntimeDistributions } from '../runtime-distribution.mjs';
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

  const activeFile = join(directory, 'config/leesh-loop/active-runtime.json');
  const activeBeforeFailure = await readFile(activeFile, 'utf8');
  const runtimeCode = join(first.path, 'operator/app/manager.mjs');
  const originalCode = await readFile(runtimeCode);
  await writeFile(runtimeCode, `${originalCode}\n// tampered\n`);
  await assert.rejects(activeRuntime({ environment, homeDirectory: directory }), /contents do not match their immutable identity/);
  await writeFile(runtimeCode, originalCode);
  assert.equal((await activeRuntime({ environment, homeDirectory: directory })).id, first.id);
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
