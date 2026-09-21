import assert from 'node:assert/strict';
import { copyFile, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { execFile as execute } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { compatible, effective, loadConfig, operatorBootstrapArgs } from '../leesh-loop.mjs';
import { materializeWorkspaceFiles, validateWorkspaceFiles } from '../workspace-files.mjs';

const execFile = promisify(execute);
const root = join(import.meta.dirname, '../../..');
const cli = join(root, 'operator', 'app', 'leesh-loop.mjs');
const workflow = join(root, 'WORKFLOW.md');

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-workspace-files-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const workspaceRoot = join(directory, 'workspaces');
  const workspace = join(workspaceRoot, 'new-workspace');
  await mkdir(workspace, { recursive: true });
  return { directory, workspaceRoot, workspace };
}

async function projectConfig(directory, workspaceRoot, workspaceFiles, skipExternalReadiness) {
  const path = join(directory, 'project.json');
  const config = {
    workflow_path: join(root, 'WORKFLOW.md'),
    notion_database_url: 'https://notion.example/database',
    symphony_workspace_root: workspaceRoot,
    github_repository_url: 'https://github.com/example/repository.git',
    github_base_branch: 'main'
  };
  if (workspaceFiles !== undefined) config.workspace_files = workspaceFiles;
  if (skipExternalReadiness !== undefined) config.skip_external_readiness = skipExternalReadiness;
  await writeFile(path, JSON.stringify(config));
  return path;
}

test('workspace-file configuration accepts omitted, empty, and absolute regular sources', async t => {
  const { directory, workspaceRoot } = await fixture(t);
  const source = join(directory, '.env');
  await writeFile(source, 'SENTINEL=workspace-file\n');
  for (const files of [undefined, [], [source]]) {
    const config = await loadConfig(await projectConfig(directory, workspaceRoot, files));
    assert.deepEqual(config.workspace_files, files === undefined ? [] : files);
  }
});

test('workspace-file configuration rejects invalid paths and destination collisions', async t => {
  const { directory, workspaceRoot } = await fixture(t);
  const source = join(directory, 'source');
  const otherDirectory = join(directory, 'directory');
  const first = join(directory, 'one', '.env');
  const second = join(directory, 'two', '.env');
  await mkdir(join(directory, 'one'), { recursive: true });
  await mkdir(join(directory, 'two'), { recursive: true });
  await mkdir(otherDirectory);
  await writeFile(source, 'source');
  await writeFile(first, 'one');
  await writeFile(second, 'two');
  await assert.rejects(loadConfig(await projectConfig(directory, workspaceRoot, ['relative.env'])), /must be an absolute path/);
  await assert.rejects(loadConfig(await projectConfig(directory, workspaceRoot, [join(directory, 'missing')])), /does not exist/);
  await assert.rejects(loadConfig(await projectConfig(directory, workspaceRoot, [otherDirectory])), /not a regular file/);
  await assert.rejects(loadConfig(await projectConfig(directory, workspaceRoot, [first, second])), /conflicting destination basename/);
});

test('external readiness skip configuration is boolean and defaults to performing readiness', async t => {
  const { directory, workspaceRoot } = await fixture(t);
  const configPath = await projectConfig(directory, workspaceRoot);
  const omitted = await loadConfig(configPath);
  assert.equal(omitted.skip_external_readiness, false);

  await writeFile(configPath, JSON.stringify({
    workflow_path: workflow,
    notion_database_url: 'https://notion.example/database',
    symphony_workspace_root: workspaceRoot,
    github_repository_url: 'https://github.com/example/repository.git',
    github_base_branch: 'main',
    skip_external_readiness: false
  }));
  const explicitFalse = await loadConfig(configPath);
  assert.equal(explicitFalse.skip_external_readiness, false);

  await writeFile(configPath, JSON.stringify({
    workflow_path: workflow,
    notion_database_url: 'https://notion.example/database',
    symphony_workspace_root: workspaceRoot,
    github_repository_url: 'https://github.com/example/repository.git',
    github_base_branch: 'main',
    skip_external_readiness: true
  }));
  const skipped = await loadConfig(configPath);
  assert.equal(skipped.skip_external_readiness, true);
  assert.notDeepEqual(effective(explicitFalse, 'same-runtime', 4100), effective(skipped, 'same-runtime', 4100));
  assert.equal(compatible(effective(explicitFalse, 'old-runtime', 4100), effective(skipped, 'new-runtime', 4100)), false);
  const legacyFalse = { ...effective(explicitFalse, 'legacy-runtime', 4100) };
  delete legacyFalse.skip_external_readiness;
  assert.equal(compatible(legacyFalse, effective(explicitFalse, 'new-runtime', 4100)), true);
  assert.deepEqual(operatorBootstrapArgs(skipped, '/tmp/symphony', 4100).slice(1, 3), ['--skip-external-readiness', '--']);
  assert.deepEqual(operatorBootstrapArgs(explicitFalse, '/tmp/symphony', 4100).slice(1, 2), ['--']);

  await writeFile(configPath, JSON.stringify({
    workflow_path: workflow,
    notion_database_url: 'https://notion.example/database',
    symphony_workspace_root: workspaceRoot,
    github_repository_url: 'https://github.com/example/repository.git',
    github_base_branch: 'main',
    skip_external_readiness: 'true'
  }));
  await assert.rejects(loadConfig(configPath), /skip_external_readiness must be a boolean/);
});

