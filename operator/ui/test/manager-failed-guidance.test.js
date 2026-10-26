import assert from 'node:assert/strict';
import test from 'node:test';
import { managerFailedGuidance } from '../src/manager-failed-guidance.js';

test('confirmed process absence points to diagnosis before restart', () => {
  assert.equal(
    managerFailedGuidance({ process_absence_confirmed: true }),
    'The Loop failed and no active process remains. Review diagnosis and logs before restarting.'
  );
});

test('an owned failed process must stop before restart or Workflow change', () => {
  assert.equal(
    managerFailedGuidance({ can_stop: true }),
    'The Loop reported a failure while its process is still owned. Stop it before restarting or changing its Workflow.'
  );
});

test('Failed state without a phase or ownership signal uses phase-neutral guidance', () => {
  assert.equal(
    managerFailedGuidance({}),
    'The Loop failed. Review its diagnosis and logs before retrying.'
  );
});

test('Workflow eligibility alone does not claim confirmed process absence', () => {
  assert.equal(
    managerFailedGuidance({ can_update_workflow: true }),
    'The Loop failed. Review its diagnosis and logs before retrying.'
  );
});
