import assert from 'node:assert/strict';
import test from 'node:test';
import { canUnregisterLoop } from '../src/manager-unregister-eligibility.js';

test('unregistration is available only when stopped or failed with confirmed process absence', () => {
  assert.equal(canUnregisterLoop({ status: 'Stopped' }), true);
  assert.equal(canUnregisterLoop({ status: 'Failed', can_update_workflow: true }), true);
  assert.equal(canUnregisterLoop({ status: 'Failed', can_stop: true }), false);
  assert.equal(canUnregisterLoop({ status: 'Failed' }), false);
  assert.equal(canUnregisterLoop({ status: 'Unconfirmed', can_update_workflow: true }), false);
  assert.equal(canUnregisterLoop({ status: 'Starting' }), false);
  assert.equal(canUnregisterLoop(null), false);
});
