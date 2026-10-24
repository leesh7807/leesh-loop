import assert from 'node:assert/strict';
import test from 'node:test';
import { initialInstanceOperationFeedback, initialManagerFeedback, instanceOperationFeedbackFor, instanceOperationFeedbackReducer, lifecycleCompletionMessage, managerFeedbackReducer, managerOperationAnnouncement, managerOperationCompletionMessage, workflowOperationFeedbackPlacement } from '../src/manager-feedback.js';

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

test('lifecycle feedback states the action result separately from the current status badge', () => {
  assert.equal(
    lifecycleCompletionMessage('start-loop', { repository_name: 'payments-api', status: 'Running' }),
    'Start request completed for payments-api. Manager reported Running at completion.'
  );
  assert.equal(
    lifecycleCompletionMessage('stop-loop', { id: 'loop-a', status: 'Stopped' }),
    'Stop request completed for loop-a. Manager reported Stopped at completion.'
  );
  assert.equal(lifecycleCompletionMessage('start-loop'), 'Start request completed for Loop.');
  assert.equal(lifecycleCompletionMessage('unrecognized-operation'), 'Loop request completed for Loop.');
});

test('operation completion messages use stable operation IDs rather than presentation labels', () => {
  assert.equal(managerOperationCompletionMessage('update-runtime'), 'Runtime update completed.');
  assert.equal(managerOperationCompletionMessage('update-workflow'), 'Workflow update completed.');
  assert.equal(
    managerOperationCompletionMessage('start-loop', { repository_name: 'payments-api', status: 'Running' }),
    'Start request completed for payments-api. Manager reported Running at completion.'
  );
  assert.equal(
    managerOperationCompletionMessage('stop-loop', { id: 'loop-a', status: 'Stopped' }),
    'Stop request completed for loop-a. Manager reported Stopped at completion.'
  );
  assert.equal(managerOperationCompletionMessage('another-manager-action'), 'Change saved.');
});

test('Workflow operation feedback has one visible location across closed, loading, failed, and loaded states', () => {
  assert.equal(workflowOperationFeedbackPlacement(false, false), 'header');
  assert.equal(workflowOperationFeedbackPlacement(false, true), 'header');
  assert.equal(workflowOperationFeedbackPlacement(true, false), 'panel');
  assert.equal(workflowOperationFeedbackPlacement(true, true), 'actions');
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
