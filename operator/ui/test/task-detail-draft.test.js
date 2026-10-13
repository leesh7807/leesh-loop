import assert from 'node:assert/strict';
import test from 'node:test';
import { readTaskDetailDraft } from '../src/task-detail-draft.js';

test('task detail drafts preserve the Local Store Blocked By task IDs', () => {
  const task = { state: 'Human Review', blockedBy: ['task-a', 'task-b'] };

  const draft = readTaskDetailDraft(task);

  assert.deepEqual(draft, { state: 'Human Review', blockedBy: ['task-a', 'task-b'] });
  assert.notEqual(draft.blockedBy, task.blockedBy);
});
