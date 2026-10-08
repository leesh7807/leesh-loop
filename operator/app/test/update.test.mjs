import assert from 'node:assert/strict';
import { execFile as execute } from 'node:child_process';
import { appendFile, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { initLoop, generatedWorkflow } from '../init.mjs';
import { updateLoop } from '../update.mjs';
import { readInstallationMetadata, writeInstallationMetadata } from '../installation-metadata.mjs';
import { listRuntimeSnapshotFiles } from '../runtime-manifest.mjs';

const execFile = promisify(execute);
const sourceRoot = resolve(import.meta.dirname, '../../..');

async function git(cwd, ...args) {
  return execFile('git', args, { cwd, encoding: 'utf8' });
}

async function makeTarget(t) {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-update-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const targetRoot = join(directory, 'sample-repository');
  await mkdir(targetRoot);
  await git(targetRoot, 'init', '--quiet', '-b', 'feature/update-target');
  await git(targetRoot, 'config', 'user.name', 'Update Test');
  await git(targetRoot, 'config', 'user.email', 'update-test@example.invalid');
  await writeFile(join(targetRoot, 'README.md'), '# Target\n');
  await git(targetRoot, 'add', 'README.md');
  await git(targetRoot, 'commit', '--quiet', '-m', 'initial target');
  await git(targetRoot, 'remote', 'add', 'origin', 'https://github.com/example/sample-repository.git');
  const head = (await git(targetRoot, 'rev-parse', 'HEAD')).stdout.trim();
  await git(targetRoot, 'update-ref', 'refs/remotes/origin/main', head);
  await git(targetRoot, 'config', 'branch.feature/update-target.remote', 'origin');
  await git(targetRoot, 'config', 'branch.feature/update-target.merge', 'refs/heads/main');
  return { directory, targetRoot, destination: join(directory, 'sample-repository-loop') };
}

async function createLoop(t) {
  const target = await makeTarget(t);
  await initLoop({ cwd: target.targetRoot, sourceRoot, environment: {} });
  return target;
}

async function makeCurrentDistribution(t) {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-distribution-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await git(directory, 'init', '--quiet', '-b', 'snapshot');
  await git(directory, 'config', 'user.name', 'Distribution Test');
  await git(directory, 'config', 'user.email', 'distribution-test@example.invalid');
  for (const file of listRuntimeSnapshotFiles(sourceRoot)) {
    const source = join(sourceRoot, file);
    const destination = join(directory, file);
    await mkdir(join(destination, '..'), { recursive: true });
    await copyFile(source, destination);
  }
  await appendFile(join(directory, 'operator/app/leesh-loop.mjs'), '\n// changed in the update distribution fixture\n');
  const addedFile = join(directory, 'operator/ui/src/update-distribution.js');
  await writeFile(addedFile, 'export const distributionUpdate = true;\n');
  await git(directory, 'add', '-A');
  return directory;
}

async function walk(root, relative = '') {
  const directory = join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await walk(root, child));
    else result.push(child);
  }
  return result.sort();
}

