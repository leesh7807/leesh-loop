import assert from 'node:assert/strict';
import test from 'node:test';
import { initialManagerFeedback, managerFeedbackReducer } from '../src/manager-feedback.js';

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
