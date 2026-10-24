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
