import test from 'node:test';
import assert from 'node:assert/strict';
import { E2ELifecycleInterpreter } from '../run/lifecycle/lifecycle-interpreter.mjs';

test('interpreter maps task states without owning a competing lifecycle state model', () => {
  const interpreter = new E2ELifecycleInterpreter();
  assert.deepEqual(interpreter.interpretTaskState({ state: 'Human Review' }), { phase: 'Human Review', handling: 'mechanical_human_review_transition', state: 'Human Review' });
  assert.equal(interpreter.interpretTaskState({ state: 'Rework' }).handling, 'unsupported_state');
  assert.equal(interpreter.interpretTaskState({ state: 'Unexpected' }).handling, 'unsupported_state');
  assert.deepEqual(interpreter.findMissingLifecyclePhases('In Progress'), ['Human Review', 'Merging', 'Done']);
});

test('verified-through stops at the first unobserved normal lifecycle phase', () => {
  const interpreter = new E2ELifecycleInterpreter();
  const observations = [{ state: 'Human Review' }, { state: 'Merging' }, { state: 'Done' }];
  assert.equal(interpreter.findVerifiedLifecycleThrough(observations), null);
  assert.deepEqual(interpreter.findMissingLifecyclePhases(null), ['Ready', 'In Progress', 'Human Review', 'Merging', 'Done']);
  assert.equal(interpreter.findVerifiedLifecycleThrough([
    { state: 'Ready' },
    { state: 'Human Review' },
    { state: 'In Progress' },
    { state: 'Merging' },
    { state: 'Done' }
  ]), 'Ready');
});
