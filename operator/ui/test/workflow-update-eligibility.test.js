import assert from 'node:assert/strict';
import test from 'node:test';
import { workflowUpdateEligibility } from '../src/workflow-update-eligibility.js';

test('a stopped or confirmed-exited failed Loop can apply a Workflow update', () => {
  assert.equal(workflowUpdateEligibility({ status: 'Stopped' }).canApply, true);
  assert.equal(workflowUpdateEligibility({ status: 'Failed', can_update_workflow: true }).canApply, true);
  assert.match(workflowUpdateEligibility({ status: 'Failed', can_update_workflow: true }).summary, /no active processes/);
});

test('an active Loop explains the Stop prerequisite before the Workflow diff', () => {
  const eligibility = workflowUpdateEligibility({ status: 'Running' });
  assert.equal(eligibility.canApply, false);
  assert.match(eligibility.summary, /Running — stop this Loop/);
  assert.match(eligibility.controlHint, /Stop this Loop to enable/);
});

test('starting, stopping, and unconfirmed states explain their safe next action', () => {
  assert.match(workflowUpdateEligibility({ status: 'Starting' }).summary, /wait until the Loop is ready/);
  assert.match(workflowUpdateEligibility({ status: 'Stopping' }).controlHint, /Wait for Stop to finish/);
  assert.match(workflowUpdateEligibility({ status: 'Unconfirmed' }).summary, /resolve process ownership/);
  assert.equal(workflowUpdateEligibility({ status: 'Unconfirmed' }).canApply, false);
});
