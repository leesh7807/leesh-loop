import assert from 'node:assert/strict';
import { execFile as execute } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { resolveProjectPath } from '../../local-path.mjs';
import { bootstrapProject, discoverTargetProject } from '../project-bootstrap.mjs';

const execFile = promisify(execute);

async function git(args, cwd) {
  return execFile('git', args, { cwd, encoding: 'utf8' });
}

async function fixture(t, { upstream = true, sshRemote = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-project-bootstrap-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'leesh-loop-source');
  const target = join(directory, 'sample-project');
  await mkdir(source);
  await mkdir(join(source, 'operator'));
  await mkdir(target);
  await git(['init', '-b', 'main'], source);
  await writeFile(join(source, 'mise.toml'), '[tools]\nelixir = "1.19.5"\n');
  await writeFile(join(source, 'operator', '.gitkeep'), '');
  await git(['add', 'mise.toml', 'operator/.gitkeep'], source);
  await git(['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '-m', 'source'], source);
  await git(['remote', 'add', 'origin', 'https://github.com/example/leesh-loop.git'], source);

  await git(['init', '-b', 'feature/bootstrap'], target);
  await writeFile(join(target, 'WORKFLOW.md'), '# Project-owned policy\n');
  await git(['add', 'WORKFLOW.md'], target);
  await git(['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '-m', 'target'], target);
  const remote = sshRemote ? 'git@github.com:example/sample-project.git' : 'https://github.com/example/sample-project.git';
  await git(['remote', 'add', 'origin', remote], target);
  if (upstream) {
    await git(['config', 'branch.feature/bootstrap.remote', 'origin'], target);
    await git(['config', 'branch.feature/bootstrap.merge', 'refs/heads/release/bootstrap'], target);
    await git(['update-ref', 'refs/remotes/origin/release/bootstrap', 'HEAD'], target);
  } else {
    await git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk'], target);
  }
  return { directory, source, target, runtime: join(directory, 'sample-project-loop') };
}

test('bootstrap creates a same-revision Git runtime and derives Project paths and bindings', async t => {
  const { source, target, runtime } = await fixture(t);
  const workflowBefore = await readFile(join(target, 'WORKFLOW.md'), 'utf8');
  const result = await bootstrapProject({ targetDirectory: target, sourceDirectory: source, prepareDependencies: false });

  assert.equal(result.repositoryUrl, 'https://github.com/example/sample-project.git');
  assert.equal(result.baseBranch, 'release/bootstrap');
  assert.equal(await git(['rev-parse', 'HEAD'], runtime).then(value => value.stdout.trim()), result.runtimeRevision);
  assert.equal(result.runtimeRevision, await git(['rev-parse', 'HEAD'], source).then(value => value.stdout.trim()));
  assert.equal(await git(['remote', 'get-url', 'origin'], runtime).then(value => value.stdout.trim()), 'https://github.com/example/leesh-loop.git');

  const project = JSON.parse(await readFile(join(runtime, 'operator/project.json'), 'utf8'));
  assert.equal(resolveProjectPath(project.workflow_path, join(runtime, 'operator')), join(target, 'WORKFLOW.md'));
  assert.equal(resolveProjectPath(project.symphony_workspace_root, join(runtime, 'operator')), join(runtime, 'operator/.runtime/workspaces'));
  assert.equal(project.allow_workspace_root_inside_repository, true);
  assert.deepEqual(project.workspace_files, ['../.env']);
  assert.equal(project.github_repository_url, 'https://github.com/example/sample-project.git');
  assert.equal(project.github_base_branch, 'release/bootstrap');
  assert.equal(project.symphony_port, 4100);
  assert.equal(project.ui_port, 4310);
  assert.equal(project.startup_timeout_ms, 30 * 60_000);
  assert.equal(project.browser_acknowledgement_timeout_ms, 1_000);
  assert.equal(project.skip_external_readiness, false);
  assert.equal('codex_model' in project, false);
  assert.equal('codex_reasoning_effort' in project, false);
  assert.equal(await readFile(join(runtime, '.env'), 'utf8'), 'NOTION_TOKEN=\nLEESH_LOOP_NOTION_DATABASE_URL=\n');
  assert.equal((await stat(join(runtime, '.env'))).mode & 0o777, 0o600);
  assert.equal(await readFile(join(target, 'WORKFLOW.md'), 'utf8'), workflowBefore);
});

test('bootstrap uses configured remote HEAD when there is one unambiguous remote and no branch tracking', async t => {
  const { source, target } = await fixture(t, { upstream: false, sshRemote: true });
  const targetInfo = await discoverTargetProject(target);
  assert.equal(targetInfo.repositoryUrl, 'https://github.com/example/sample-project.git');
  assert.equal(targetInfo.baseBranch, 'trunk');
  const result = await bootstrapProject({ targetDirectory: target, sourceDirectory: source, noExternal: true, prepareDependencies: false });
  const project = JSON.parse(await readFile(join(result.runtimeRoot, 'operator/project.json'), 'utf8'));
  assert.equal(project.skip_external_readiness, true);
});

test('existing sibling runtime collision preserves all existing files', async t => {
  const { source, target, runtime } = await fixture(t);
  await mkdir(runtime);
  await writeFile(join(runtime, 'sentinel'), 'keep exactly\n');
  await assert.rejects(bootstrapProject({ targetDirectory: target, sourceDirectory: source, prepareDependencies: false }), /runtime root already exists/);
  assert.equal(await readFile(join(runtime, 'sentinel'), 'utf8'), 'keep exactly\n');
  assert.deepEqual((await git(['status', '--porcelain'], target)).stdout, '');
});

test('missing target workflow is a specific failure before runtime creation', async t => {
  const { source, target, runtime } = await fixture(t);
  await rm(join(target, 'WORKFLOW.md'));
  await assert.rejects(bootstrapProject({ targetDirectory: target, sourceDirectory: source, prepareDependencies: false }), /required project-owned WORKFLOW.md is missing/);
  await assert.rejects(stat(runtime), { code: 'ENOENT' });
});

test('boot must run at the target Git root and rejects an unbound repository', async t => {
  const { source, target, runtime } = await fixture(t);
  const child = join(target, 'nested');
  await mkdir(child);
  await assert.rejects(bootstrapProject({ targetDirectory: child, sourceDirectory: source, prepareDependencies: false }), /must run from the Git repository root/);

  const unbound = join((await mkdtemp(join(tmpdir(), 'leesh-loop-unbound-'))), 'project');
  t.after(() => rm(resolve(unbound, '..'), { recursive: true, force: true }));
  await mkdir(unbound);
  await git(['init', '-b', 'main'], unbound);
  await writeFile(join(unbound, 'WORKFLOW.md'), '# policy\n');
  await git(['add', 'WORKFLOW.md'], unbound);
  await git(['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '-m', 'target'], unbound);
  await assert.rejects(bootstrapProject({ targetDirectory: unbound, sourceDirectory: source, prepareDependencies: false }), /cannot determine the target repository URL and base branch/);
  await assert.rejects(stat(join(resolve(unbound, '..'), 'project-loop')), { code: 'ENOENT' });
  await assert.rejects(stat(runtime), { code: 'ENOENT' });
});

test('dirty linked CLI source rejects both tracked and untracked changes before runtime creation', async t => {
  const { source, target, runtime } = await fixture(t);
  await writeFile(join(source, 'local.txt'), 'untracked\n');
  await assert.rejects(bootstrapProject({ targetDirectory: target, sourceDirectory: source, prepareDependencies: false }), /linked Leesh Loop CLI checkout is dirty/);
  await rm(join(source, 'local.txt'));
  await writeFile(join(source, 'mise.toml'), '[tools]\nelixir = "local-change"\n');
  await assert.rejects(bootstrapProject({ targetDirectory: target, sourceDirectory: source, prepareDependencies: false }), /linked Leesh Loop CLI checkout is dirty/);
  await assert.rejects(stat(runtime), { code: 'ENOENT' });
});
