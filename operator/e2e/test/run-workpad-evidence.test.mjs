import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRunWorkpadEvidence, recordRunWorkpadEvidence, recordSnapshotWorkpadEvidence } from '../model/run-workpad-evidence.mjs';

test('Workpad evidence normalizes delivery identities and Merging targets in one pass', () => {
  const deliveryUrl = 'https://github.com/owner/repo/pull/7';
  const workpad = `Human Review\ncycle: 1\ndelivered_pr: ${deliveryUrl}\n\nMerging\ncycle: 1\napproved_pr: ${deliveryUrl}\napproved_head: ${'a'.repeat(40)}\nmerge_target_head: ${'b'.repeat(40)}\n`;
  const parsed = parseRunWorkpadEvidence(workpad);
  assert.deepEqual(parsed.delivery_prs, [deliveryUrl]);
  assert.equal(parsed.latest_delivery_pr, deliveryUrl);
  assert.deepEqual(parsed.merge_targets, [{ cycle: '1', approved_pr: deliveryUrl, approved_head: 'a'.repeat(40), merge_target_head: 'b'.repeat(40) }]);

  const record = { artifacts: {}, evidence: { snapshots: [{ notion: { workpad } }] } };
  recordRunWorkpadEvidence(record, workpad);
  recordSnapshotWorkpadEvidence(record);
  assert.deepEqual(record.artifacts.workpad_delivery_prs, [deliveryUrl]);
  assert.equal(record.artifacts.workpad_latest_delivery_pr, deliveryUrl);
  assert.deepEqual(record.artifacts.workpad_merge_targets, parsed.merge_targets);
});

test('a latest none delivery marker clears the normalized current identity while retaining history', () => {
  const first = 'https://github.com/owner/repo/pull/7';
  const workpad = `Human Review\ncycle: 1\ndelivered_pr: ${first}\n\nHuman Review\ncycle: 2\ndelivered_pr: none\n`;
  const record = { artifacts: {} };
  recordRunWorkpadEvidence(record, workpad);
  assert.deepEqual(record.artifacts.workpad_delivery_prs, [first]);
  assert.equal(record.artifacts.workpad_latest_delivery_pr, null);
});
