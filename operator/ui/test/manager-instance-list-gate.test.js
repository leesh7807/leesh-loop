import assert from 'node:assert/strict';
import test from 'node:test';
import { createManagerInstanceListGate } from '../src/manager-instance-list-gate.js';

test('a newer list read supersedes an older in-flight response', () => {
  const gate = createManagerInstanceListGate();
  const olderRead = gate.begin();
  const newerRead = gate.begin();

  assert.equal(gate.isCurrent(olderRead), false);
  assert.equal(gate.isCurrent(newerRead), true);
});

test('creating an instance invalidates lists that started before the create completed', () => {
  const gate = createManagerInstanceListGate();
  const beforeCreate = gate.begin();

  gate.invalidate();
  const afterCreate = gate.begin();

  assert.equal(gate.isCurrent(beforeCreate), false);
  assert.equal(gate.isCurrent(afterCreate), true);
});
