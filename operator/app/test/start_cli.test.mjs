import assert from 'node:assert/strict';
import { execFile as execute } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import test from 'node:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { configureTaskStoreEnvironment, effective, loadConfig, operatorBootstrapArgs, parseStartArguments, startConfiguration } from '../leesh-loop.mjs';

const execFile = promisify(execute);
const root = join(import.meta.dirname, '../../..');

test('start:fast uses the same start command and project config with the existing readiness skip', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const normalInvocation = manifest.scripts.start.split(' ');
  const fastInvocation = manifest.scripts['start:fast'].split(' ');

  assert.deepEqual(normalInvocation.slice(0, 3), fastInvocation.slice(0, 3));
  assert.equal(normalInvocation[2], 'start');
  assert.deepEqual(fastInvocation.slice(3), ['project.toml', '--skip-external-readiness']);
  assert.equal(parseStartArguments([]).configurationPath, join(root, 'project.toml'));

  const normal = parseStartArguments(normalInvocation.slice(3));
  const fast = parseStartArguments(fastInvocation.slice(3));
  assert.equal(normal.configurationPath, fast.configurationPath);
  assert.equal(normal.skipExternalReadiness, false);
  assert.equal(fast.skipExternalReadiness, true);

  const projectConfig = { workflow_path: '/tmp/workflow.md', skip_external_readiness: false };
  const normalConfig = startConfiguration(projectConfig, normal);
  const fastConfig = startConfiguration(projectConfig, fast);
  const normalIdentity = effective(normalConfig, 'same-runtime', 4100);
  const fastIdentity = effective(fastConfig, 'same-runtime', 4100);
  assert.deepEqual({ ...fastIdentity, skip_external_readiness: normalIdentity.skip_external_readiness }, normalIdentity);
  const normalBootstrapArgs = operatorBootstrapArgs(normalConfig, '/tmp/symphony', 4100);
  const fastBootstrapArgs = operatorBootstrapArgs(fastConfig, '/tmp/symphony', 4100);
  assert.deepEqual(normalBootstrapArgs.slice(1, 2), ['--']);
  assert.deepEqual(fastBootstrapArgs.slice(1, 3), ['--skip-external-readiness', '--']);
  assert.deepEqual(fastBootstrapArgs.filter(argument => argument !== '--skip-external-readiness'), normalBootstrapArgs);
});

test('a Local Project needs no Notion binding and passes only its Local Task Store path to Symphony', async t => {
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
    'task_store = "local"'
  ].join('\n') + '\n');

  const config = await loadConfig(configPath, { environment: {}, envFile: join(directory, 'missing.env') });
  assert.equal(config.task_store, 'local');
  assert.equal(config.notion_database_url, undefined);
  const localIdentity = effective(config, 'local-runtime', 4100);
  assert.equal(localIdentity.local_task_store_path, join(stateDirectory, 'local-task-store', 'local-task-store.sqlite'));

  const localEnvironment = configureTaskStoreEnvironment({}, config.task_store, localIdentity.local_task_store_path, root);
  assert.equal(localEnvironment.LEESH_LOOP_TRACKER_KIND, 'local');
  assert.equal(localEnvironment.LEESH_LOOP_LOCAL_TASK_STORE_PATH, localIdentity.local_task_store_path);
  assert.equal(localEnvironment.LEESH_LOOP_RUNTIME_ROOT, root);

  const notionEnvironment = configureTaskStoreEnvironment({ LEESH_LOOP_LOCAL_TASK_STORE_PATH: localIdentity.local_task_store_path }, 'notion', localIdentity.local_task_store_path, root);
  assert.equal(notionEnvironment.LEESH_LOOP_TRACKER_KIND, 'notion');
  assert.equal(Object.hasOwn(notionEnvironment, 'LEESH_LOOP_LOCAL_TASK_STORE_PATH'), false);
});

test('start rejects malformed fast-start arguments before treating an option as a config path', async () => {
  await assert.rejects(
    execFile('npm', ['run', 'start:fast', '--', '/tmp/custom-project.toml', 'unexpected'], { cwd: root }),
    error => {
      assert.equal(error.code, 2);
      assert.match(error.stderr, /start accepts at most one project configuration path/);
      assert.doesNotMatch(error.stderr, /missing or invalid project configuration/);
      return true;
    }
  );
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
