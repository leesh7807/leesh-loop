import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { E2E_DATABASE_URL, createOperatorProjectConfig, createRunPaths, loadE2EProjectConfig } from '../model/e2e-project-config.mjs';

async function projectFixture(t, extra = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-project-config-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = join(directory, 'operator', 'e2e', 'project.json');
  await mkdir(join(directory, 'operator', 'e2e'), { recursive: true });
  await writeFile(configPath, JSON.stringify({
    repository_url: 'https://github.com/example/repository.git',
    workflow_path: 'WORKFLOW.md',
    notion_database_url: E2E_DATABASE_URL,
    seed_source_ref: 'refs/heads/main',
    ...extra
  }));
  return { directory, configPath };
}

test('E2E config defaults nested Symphony workspace under the current repository', async t => {
  const fixture = await projectFixture(t);
  const config = await loadE2EProjectConfig(fixture.configPath);
  assert.equal(config.workspace_root, join(fixture.directory, 'operator', 'e2e', 'workspaces'));
  assert.equal(config.repository_root, fixture.directory);
  const paths = createRunPaths(config, 'run-1');
  const project = createOperatorProjectConfig(config, paths, 'base/run-1', join(fixture.directory, 'run', 'workflow.md'));
  assert.equal(project.symphony_workspace_root, join(config.workspace_root, 'run-1'));
  assert.equal(project.allow_workspace_root_inside_repository, true);
  assert.equal(project.skip_external_readiness, true);
});

test('E2E config rejects a host-global or external workspace authority', async t => {
  const fixture = await projectFixture(t, { workspace_root: '/tmp/e2e-workspaces' });
  await assert.rejects(() => loadE2EProjectConfig(fixture.configPath), /inside the current repository/);
});

test('E2E Codex overrides are optional and selectively copied to run-local Operator Projects', async t => {
  for (const overrides of [
    {},
    { codex_model: 'example-model' },
    { codex_reasoning_effort: 'example-effort' },
    { codex_model: 'example-model', codex_reasoning_effort: 'example-effort' }
  ]) {
    const { configPath } = await projectFixture(t, overrides);
    const config = await loadE2EProjectConfig(configPath);
    const paths = createRunPaths(config, 'run-1');
    const project = createOperatorProjectConfig(config, paths, 'base/run-1');
    assert.equal(project.codex_model, overrides.codex_model);
    assert.equal(project.codex_reasoning_effort, overrides.codex_reasoning_effort);
    assert.equal(Object.hasOwn(project, 'codex_model'), Object.hasOwn(overrides, 'codex_model'));
    assert.equal(Object.hasOwn(project, 'codex_reasoning_effort'), Object.hasOwn(overrides, 'codex_reasoning_effort'));
  }
});

test('E2E Codex override configuration rejects blank and non-string values', async t => {
  for (const [key, value] of [['codex_model', ''], ['codex_model', '  '], ['codex_model', null], ['codex_model', 1], ['codex_reasoning_effort', ''], ['codex_reasoning_effort', '  '], ['codex_reasoning_effort', null], ['codex_reasoning_effort', 1]]) {
    const { configPath } = await projectFixture(t, { [key]: value });
    await assert.rejects(loadE2EProjectConfig(configPath), new RegExp(key + ' must be a non-empty string'));
  }
});
