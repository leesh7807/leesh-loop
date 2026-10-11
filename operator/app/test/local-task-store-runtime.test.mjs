import assert from 'node:assert/strict';
import { lstat, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openLoopTaskStore } from '../local-task-store-runtime.mjs';

test('Loop state directories own isolated stores that persist when reopened', async t => {
  const root = await mkdtemp(join(tmpdir(), 'leesh-loop-store-instances-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const firstState = join(root, 'first-loop', 'state');
  const secondState = join(root, 'second-loop', 'state');
  const first = await openLoopTaskStore(firstState);
  const second = await openLoopTaskStore(secondState);
  const firstTask = first.publishTask({
    publicationKey: 'first-loop-request',
    identifier: 'PLAN-AAAA00000001',
    title: 'First Loop task',
    acceptedPlan: '# first-loop\n'
  });
  const secondTask = second.publishTask({
    publicationKey: 'second-loop-request',
    identifier: 'PLAN-BBBB00000002',
    title: 'Second Loop task',
    acceptedPlan: '# second-loop\n'
  });
  first.close();
  second.close();

  const firstPath = join(firstState, 'local-task-store', 'local-task-store.sqlite');
  const secondPath = join(secondState, 'local-task-store', 'local-task-store.sqlite');
  assert.equal((await lstat(firstPath)).isFile(), true);
  assert.equal((await lstat(secondPath)).isFile(), true);
  assert.equal((await stat(join(firstState, 'local-task-store'))).mode & 0o777, 0o700);
  assert.equal((await stat(firstPath)).mode & 0o777, 0o600);
  const firstRestart = await openLoopTaskStore(firstState);
  const secondRestart = await openLoopTaskStore(secondState);
  t.after(() => firstRestart.close());
  t.after(() => secondRestart.close());
  assert.deepEqual(firstRestart.listTasks().map(task => task.id), [firstTask.id]);
  assert.deepEqual(secondRestart.listTasks().map(task => task.id), [secondTask.id]);
});
