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

  writePublicationDraft(draft, storage);

  assert.deepEqual(readPublicationDraft(storage), draft);
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
  }, storage);

  assert.deepEqual(readPublicationDraft(storage), {
    plan: '# Safe read',
    state: '',
    selectedBlockers: [{ taskId: 'task-a', title: 'First', state: 'Done', identifier: '' }]
  });

  storage.setItem('leesh-loop.operator.publication-draft.v1', '{invalid');
  assert.deepEqual(readPublicationDraft(storage), { plan: '', state: '', selectedBlockers: [] });
});

test('a successful publication can clear its recovery draft', () => {
  const storage = new MemoryStorage();
  writePublicationDraft({ plan: '# Published', state: 'Backlog', selectedBlockers: [] }, storage);

  clearPublicationDraft(storage);

  assert.deepEqual(readPublicationDraft(storage), { plan: '', state: '', selectedBlockers: [] });
});
