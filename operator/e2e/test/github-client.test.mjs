import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubClient, isSameRepositoryDelivery } from '../systems/github/github-client.mjs';

test('delivery ownership uses one same-repository predicate', () => {
  assert.equal(isSameRepositoryDelivery({ isCrossRepository: false, headRepository: { nameWithOwner: 'owner/repo' } }, 'owner/repo'), true);
  assert.equal(isSameRepositoryDelivery({ isCrossRepository: true, headRepository: { nameWithOwner: 'owner/repo' } }, 'owner/repo'), false);
  assert.equal(isSameRepositoryDelivery({ isCrossRepository: false, headRepository: { nameWithOwner: 'other/repo' } }, 'owner/repo'), false);
});

test('delivery branch cleanup follows only the task-recorded PR identity', () => {
  const github = new GitHubClient({ repositoryUrl: 'git@github.com:owner/repo.git' });
  const deliveryUrl = 'https://github.com/owner/repo/pull/7';
  const record = { artifacts: { workpad_delivery_prs: [deliveryUrl] } };
  const prs = [
    { number: 7, url: deliveryUrl, headRefName: 'task-delivery', isCrossRepository: false, headRepository: { nameWithOwner: 'owner/repo' } },
    { number: 8, url: 'https://github.com/owner/repo/pull/8', headRefName: 'unrelated', isCrossRepository: false, headRepository: { nameWithOwner: 'owner/repo' } },
    { number: 9, url: 'https://github.com/owner/repo/pull/9', headRefName: 'forked', isCrossRepository: true, headRepository: { nameWithOwner: 'other/repo' } }
  ];
  const resolution = github.resolveRunOwnedDeliveries(prs, record);
  assert.deepEqual(resolution.identities, [deliveryUrl]);
  assert.deepEqual(resolution.deliveries, [{ identity: deliveryUrl, branch: 'task-delivery', source: 'snapshot', pullRequest: prs[0] }]);
  assert.deepEqual(github.findRunOwnedDeliveryBranches(prs, record), ['task-delivery']);
});

test('delivery PR lookup uses the latest observation when snapshots contain repeated identities', () => {
  const github = new GitHubClient({ repositoryUrl: 'git@github.com:owner/repo.git' });
  const deliveryUrl = 'https://github.com/owner/repo/pull/7';
  const earlier = { number: 7, url: deliveryUrl, headRefName: 'task-delivery', mergedAt: null };
  const later = { ...earlier, mergedAt: '2026-09-28T12:00:00Z', mergeCommit: { oid: 'a'.repeat(40) } };
  assert.equal(github.findDeliveryPullRequest([earlier, later], deliveryUrl), later);
});

test('GitHub adapter does not reinterpret raw Workpad snapshots', () => {
  const github = new GitHubClient({ repositoryUrl: 'git@github.com:owner/repo.git' });
  const deliveryUrl = 'https://github.com/owner/repo/pull/7';
  const record = { artifacts: {}, evidence: { snapshots: [{ notion: { workpad: `Human Review\ncycle: 1\ndelivered_pr: ${deliveryUrl}\n` } }] } };
  assert.deepEqual(github.deliveryPrIdentities(record), []);
});

test('legacy repository-wide ref snapshots do not establish delivery branch ownership', () => {
  const github = new GitHubClient({ repositoryUrl: 'git@github.com:owner/repo.git' });
  const record = { started_at: '2026-09-19T00:00:00.000Z', binding: { base_branch: 'base/run-1' }, evidence: { branch_refs_before: {} } };
  const prs = [{ number: 8, url: 'https://github.com/owner/repo/pull/8', baseRefName: 'base/run-1', headRefName: 'created-during-run', createdAt: '2026-09-19T00:01:00.000Z', isCrossRepository: false, headRepository: { nameWithOwner: 'owner/repo' } }];
  assert.deepEqual(github.findRunOwnedDeliveryBranches(prs, record), []);
});
