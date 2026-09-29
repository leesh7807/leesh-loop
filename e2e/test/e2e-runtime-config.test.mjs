import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createOperatorProjectConfig, createRunPaths, INITIAL_EMPTY_E2E_DATABASE_URLS, loadE2ERuntimeConfig, resolveE2EDatabasePool } from '../model/e2e-runtime-config.mjs';
import { extractNotionDatabaseId } from '../model/notion-database-id.mjs';

async function projectFixture(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-runtime-config-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'operator'), { recursive: true });
  const projectPath = join(root, 'operator/project.json');
  await writeFile(projectPath, JSON.stringify({
    workflow_path: '../WORKFLOW.md',
    symphony_workspace_root: '/host/global/workspaces',
    workspace_files: ['../.env'],
    state_directory: '/host/global/state',
    github_repository_url: 'https://github.com/example/repository.git',
    github_base_branch: 'release',
    codex_model: 'production-model',
    codex_reasoning_effort: 'high',
    symphony_port: 4100,
    ui_port: 4310,
    ...overrides
  }));
  const existingUrl = `https://www.notion.so/${randomUUID()}`;
  return { root, projectPath, existingUrl, envFile: join(root, '.env'), environment: { LEESH_LOOP_E2E_NOTION_DATABASE_URL: existingUrl } };
}

test('E2E shared settings come selectively from production Project while policy paths stay E2E-owned', async t => {
  const fixture = await projectFixture(t);
  const config = await loadE2ERuntimeConfig({ root: fixture.root, environment: fixture.environment, envFile: fixture.envFile });
  assert.equal(config.repository_url, 'https://github.com/example/repository.git');
  assert.equal(config.production_base_branch, 'release');
  assert.equal(config.seed_source_ref, 'refs/heads/release');
  assert.equal(config.codex_model, 'production-model');
  assert.equal(config.codex_reasoning_effort, 'high');
  assert.equal(config.workflow_path, join(fixture.root, 'e2e/WORKFLOW.md'));
  assert.equal(config.workspace_root, join(fixture.root, 'e2e/workspaces'));
  assert.equal(config.run_record_directory, join(fixture.root, 'e2e/runs'));
  assert.equal(config.database_pool.length, 5);
  assert.equal(config.database_pool[0].database_url, fixture.existingUrl);
  assert.equal(Object.hasOwn(config, 'symphony_workspace_root'), false);
  assert.equal(Object.hasOwn(config, 'state_directory'), false);
  assert.equal(Object.hasOwn(config, 'workspace_files'), false);
  assert.equal(Object.hasOwn(config, 'symphony_port'), false);
  assert.equal(Object.hasOwn(config, 'ui_port'), false);

  const paths = createRunPaths(config, 'run-1');
  const project = createOperatorProjectConfig(config, paths, 'base/run-1', config.workflow_path, { symphony_port: 45001, ui_port: 45002 });
  assert.equal(project.symphony_workspace_root, join(config.workspace_root, 'run-1'));
  assert.equal(project.github_base_branch, 'base/run-1');
  assert.equal(project.workflow_path, config.workflow_path);
  assert.equal(project.symphony_port, 45001);
  assert.equal(project.ui_port, 45002);
  assert.equal(project.skip_external_readiness, true);
  assert.equal(project.open_project_surfaces, false);
  assert.equal(Object.hasOwn(project, 'workspace_files'), false);
  assert.equal(Object.hasOwn(project, 'state_directory'), true);
});

test('pool URLs can override the bootstrap pool and identities deduplicate across URL forms', () => {
  const first = INITIAL_EMPTY_E2E_DATABASE_URLS[0];
  const databaseId = extractNotionDatabaseId(first);
  const compact = `https://www.notion.so/${databaseId.replaceAll('-', '')}`;
  assert.deepEqual(resolveE2EDatabasePool({ configuredUrls: `${first}\n${compact}` }), [{ database_id: databaseId, database_url: first }]);
  assert.equal(resolveE2EDatabasePool({ existingUrl: 'https://www.notion.so/00000000000040008000000000000001' }).length, 5);
});

test('production authority validates required fields and only imports supported Codex values', async t => {
  const fixture = await projectFixture(t, { github_base_branch: '', codex_model: null });
  await assert.rejects(loadE2ERuntimeConfig({ root: fixture.root, environment: fixture.environment, envFile: fixture.envFile }), /github_base_branch/);
  await writeFile(fixture.projectPath, JSON.stringify({ github_repository_url: 'https://github.com/example/repository.git', github_base_branch: 'main', codex_model: '' }));
  await assert.rejects(loadE2ERuntimeConfig({ root: fixture.root, environment: fixture.environment, envFile: fixture.envFile }), /codex_model/);
});

test('E2E requires at least one valid Notion database URL', () => {
  assert.equal(resolveE2EDatabasePool({ configuredUrls: '' }).length, 4);
  assert.throws(() => resolveE2EDatabasePool({ configuredUrls: 'https://example.com/not-a-database' }), /Notion URL/);
});
