import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkflowDiff } from '../src/workflow-diff.js';

test('Workflow comparison marks changed lines and keeps nearby context', () => {
  const diff = createWorkflowDiff('one\ntwo\nold\nfour\nfive', 'one\ntwo\nnew\nfour\nfive');

  assert.deepEqual(diff.map(line => [line.type, line.text]), [
    ['equal', 'one'],
    ['equal', 'two'],
    ['removed', 'old'],
    ['added', 'new'],
    ['equal', 'four'],
    ['equal', 'five']
  ]);
  assert.equal(diff[2].oldNumber, 3);
  assert.equal(diff[3].newNumber, 3);
});

test('Workflow comparison collapses distant unchanged sections into context counts', () => {
  const before = ['start', 'first change', ...Array.from({ length: 12 }, (_, index) => `middle ${index}`), 'last change', 'end'].join('\n');
  const after = ['start', 'first update', ...Array.from({ length: 12 }, (_, index) => `middle ${index}`), 'last update', 'end'].join('\n');

  const diff = createWorkflowDiff(before, after, 1);

  assert.deepEqual(diff.filter(line => line.type === 'gap').map(line => line.count), [10]);
  assert.deepEqual(diff.filter(line => line.type === 'removed' || line.type === 'added').map(line => [line.type, line.text]), [
    ['removed', 'first change'], ['added', 'first update'],
    ['removed', 'last change'], ['added', 'last update']
  ]);
});

test('Workflow comparison returns no rows for identical content', () => {
  assert.deepEqual(createWorkflowDiff('same\ncontent', 'same\ncontent'), []);
});

test('Workflow comparison normalizes line endings', () => {
  assert.deepEqual(createWorkflowDiff('one\r\ntwo\r\n', 'one\ntwo\n'), []);
});

test('line numbers and operations reconstruct both sides with repeated lines', () => {
  const before = 'repeat\nold\nrepeat\nend';
  const after = 'repeat\nrepeat\nnew\nend';
  const diff = createWorkflowDiff(before, after, 100);

  assert.equal(diff.filter(line => line.type !== 'added').map(line => line.text).join('\n'), before);
  assert.equal(diff.filter(line => line.type !== 'removed').map(line => line.text).join('\n'), after);
});

test('a very large replacement uses a bounded, explicit summary', () => {
  const before = Array.from({ length: 1600 }, (_, index) => `before ${index}`).join('\n');
  const after = Array.from({ length: 1600 }, (_, index) => `after ${index}`).join('\n');

  assert.deepEqual(createWorkflowDiff(before, after), [{ type: 'replacement', removed: 1600, added: 1600 }]);
});
