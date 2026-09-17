import assert from 'node:assert/strict';
import { execFile as execute } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { bootstrapGitTarget, readRemoteBranch } from '../git-target.mjs';

const execFile = promisify(execute);

async function git(args, cwd) {
  return execFile('git', args, { cwd });
}

async function remoteFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-git-target-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const seed = join(directory, 'seed');
  const remote = join(directory, 'remote.git');
  await mkdir(seed);
  await git(['init', '--bare', remote]);
  await git(['init', '-b', 'main'], seed);
  await writeFile(join(seed, 'README.md'), 'seed\n');
  await git(['add', 'README.md'], seed);
  await git(['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '-m', 'seed'], seed);
  await git(['remote', 'add', 'origin', remote], seed);
  await git(['push', 'origin', 'main'], seed);
  await git(['--git-dir', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
  const { stdout } = await git(['rev-parse', 'HEAD'], seed);
  return { remote, defaultCommit: stdout.trim() };
}

test('missing configured base is created from default HEAD and read back', async t => {
  const { remote, defaultCommit } = await remoteFixture(t);
  assert.equal(await readRemoteBranch(remote, 'e2e/run'), null);
  assert.equal(await bootstrapGitTarget(remote, 'e2e/run'), defaultCommit);
  assert.equal(await readRemoteBranch(remote, 'e2e/run'), defaultCommit);
});

test('existing configured base is reused without being reset to default', async t => {
  const { remote, defaultCommit } = await remoteFixture(t);
  // Create the existing branch through the same Git remote path with a
  // distinct commit instead of using the default branch as its seed.
  await git(['clone', remote, join(remote, '..', 'existing')]);
  const existing = join(remote, '..', 'existing');
  await writeFile(join(existing, 'existing.txt'), 'existing\n');
  await git(['add', 'existing.txt'], existing);
  await git(['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '-m', 'existing'], existing);
  const { stdout: existingCommitOutput } = await git(['rev-parse', 'HEAD'], existing);
  const existingCommit = existingCommitOutput.trim();
  await git(['push', 'origin', `HEAD:refs/heads/e2e/run`], existing);
  assert.notEqual(existingCommit, defaultCommit);
  assert.equal(await bootstrapGitTarget(remote, 'e2e/run'), existingCommit);
  assert.equal(await readRemoteBranch(remote, 'e2e/run'), existingCommit);
});

test('an empty repository cannot bootstrap a configured base', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-empty-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const remote = join(directory, 'empty.git');
  await git(['init', '--bare', remote]);
  await assert.rejects(bootstrapGitTarget(remote, 'e2e/run'), /default branch HEAD could not be resolved/);
});

test('invalid configured branch is rejected before remote access', async () => {
  await assert.rejects(bootstrapGitTarget('/does/not/exist', 'invalid..branch'), /not a valid Git branch name/);
});
