import assert from 'node:assert/strict';
import { execFile as execute } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { initLoop } from '../init.mjs';
import { RUNTIME_SNAPSHOT_PATHS, listRuntimeSnapshotFiles } from '../runtime-manifest.mjs';
import { githubRepositoryTransport } from '../github-repository-url.mjs';

const execFile = promisify(execute);
const sourceRoot = resolve(import.meta.dirname, '../../..');

async function git(cwd, ...args) {
  return execFile('git', args, { cwd, encoding: 'utf8' });
}

async function makeTarget(t, { upstream = true, remoteUrl = 'https://github.com/example/sample-repository.git' } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-init-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const targetRoot = join(directory, 'sample-repository');
  await mkdir(targetRoot);
  await git(targetRoot, 'init', '--quiet', '-b', 'feature/init-target');
  await git(targetRoot, 'config', 'user.name', 'Init Test');
  await git(targetRoot, 'config', 'user.email', 'init-test@example.invalid');
  await writeFile(join(targetRoot, 'README.md'), '# Target\n');
  await git(targetRoot, 'add', 'README.md');
  await git(targetRoot, 'commit', '--quiet', '-m', 'initial target');
  if (upstream) {
    await git(targetRoot, 'remote', 'add', 'review', remoteUrl);
    const head = (await git(targetRoot, 'rev-parse', 'HEAD')).stdout.trim();
    await git(targetRoot, 'update-ref', 'refs/remotes/review/releases/2026/init', head);
    await git(targetRoot, 'config', 'branch.feature/init-target.remote', 'review');
    await git(targetRoot, 'config', 'branch.feature/init-target.merge', 'refs/heads/releases/2026/init');
  }
  return { directory, targetRoot, destination: join(directory, 'sample-repository-loop') };
}

async function makeBrokenSource(t) {
  const root = await mkdtemp(join(tmpdir(), 'leesh-loop-broken-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, 'init', '--quiet');
  await git(root, 'config', 'user.name', 'Init Test');
  await git(root, 'config', 'user.email', 'init-test@example.invalid');
  for (const entry of RUNTIME_SNAPSHOT_PATHS) {
    if (entry.endsWith('/')) {
      const file = join(root, `${entry}fixture.txt`);
      await mkdir(join(file, '..'), { recursive: true });
      await writeFile(file, 'fixture\n');
    } else {
      const file = join(root, entry);
      await mkdir(join(file, '..'), { recursive: true });
      if (entry === 'operator/app/leesh-loop.mjs') await symlink('missing-source-target', file);
      else await writeFile(file, 'fixture\n');
    }
  }
  await mkdir(join(root, 'docs'), { recursive: true });
  await writeFile(join(root, 'docs/WORKFLOW_TEMPLATE.md'), '# Reusable template\n');
  await git(root, 'add', '-A');
  return root;
}

async function walk(root, relative = '') {
  const directory = join(root, relative);
  const entries = await (await import('node:fs/promises')).readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await walk(root, child));
    else result.push(child);
  }
  return result.sort();
}

