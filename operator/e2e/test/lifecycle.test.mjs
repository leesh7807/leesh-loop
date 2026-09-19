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
    workpad: 'Human Review\ncycle: 2\nreason: review\ndelivered_pr: https://github.com/a/b/pull/4\ndelivered_head: 0123456789012345678901234567890123456789\n# Verdict\nPASS\n'
  };
  assert.equal(mechanicalReviewAllowed(valid).allowed, true);
  assert.equal(mechanicalReviewAllowed({ ...valid, workpad: valid.workpad.replace('reason: review', 'reason: blocker') }).allowed, false);
  assert.equal(mechanicalReviewAllowed({ ...valid, workpad: valid.workpad.replace('# Verdict\nPASS', '# Verdict\nFINDINGS') }).allowed, false);
});
