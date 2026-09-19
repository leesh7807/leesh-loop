import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newRunRecord } from '../record.mjs';
import { runPaths } from '../config.mjs';
import { EvidenceCollector } from '../evidence.mjs';

test('chatgpt-shot timing keeps an observation duration when Jobs has no timestamps', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-evidence-'));
  const config = { notion_database_url: 'https://app.notion.com/p/studyleesh/3e08a2658625805cad23fe1137be4a1e?v=3e08a26586258042a8e4000c945e56e7', repository_url: 'git@github.com:owner/repo.git', seed_source_ref: 'refs/heads/main' };
  const workload = { id: 'fixture', identifier: 'PLAN-FIXTURE', accepted_plan: '# Fixture\n', accepted_plan_sha256: 'hash', hard_cap_ms: 10 };
  const record = newRunRecord({ config, runId: 'run-1', workload, paths: runPaths({ run_record_directory: directory + '/runs', workspace_root: directory + '/workspaces' }, 'run-1') });
  const task = { id: 'page-1', url: 'https://notion/page-1', identifier: 'PLAN-FIXTURE', state: 'In Progress', accepted_plan: '# Fixture\n', workpad: 'Job ID: 123e4567-e89b-42d3-a456-426614174000' };
  const collector = new EvidenceCollector({
    notion: { async readTask() { return task; } },
    runtime: { async runtime() { return {}; }, async state() { return {}; }, async issue() { return null; }, async trackerInput() { return null; } },
    github: { async pullRequestsForBase() { return []; } },
    git: { async remoteRefs() { return {}; } },
    review: { async inspect() { return { job_id: '123e4567-e89b-42d3-a456-426614174000', terminal_state: 'running', result: null, error: null, observations: [], observed_duration_ms: null }; } }
  });
  await collector.snapshot({ record, databaseUrl: config.notion_database_url, identifier: task.identifier, dashboard: 'http://127.0.0.1:1', baseBranch: 'base/run-1', workspaceRoot: directory + '/workspaces' });
  assert.equal(record.timing.chatgpt_shot.job_id, '123e4567-e89b-42d3-a456-426614174000');
  assert.ok(Number.isFinite(record.timing.chatgpt_shot.observed_duration_ms));
  assert.equal(record.timing.chatgpt_shot.observations.length, 1);
});
