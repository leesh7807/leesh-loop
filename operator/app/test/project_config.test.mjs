import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  parseProjectToml,
  readProjectConfiguration,
  stringifyProjectConfiguration,
  validateProjectConfiguration,
  writeProjectConfiguration
} from '../../project-config.mjs';

const root = join(import.meta.dirname, '../../..');
const required = {
  github_repository_url: 'https://github.com/example/repository.git',
  github_base_branch: 'main',
  workflow_path: 'WORKFLOW.md',
  symphony_workspace_root: '.runtime/workspaces'
};

test('the root Project TOML describes defaults and resolves its paths from the Loop root', async () => {
  const projectPath = join(root, 'project.toml');
  const source = await readFile(projectPath, 'utf8');
  const project = await readProjectConfiguration(projectPath, { validateWorkspaceFileSources: true });

  assert.equal(project.configuration_path, projectPath);
  assert.equal(project.workflow_path, join(root, 'WORKFLOW.md'));
  assert.equal(project.symphony_workspace_root, join(homedir(), '.leesh-loop/workspaces'));
  assert.equal(project.symphony_port, 4100);
  assert.equal(project.ui_port, 4310);
  assert.equal(project.workspace_files.length, 0);
  assert.equal(project.startup_timeout_ms, 30 * 60_000);
  assert.equal(project.browser_acknowledgement_timeout_ms, 1_000);
  assert.equal(project.open_project_surfaces, true);
  assert.equal(project.skip_external_readiness, false);
  assert.match(source, /UI port\. Default: 4310/);
  assert.match(source, /Symphony runtime port\. Default: 4100/);
  assert.match(source, /workspace_files = \[\]/);
  assert.match(source, /workspace root under its basename/);
  assert.match(source, /Git tracking does not matter/);
});

test('TOML comments, omitted defaults, optional settings, and serialization use one Project contract', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-project-toml-'));
  try {
    const projectPath = join(directory, 'project.toml');
    const project = {
      ...required,
      workspace_files: [],
      codex_model: 'worker-model',
      codex_reasoning_effort: 'high',
      ui_port: 4311,
      symphony_port: 4101,
      open_project_surfaces: false,
      skip_external_readiness: true,
      startup_timeout_ms: 90_000,
      browser_acknowledgement_timeout_ms: 1_500,
      state_directory: '.runtime/state'
    };
    const serialized = stringifyProjectConfiguration(project);
    assert.match(serialized, /ui_port = 4311/);
    assert.match(serialized, /symphony_port = 4101/);
    assert.deepEqual({ ...parseProjectToml(serialized) }, project);

    await writeProjectConfiguration(projectPath, project);
    const readback = await readProjectConfiguration(projectPath);
    for (const [key, value] of Object.entries(project)) {
      if (['workflow_path', 'symphony_workspace_root', 'state_directory'].includes(key)) continue;
      assert.deepEqual(readback[key], value);
    }
    assert.equal(readback.workflow_path, join(directory, 'WORKFLOW.md'));
    assert.equal(readback.symphony_workspace_root, join(directory, '.runtime/workspaces'));
    assert.equal(readback.state_directory, join(directory, '.runtime/state'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Project-relative, absolute, and home workspace file paths normalize before file validation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-project-paths-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const targetRoot = join(directory, 'target');
  const home = join(directory, 'home');
  const relativeSource = join(targetRoot, 'relative-settings.json');
  const absoluteSource = join(directory, 'absolute-settings.json');
  const homeSource = join(home, 'home-settings.json');
  await mkdir(targetRoot, { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(relativeSource, 'relative');
  await writeFile(absoluteSource, 'absolute');
  await writeFile(homeSource, 'home');
  const projectPath = join(directory, 'loop', 'project.toml');
  await mkdir(join(directory, 'loop'), { recursive: true });
  const project = {
    ...required,
    workspace_files: ['../target/relative-settings.json', absoluteSource, '~/home-settings.json']
  };
  await writeProjectConfiguration(projectPath, project);
  const readback = await readProjectConfiguration(projectPath, { homeDirectory: home, validateWorkspaceFileSources: true });

  assert.equal(readback.workflow_path, join(directory, 'loop', 'WORKFLOW.md'));
  assert.equal(readback.symphony_workspace_root, join(directory, 'loop', '.runtime/workspaces'));
  assert.deepEqual(readback.workspace_files, [relativeSource, absoluteSource, homeSource]);
});

test('malformed TOML and invalid Project value types, ranges, and paths fail clearly', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-project-invalid-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const projectPath = join(directory, 'project.toml');
  const valid = stringifyProjectConfiguration(required);
  await writeFile(projectPath, 'github_repository_url = [unterminated\n');
  await assert.rejects(readProjectConfiguration(projectPath), /invalid Project TOML/);

  for (const extra of [
    'symphony_port = "4100"',
    'ui_port = 65536',
    'symphony_port = 4100.5',
    'symphony_port = 4310',
    'symphony_port = 4321\nui_port = 4321',
    'workspace_files = ["one", 2]',
    'codex_model = true',
    'open_project_surfaces = "false"',
    'startup_timeout_ms = 0',
    'state_directory = ""'
  ]) {
    await writeFile(projectPath, valid + extra + '\n');
    await assert.rejects(readProjectConfiguration(projectPath), error => error instanceof Error && !/invalid Project TOML/.test(error.message));
  }
  await writeFile(projectPath, valid.replace('github_base_branch = "main"', 'github_base_branch = "foo~bar"'));
  await assert.rejects(readProjectConfiguration(projectPath), /not a valid Git branch name: foo~bar/);
  await writeFile(projectPath, `${valid}ui_prt = 4311\n`);
  await assert.rejects(readProjectConfiguration(projectPath), /unknown Project setting: ui_prt/);
  assert.throws(() => validateProjectConfiguration([]), /top-level table/);
});
