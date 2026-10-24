import assert from 'node:assert/strict';
import { execFile as execute } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { createLoopInstance } from '../manager-storage.mjs';

const execFile = promisify(execute);
const sourceRoot = resolve(import.meta.dirname, '../../..');

async function git(cwd, ...args) {
  return execFile('git', args, { cwd, encoding: 'utf8' });
}

async function makeTarget(root, name, { upstream = true } = {}) {
  const repository = join(root, name);
  await mkdir(repository, { recursive: true });
  await git(repository, 'init', '--quiet', '-b', 'main');
  await git(repository, 'config', 'user.name', 'Init Test');
  await git(repository, 'config', 'user.email', 'init-test@example.invalid');
  await writeFile(join(repository, 'README.md'), `# ${name}\n`);
  await git(repository, 'add', 'README.md');
  await git(repository, 'commit', '--quiet', '-m', 'initial target');
  if (upstream) {
    await git(repository, 'remote', 'add', 'review', `https://github.com/example/${name}.git`);
    const head = (await git(repository, 'rev-parse', 'HEAD')).stdout.trim();
    await git(repository, 'update-ref', 'refs/remotes/review/releases/2026/init', head);
    await git(repository, 'config', 'branch.main.remote', 'review');
    await git(repository, 'config', 'branch.main.merge', 'refs/heads/releases/2026/init');
  }
  return repository;
}

test('init creates only the managed instance data and preserves the target Git repository', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-init-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const targetRoot = await makeTarget(directory, 'sample-repository');
  const before = (await git(targetRoot, 'status', '--porcelain')).stdout;
  const xdg = {
    XDG_DATA_HOME: join(directory, 'data'),
    XDG_STATE_HOME: join(directory, 'state'),
    XDG_CONFIG_HOME: join(directory, 'config')
  };

  const instance = await createLoopInstance(targetRoot, { sourceRoot, environment: { ...process.env, ...xdg }, homeDirectory: directory });
  const files = await readdir(instance.data_directory);
  const project = await readFile(join(instance.data_directory, 'project.toml'), 'utf8');
  const workflow = await readFile(join(instance.data_directory, 'WORKFLOW.md'), 'utf8');
  assert.equal(instance.repository_root, targetRoot);
  assert.equal(instance.base_branch, 'releases/2026/init');
  assert.ok(files.includes('project.toml'));
  assert.ok(files.includes('WORKFLOW.md'));
  assert.ok(!files.includes('operator'));
  assert.ok(!files.includes('.env.example'));
  assert.match(project, /github_repository_url = "https:\/\/github.com\/example\/sample-repository\.git"/);
  assert.doesNotMatch(project, /(?:ui_port|symphony_port)\s*=/);
  assert.match(workflow, /^---\ntracker:\n  kind: local/m);
  assert.equal((await git(targetRoot, 'status', '--porcelain')).stdout, before);
  await assert.rejects(createLoopInstance(targetRoot, { sourceRoot, environment: { ...process.env, ...xdg }, homeDirectory: directory }), /already managed/);
});

test('init rejects repositories without a configured upstream before creating an instance', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-init-no-upstream-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const targetRoot = await makeTarget(directory, 'private-project', { upstream: false });
  const environment = {
    ...process.env,
    XDG_DATA_HOME: join(directory, 'data'),
    XDG_STATE_HOME: join(directory, 'state'),
    XDG_CONFIG_HOME: join(directory, 'config')
  };
  await assert.rejects(createLoopInstance(targetRoot, { sourceRoot, environment, homeDirectory: directory }), /no configured remote branch/);
  assert.deepEqual(await readdir(join(directory, 'data/leesh-loop/instances')).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error)), []);
});
