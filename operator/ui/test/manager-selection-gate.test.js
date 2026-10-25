import assert from 'node:assert/strict';
import test from 'node:test';
import { createManagerSelectionGate } from '../src/manager-selection-gate.js';

test('a late request is stale after the selected instance changes', () => {
  const gate = createManagerSelectionGate('loop-a');
  const request = gate.capture();

  gate.select('loop-b');

  assert.equal(gate.isCurrent(request), false);
});

test('a request stays stale after switching away and back to the same instance', () => {
  const gate = createManagerSelectionGate('loop-a');
  const request = gate.capture();

  gate.select('loop-b');
  gate.select('loop-a');

  assert.equal(gate.isCurrent(request), false);
});

test('selecting the same instance does not invalidate its request', () => {
  const gate = createManagerSelectionGate('loop-a');
  const request = gate.capture();

  gate.select('loop-a');

  assert.equal(gate.isCurrent(request), true);
});
