import assert from 'node:assert/strict';
import test from 'node:test';
import { initialInstanceOperationFeedback, initialManagerFeedback, instanceOperationFeedbackFor, instanceOperationFeedbackReducer, managerFeedbackReducer, managerOperationAnnouncement } from '../src/manager-feedback.js';

test('a successful instance poll clears read errors without dismissing an operation failure', () => {
  let feedback = managerFeedbackReducer(initialManagerFeedback, {
    type: 'operation-error',
    target: 'workflow',
    message: 'Workflow changed since it was reviewed. Refresh the comparison before applying.'
  });
  feedback = managerFeedbackReducer(feedback, { type: 'read-error', target: 'instances', message: 'Could not refresh instances.' });
  feedback = managerFeedbackReducer(feedback, { type: 'read-cleared', target: 'instances' });

  assert.equal(feedback.readErrors.instances, undefined);
  assert.equal(feedback.operationErrors.workflow, 'Workflow changed since it was reviewed. Refresh the comparison before applying.');
});

test('retrying an operation or changing the selected instance clears its prior operation error', () => {
  const failed = managerFeedbackReducer(initialManagerFeedback, { type: 'operation-error', target: 'workflow', message: 'Request failed.' });

  assert.deepEqual(managerFeedbackReducer(failed, { type: 'operation-started', target: 'workflow' }), initialManagerFeedback);
  assert.deepEqual(managerFeedbackReducer(failed, { type: 'instance-changed' }), initialManagerFeedback);
});

test('feedback for Runtime operations survives a selected Loop change and stays scoped to its action', () => {
  const failed = managerFeedbackReducer(initialManagerFeedback, {
    type: 'operation-error',
    target: 'runtime',
    message: 'Runtime installation failed.'
  });
  const changed = managerFeedbackReducer(failed, { type: 'instance-changed' });

  assert.equal(changed.operationErrors.runtime, 'Runtime installation failed.');
  assert.equal(changed.operationErrors.workflow, undefined);
});

test('changing the selected Loop clears a prior log-read error', () => {
  const failed = managerFeedbackReducer(initialManagerFeedback, {
    type: 'read-error', target: 'logs', message: 'Could not read Loop logs.'
  });
  const changed = managerFeedbackReducer(failed, { type: 'instance-changed' });

  assert.equal(changed.readErrors.logs, undefined);
});

test('per-instance operation outcomes remain with their initiating Loop', () => {
  let outcomes = instanceOperationFeedbackReducer(initialInstanceOperationFeedback, {
    type: 'success', instanceId: 'loop-a', target: 'workflow', message: 'Workflow update completed.'
  });

  assert.deepEqual(instanceOperationFeedbackFor(outcomes, 'loop-a', 'workflow'), {
    kind: 'success', message: 'Workflow update completed.'
  });
  assert.equal(instanceOperationFeedbackFor(outcomes, 'loop-b', 'workflow'), null);

  outcomes = instanceOperationFeedbackReducer(outcomes, {
    type: 'error', instanceId: 'loop-a', target: 'lifecycle', message: 'Loop could not start.'
  });
  assert.deepEqual(instanceOperationFeedbackFor(outcomes, 'loop-a', 'lifecycle'), {
    kind: 'failure', message: 'Loop could not start.'
  });
  assert.equal(instanceOperationFeedbackFor(outcomes, 'loop-b', 'lifecycle'), null);

  const startedAgain = instanceOperationFeedbackReducer(outcomes, {
    type: 'started', instanceId: 'loop-a', target: 'workflow'
  });
  assert.equal(instanceOperationFeedbackFor(startedAgain, 'loop-a', 'workflow'), null);
  assert.equal(instanceOperationFeedbackFor(startedAgain, 'loop-a', 'lifecycle').kind, 'failure');
  assert.equal(instanceOperationFeedbackFor(outcomes, 'loop-a', 'workflow').kind, 'success');
});

test('a Manager-wide busy notice names its target and says what remains available', () => {
  assert.equal(
    managerOperationAnnouncement({ label: 'Updating Workflow', repositoryName: 'payments-api' }),
    'Updating Workflow for payments-api is in progress. Other Manager actions are temporarily unavailable; instance switching and Task management remain available.'
  );
  assert.equal(managerOperationAnnouncement(null), '');
});

test('a successful Runtime or Workflow read clears only its own read error', () => {
  let feedback = managerFeedbackReducer(initialManagerFeedback, {
    type: 'read-error', target: 'runtime', message: 'Could not load the Runtime version.'
  });
  feedback = managerFeedbackReducer(feedback, {
    type: 'read-error', target: 'workflow', message: 'Could not compare the Workflow.'
  });
  feedback = managerFeedbackReducer(feedback, {
    type: 'operation-error', target: 'workflow', message: 'Workflow update failed.'
  });

  feedback = managerFeedbackReducer(feedback, { type: 'read-cleared', target: 'runtime' });
  assert.equal(feedback.readErrors.runtime, undefined);
  assert.equal(feedback.readErrors.workflow, 'Could not compare the Workflow.');
  assert.equal(feedback.operationErrors.workflow, 'Workflow update failed.');

  feedback = managerFeedbackReducer(feedback, { type: 'read-cleared', target: 'workflow' });
  assert.equal(feedback.readErrors.workflow, undefined);
  assert.equal(feedback.operationErrors.workflow, 'Workflow update failed.');
});
