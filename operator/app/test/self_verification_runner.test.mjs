import assert from 'node:assert/strict';
import test from 'node:test';
import { latestHumanReviewBlock } from '../self-verification-runner.mjs';

test('self-verification selects delivery identities from the latest Human Review cycle', () => {
  const workpad = `Human Review
cycle: 1
delivered_pr: https://github.com/example/project/pull/1
delivered_head: ${'a'.repeat(40)}
review_job: 11111111-1111-4111-8111-111111111111

Human Review Entered
cycle: 1

Human Review
cycle: 2
delivered_pr: https://github.com/example/project/pull/2
delivered_head: ${'b'.repeat(40)}
review_job: 22222222-2222-4222-8222-222222222222`;
  const latest = latestHumanReviewBlock(workpad);
  assert.match(latest, /pull\/2/);
  assert.doesNotMatch(latest, /pull\/1/);
});
