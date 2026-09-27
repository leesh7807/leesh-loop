import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createOperatorProjectConfig, createRunPaths, loadE2EProjectConfig } from '../model/e2e-project-config.mjs';
import { extractNotionDatabaseId } from '../model/notion-database-id.mjs';

async function projectFixture(t, extra = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-project-config-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = join(directory, 'operator', 'e2e', 'project.json');
  await mkdir(join(directory, 'operator', 'e2e'), { recursive: true });
  const databaseUrl = `https://www.notion.so/${randomUUID()}`;
  await writeFile(configPath, JSON.stringify({
    repository_url: 'https://github.com/example/repository.git',
    workflow_path: 'WORKFLOW.md',
    seed_source_ref: 'refs/heads/main',
    ...extra
  }));
  return { directory, configPath, databaseUrl, environment: { LEESH_LOOP_E2E_NOTION_DATABASE_URL: databaseUrl }, envFile: join(directory, '.env') };
}

function loadFixtureConfig(fixture, options = {}) {
  return loadE2EProjectConfig(fixture.configPath, { environment: fixture.environment, envFile: fixture.envFile, ...options });
}

test('E2E config defaults nested Symphony workspace under the current repository', async t => {
  const fixture = await projectFixture(t);
  const config = await loadFixtureConfig(fixture);
  assert.equal(config.workspace_root, join(fixture.directory, 'operator', 'e2e', 'workspaces'));
  assert.equal(config.repository_root, fixture.directory);
  assert.equal(config.notion_database_url, fixture.databaseUrl);
  assert.equal(config.notion_database_id, extractNotionDatabaseId(fixture.databaseUrl));
  const paths = createRunPaths(config, 'run-1');
  const project = createOperatorProjectConfig(config, paths, 'base/run-1', join(fixture.directory, 'run', 'workflow.md'));
  assert.equal(Object.hasOwn(project, 'notion_database_url'), false);
  assert.equal(project.symphony_workspace_root, join(config.workspace_root, 'run-1'));
  assert.equal(project.allow_workspace_root_inside_repository, true);
  assert.equal(project.skip_external_readiness, true);
});

test('E2E config rejects a host-global or external workspace authority', async t => {
  const fixture = await projectFixture(t, { workspace_root: '/tmp/e2e-workspaces' });
  await assert.rejects(() => loadFixtureConfig(fixture), /inside the current repository/);
});

test('E2E database binding is required before admission setup and comes from environment or root .env', async t => {
  const fixture = await projectFixture(t);
  await writeFile(fixture.envFile, 'LEESH_LOOP_E2E_NOTION_DATABASE_URL=https://www.notion.so/00000000-0000-4000-8000-000000000001\n');
  const environmentValue = `https://www.notion.so/${randomUUID()}`;
  const fromEnvironment = await loadE2EProjectConfig(fixture.configPath, { environment: { LEESH_LOOP_E2E_NOTION_DATABASE_URL: environmentValue }, envFile: fixture.envFile });
  const fromFile = await loadE2EProjectConfig(fixture.configPath, { environment: {}, envFile: fixture.envFile });
  assert.equal(fromEnvironment.notion_database_url, environmentValue);
  assert.equal(fromFile.notion_database_url, 'https://www.notion.so/00000000-0000-4000-8000-000000000001');
  await assert.rejects(loadE2EProjectConfig(fixture.configPath, { environment: {}, envFile: join(fixture.directory, 'missing.env') }), /missing LEESH_LOOP_E2E_NOTION_DATABASE_URL/);
});

test('E2E local paths preserve absolutes and resolve project-relative and home forms', async t => {
  const fixture = await projectFixture(t, {
    workflow_path: '~/operator/e2e/workflow.md',
    run_record_directory: '../records',
    workspace_root: '~/operator/e2e/alternate-workspaces'
  });
  const config = await loadFixtureConfig(fixture, { homeDirectory: fixture.directory });
  assert.equal(config.workflow_path, join(fixture.directory, 'operator', 'e2e', 'workflow.md'));
  assert.equal(config.run_record_directory, join(fixture.directory, 'operator', 'records'));
  assert.equal(config.workspace_root, join(fixture.directory, 'operator', 'e2e', 'alternate-workspaces'));

  const absoluteWorkspace = join(fixture.directory, 'operator', 'e2e', 'absolute-workspaces');
  await writeFile(fixture.configPath, JSON.stringify({
    repository_url: 'https://github.com/example/repository.git',
    workflow_path: join(fixture.directory, 'operator', 'e2e', 'workflow.md'),
    seed_source_ref: 'refs/heads/main',
    workspace_root: absoluteWorkspace
  }));
  const absolute = await loadFixtureConfig(fixture);
  assert.equal(absolute.workflow_path, join(fixture.directory, 'operator', 'e2e', 'workflow.md'));
  assert.equal(absolute.workspace_root, absoluteWorkspace);
});

test('E2E Codex overrides are optional and selectively copied to run-local Operator Projects', async t => {
  for (const overrides of [
    {},
    { codex_model: 'example-model' },
    { codex_reasoning_effort: 'example-effort' },
    { codex_model: 'example-model', codex_reasoning_effort: 'example-effort' }
  ]) {
    const fixture = await projectFixture(t, overrides);
    const config = await loadFixtureConfig(fixture);
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
    const fixture = await projectFixture(t, { [key]: value });
    await assert.rejects(loadFixtureConfig(fixture), new RegExp(key + ' must be a non-empty string'));
  }
});
