import assert from 'node:assert/strict';
import test from 'node:test';
import { runtimeUpdateCompletionMessage } from '../src/manager-runtime-feedback.js';

test('Runtime recovery feedback explains invalid prior state and Manager restart', () => {
  const message = runtimeUpdateCompletionMessage({
    active: { id: 'same-runtime-id', version: '0.2.0' },
    active_runtime_error: 'Runtime contents do not match their immutable identity.',
    changed: true,
    recovered_from_invalid_active: true,
    repaired_distribution: true,
    preserved_runtime_path: '/tmp/runtimes/.damaged-runtime-id',
    manager_restart_required: true
  }, 'same-runtime-id');

  assert.match(message, /validated source Runtime is now active/);
  assert.match(message, /Reopen Manager with leesh-loop to load the repaired Runtime/);
  assert.match(message, /Validation detail: Runtime contents do not match/);
  assert.match(message, /Damaged Runtime preserved at \/tmp\/runtimes\/\.damaged-runtime-id/);
  assert.match(message, /Running Loops and Workflow files were not changed/);
});

test('a no-change Runtime update explains that running Loops and Workflows were untouched', () => {
  assert.equal(
    runtimeUpdateCompletionMessage({ active: { version: '0.2.0' }, changed: false }, '0.2.0'),
    'Runtime is already up to date at version 0.2.0. No running Loop or Workflow was changed.'
  );
});

test('a no-change Runtime update keeps a pending Manager restart visible', () => {
  assert.match(
    runtimeUpdateCompletionMessage({ active: { version: '0.2.0' }, changed: false, manager_restart_required: true }, '0.2.0'),
    /Manager still requires a restart to load it\. Run leesh-loop/
  );
});
