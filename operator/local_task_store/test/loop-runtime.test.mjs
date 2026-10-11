import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { initLoop } from '../../app/init.mjs';
import { updateLoop } from '../../app/update.mjs';
import { openLocalTaskStore } from '../src/local-task-store.mjs';

const execFile = promisify(execFileCallback);
const sourceRoot = resolve(import.meta.dirname, '../../..');

async function git(cwd, ...args) {
  return execFile('git', args, { cwd, encoding: 'utf8' });
}

test('a real task database in instance state survives a Loop runtime update', async t => {
  const root = await mkdtemp(join(tmpdir(), 'leesh-loop-store-update-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const targetRoot = join(root, 'target-project');
  await mkdir(targetRoot);
  await git(targetRoot, 'init', '--quiet', '-b', 'feature/store-update');
  await git(targetRoot, 'config', 'user.name', 'Local Store Test');
  await git(targetRoot, 'config', 'user.email', 'local-store@example.invalid');
  await writeFile(join(targetRoot, 'README.md'), '# Target project\n');
  await git(targetRoot, 'add', 'README.md');
  await git(targetRoot, 'commit', '--quiet', '-m', 'initial target');
  await git(targetRoot, 'remote', 'add', 'origin', 'https://github.com/example/target-project.git');
  const head = (await git(targetRoot, 'rev-parse', 'HEAD')).stdout.trim();
  await git(targetRoot, 'update-ref', 'refs/remotes/origin/main', head);
  await git(targetRoot, 'config', 'branch.feature/store-update.remote', 'origin');
  await git(targetRoot, 'config', 'branch.feature/store-update.merge', 'refs/heads/main');

  const loopRoot = join(root, 'target-project-loop');
  await initLoop({ cwd: targetRoot, sourceRoot, environment: {} });
  const stateDirectory = join(loopRoot, '.runtime/state');
  const store = await openLocalTaskStore(join(stateDirectory, 'local-task-store', 'local-task-store.sqlite'));
  const task = store.publishTask({
    publicationKey: 'durable-task',
    identifier: 'PLAN-CCCC00000003',
    title: 'Preserve local data on update',
    acceptedPlan: '# local-task-store-update\n\nAccepted input survives runtime replacement.\n'
  });
  store.appendWorkpad(task.id, 'Persist this execution record.');
  store.appendComment(task.id, 'Persist this user input.');
  store.close();

  const result = await updateLoop({ cwd: loopRoot, sourceRoot });
  assert.equal(result.area, 'runtime');
  const reopened = await openLocalTaskStore(join(stateDirectory, 'local-task-store', 'local-task-store.sqlite'));
  t.after(() => reopened.close());
  assert.equal(reopened.getTask(task.id).acceptedPlan, task.acceptedPlan);
  assert.deepEqual(reopened.listRecords(task.id).map(record => record.content), [
    'Persist this execution record.',
    'Persist this user input.'
  ]);
  assert.equal(await readFile(join(targetRoot, 'README.md'), 'utf8'), '# Target project\n');
});