async function bytes(path) {
  try { return await readFile(path); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

async function captureFiles(root, omit = new Set()) {
  const result = new Map();
  for (const file of await walk(root)) {
    if (omit.has(file)) continue;
    result.set(file, await readFile(join(root, file)));
  }
  return result;
}

function assertCapturedFilesEqual(before, after) {
  assert.deepEqual([...after.keys()], [...before.keys()]);
  for (const [path, content] of before) assert.deepEqual(after.get(path), content, `${path} changed`);
}

async function addProtectedAndPersistentFiles(loopRoot) {
  const protectedContents = new Map();
  for (const [name, contents] of [
    ['.env', 'LOCAL_SECRET=fixture\n'],
    ['.env.example', 'LOCAL_EXAMPLE=fixture\n']
  ]) {
    const path = join(loopRoot, name);
    await writeFile(path, contents);
    protectedContents.set(name, await readFile(path));
  }
  const projectPath = join(loopRoot, 'project.toml');
  await writeFile(projectPath, `${await readFile(projectPath, 'utf8')}\n# local project configuration\n`);
  protectedContents.set('project.toml', await readFile(projectPath));
  await mkdir(join(loopRoot, '.runtime/workspaces/task-1'), { recursive: true });
  await mkdir(join(loopRoot, '.runtime/state'), { recursive: true });
  await writeFile(join(loopRoot, '.runtime/workspaces/task-1/README.md'), 'workspace state\n');
  await writeFile(join(loopRoot, '.runtime/state/operator.json'), '{"running":false}\n');
  return protectedContents;
}

async function assertProtectedAndPersistentFiles(loopRoot, expected) {
  for (const [name, content] of expected) assert.deepEqual(await readFile(join(loopRoot, name)), content);
  assert.equal(await readFile(join(loopRoot, '.runtime/workspaces/task-1/README.md'), 'utf8'), 'workspace state\n');
  assert.equal(await readFile(join(loopRoot, '.runtime/state/operator.json'), 'utf8'), '{"running":false}\n');
}

test('runtime update replaces runtime files, restores missing files, removes old managed files, and preserves instance data', async t => {
  const target = await createLoop(t);
  const loopRoot = target.destination;
  const protectedContents = await addProtectedAndPersistentFiles(loopRoot);
  const targetStatus = (await git(target.targetRoot, 'status', '--porcelain')).stdout;
  const workflowBefore = await readFile(join(loopRoot, 'WORKFLOW.md'));
  const runtimeFile = 'operator/app/leesh-loop.mjs';
  const restoredFile = 'operator/app/workspace-files.mjs';
  const staleFile = 'operator/app/old-runtime-file.mjs';
  const expectedRuntime = await readFile(join(sourceRoot, runtimeFile));
  const expectedRestored = await readFile(join(sourceRoot, restoredFile));
  await writeFile(join(loopRoot, runtimeFile), 'local runtime edit\n');
  await rm(join(loopRoot, restoredFile));
  await writeFile(join(loopRoot, staleFile), 'old deployment file\n');
  const metadata = await readInstallationMetadata(loopRoot);
  metadata.runtime.managedFiles.push(staleFile);
  await writeInstallationMetadata(loopRoot, metadata);

  const first = await updateLoop({ cwd: loopRoot, sourceRoot });
  assert.equal(first.area, 'runtime');
  assert.deepEqual(await readFile(join(loopRoot, runtimeFile)), expectedRuntime);
  assert.deepEqual(await readFile(join(loopRoot, restoredFile)), expectedRestored);
  assert.equal(await bytes(join(loopRoot, staleFile)), null);
  assert.deepEqual(await readFile(join(loopRoot, 'WORKFLOW.md')), workflowBefore);
  await assertProtectedAndPersistentFiles(loopRoot, protectedContents);
  assert.equal((await git(target.targetRoot, 'status', '--porcelain')).stdout, targetStatus);

  const manifest = JSON.parse(await readFile(join(loopRoot, 'package.json'), 'utf8'));
  const lockBytes = await readFile(join(loopRoot, 'package-lock.json'));
  const lock = JSON.parse(lockBytes);
  assert.equal(lock.name, manifest.name);
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[''].name, manifest.name);
  const metadataAfterFirst = await readInstallationMetadata(loopRoot);
  assert.equal(first.distributionId, metadata.runtime.distributionId, 'init and update must identify the same distribution');
  assert.equal(metadataAfterFirst.runtime.distributionId, first.distributionId);
  assert.deepEqual(metadataAfterFirst.workflow, metadata.workflow);

  const env = {
    ...process.env,
    HOME: target.directory,
    XDG_CACHE_HOME: join(target.directory, 'xdg-cache'),
    npm_config_cache: join(target.directory, 'npm-cache')
  };
  await execFile('npm', ['ci', '--ignore-scripts', '--offline'], { cwd: loopRoot, env });
  assert.deepEqual(await readFile(join(loopRoot, 'package-lock.json')), lockBytes, 'npm ci must not rewrite the generated lockfile');

  const treeAfterFirst = await captureFiles(loopRoot);
  const second = await updateLoop({ cwd: loopRoot, sourceRoot });
  assert.equal(second.distributionId, first.distributionId);
  assertCapturedFilesEqual(treeAfterFirst, await captureFiles(loopRoot));
});

test('runtime update adopts files added to the current manifest and content from a newer distribution', async t => {
  const target = await createLoop(t);
  const nextDistribution = await makeCurrentDistribution(t);
  const loopRoot = target.destination;
  const previousDistributionId = (await readInstallationMetadata(loopRoot)).runtime.distributionId;
  const updatedRuntime = 'operator/app/leesh-loop.mjs';
  const addedRuntime = 'operator/ui/src/update-distribution.js';
  const expectedRuntime = await readFile(join(nextDistribution, updatedRuntime));
  const expectedAdded = await readFile(join(nextDistribution, addedRuntime));

  const result = await updateLoop({ cwd: loopRoot, sourceRoot: nextDistribution });
  assert.notEqual(result.distributionId, previousDistributionId);
  assert.deepEqual(await readFile(join(loopRoot, updatedRuntime)), expectedRuntime);
  assert.deepEqual(await readFile(join(loopRoot, addedRuntime)), expectedAdded);
  assert.ok((await readInstallationMetadata(loopRoot)).runtime.managedFiles.includes(addedRuntime));
});

test('workflow-only update replaces the generated workflow and leaves runtime, package, config, and state unchanged', async t => {
  const target = await createLoop(t);
  const loopRoot = target.destination;
  const protectedContents = await addProtectedAndPersistentFiles(loopRoot);
  const projectPath = join(loopRoot, 'project.toml');
  const customProject = (await readFile(projectPath, 'utf8')).replace('workflow_path = "WORKFLOW.md"', 'workflow_path = "custom-workflow.md"');
  assert.notEqual(customProject, await readFile(projectPath, 'utf8'));
  await writeFile(projectPath, customProject);
  protectedContents.set('project.toml', await readFile(projectPath));
  await writeFile(join(loopRoot, 'custom-workflow.md'), '# project-specific worker contract\n');
  const customWorkflow = await readFile(join(loopRoot, 'custom-workflow.md'));
  await writeFile(join(loopRoot, 'WORKFLOW.md'), '# local workflow changes\n');
  const runtimeBefore = await captureFiles(loopRoot, new Set(['WORKFLOW.md', '.leesh-loop/installation.json']));
  const metadataBefore = await readInstallationMetadata(loopRoot);
  const workflow = generatedWorkflow(await readFile(join(sourceRoot, 'docs/WORKFLOW_TEMPLATE.md'), 'utf8'));

  const result = await updateLoop({ cwd: loopRoot, sourceRoot, workflowOnly: true });
  assert.equal(result.area, 'workflow');
  assert.equal(await readFile(join(loopRoot, 'WORKFLOW.md'), 'utf8'), workflow);
  assert.deepEqual(await readFile(join(loopRoot, 'custom-workflow.md')), customWorkflow);
  assertCapturedFilesEqual(runtimeBefore, await captureFiles(loopRoot, new Set(['WORKFLOW.md', '.leesh-loop/installation.json'])));
  await assertProtectedAndPersistentFiles(loopRoot, protectedContents);
  const metadataAfter = await readInstallationMetadata(loopRoot);
  assert.deepEqual(metadataAfter.runtime, metadataBefore.runtime);
  assert.equal(metadataAfter.workflow.distributionId, result.distributionId);
  assert.deepEqual(metadataAfter.workflow.managedFiles, ['WORKFLOW.md']);
  const filesAfterFirst = await captureFiles(loopRoot);
  const repeated = await updateLoop({ cwd: loopRoot, sourceRoot, workflowOnly: true });
  assert.equal(repeated.distributionId, result.distributionId);
  assertCapturedFilesEqual(filesAfterFirst, await captureFiles(loopRoot));
});

test('runtime and workflow updates can run independently in either order', async t => {
  const target = await createLoop(t);
  const loopRoot = target.destination;
  const runtimePath = join(loopRoot, 'operator/app/leesh-loop.mjs');
  await writeFile(runtimePath, 'local runtime change\n');
  await updateLoop({ cwd: loopRoot, sourceRoot, workflowOnly: true });
  assert.equal(await readFile(runtimePath, 'utf8'), 'local runtime change\n');
  const workflowAfterWorkflowUpdate = await readFile(join(loopRoot, 'WORKFLOW.md'));
  await updateLoop({ cwd: loopRoot, sourceRoot });
  assert.deepEqual(await readFile(join(loopRoot, 'WORKFLOW.md')), workflowAfterWorkflowUpdate);
  assert.deepEqual(await readFile(runtimePath), await readFile(join(sourceRoot, 'operator/app/leesh-loop.mjs')));
});

test('legacy init layout can update without metadata when its ownership structure is identifiable', async t => {
  const target = await createLoop(t);
  const loopRoot = target.destination;
  await rm(join(loopRoot, '.leesh-loop/installation.json'));
  await rm(join(loopRoot, '.leesh-loop'), { recursive: true });
  await rm(join(loopRoot, 'package-lock.json'));
  await updateLoop({ cwd: loopRoot, sourceRoot });
  const metadata = await readInstallationMetadata(loopRoot);
  assert.ok(metadata.runtime);
  assert.deepEqual(metadata.runtime.managedFiles, (await import('../runtime-manifest.mjs')).listRuntimeSnapshotFiles(sourceRoot));
  const packageManifest = JSON.parse(await readFile(join(loopRoot, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(await readFile(join(loopRoot, 'package-lock.json'), 'utf8'));
  assert.equal(packageLock.name, packageManifest.name);
});

test('legacy update refuses an unrecorded file that cannot be proven runtime-owned', async t => {
  const target = await createLoop(t);
  const loopRoot = target.destination;
  await rm(join(loopRoot, '.leesh-loop'), { recursive: true });
  await rm(join(loopRoot, 'package-lock.json'));
  const localFile = 'operator/ui/src/local-note.js';
  await writeFile(join(loopRoot, localFile), 'preserve this local file\n');
  const before = await captureFiles(loopRoot);

  await assert.rejects(updateLoop({ cwd: loopRoot, sourceRoot }), /cannot safely identify legacy runtime ownership/);
  assertCapturedFilesEqual(before, await captureFiles(loopRoot));
});

test('an interrupted runtime update can be retried from its pending journal', async t => {
  const target = await createLoop(t);
  const loopRoot = target.destination;
  const metadata = await readInstallationMetadata(loopRoot);
  const currentDistribution = metadata.runtime.distributionId;
  metadata.runtime.distributionId = 'previous-distribution';
  await writeInstallationMetadata(loopRoot, metadata);
  const managedPath = 'operator/app/workspace-files.mjs';
  await rm(join(loopRoot, managedPath));
  await writeFile(join(loopRoot, '.leesh-loop/update.json'), `${JSON.stringify({
    schemaVersion: 1,
    area: 'runtime',
    distributionId: currentDistribution,
    previousDistributionId: 'previous-distribution',
    priorManagedFiles: metadata.runtime.managedFiles,
    nextManagedFiles: metadata.runtime.managedFiles,
    transactionId: '8b334734-2738-41d5-8b5f-34313867b41c'
  }, null, 2)}\n`);

  const result = await updateLoop({ cwd: loopRoot, sourceRoot });
  assert.equal(result.distributionId, currentDistribution);
  assert.deepEqual(await readFile(join(loopRoot, managedPath)), await readFile(join(sourceRoot, managedPath)));
  assert.equal(await bytes(join(loopRoot, '.leesh-loop/update.json')), null);
  assert.equal((await readInstallationMetadata(loopRoot)).runtime.distributionId, currentDistribution);
});

test('ordinary directories, invalid sources, and symlink collisions fail without changing protected data', async t => {
  const target = await createLoop(t);
  const loopRoot = target.destination;
  const protectedContents = await addProtectedAndPersistentFiles(loopRoot);
  const unrelated = join(target.directory, 'ordinary-directory');
  await mkdir(unrelated);
  await writeFile(join(unrelated, 'README.md'), 'leave alone\n');
  await assert.rejects(updateLoop({ cwd: unrelated, sourceRoot }), /project.toml|generated Loop/);
  await assert.rejects(updateLoop({ cwd: loopRoot, sourceRoot: join(target.directory, 'missing-source') }), /installed leesh-loop distribution/);
  await assertProtectedAndPersistentFiles(loopRoot, protectedContents);

  const badSource = join(target.directory, 'bad-workflow-source');
  const externalTemplate = join(target.directory, 'outside-template.md');
  await mkdir(join(badSource, 'docs'), { recursive: true });
  await writeFile(join(badSource, 'package.json'), '{"name":"leesh-loop","version":"0.1.0"}\n');
  await writeFile(externalTemplate, '# outside template\n');
  await symlink(externalTemplate, join(badSource, 'docs/WORKFLOW_TEMPLATE.md'));
  const beforeInvalidSource = await captureFiles(loopRoot);
  await assert.rejects(updateLoop({ cwd: loopRoot, sourceRoot: badSource, workflowOnly: true }), /distribution source contains a symlink/);
  assertCapturedFilesEqual(beforeInvalidSource, await captureFiles(loopRoot));

  const managedPath = join(loopRoot, 'operator/app/workspace-files.mjs');
  const original = await readFile(managedPath);
  const outside = join(target.directory, 'outside-target.txt');
  await writeFile(outside, 'outside bytes\n');
  await rm(managedPath);
  await symlink(outside, managedPath);
  await assert.rejects(updateLoop({ cwd: loopRoot, sourceRoot }), /symlink/);
  assert.equal(await readFile(outside, 'utf8'), 'outside bytes\n');
  assert.equal((await lstat(managedPath)).isSymbolicLink(), true);
  assertProtectedAndPersistentFiles(loopRoot, protectedContents);
  await rm(managedPath);
  await writeFile(managedPath, original);
});

test('installed CLI accepts the two update forms and rejects unsupported options before mutation', async t => {
  const target = await createLoop(t);
  const loopRoot = target.destination;
  const cli = join(sourceRoot, 'bin/leesh-loop.mjs');
  await writeFile(join(loopRoot, 'WORKFLOW.md'), '# CLI local workflow\n');
  const before = await captureFiles(loopRoot);
  await assert.rejects(execFile(process.execPath, [cli, 'update', '--force'], { cwd: loopRoot }), error => {
    assert.equal(error.code, 2);
    return true;
  });
  assertCapturedFilesEqual(before, await captureFiles(loopRoot));
  const workflowResult = await execFile(process.execPath, [cli, 'update', '--workflow'], { cwd: loopRoot });
  assert.match(workflowResult.stdout, /Leesh Loop workflow update applied/);
  const runtimeResult = await execFile(process.execPath, [cli, 'update'], { cwd: loopRoot });
  assert.match(runtimeResult.stdout, /Leesh Loop runtime update applied/);
});

test('actual init CLI creates the independent Loop and its install baseline without changing the target Git worktree', async t => {
  const target = await makeTarget(t);
  const cli = join(sourceRoot, 'bin/leesh-loop.mjs');
  const before = (await git(target.targetRoot, 'status', '--porcelain')).stdout;
  const result = await execFile(process.execPath, [cli, 'init'], { cwd: target.targetRoot });
  assert.match(result.stdout, /Leesh Loop is ready/);
  assert.ok(await lstat(join(target.destination, 'package-lock.json')));
  assert.ok(await lstat(join(target.destination, '.leesh-loop/installation.json')));
  assert.equal((await git(target.targetRoot, 'status', '--porcelain')).stdout, before);
  assert.equal((await readInstallationMetadata(target.destination)).runtime.managedFiles.includes('package-lock.json'), true);
});
