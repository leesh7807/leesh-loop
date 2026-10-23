import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { openLocalTaskStore } from '../src/local-task-store.mjs';
import { publishAcceptedPlan } from '../src/local-publisher.mjs';

const execFile = promisify(execFileCallback);
const sourceRoot = resolve(import.meta.dirname, '../../..');
const plan = '# 2026-10-11-local-execution-integration\n\nAccepted input lives in the Local Task Store.\n';

test('Local Publisher stores complete Accepted Plans and creates a new task for each request', async t => {
  const root = await mkdtemp(join(tmpdir(), 'leesh-loop-local-publisher-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await openLocalTaskStore(join(root, 'state', 'local-task-store', 'local-task-store.sqlite'));
  t.after(() => store.close());

  const published = publishAcceptedPlan(store, plan);
  const retry = publishAcceptedPlan(store, plan);
  const task = store.getTask(published.page_id);
  const secondTask = store.getTask(retry.page_id);
  const baseTitle = Array.from(plan.trim().replace(/\s+/gu, ' ')).slice(0, 80).join('');

  assert.notEqual(retry.page_id, published.page_id);
  assert.notEqual(retry.identifier, published.identifier);
  assert.equal(task.identifier, published.identifier);
  assert.equal(task.title, baseTitle);
  assert.equal(secondTask.title, `${baseTitle} (1)`);
  assert.equal(task.state, 'Ready');
  assert.equal(task.priority, 3);
  assert.deepEqual(task.labels, []);
  assert.equal(task.acceptedPlan, plan);
  assert.equal(secondTask.acceptedPlan, plan);
  assert.equal(store.listTasks().length, 2);
});

test('Local publication CLI uses the selected Loop State directory and permits repeated input', async t => {
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
    `state_directory = ${JSON.stringify(stateDirectory)}`
  ].join('\n') + '\n');

  const { stdout } = await execFile(process.execPath, [
    join(sourceRoot, 'operator/app/publish-local-plan.mjs'), projectPath, '--plan', planPath
  ], { cwd: root, encoding: 'utf8', env: process.env });
  const result = JSON.parse(stdout);
  const store = await openLocalTaskStore(join(stateDirectory, 'local-task-store', 'local-task-store.sqlite'));
  t.after(() => store.close());

  assert.equal(store.getTask(result.page_id).acceptedPlan, await readFile(planPath, 'utf8'));
  assert.equal(store.getTask(result.page_id).state, 'Ready');
  const retry = JSON.parse((await execFile(process.execPath, [
    join(sourceRoot, 'operator/app/publish-local-plan.mjs'), projectPath, '--plan', planPath
  ], { cwd: root, encoding: 'utf8', env: process.env })).stdout);
  assert.notEqual(retry.page_id, result.page_id);
  assert.notEqual(retry.identifier, result.identifier);
  assert.equal(store.getTask(retry.page_id).title, `${store.getTask(result.page_id).title} (1)`);
  assert.equal(store.listTasks().length, 2);
});

test('Local Publisher derives a plain-text title and rejects blank Plans', async t => {
  const root = await mkdtemp(join(tmpdir(), 'leesh-loop-local-publisher-invalid-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await openLocalTaskStore(join(root, 'state', 'local-task-store', 'local-task-store.sqlite'));
  t.after(() => store.close());

  const plainText = `  ${'Title '.repeat(20)}\n\nFollow-up details.`;
  const published = publishAcceptedPlan(store, plainText);
  assert.equal(store.getTask(published.page_id).title, Array.from('Title '.repeat(20) + 'Follow-up details.').slice(0, 80).join(''));
  assert.equal(store.getTask(published.page_id).acceptedPlan, plainText);
  assert.throws(() => publishAcceptedPlan(store, ' \n\t  '), /Plan content must be non-empty/);
  assert.equal(store.listTasks().length, 1);
});

test('concurrent Local Publisher requests assign distinct identities and atomic title suffixes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'leesh-loop-local-publisher-concurrent-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateDirectory = join(root, 'state');
  const concurrentPlan = 'Same plan title\n\nConcurrent independent publication.';
  const child = `
    import { pathToFileURL } from 'node:url';
    import { join } from 'node:path';
    const { openLocalTaskStore } = await import(pathToFileURL(process.argv[1]).href);
    const { publishAcceptedPlan } = await import(pathToFileURL(process.argv[2]).href);
    const store = await openLocalTaskStore(join(process.argv[3], 'local-task-store', 'local-task-store.sqlite'));
    try {
      const publication = publishAcceptedPlan(store, process.argv[4]);
      process.stdout.write(JSON.stringify(publication));
    } finally { store.close(); }
  `;
  const runChild = () => execFile(process.execPath, [
    '--input-type=module', '-e', child,
    join(sourceRoot, 'operator/local_task_store/src/local-task-store.mjs'),
    join(sourceRoot, 'operator/local_task_store/src/local-publisher.mjs'),
    stateDirectory,
    concurrentPlan
  ], { cwd: sourceRoot, maxBuffer: 1024 * 1024 });

  const results = await Promise.all(Array.from({ length: 8 }, runChild));
  const publications = results.map(result => JSON.parse(result.stdout));
  const store = await openLocalTaskStore(join(stateDirectory, 'local-task-store', 'local-task-store.sqlite'));
  t.after(() => store.close());
  const tasks = publications.map(publication => store.getTask(publication.page_id));

  assert.equal(new Set(publications.map(publication => publication.page_id)).size, 8);
  assert.equal(new Set(publications.map(publication => publication.identifier)).size, 8);
  assert.deepEqual(new Set(tasks.map(task => task.title)), new Set([
    'Same plan title Concurrent independent publication.',
    ...Array.from({ length: 7 }, (_, index) => `Same plan title Concurrent independent publication. (${index + 1})`)
  ]));
  assert.ok(tasks.every(task => task.acceptedPlan === concurrentPlan));
  assert.equal(store.listTasks().length, 8);
});