test('init uses only the current branch configured upstream and creates an independent Loop snapshot', async t => {
  const target = await makeTarget(t);
  const before = (await git(target.targetRoot, 'status', '--porcelain')).stdout;
  const result = await initLoop({ cwd: target.targetRoot, sourceRoot, environment: {} });
  const project = JSON.parse(await readFile(join(target.destination, 'operator/project.json'), 'utf8'));
  const generatedPackage = JSON.parse(await readFile(join(target.destination, 'package.json'), 'utf8'));
  const workflow = await readFile(join(target.destination, 'WORKFLOW.md'), 'utf8');
  const files = await walk(target.destination);
  const manifestFiles = listRuntimeSnapshotFiles(sourceRoot);

  assert.equal(result.target.remoteName, 'review');
  assert.equal(result.target.remoteUrl, 'https://github.com/example/sample-repository.git');
  assert.equal(result.target.upstreamBranch, 'releases/2026/init');
  assert.equal(project.github_repository_url, result.target.remoteUrl);
  assert.equal(project.github_base_branch, 'releases/2026/init');
  assert.equal(project.codex_model, 'gpt-6-luna');
  assert.equal(project.codex_reasoning_effort, 'xhigh');
  assert.equal(project.workflow_path, '../WORKFLOW.md');
  assert.equal(resolve(target.destination, 'operator', project.symphony_workspace_root), join(target.destination, '.runtime/workspaces'));
  assert.equal(resolve(target.destination, 'operator', project.state_directory), join(target.destination, '.runtime/state'));
  assert.equal(generatedPackage.scripts.stop, 'node operator/app/leesh-loop.mjs stop operator/project.json');
  assert.match(generatedPackage.scripts.start, /operator\/app\/prepare-runtime\.mjs/);
  assert.deepEqual(Object.keys(generatedPackage.scripts).sort(), ['start', 'stop']);
  assert.equal(result.workflowPath, join(target.destination, 'WORKFLOW.md'));
  assert.equal(result.notionBinding, 'not configured');
  assert.match(result.completionOutput, /Notion database binding: not configured/);
  assert.match(result.completionOutput, /set LEESH_LOOP_NOTION_DATABASE_URL/);
  assert.match(result.completionOutput, /npm start/);
  assert.doesNotMatch(result.completionOutput, /npm (?:install|ci)|mix deps\.get/);
  assert.match(workflow, /chatgpt-shot submit/);
  assert.match(workflow, /chatgpt-shot jobs/);
  assert.match(workflow, /take up to 3 minutes.*execution timeout longer than 3 minutes/);
  assert.match(workflow, /\{\{ issue\.identifier \}\}/);
  assert.match(workflow, /\{\{ issue\.title \}\}/);
  assert.match(workflow, /\{\{ issue\.state \}\}/);
  assert.match(workflow, /\{\{ issue\.url \}\}/);
  assert.match(workflow, /\{\{ issue\.description \}\}/);
  assert.match(workflow, /git clone --branch "\$SYMPHONY_GITHUB_BASE_BRANCH"/);
  assert.match(workflow, /create the task branch from that fetched remote commit/);
  assert.match(workflow, /Create the PR with an explicit configured base/);
  assert.match(workflow, /never push or merge directly into the configured base/);
  assert.match(workflow, /Follow the repository-owned workflow or task instructions for Workpad language/);
  assert.doesNotMatch(workflow, /Korean Workpad|Workpad in Korean/);
  assert.doesNotMatch(workflow, /operator\/app\/workspace-files\.mjs|operator\/e2e|mise exec -- mix deps\.get/);
  assert.ok(files.includes('operator/notion_publisher/package-lock.json'));
  assert.ok(files.includes('operator/ui/package-lock.json'));
  assert.ok(files.includes('operator/symphony/mix.lock'));
  assert.ok(files.includes('operator/symphony/mise.toml'));
  assert.ok(files.includes('operator/external/chatgpt-shot/chatgpt-shot'));
  assert.ok(files.includes('operator/app/prepare-runtime.mjs'));
  assert.ok((await stat(join(target.destination, 'operator/app/operator-bootstrap'))).mode & 0o111);
  const prepareRuntime = await readFile(join(target.destination, 'operator/app/prepare-runtime.mjs'), 'utf8');
  assert.match(prepareRuntime, /mise.*mix.*deps\.get/);
  for (const file of files) assert.ok(!(await lstat(join(target.destination, file))).isSymbolicLink(), `${file} must be materialized, not linked`);
  const generatedInputs = [generatedPackage, project, workflow, prepareRuntime].map(value => typeof value === 'string' ? value : JSON.stringify(value)).join('\n');
  assert.equal(generatedInputs.includes(sourceRoot), false);
  assert.ok(!files.some(file => file.includes('/test/') || file.startsWith('docs/') || file.startsWith('operator/e2e/')));
  assert.ok(!files.some(file => file.endsWith('node_modules') || file.includes('/node_modules/')));
  assert.ok(!files.some(file => file === '.env'));
  assert.deepEqual(files.filter(file => !['.env.example', 'WORKFLOW.md', 'package.json', 'operator/project.json'].includes(file)), manifestFiles);
  assert.equal((await git(target.targetRoot, 'status', '--porcelain')).stdout, before);
});

test('the existing Operator configuration loader reads Notion binding from the generated Loop root', async t => {
  const target = await makeTarget(t);
  await initLoop({ cwd: target.targetRoot, sourceRoot, environment: {} });
  const generatedOperatorPath = pathToFileURL(join(target.destination, 'operator/app/leesh-loop.mjs')).href;
  const { loadConfig } = await import(generatedOperatorPath);
  const projectPath = join(target.destination, 'operator/project.json');
  const fromEnvironment = await loadConfig(projectPath, {
    validateWorkspaceFileSources: false,
    environment: { LEESH_LOOP_NOTION_DATABASE_URL: 'https://www.notion.so/example/environment-binding' }
  });
  assert.equal(fromEnvironment.notion_database_url, 'https://www.notion.so/example/environment-binding');

  await writeFile(join(target.destination, '.env'), 'LEESH_LOOP_NOTION_DATABASE_URL=https://www.notion.so/example/root-binding\n');
  const fromLoopEnvFile = await loadConfig(projectPath, { validateWorkspaceFileSources: false, environment: {} });
  assert.equal(fromLoopEnvFile.notion_database_url, 'https://www.notion.so/example/root-binding');

  const processBoundTarget = await makeTarget(t);
  const processBoundUrl = 'https://www.notion.so/example/never-write-this-value';
  const processBoundResult = await initLoop({
    cwd: processBoundTarget.targetRoot,
    sourceRoot,
    environment: { LEESH_LOOP_NOTION_DATABASE_URL: processBoundUrl }
  });
  assert.match(processBoundResult.notionBinding, /configured in the init process environment/);
  assert.equal(processBoundResult.completionOutput.includes(processBoundUrl), false);
  assert.equal(await readFile(join(processBoundTarget.destination, '.env.example'), 'utf8').then(value => value.includes(processBoundUrl)), false);
  await assert.rejects(lstat(join(processBoundTarget.destination, '.env')), error => error.code === 'ENOENT');
});

