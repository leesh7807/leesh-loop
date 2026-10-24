import assert from 'node:assert/strict';
import test from 'node:test';
import { createSerializedRefreshQueue } from '../src/refresh-queue.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('an invalidated Task detail read cannot replace a saved mutation and queues one refresh', async () => {
  const queue = createSerializedRefreshQueue();
  const initialRead = deferred();
  const followupRead = deferred();
  const reads = [];
  const appliedStates = [];
  let currentState = 'Ready';
  let queuedRefresh;

  async function refresh() {
    const requestVersion = queue.begin();
    if (requestVersion === null) return;
    const read = reads.length === 0 ? initialRead : followupRead;
    reads.push(read);
    try {
      const task = await read.promise;
      if (!queue.isCurrent(requestVersion)) return;
      currentState = task.state;
      appliedStates.push(task.state);
    } finally {
      const { shouldRefresh } = queue.finish(requestVersion);
      if (shouldRefresh) queuedRefresh = refresh();
    }
  }

  const initialRefresh = refresh();
  await refresh(); // Polling during the first GET queues one follow-up.
  assert.equal(reads.length, 1);

  queue.invalidate(); // State mutation starts.
  currentState = 'Human Review'; // The successful PUT response is applied.
  appliedStates.push(currentState);
  queue.invalidate(); // State mutation settles.
  await refresh(); // The post-mutation refresh joins the queued request.

  initialRead.resolve({ state: 'Ready' });
  await initialRefresh;
  assert.equal(reads.length, 2);
  assert.deepEqual(appliedStates, ['Human Review']);
  assert.equal(currentState, 'Human Review');

  followupRead.resolve({ state: 'Human Review' });
  await queuedRefresh;
  assert.deepEqual(appliedStates, ['Human Review', 'Human Review']);
  assert.equal(currentState, 'Human Review');
  assert.equal(reads.length, 2);
});

test('a stale Task list response queues and applies one current read', async () => {
  const queue = createSerializedRefreshQueue();
  const staleRead = deferred();
  const currentRead = deferred();
  const reads = [];
  let tasks = ['Before mutation'];
  let queuedRefresh;

  async function refresh() {
    const requestVersion = queue.begin();
    if (requestVersion === null) return;
    const read = reads.length === 0 ? staleRead : currentRead;
    reads.push(read);
    try {
      const result = await read.promise;
      if (!queue.isCurrent(requestVersion)) {
        queue.markQueued();
        return;
      }
      tasks = result.tasks;
    } finally {
      const { shouldRefresh } = queue.finish(requestVersion);
      if (shouldRefresh) queuedRefresh = refresh();
    }
  }

  const initialRefresh = refresh();
  queue.invalidate(); // A mutation response updates the queue's authoritative data.
  tasks = ['Saved mutation'];
  await refresh(); // Mutation-triggered refresh is queued behind the old GET.
  assert.equal(reads.length, 1);

  staleRead.resolve({ tasks: ['Stale snapshot'] });
  await initialRefresh;
  assert.equal(reads.length, 2);
  assert.deepEqual(tasks, ['Saved mutation']);

  currentRead.resolve({ tasks: ['Saved mutation'] });
  await queuedRefresh;
  assert.deepEqual(tasks, ['Saved mutation']);
  assert.equal(reads.length, 2);
});
