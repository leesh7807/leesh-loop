import assert from 'node:assert/strict';
import test from 'node:test';
import { clearPublicationDraft, readPublicationDraft, writePublicationDraft } from '../src/publication-draft.js';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
  removeItem(key) { this.values.delete(key); }
}

test('a page reload restores the Plan, publication State, and selected blocker summaries', () => {
  const storage = new MemoryStorage();
  const draft = {
    plan: '# Continue after reload\n\nKeep this context.',
    state: 'Backlog',
    selectedBlockers: [
      { taskId: 'task-a', title: 'First blocker', state: 'Done', identifier: 'PLAN-A' },
      { taskId: 'task-b', title: 'Second blocker', state: 'In Progress', identifier: 'PLAN-B' }
    ]
  };

  writePublicationDraft(draft, 'instance-a', storage);

  assert.deepEqual(readPublicationDraft('instance-a', storage), draft);
});

test('malformed session data is ignored and duplicate or incomplete blockers are discarded', () => {
  const storage = new MemoryStorage();
  writePublicationDraft({
    plan: '# Safe read',
    state: 7,
    selectedBlockers: [
      { taskId: 'task-a', title: 'First', state: 'Done' },
      { taskId: 'task-a', title: 'Duplicate', state: 'Done' },
      { title: 'No identity', state: 'Backlog' }
    ]
  }, 'instance-a', storage);

  assert.deepEqual(readPublicationDraft('instance-a', storage), {
    plan: '# Safe read',
    state: '',
    selectedBlockers: [{ taskId: 'task-a', title: 'First', state: 'Done', identifier: '' }]
  });

  storage.setItem('leesh-loop.operator.publication-draft.v1:instance-a', '{invalid');
  assert.deepEqual(readPublicationDraft('instance-a', storage), { plan: '', state: '', selectedBlockers: [] });
});

test('a successful publication can clear its recovery draft', () => {
  const storage = new MemoryStorage();
  writePublicationDraft({ plan: '# Published', state: 'Backlog', selectedBlockers: [] }, 'instance-a', storage);

  clearPublicationDraft('instance-a', storage);

  assert.deepEqual(readPublicationDraft('instance-a', storage), { plan: '', state: '', selectedBlockers: [] });
});

test('publication recovery stays scoped to its mounted instance across tab selection changes', () => {
  const storage = new MemoryStorage();
  const firstDraft = { plan: '# First', state: 'Ready', selectedBlockers: [] };
  const secondDraft = { plan: '# Second', state: 'Backlog', selectedBlockers: [] };

  writePublicationDraft(firstDraft, 'instance-a', storage);
  writePublicationDraft(secondDraft, 'instance-b', storage);

  assert.deepEqual(readPublicationDraft('instance-a', storage), firstDraft);
  assert.deepEqual(readPublicationDraft('instance-b', storage), secondDraft);
  clearPublicationDraft('instance-a', storage);
  assert.deepEqual(readPublicationDraft('instance-a', storage), { plan: '', state: '', selectedBlockers: [] });
  assert.deepEqual(readPublicationDraft('instance-b', storage), secondDraft);
});
