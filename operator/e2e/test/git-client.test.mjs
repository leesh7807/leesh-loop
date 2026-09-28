import test from 'node:test';
import assert from 'node:assert/strict';
import { GitClient } from '../systems/git/git-client.mjs';

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

  assert.deepEqual(await git.deleteRemoteBranch(branch), { branch, deleted: true });
  assert.deepEqual(calls, [
    ['ls-remote', '--heads', 'https://github.com/owner/repo.git', ref],
    ['push', 'https://github.com/owner/repo.git', '--delete', ref],
    ['ls-remote', '--heads', 'https://github.com/owner/repo.git', ref]
  ]);
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
