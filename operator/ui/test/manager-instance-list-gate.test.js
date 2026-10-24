import assert from 'node:assert/strict';
import test from 'node:test';
import { createManagerInstanceListGate } from '../src/manager-instance-list-gate.js';

test('starting a newer list read does not discard an older response that completes first', () => {
  const gate = createManagerInstanceListGate();
  const olderRead = gate.begin();
  const newerRead = gate.begin();

  assert.equal(gate.accept(olderRead), true);
  assert.equal(gate.accept(newerRead), true);
  assert.equal(gate.accept(olderRead), false);
});

test('an older response cannot overwrite a newer completed list read', () => {
  const gate = createManagerInstanceListGate();
  const olderRead = gate.begin();
  const newerRead = gate.begin();

  assert.equal(gate.accept(newerRead), true);
  assert.equal(gate.accept(olderRead), false);
});

test('creating an instance invalidates lists that started before the create completed', () => {
  const gate = createManagerInstanceListGate();
  const beforeCreate = gate.begin();

  gate.invalidate();
  const afterCreate = gate.begin();

  assert.equal(gate.accept(beforeCreate), false);
  assert.equal(gate.accept(afterCreate), true);
});
