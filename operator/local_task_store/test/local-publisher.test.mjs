import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { openLoopTaskStore } from '../../app/local-task-store-runtime.mjs';
import { publishAcceptedPlan } from '../src/local-publisher.mjs';

const execFile = promisify(execFileCallback);
const sourceRoot = resolve(import.meta.dirname, '../../..');
const plan = '# 2026-10-11-local-execution-integration\n\nAccepted input lives in the Local Task Store.\n';

test('Local Publisher stores complete Accepted Plans and safely retries the same publication', async t => {
  const root = await mkdtemp(join(tmpdir(), 'leesh-loop-local-publisher-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await openLoopTaskStore(join(root, 'state'));
  t.after(() => store.close());

  const published = publishAcceptedPlan(store, plan);
  const retry = publishAcceptedPlan(store, plan);
  const task = store.getTask(published.page_id);

  assert.equal(retry.page_id, published.page_id);
  assert.equal(task.identifier, published.identifier);
  assert.equal(task.title, '2026-10-11-local-execution-integration');
  assert.equal(task.state, 'Ready');
  assert.equal(task.priority, 3);
  assert.deepEqual(task.labels, []);
  assert.equal(task.acceptedPlan, plan);
  assert.equal(store.listTasks().length, 1);
});

test('Local publication CLI uses the selected Loop State directory without a Git Plan file', async t => {
  const root = await mkdtemp(join(tmpdir(), 'leesh-loop-local-publisher-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateDirectory = join(root, 'state');
  const planPath = join(root, 'accepted-plan.md');
  await writeFile(planPath, plan);
  const projectPath = join(root, 'project.toml');
  await writeFile(projectPath, [
    'github_repository_url = "https://github.com/example/local-loop.git"',
    'github_base_branch = "main"',
    'workflow_path = "WORKFLOW.md"',
    'symphony_workspace_root = "workspaces"',
    `state_directory = ${JSON.stringify(stateDirectory)}`,
    'task_store = "local"'
  ].join('\n') + '\n');

  const { stdout } = await execFile(process.execPath, [
    join(sourceRoot, 'operator/app/publish-local-plan.mjs'), projectPath, '--plan', planPath
  ], { cwd: root, encoding: 'utf8' });
  const result = JSON.parse(stdout);
  const store = await openLoopTaskStore(stateDirectory);
  t.after(() => store.close());

  assert.equal(store.getTask(result.page_id).acceptedPlan, await readFile(planPath, 'utf8'));
  assert.equal(store.getTask(result.page_id).state, 'Ready');
  const retry = JSON.parse((await execFile(process.execPath, [
    join(sourceRoot, 'operator/app/publish-local-plan.mjs'), projectPath, '--plan', planPath
  ], { cwd: root, encoding: 'utf8' })).stdout);
  assert.equal(retry.page_id, result.page_id);
  assert.equal(store.listTasks().length, 1);
});

test('Local Publisher rejects incomplete Plans before the Store changes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'leesh-loop-local-publisher-invalid-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await openLoopTaskStore(join(root, 'state'));
  t.after(() => store.close());

  assert.throws(() => publishAcceptedPlan(store, 'Plan without a heading'), /Markdown H1/);
  assert.equal(store.listTasks().length, 0);
});
