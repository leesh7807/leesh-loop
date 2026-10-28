import assert from 'node:assert/strict';
import test from 'node:test';
import { readTaskDetailDraft, writeTaskDetailDraft } from '../src/task-detail-draft.js';

function createStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
    values
  };
}

test('task detail drafts preserve the Local Store Blocked By task IDs', () => {
  const task = { id: 'task-1', state: 'Human Review', blockedBy: ['task-a', 'task-b'] };

  const draft = readTaskDetailDraft(task);

  assert.deepEqual(draft, { state: 'Human Review', blockedBy: ['task-a', 'task-b'], comment: '' });
  assert.notEqual(draft.blockedBy, task.blockedBy);
});

test('task detail drafts are scoped to both project and Task and restore comment text', () => {
  const storage = createStorage();
  const task = { id: 'task-1', state: 'Ready', blockedBy: [] };
  const draft = { state: 'Human Review', blockedBy: ['task-2'], comment: 'Unsaved note' };

  writeTaskDetailDraft(task, draft, { instanceId: 'project-a', storage });

  assert.deepEqual(readTaskDetailDraft(task, { instanceId: 'project-a', states: ['Ready', 'Human Review'], storage }), draft);
  assert.deepEqual(readTaskDetailDraft(task, { instanceId: 'project-b', states: ['Ready', 'Human Review'], storage }), {
    state: 'Ready', blockedBy: [], comment: ''
  });
  assert.deepEqual(readTaskDetailDraft({ ...task, id: 'task-2' }, { instanceId: 'project-a', states: ['Ready', 'Human Review'], storage }), {
    state: 'Ready', blockedBy: [], comment: ''
  });
});

test('malformed task detail drafts fall back to saved Task values and normalize duplicate blockers', () => {
  const storage = createStorage();
  const task = { id: 'task-1', state: 'Ready', blockedBy: ['task-a'] };
  storage.setItem('leesh-loop.operator.task-detail-draft.v1:project-a:task-1', JSON.stringify({
    state: 'not a State', blockedBy: ['task-a', 'task-b', 'task-a', null], comment: 7
  }));

  assert.deepEqual(readTaskDetailDraft(task, { instanceId: 'project-a', states: ['Ready', 'Human Review'], storage }), {
    state: 'Ready', blockedBy: ['task-a', 'task-b'], comment: ''
  });
});

test('saving matching detail values clears stale draft data', () => {
  const storage = createStorage();
  const task = { id: 'task-1', state: 'Ready', blockedBy: ['task-a'] };
  const options = { instanceId: 'project-a', storage };

  writeTaskDetailDraft(task, { state: 'Human Review', blockedBy: [], comment: 'Draft' }, options);
  writeTaskDetailDraft(task, { state: 'Ready', blockedBy: ['task-a'], comment: '' }, options);

  assert.equal(storage.values.size, 0);
});
