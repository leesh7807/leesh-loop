import assert from 'node:assert/strict';
import test from 'node:test';
import { managerLifecycleAction } from '../src/manager-lifecycle-action.js';

test('a Starting Loop exposes status instead of an unavailable stop action', () => {
  assert.equal(managerLifecycleAction('Starting'), 'pending');
});

test('stop is available for running Loops and failed Loops with a confirmed owned process', () => {
  assert.equal(managerLifecycleAction('Running'), 'stop');
  assert.equal(managerLifecycleAction('Failed', true), 'stop');
  assert.equal(managerLifecycleAction('Failed', false), 'start');
});

test('stopping has a status and unconfirmed ownership exposes no lifecycle action', () => {
  assert.equal(managerLifecycleAction('Stopping'), 'stopping');
  assert.equal(managerLifecycleAction('Unconfirmed'), 'unconfirmed');
});
