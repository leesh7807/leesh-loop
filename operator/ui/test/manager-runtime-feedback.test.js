import assert from 'node:assert/strict';
import test from 'node:test';
import { runtimeUpdateCompletionMessage } from '../src/manager-runtime-feedback.js';

test('Runtime recovery feedback explains invalid prior state and Manager restart', () => {
  const message = runtimeUpdateCompletionMessage({
    active: { version: '0.2.0' },
    changed: true,
    recovered_from_invalid_active: true,
    manager_restart_required: true
  }, '0.1.0');

  assert.match(message, /validated source Runtime is now active/);
  assert.match(message, /Manager still uses Runtime 0\.1\.0; run leesh-loop/);
  assert.match(message, /Running Loops and Workflow files were not changed/);
});

test('a no-change Runtime update explains that running Loops and Workflows were untouched', () => {
  assert.equal(
    runtimeUpdateCompletionMessage({ active: { version: '0.2.0' }, changed: false }, '0.2.0'),
    'Runtime is already up to date at version 0.2.0. No running Loop or Workflow was changed.'
  );
});
