import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createOperatorProjectConfig, createRunPaths, E2E_DATABASE_URL, loadE2EProjectConfig } from '../model/e2e-project-config.mjs';

async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-project-config-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = join(directory, 'project.json');
  await writeFile(configPath, JSON.stringify({
    repository_url: 'https://github.com/example/repository.git',
    workflow_path: '../../WORKFLOW.md',
    notion_database_url: E2E_DATABASE_URL,
    seed_source_ref: 'refs/heads/main',
    ...overrides
  }));
  return { directory, configPath };
}

test('E2E Codex overrides are optional and selectively copied to run-local Operator Projects', async t => {
  for (const overrides of [
    {},
    { codex_model: 'example-model' },
    { codex_reasoning_effort: 'example-effort' },
    { codex_model: 'example-model', codex_reasoning_effort: 'example-effort' }
  ]) {
    const { directory, configPath } = await fixture(t, overrides);
    const config = await loadE2EProjectConfig(configPath);
    const paths = createRunPaths({ run_record_directory: join(directory, 'runs'), workspace_root: join(directory, 'workspaces') }, 'run-1');
    const project = createOperatorProjectConfig(config, paths, 'base/run-1');
    assert.equal(project.codex_model, overrides.codex_model);
    assert.equal(project.codex_reasoning_effort, overrides.codex_reasoning_effort);
    assert.equal(Object.hasOwn(project, 'codex_model'), Object.hasOwn(overrides, 'codex_model'));
    assert.equal(Object.hasOwn(project, 'codex_reasoning_effort'), Object.hasOwn(overrides, 'codex_reasoning_effort'));
  }
});

test('E2E Codex override configuration rejects blank and non-string values', async t => {
  for (const [key, value] of [['codex_model', ''], ['codex_model', '  '], ['codex_model', null], ['codex_model', 1], ['codex_reasoning_effort', ''], ['codex_reasoning_effort', '  '], ['codex_reasoning_effort', null], ['codex_reasoning_effort', 1]]) {
    const { configPath } = await fixture(t, { [key]: value });
    await assert.rejects(loadE2EProjectConfig(configPath), new RegExp(`${key} must be a non-empty string`));
  }
});
