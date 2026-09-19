import test from 'node:test';
import assert from 'node:assert/strict';
import { LifecycleInterpreter, mechanicalReviewAllowed } from '../lifecycle.mjs';

test('interpreter selects a capability without owning a competing lifecycle state model', () => {
  const interpreter = new LifecycleInterpreter();
  assert.deepEqual(interpreter.interpret({ state: 'Human Review' }), { phase: 'Human Review', capability: 'mechanical_review_approval', state: 'Human Review' });
  assert.equal(interpreter.interpret({ state: 'Unexpected' }).capability, 'unsupported_state');
  assert.deepEqual(interpreter.gaps('In Progress'), ['Human Review', 'Merging', 'Done']);
});

test('mechanical approval only accepts normal review with matching delivery evidence and PASS', () => {
  const valid = {
    state: 'Human Review',
    workpad: 'review target: https://github.com/a/b/pull/4\nreview head: 0123456789012345678901234567890123456789\nJob ID: 123e4567-e89b-42d3-a456-426614174000\n# Verdict\nPASS\nHuman Review\ncycle: 2\nreason: review\ndelivered_pr: https://github.com/a/b/pull/4\ndelivered_head: 0123456789012345678901234567890123456789\n'
  };
  const reviewEvidence = { job_id: '123e4567-e89b-42d3-a456-426614174000', terminal_state: 'completed', result: '# Verdict\nPASS' };
  assert.equal(mechanicalReviewAllowed(valid, reviewEvidence).allowed, true);
  assert.equal(mechanicalReviewAllowed(valid, { ...reviewEvidence, job_id: null }).pending, true);
  assert.equal(mechanicalReviewAllowed({ ...valid, workpad: valid.workpad.replace('reason: review', 'reason: blocker') }).allowed, false);
  assert.equal(mechanicalReviewAllowed({ ...valid, workpad: valid.workpad.replace('# Verdict\nPASS', '# Verdict\nFINDINGS') }, reviewEvidence).allowed, false);
  assert.equal(mechanicalReviewAllowed(valid, { ...reviewEvidence, terminal_state: 'failed', result: null }).allowed, false);
  const staleJob = valid.workpad.replace('123e4567-e89b-42d3-a456-426614174000', '223e4567-e89b-42d3-a456-426614174000');
  assert.equal(mechanicalReviewAllowed({ ...valid, workpad: staleJob }, reviewEvidence).allowed, false);
});
