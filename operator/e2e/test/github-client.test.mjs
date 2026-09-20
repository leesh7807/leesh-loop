import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubClient } from '../systems/github/github-client.mjs';

test('delivery branch cleanup only claims newly created same-repository heads', () => {
  const github = new GitHubClient({ repositoryUrl: 'git@github.com:owner/repo.git' });
  const record = { started_at: '2026-09-19T00:00:00.000Z', binding: { base_branch: 'base/run-1' }, evidence: { branch_refs_before: { 'refs/heads/preexisting': 'a'.repeat(40) } } };
  const prs = [
    { baseRefName: 'base/run-1', headRefName: 'new', createdAt: '2026-09-19T00:01:00.000Z', isCrossRepository: false, headRepository: { nameWithOwner: 'owner/repo' } },
    { baseRefName: 'base/run-1', headRefName: 'preexisting', createdAt: '2026-09-19T00:01:00.000Z', isCrossRepository: false, headRepository: { nameWithOwner: 'owner/repo' } },
    { baseRefName: 'base/run-1', headRefName: 'forked', createdAt: '2026-09-19T00:01:00.000Z', isCrossRepository: true, headRepository: { nameWithOwner: 'other/repo' } }
  ];
  assert.deepEqual(github.findRunOwnedDeliveryBranches(prs, record), ['new']);
});
