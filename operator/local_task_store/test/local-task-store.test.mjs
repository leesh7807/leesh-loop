import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { openLocalTaskStore } from '../src/local-task-store.mjs';

const execFile = promisify(execFileCallback);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const storeModule = join(packageRoot, 'src/local-task-store.mjs');

async function makeStore(t) {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-local-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'state', 'local-task-store.sqlite');
  const store = await openLocalTaskStore(databasePath);
  let isOpen = true;
  const close = () => {
    if (isOpen) {
      store.close();
      isOpen = false;
    }
  };
  t.after(close);
  return { directory, databasePath, store, close };
}

function publication(overrides = {}) {
  return {
    publicationKey: 'request-1',
    identifier: 'PLAN-A1B2C3D4E5F6',
    title: 'Local Task Store',
    acceptedPlan: '# 2026-10-11-local-task-store-foundation\n\nThe complete accepted input.\n',
    ...overrides
  };
}

test('publishes complete local tasks idempotently and keeps Accepted Plan unchanged after close and reopen', async t => {
  const { directory, databasePath, store, close } = await makeStore(t);
  const plan = publication().acceptedPlan;
  const blocker = store.publishTask(publication({
    publicationKey: 'blocker-request',
    identifier: 'PLAN-111111111111',
    title: 'Blocker',
    state: 'In Progress',
    acceptedPlan: '# blocker\n'
  }));
  while (Date.now() <= Date.parse(blocker.createdAt)) await new Promise(resolve => setTimeout(resolve, 1));
  const taskInput = publication({
    priority: 3,
    labels: ['symphony', 'local-store'],
    blockedBy: [blocker.id]
  });
  const task = store.publishTask(taskInput);

  assert.deepEqual(task, store.publishTask(taskInput));
  assert.equal(task.acceptedPlan, plan);
  assert.equal(task.state, 'Ready');
  assert.equal(task.priority, 3);
  assert.deepEqual(task.labels, ['symphony', 'local-store']);
  assert.deepEqual(task.blockedBy, [blocker.id]);
  assert.match(task.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(task.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(existsSync(join(directory, '2026-10-11-local-task-store-foundation.md')), false);
  assert.deepEqual(store.listTasks().map(item => item.id), [blocker.id, task.id]);
  assert.deepEqual(store.listTasks({ state: 'Ready' }).map(item => item.id), [task.id]);

  const updated = store.updateTask(task.id, { title: 'Edited title', state: 'In Progress', priority: 2, labels: ['changed'] });
  assert.ok(updated.updatedAt >= task.updatedAt);
  store.appendWorkpad(task.id, 'Worker progress');
  store.appendComment(task.id, 'Human input');
  store.addBlockedBy(task.id, blocker.id);
  assert.equal(store.getTask(task.id).acceptedPlan, plan);
  const storedRecords = store.listRecords(task.id);
  assert.throws(() => store.updateTask(task.id, { acceptedPlan: '# rewritten' }), /cannot be changed: acceptedPlan/);
  close();

  const directDatabase = new Database(databasePath);
  assert.throws(
    () => directDatabase.prepare('UPDATE tasks SET accepted_plan = ? WHERE id = ?').run('# rewritten', task.id),
    /Accepted Plan is immutable/
  );
  directDatabase.close();

  const reopened = await openLocalTaskStore(databasePath);
  t.after(() => reopened.close());
  const restored = reopened.getTask(task.id);
  assert.equal(restored.id, task.id);
  assert.equal(restored.title, 'Edited title');
  assert.equal(restored.state, 'In Progress');
  assert.equal(restored.priority, 2);
  assert.deepEqual(restored.labels, ['changed']);
  assert.equal(restored.acceptedPlan, plan);
  assert.deepEqual(restored.blockedBy, [blocker.id]);
  assert.deepEqual(reopened.listRecords(task.id), storedRecords);
});

test('a failed publication rolls back completely and an idempotency key cannot change meaning', async t => {
  const { store } = await makeStore(t);
  const invalid = publication({ blockedBy: ['missing-task-id'] });
  assert.throws(() => store.publishTask(invalid), /FOREIGN KEY constraint failed/);
  assert.deepEqual(store.listTasks(), []);

  const original = store.publishTask(publication());
  assert.throws(() => store.publishTask(publication({ title: 'Different input' })), /already used with different task data/);
  assert.deepEqual(store.listTasks(), [original]);
  assert.equal(store.getTask(original.id).title, 'Local Task Store');
});

test('workpad and comments retain append order, unique IDs, and comment-baseline reads', async t => {
  const { store } = await makeStore(t);
  const task = store.publishTask(publication());
  const workpad1 = store.appendWorkpad(task.id, 'started');
  const comment1 = store.appendComment(task.id, 'first human input');
  const workpad2 = store.appendWorkpad(task.id, 'continued');
  const comment2 = store.appendComment(task.id, 'second human input');

  const records = store.listRecords(task.id);
  assert.deepEqual(records.map(record => record.id), [workpad1.id, comment1.id, workpad2.id, comment2.id]);
  assert.deepEqual(records.map(record => record.sequence), [...records].map(record => record.sequence).sort((a, b) => a - b));
  assert.equal(new Set([workpad1.id, comment1.id, workpad2.id, comment2.id]).size, 4);
  assert.deepEqual(store.listRecords(task.id, { kind: 'workpad' }).map(record => record.id), [workpad1.id, workpad2.id]);
  assert.deepEqual(store.listRecords(task.id, { kind: 'comment' }).map(record => record.id), [comment1.id, comment2.id]);
  assert.deepEqual(store.listCommentsAfter(task.id, comment1.id).map(record => record.id), [comment2.id]);
  assert.equal(store.latestCommentId(task.id), comment2.id);
  assert.throws(() => store.listCommentsAfter(task.id, workpad1.id), /Comment baseline not found/);
  assert.throws(() => store.listCommentsAfter(task.id, 'unknown-comment'), /Comment baseline not found/);
});

test('Blocked By rejects invalid relations atomically and follows terminal-state semantics', async t => {
  const { store } = await makeStore(t);
  const blocker = store.publishTask(publication({
    publicationKey: 'blocker',
    identifier: 'PLAN-222222222222',
    title: 'Dependency',
    state: 'In Progress',
    acceptedPlan: '# dependency\n'
  }));
  const alternateBlocker = store.publishTask(publication({
    publicationKey: 'alternate-blocker',
    identifier: 'PLAN-222222222223',
    title: 'Alternate dependency',
    state: 'In Progress',
    acceptedPlan: '# alternate dependency\n'
  }));
  const task = store.publishTask(publication({
    publicationKey: 'blocked',
    identifier: 'PLAN-333333333333',
    title: 'Blocked task',
    acceptedPlan: '# blocked\n'
  }));

  assert.deepEqual(store.setBlockedBy(task.id, [blocker.id]).blockedBy, [blocker.id]);
  assert.equal(store.isBlocked(task.id), true);
  store.updateTask(blocker.id, { state: 'Done' });
  assert.equal(store.isBlocked(task.id), false);
  store.updateTask(blocker.id, { state: 'Cancelled' });
  assert.equal(store.isBlocked(task.id, ['Done']), true);

  assert.throws(() => store.setBlockedBy(task.id, [task.id]), /cannot block itself/);
  assert.throws(() => store.setBlockedBy(task.id, [alternateBlocker.id, 'missing-task-id']), /FOREIGN KEY constraint failed/);
  assert.deepEqual(store.getTask(task.id).blockedBy, [blocker.id]);
  assert.throws(() => store.isBlocked('missing-task-id'), /Task not found/);
});

test('concurrent processes preserve each append and deduplicate the same publication request', async t => {
  const { databasePath, store, close } = await makeStore(t);
  const task = store.publishTask(publication());
  close();

  const child = `
    import { pathToFileURL } from 'node:url';
    const { openLocalTaskStore } = await import(pathToFileURL(process.argv[1]).href);
    const store = await openLocalTaskStore(process.argv[2]);
    try {
      const mode = process.argv[3];
      if (mode === 'append') {
        const record = store.appendComment(process.argv[4], process.argv[5]);
        process.stdout.write(JSON.stringify(record));
      } else {
        const task = store.publishTask(JSON.parse(process.argv[4]));
        process.stdout.write(JSON.stringify(task));
      }
    } finally { store.close(); }
  `;
  const runChild = (...args) => execFile(process.execPath, ['--input-type=module', '-e', child, storeModule, databasePath, ...args], { maxBuffer: 1024 * 1024 });

  const appendResults = await Promise.all(Array.from({ length: 12 }, (_, index) =>
    runChild('append', task.id, `concurrent comment ${index}`)
  ));
  const appendedIds = appendResults.map(result => JSON.parse(result.stdout).id);
  const afterAppend = await openLocalTaskStore(databasePath);
  t.after(() => afterAppend.close());
  const comments = afterAppend.listRecords(task.id, { kind: 'comment' });
  assert.equal(comments.length, 12);
  assert.equal(new Set(comments.map(record => record.id)).size, 12);
  assert.deepEqual(new Set(comments.map(record => record.id)), new Set(appendedIds));

  const concurrentPublication = publication({
    publicationKey: 'concurrent-request',
    identifier: 'PLAN-444444444444',
    title: 'Concurrent Request'
  });
  const publicationResults = await Promise.all(Array.from({ length: 8 }, () =>
    runChild('publish', JSON.stringify(concurrentPublication))
  ));
  const publishedIds = publicationResults.map(result => JSON.parse(result.stdout).id);
  assert.equal(new Set(publishedIds).size, 1);
  assert.equal(afterAppend.listTasks().length, 2);
});
