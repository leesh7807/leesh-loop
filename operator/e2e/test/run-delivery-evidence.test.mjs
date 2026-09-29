import test from 'node:test';
import assert from 'node:assert/strict';
import { recordRunDeliveryEvidence } from '../model/run-delivery-evidence.mjs';

test('records one same-repository delivery consistently across current and owned evidence', () => {
  const record = { artifacts: {} };
  const pullRequest = { url: 'https://github.com/owner/repo/pull/7', headRefName: 'task/delivery', headRefOid: 'a'.repeat(40) };

  const result = recordRunDeliveryEvidence(record, pullRequest.url, pullRequest, {
    sameRepository: true,
    observedAt: '2026-09-29T12:00:00.000Z',
    lockDeliveredHead: true
  });

  assert.deepEqual(result, { pr_url: pullRequest.url, branch: 'task/delivery', head: 'a'.repeat(40) });
  assert.equal(record.artifacts.delivery_pr_url, pullRequest.url);
  assert.equal(record.artifacts.delivery_branch, 'task/delivery');
  assert.deepEqual(record.artifacts.delivery_branches, ['task/delivery']);
  assert.deepEqual(record.artifacts.owned_deliveries, [{ pr_url: pullRequest.url, branch: 'task/delivery', head: 'a'.repeat(40), observed_at: '2026-09-29T12:00:00.000Z' }]);
  assert.equal(record.artifacts.delivered_head, 'a'.repeat(40));
  assert.equal(record.artifacts.delivered_head_locked, true);
});

test('does not assign branch ownership to an unconfirmed or cross-repository delivery', () => {
  const record = { artifacts: { delivery_branches: [], owned_deliveries: [] } };

  recordRunDeliveryEvidence(record, 'https://github.com/other/repo/pull/7', { headRefName: 'foreign', headRefOid: 'b'.repeat(40) }, {
    sameRepository: false,
    lockDeliveredHead: true
  });

  assert.equal(record.artifacts.delivery_pr_url, 'https://github.com/other/repo/pull/7');
  assert.equal(record.artifacts.delivery_branch, null);
  assert.deepEqual(record.artifacts.delivery_branches, []);
  assert.deepEqual(record.artifacts.owned_deliveries, []);
  assert.equal(record.artifacts.delivered_head, null);
  assert.equal(record.artifacts.delivered_head_locked, true);
});

test('keeps historical delivery branches while updating the current delivery', () => {
  const record = { artifacts: { delivery_branches: ['task/old'], owned_deliveries: [] } };
  const pullRequest = { headRefName: 'task/new', headRefOid: 'c'.repeat(40) };

  recordRunDeliveryEvidence(record, 'https://github.com/owner/repo/pull/8', pullRequest, { sameRepository: true });

  assert.equal(record.artifacts.delivery_branch, 'task/new');
  assert.deepEqual(record.artifacts.delivery_branches, ['task/old', 'task/new']);
  assert.equal(record.artifacts.owned_deliveries[0].branch, 'task/new');
  assert.equal(record.artifacts.delivered_head_locked, undefined);
});