test('init fails without a resolvable configured upstream and leaves no destination', async t => {
  const target = await makeTarget(t, { upstream: false });
  await assert.rejects(
    initLoop({ cwd: target.targetRoot, sourceRoot, environment: {} }),
    /current branch 'feature\/init-target' has no configured Git upstream/
  );
  await assert.rejects(lstat(target.destination), error => error.code === 'ENOENT');
  assert.equal((await git(target.targetRoot, 'status', '--porcelain')).stdout, '');
});

test('destination collision fails without changing existing content or type', async t => {
  const target = await makeTarget(t);
  await mkdir(target.destination);
  await writeFile(join(target.destination, 'operator-owned.txt'), 'keep\n');
  const before = await walk(target.destination);
  await assert.rejects(
    initLoop({ cwd: target.targetRoot, sourceRoot, environment: {} }),
    /destination already exists; refusing to change it/
  );
  assert.deepEqual(await walk(target.destination), before);
  assert.equal(await readFile(join(target.destination, 'operator-owned.txt'), 'utf8'), 'keep\n');
});

test('file and symlink destination collisions are rejected without following or changing them', async t => {
  const fileTarget = await makeTarget(t);
  await writeFile(fileTarget.destination, 'keep file\n');
  await assert.rejects(initLoop({ cwd: fileTarget.targetRoot, sourceRoot, environment: {} }), /destination already exists/);
  assert.equal(await readFile(fileTarget.destination, 'utf8'), 'keep file\n');

  const symlinkTarget = await makeTarget(t);
  const protectedFile = join(symlinkTarget.directory, 'protected-data.txt');
  await writeFile(protectedFile, 'keep target\n');
  await symlink(protectedFile, symlinkTarget.destination);
  await assert.rejects(initLoop({ cwd: symlinkTarget.targetRoot, sourceRoot, environment: {} }), /destination already exists/);
  assert.equal((await lstat(symlinkTarget.destination)).isSymbolicLink(), true);
  assert.equal(await readFile(protectedFile, 'utf8'), 'keep target\n');
});

test('failure after destination creation removes the partial Loop so init can be retried', async t => {
  const target = await makeTarget(t);
  const brokenSource = await makeBrokenSource(t);
  await assert.rejects(
    initLoop({ cwd: target.targetRoot, sourceRoot: brokenSource, environment: {} }),
    /runtime snapshot source is not a regular file: operator\/app\/leesh-loop\.mjs/
  );
  await assert.rejects(lstat(target.destination), error => error.code === 'ENOENT');
  assert.equal((await git(target.targetRoot, 'status', '--porcelain')).stdout, '');

  await initLoop({ cwd: target.targetRoot, sourceRoot, environment: {} });
  assert.equal(JSON.parse(await readFile(join(target.destination, 'operator/project.json'), 'utf8')).github_base_branch, 'releases/2026/init');
});

test('runtime snapshot selection is a tracked whitelist and preserves executable entry points', async t => {
  const files = listRuntimeSnapshotFiles(sourceRoot);
  assert.ok(files.includes('operator/app/operator-bootstrap'));
  assert.ok(files.includes('operator/app/run-symphony'));
  assert.ok(!files.some(file => file.startsWith('operator/app/test/')));
  assert.ok(!files.some(file => file.startsWith('operator/symphony/test/')));
  assert.ok(!files.some(file => file.startsWith('operator/e2e/')));
  assert.ok(!files.some(file => file.startsWith('docs/plans/')));
});

test('one GitHub repository URL policy accepts the supported HTTPS and SSH transports', () => {
  assert.equal(githubRepositoryTransport('https://github.com/example/repository.git'), 'https');
  assert.equal(githubRepositoryTransport('git@github.com:example/repository.git'), 'ssh');
  assert.equal(githubRepositoryTransport('ssh://git@github.com/example/repository.git'), 'ssh');
  assert.throws(() => githubRepositoryTransport('https://user:token@github.com/example/repository.git'), /contains credentials/);
  assert.throws(() => githubRepositoryTransport('https://gitlab.com/example/repository.git'), /requires a GitHub repository/);
  assert.throws(() => githubRepositoryTransport('git@github.com:example'), /requires an HTTPS or SSH GitHub upstream URL/);
});