test('stop accepts an invalidated workspace-file source so a live runtime remains recoverable', async t => {
  const { directory, workspaceRoot } = await fixture(t);
  const missingSource = join(directory, '.env');
  const config = await projectConfig(directory, workspaceRoot, [missingSource]);
  const contents = JSON.parse(await readFile(config, 'utf8'));
  contents.state_directory = join(directory, 'runtime');
  await writeFile(config, JSON.stringify(contents));
  await execFile(process.execPath, [cli, 'stop', config]);
});

test('workspace files participate in effective runtime identity', async t => {
  const { directory, workspaceRoot } = await fixture(t);
  const first = join(directory, 'first');
  const second = join(directory, 'second');
  await writeFile(first, 'first');
  await writeFile(second, 'second');
  const configA = await loadConfig(await projectConfig(directory, workspaceRoot, [first]));
  const configB = await loadConfig(await projectConfig(directory, workspaceRoot, [second]));
  assert.notDeepEqual(effective(configA, 'same-runtime', 4100), effective(configB, 'same-runtime', 4100));
});

test('Git target binding is required and participates in effective runtime identity', async t => {
  const { directory, workspaceRoot } = await fixture(t);
  const configPath = await projectConfig(directory, workspaceRoot);
  const contents = JSON.parse(await readFile(configPath, 'utf8'));
  for (const key of ['github_repository_url', 'github_base_branch']) {
    const missing = { ...contents };
    delete missing[key];
    await writeFile(configPath, JSON.stringify(missing));
    await assert.rejects(loadConfig(configPath), new RegExp(`project configuration requires ${key}`));
  }

  await writeFile(configPath, JSON.stringify(contents));
  const baseChanged = { ...contents, github_base_branch: 'e2e/other-run' };
  const repositoryChanged = { ...contents, github_repository_url: 'https://github.com/other/repository.git' };
  const first = await loadConfig(configPath);
  await writeFile(configPath, JSON.stringify(baseChanged));
  const second = await loadConfig(configPath);
  await writeFile(configPath, JSON.stringify(repositoryChanged));
  const third = await loadConfig(configPath);
  assert.notDeepEqual(effective(first, 'same-runtime', 4100), effective(second, 'same-runtime', 4100));
  assert.notDeepEqual(effective(first, 'same-runtime', 4100), effective(third, 'same-runtime', 4100));
});

test('Git target binding rejects invalid branch names before startup', async t => {
  const { directory, workspaceRoot } = await fixture(t);
  const configPath = await projectConfig(directory, workspaceRoot);
  const contents = JSON.parse(await readFile(configPath, 'utf8'));
  contents.github_base_branch = 'invalid..branch';
  await writeFile(configPath, JSON.stringify(contents));
  await assert.rejects(loadConfig(configPath), /not a valid Git branch name/);
});

test('materializer copies bytes after clone without changing unrelated workspace content', async t => {
  const { directory, workspaceRoot, workspace } = await fixture(t);
  const source = join(directory, '.env');
  await writeFile(source, Buffer.from([0, 1, 2, 255]));
  await writeFile(join(workspace, 'cloned.txt'), 'clone output');
  await materializeWorkspaceFiles(workspace, await validateWorkspaceFiles([source]), workspaceRoot);
  assert.deepEqual(await readFile(join(workspace, '.env')), await readFile(source));
  assert.equal(await readFile(join(workspace, 'cloned.txt'), 'utf8'), 'clone output');
});

test('materializer never overwrites existing files, directories, or symlinks', async t => {
  const { directory, workspaceRoot, workspace } = await fixture(t);
  const source = join(directory, '.env');
  const target = join(directory, 'target');
  await writeFile(source, 'new');
  await writeFile(target, 'target');
  for (const setup of [
    async destination => writeFile(destination, 'existing'),
    async destination => mkdir(destination),
    async destination => symlink(target, destination),
    async destination => symlink(join(directory, 'missing-target'), destination)
  ]) {
    const destination = join(workspace, basename(source));
    await setup(destination);
    await assert.rejects(materializeWorkspaceFiles(workspace, [source], workspaceRoot), /already exists/);
    assert.equal((await lstat(destination)).isSymbolicLink() || (await lstat(destination)).isDirectory() || (await readFile(destination, 'utf8')) === 'existing', true);
    await rm(destination, { recursive: true, force: true });
  }
  assert.equal(await readFile(target, 'utf8'), 'target');
});

