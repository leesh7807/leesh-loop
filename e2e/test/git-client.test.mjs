import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { GitClient } from '../systems/git/git-client.mjs';

const execFileAsync = promisify(execFile);

async function git(cwd, ...args) {
  return execFileAsync('git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
}

test('branch deletion reads back only the exact owned remote ref', async () => {
  const branch = 'e2e/task-delivery';
  const ref = `refs/heads/${branch}`;
  const commit = 'a'.repeat(40);
  const calls = [];
  const git = new GitClient({
    repositoryUrl: 'https://github.com/owner/repo.git',
    gitCommand: async (_command, args) => {
      calls.push(args);
      if (args[0] === 'ls-remote') return { stdout: calls.filter(call => call[0] === 'ls-remote').length === 1 ? `${commit}\t${ref}\n` : '' };
      return { stdout: '', stderr: '' };
    }
  });

  assert.deepEqual(await git.deleteRemoteBranch(branch, { expectedCommit: commit }), { branch, deleted: true, expected_commit: commit });
  assert.deepEqual(calls, [
    ['ls-remote', '--heads', 'https://github.com/owner/repo.git', ref],
    ['push', `--force-with-lease=${ref}:${commit}`, 'https://github.com/owner/repo.git', '--delete', ref],
    ['ls-remote', '--heads', 'https://github.com/owner/repo.git', ref]
  ]);
});

test('branch deletion preserves a ref whose commit changed after its ownership record', async () => {
  const branch = 'e2e/task-delivery';
  const ref = `refs/heads/${branch}`;
  const expectedCommit = 'a'.repeat(40);
  const currentCommit = 'b'.repeat(40);
  const calls = [];
  const git = new GitClient({
    repositoryUrl: 'https://github.com/owner/repo.git',
    gitCommand: async (_command, args) => {
      calls.push(args);
      return { stdout: `${currentCommit}\t${ref}\n` };
    }
  });

  await assert.rejects(() => git.deleteRemoteBranch(branch, { expectedCommit }), /changed before deletion/);
  assert.deepEqual(calls, [['ls-remote', '--heads', 'https://github.com/owner/repo.git', ref]]);
});

test('branch deletion confirms absence without requiring a commit for an absent ref', async () => {
  const branch = 'e2e/task-delivery';
  const calls = [];
  const git = new GitClient({
    repositoryUrl: 'https://github.com/owner/repo.git',
    gitCommand: async (_command, args) => { calls.push(args); return { stdout: '' }; }
  });

  assert.deepEqual(await git.deleteRemoteBranch(branch), { branch, already_absent: true });
  assert.deepEqual(calls, [['ls-remote', '--heads', 'https://github.com/owner/repo.git', `refs/heads/${branch}`]]);
});

test('compare-and-delete lease preserves a branch updated between read and delete', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-branch-lease-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const remote = join(directory, 'remote.git');
  const owner = join(directory, 'owner');
  const otherTask = join(directory, 'other-task');
  await mkdir(owner);
  await git(directory, 'init', '--bare', remote);
  await git(owner, 'init');
  await git(owner, 'config', 'user.name', 'E2E branch lease test');
  await git(owner, 'config', 'user.email', 'e2e-branch-lease@example.invalid');
  await writeFile(join(owner, 'file.txt'), 'run-owned\n');
  await git(owner, 'add', 'file.txt');
  await git(owner, 'commit', '-m', 'run-owned head');
  await git(owner, 'push', remote, 'HEAD:refs/heads/e2e/task-delivery');
  const { stdout: expectedCommit } = await git(owner, 'rev-parse', 'HEAD');
  await git(directory, 'clone', '-b', 'e2e/task-delivery', remote, otherTask);
  await git(otherTask, 'config', 'user.name', 'Other task');
  await git(otherTask, 'config', 'user.email', 'other-task@example.invalid');

  let concurrentUpdatePublished = false;
  const gitCommand = async (_commandName, args, options) => {
    if (!concurrentUpdatePublished && args[0] === 'push' && args.includes('--delete')) {
      concurrentUpdatePublished = true;
      await writeFile(join(otherTask, 'file.txt'), 'other-task head\n');
      await git(otherTask, 'commit', '-am', 'other task updated reused ref');
      await git(otherTask, 'push', 'origin', 'HEAD:refs/heads/e2e/task-delivery');
    }
    return execFileAsync('git', args, { cwd: owner, timeout: options.timeout, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  };
  const client = new GitClient({ repositoryUrl: remote, gitCommand });

  await assert.rejects(() => client.deleteRemoteBranch('e2e/task-delivery', { expectedCommit: expectedCommit.trim() }));
  const { stdout: currentCommit } = await git(owner, 'ls-remote', '--heads', remote, 'refs/heads/e2e/task-delivery');
  assert.equal(currentCommit.split(/\s+/)[0], (await git(otherTask, 'rev-parse', 'HEAD')).stdout.trim());
});

test('remote branch read resolves one exact branch without listing the repository', async () => {
  const ref = 'refs/heads/e2e/base-123';
  const commit = 'b'.repeat(40);
  const calls = [];
  const git = new GitClient({
    repositoryUrl: 'https://github.com/owner/repo.git',
    gitCommand: async (_command, args) => {
      calls.push(args);
      return { stdout: `${commit}\t${ref}\n` };
    }
  });

  assert.equal(await git.readRemoteBranchCommit('e2e/base-123'), commit);
  assert.deepEqual(calls, [['ls-remote', '--heads', 'https://github.com/owner/repo.git', ref]]);
});
