import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRunRecord } from '../model/run-record-store.mjs';
import { createRunPaths } from '../model/e2e-project-config.mjs';
import { RunEvidenceCollector } from '../run/evidence/run-evidence-collector.mjs';
import { RunTimingRecorder } from '../run/run-timing.mjs';

test('chatgpt-shot timing keeps an observation duration when Jobs has no timestamps', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-evidence-'));
  const config = { notion_database_url: 'https://notion.example/database', repository_url: 'git@github.com:owner/repo.git', seed_source_ref: 'refs/heads/main' };
  const workload = { id: 'fixture', identifier: 'PLAN-FIXTURE', accepted_plan: '# Fixture\n', accepted_plan_sha256: 'hash', hard_cap_ms: 10 };
  const record = createRunRecord({ config, runId: 'run-1', workload, paths: createRunPaths({ run_record_directory: directory + '/runs', workspace_root: directory + '/workspaces' }, 'run-1') });
  const task = { id: 'page-1', url: 'https://notion/page-1', identifier: 'PLAN-FIXTURE', state: 'In Progress', accepted_plan: '# Fixture\n', workpad: 'Job ID: 123e4567-e89b-42d3-a456-426614174000' };
  const productionExecutions = { issue_identifier: 'PLAN-FIXTURE', executions: [{ execution_id: 'execution-1', attempt: 1, started_at: '2026-09-27T10:00:00Z', ended_at: '2026-09-27T10:00:05Z', runtime_seconds: 5, status: 'completed' }] };
  const collector = new RunEvidenceCollector({
    notionClient: { async readTask() { return task; } },
    operatorClient: { async readSymphonyRuntimeStatus() { return {}; }, async readSymphonyRuntimeState() { return {}; }, async readSymphonyIssue() { return { running: { started_at: '2026-09-27T10:00:00Z' } }; }, async readSymphonyExecutions() { return productionExecutions; }, async readDispatchedTrackerInput() { return null; } },
    githubClient: { async pullRequestsForBase() { return []; } },
    gitClient: { async listRemoteBranchRefs() { return {}; } },
    chatgptShotClient: { async inspectReviewJobs() { return { job_id: '123e4567-e89b-42d3-a456-426614174000', terminal_state: 'running', result: null, error: null, observations: [], observed_duration_ms: null }; } }
  });
  const snapshot = await collector.collectSnapshot({ databaseUrl: config.notion_database_url, identifier: task.identifier, dashboard: 'http://127.0.0.1:1', baseBranch: 'base/run-1', workspaceRoot: directory + '/workspaces' });
  assert.equal(record.timing.chatgpt_shot.job_id, null);
  new RunTimingRecorder().recordEvidenceSnapshot(record, snapshot);
  assert.equal(record.timing.chatgpt_shot.job_id, '123e4567-e89b-42d3-a456-426614174000');
  assert.ok(Number.isFinite(record.timing.chatgpt_shot.observed_duration_ms));
  assert.equal(record.timing.chatgpt_shot.observations.length, 1);
  assert.deepEqual(snapshot.symphony.executions, productionExecutions);
  assert.equal(record.timing.symphony.worker_started_at, undefined);
  assert.equal(record.timing.symphony.observed_duration_ms, undefined);
  assert.equal(record.schema_version, 3);
});