test('materializer rejects outside workspaces and sources invalidated after startup validation', async t => {
  const { directory, workspaceRoot, workspace } = await fixture(t);
  const source = join(directory, '.env');
  await writeFile(source, 'source');
  await assert.rejects(materializeWorkspaceFiles(directory, [source], workspaceRoot), /outside SYMPHONY_WORKSPACE_ROOT/);
  await validateWorkspaceFiles([source]);
  await rm(source);
  await assert.rejects(materializeWorkspaceFiles(workspace, [source], workspaceRoot), /does not exist/);
  await mkdir(source);
  await assert.rejects(materializeWorkspaceFiles(workspace, [source], workspaceRoot), /not a regular file/);
});

test('the actual after_create materialization command runs after clone and before bootstrap consumption', async t => {
  const { directory, workspaceRoot, workspace } = await fixture(t);
  const source = join(directory, '.env');
  const seed = join(directory, 'seed');
  const remote = join(directory, 'remote.git');
  await writeFile(source, 'AFTER_CREATE_SENTINEL\n');
  await mkdir(join(seed, 'operator', 'app'), { recursive: true });
  await copyFile(join(root, 'operator', 'app', 'workspace-files.mjs'), join(seed, 'operator', 'app', 'workspace-files.mjs'));
  await writeFile(join(seed, 'cloned.txt'), 'repository clone completed');
  await execFile('git', ['init', '--bare', remote]);
  await execFile('git', ['init'], { cwd: seed });
  await execFile('git', ['add', '.'], { cwd: seed });
  await execFile('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-m', 'fixture'], { cwd: seed });
  await execFile('git', ['remote', 'add', 'origin', remote], { cwd: seed });
  await execFile('git', ['push', 'origin', 'HEAD:main'], { cwd: seed });
  const contents = await readFile(workflow, 'utf8');
  assert.match(contents, /git clone --branch "\$SYMPHONY_GITHUB_BASE_BRANCH" "\$SYMPHONY_GITHUB_REPOSITORY_URL" \.\n    node operator\/app\/workspace-files\.mjs "\$PWD"\n    \(cd operator\/notion_publisher/);
  await execFile('sh', ['-ec', ': "${SYMPHONY_GITHUB_REPOSITORY_URL:?}"\n: "${SYMPHONY_GITHUB_BASE_BRANCH:?}"\ngit clone --branch "$SYMPHONY_GITHUB_BASE_BRANCH" "$SYMPHONY_GITHUB_REPOSITORY_URL" .\nnode operator/app/workspace-files.mjs "$PWD"\ntest "$(cat .env)" = AFTER_CREATE_SENTINEL\ntest "$(cat cloned.txt)" = "repository clone completed"', 'after_create'], {
    cwd: workspace,
    env: { ...process.env, SYMPHONY_WORKSPACE_ROOT: workspaceRoot, LEESH_LOOP_WORKSPACE_FILES: JSON.stringify([source]), SYMPHONY_GITHUB_REPOSITORY_URL: remote, SYMPHONY_GITHUB_BASE_BRANCH: 'main' }
  });
  assert.equal(await readFile(join(workspace, '.env'), 'utf8'), 'AFTER_CREATE_SENTINEL\n');
});

test('continuations preserve materialized files when a new runtime has a different file set', async t => {
  const { directory, workspaceRoot, workspace } = await fixture(t);
  const sourceA = join(directory, 'a.env');
  const sourceB = join(directory, 'b.env');
  await writeFile(sourceA, 'A');
  await writeFile(sourceB, 'B');
  await materializeWorkspaceFiles(workspace, [sourceA], workspaceRoot);
  assert.equal(await readFile(join(workspace, 'a.env'), 'utf8'), 'A');
  // A continuation does not call the after_create-only entry point.
  assert.equal(await readFile(join(workspace, 'a.env'), 'utf8'), 'A');
  await assert.rejects(lstat(join(workspace, 'b.env')));
  const newWorkspace = join(workspaceRoot, 'new-runtime-workspace');
  await mkdir(newWorkspace);
  await materializeWorkspaceFiles(newWorkspace, [sourceB], workspaceRoot);
  assert.equal(await readFile(join(newWorkspace, 'b.env'), 'utf8'), 'B');
});
