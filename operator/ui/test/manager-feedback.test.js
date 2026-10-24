import assert from 'node:assert/strict';
import test from 'node:test';
import { initialManagerFeedback, managerFeedbackReducer } from '../src/manager-feedback.js';

test('a successful instance poll clears read errors without dismissing an operation failure', () => {
  let feedback = managerFeedbackReducer(initialManagerFeedback, {
    type: 'operation-error',
    message: 'Workflow changed since it was reviewed. Refresh the comparison before applying.'
  });
  feedback = managerFeedbackReducer(feedback, { type: 'read-error', message: 'Could not refresh instances.' });
  feedback = managerFeedbackReducer(feedback, { type: 'read-cleared' });

  assert.equal(feedback.readError, '');
  assert.equal(feedback.operationError, 'Workflow changed since it was reviewed. Refresh the comparison before applying.');
});

test('retrying an operation or changing the selected instance clears its prior operation error', () => {
  const failed = managerFeedbackReducer(initialManagerFeedback, { type: 'operation-error', message: 'Request failed.' });

  assert.deepEqual(managerFeedbackReducer(failed, { type: 'operation-started' }), initialManagerFeedback);
  assert.deepEqual(managerFeedbackReducer(failed, { type: 'instance-changed' }), initialManagerFeedback);
});
