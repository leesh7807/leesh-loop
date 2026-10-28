import assert from 'node:assert/strict';
import { execFile as execute } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import test from 'node:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { configureLocalTaskStoreEnvironment, effective, executionStateRoot, initializeInstanceTaskStore, loadConfig, parseStartArguments } from '../leesh-loop.mjs';
import { localTaskStorePath } from '../local-task-store-runtime.mjs';

const execFile = promisify(execute);
const root = join(import.meta.dirname, '../../..');

test('default npm start opens the central Manager and the CLI exposes instance operations', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.scripts.start, 'node bin/leesh-loop.mjs open');
  assert.equal(manifest.scripts['start:fast'], undefined);
  assert.equal(manifest.scripts.init, 'node bin/leesh-loop.mjs init');
  assert.equal(manifest.scripts.list, 'node bin/leesh-loop.mjs list');
  assert.equal(manifest.scripts.update, 'node bin/leesh-loop.mjs update');

  const { stdout } = await execFile(process.execPath, [join(root, 'bin/leesh-loop.mjs'), '--help'], { cwd: root });
  assert.match(stdout, /leesh-loop\s+start \[project\]/);
  assert.match(stdout, /leesh-loop\s+stop \[project\]/);
  assert.match(stdout, /leesh-loop\s+manager stop/);
  assert.match(stdout, /leesh-loop\s+add \[path\]/);
  assert.doesNotMatch(stdout, /project\.toml|skip-external-readiness/);
  assert.equal(parseStartArguments([]).configurationPath, join(root, 'project.toml'));
});

test('a Project always uses Local Task Store and removes task database credentials from Symphony', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-local-project-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = join(directory, 'project.toml');
  const stateDirectory = join(directory, 'state');
  await writeFile(configPath, [
    'github_repository_url = "https://github.com/example/local-project.git"',
    'github_base_branch = "main"',
    'workflow_path = "WORKFLOW.md"',
    'symphony_workspace_root = "workspaces"',
    `state_directory = ${JSON.stringify(stateDirectory)}`,
  ].join('\n') + '\n');

  const config = await loadConfig(configPath);
  assert.equal(Object.hasOwn(config, 'task_store'), false);
  assert.equal(Object.hasOwn(config, 'notion_database_url'), false);
  const localIdentity = effective(config, 'local-runtime', 4100);
  assert.equal(localIdentity.local_task_store_path, join(stateDirectory, 'local-task-store', 'local-task-store.sqlite'));

  const localEnvironment = configureLocalTaskStoreEnvironment({
    LEESH_LOOP_TRACKER_KIND: 'notion',
    LEESH_LOOP_NOTION_DATABASE_URL: 'https://notion.example/database',
    NOTION_TOKEN: 'task-token'
  }, localIdentity.local_task_store_path, root);
  assert.equal(Object.hasOwn(localEnvironment, 'LEESH_LOOP_TRACKER_KIND'), false);
  assert.equal(Object.hasOwn(localEnvironment, 'LEESH_LOOP_NOTION_DATABASE_URL'), false);
  assert.equal(Object.hasOwn(localEnvironment, 'NOTION_TOKEN'), false);
  assert.equal(localEnvironment.LEESH_LOOP_LOCAL_TASK_STORE_PATH, localIdentity.local_task_store_path);
  assert.equal(localEnvironment.LEESH_LOOP_RUNTIME_ROOT, root);
});

test('central CLI rejects malformed commands without starting a Loop', async () => {
  await assert.rejects(
    execFile(process.execPath, [join(root, 'bin/leesh-loop.mjs'), 'unknown-command'], { cwd: root }),
    error => {
      assert.equal(error.code, 2);
      assert.match(error.stderr, /leesh-loop init/);
      assert.match(error.stderr, /leesh-loop start \[project\]/);
      return true;
    }
  );
});

test('Manager execution state stays separate from the instance Task Store', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-state-boundary-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const instanceState = join(directory, 'instance', 'state');
  const executionState = join(directory, 'xdg-state', 'loops', 'instance-id');
  const config = { state_directory: instanceState };

  assert.equal(executionStateRoot(config, { LEESH_LOOP_EXECUTION_STATE_DIRECTORY: executionState }), executionState);
  const databasePath = await initializeInstanceTaskStore(config);
  assert.equal(databasePath, localTaskStorePath(instanceState));
  assert.equal((await stat(databasePath)).isFile(), true);
  await assert.rejects(stat(localTaskStorePath(executionState)), error => error.code === 'ENOENT');
});

test('invalid TOML Project ports fail before start creates runtime state', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-invalid-start-project-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = join(directory, 'project.toml');
  const stateDirectory = join(directory, 'state');
  await writeFile(configPath, [
    'github_repository_url = "https://github.com/example/repository.git"',
    'github_base_branch = "main"',
    'workflow_path = "WORKFLOW.md"',
    'symphony_workspace_root = ".runtime/workspaces"',
    `state_directory = ${JSON.stringify(stateDirectory)}`,
    'ui_port = 70000'
  ].join('\n'));

  await assert.rejects(
    execFile(process.execPath, [join(root, 'operator/app/leesh-loop.mjs'), 'start', configPath], { timeout: 10_000 }),
    error => {
      assert.equal(error.stdout, '');
      assert.match(error.stderr, /ui_port must be an integer between 1 and 65535/);
      return true;
    }
  );
  await assert.rejects(readFile(join(stateDirectory, 'runtime.json')), { code: 'ENOENT' });
});

test('unsupported Project setting fails before start creates runtime state', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-unknown-start-project-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = join(directory, 'project.toml');
  const stateDirectory = join(directory, 'state');
  await writeFile(configPath, [
    'github_repository_url = "https://github.com/example/repository.git"',
    'github_base_branch = "main"',
    'workflow_path = "WORKFLOW.md"',
    'symphony_workspace_root = ".runtime/workspaces"',
    `state_directory = ${JSON.stringify(stateDirectory)}`,
    'ui_prt = 4311'
  ].join('\n'));

  await assert.rejects(
    execFile(process.execPath, [join(root, 'operator/app/leesh-loop.mjs'), 'start', configPath], { timeout: 10_000 }),
    error => {
      assert.equal(error.stdout, '');
      assert.match(error.stderr, /unknown Project setting: ui_prt/);
      return true;
    }
  );
  await assert.rejects(readFile(join(stateDirectory, 'runtime.json')), { code: 'ENOENT' });
});
