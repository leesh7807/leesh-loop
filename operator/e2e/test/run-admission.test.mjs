import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunAdmission } from '../run/admission/run-admission.mjs';
import { createRunPaths } from '../model/e2e-project-config.mjs';
import { createRunRecord } from '../model/run-record-store.mjs';

test('admission reconciles a verified merged base recorded as an identity-changed owned ref', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-admission-merged-base-'));
  const config = {
    notion_database_url: 'https://notion.example/database',
    run_record_directory: directory + '/runs',
    workspace_root: directory + '/workspaces'
  };
  const workload = { id: 'fixture', identifier: 'PLAN-FIXTURE', accepted_plan: '# Fixture\n', accepted_plan_sha256: 'hash', hard_cap_ms: 10 };
  const record = createRunRecord({ config, runId: 'run-merged-base', workload, paths: createRunPaths(config, 'run-merged-base') });
  const baseBranch = 'base/run-merged-base';
  const mergeCommit = 'e'.repeat(40);
  const task = { id: 'page-1', identifier: 'PLAN-FIXTURE', state: 'Done', accepted_plan: workload.accepted_plan };
  record.status = 'finished';
  record.binding.base_branch = baseBranch;
  record.binding.base_commit = 'd'.repeat(40);
  record.artifacts.remote_base_commit = mergeCommit;
  record.artifacts.task_id = task.id;
  record.artifacts.task_identifier = task.identifier;
  record.finalization.complete = true;
  record.finalization.incomplete = false;
  record.finalization.unresolved = [];
  record.cleanup.unresolved = [];
  record.evidence.owned_branch_cleanup = {
    checked_at: new Date().toISOString(),
    refs: [{ branch: baseBranch, expected_commit: record.binding.base_commit, status: 'identity_changed', commit: mergeCommit }],
    remaining_refs: []
  };

  let reconciliations = 0;
  const admission = new RunAdmission({
    config,
    catalog: workload,
    runRecordStore: { async listRecords() { return [record]; } },
    notionClient: {
      async readTask() { return task; },
      async listTasks() { return [task]; }
    },
    operatorClient: { async workspaceExists() { return false; } },
    runEvidenceCollector: { async collectSnapshot() { return { observed_at: new Date().toISOString(), notion: { state: 'Done' }, github: { delivery_prs: [] }, symphony: {} }; } },
    runDoneVerifier: { async verifyDoneDelivery() { return { ok: true, remote_base_commit: mergeCommit }; } },
    runFinalizer: {
      async finalizeRun({ record: previous, normalDone }) {
        assert.equal(normalDone, true);
        reconciliations += 1;
        previous.finalization.complete = true;
        previous.evidence.owned_branch_cleanup = {
          checked_at: new Date().toISOString(),
          refs: [{ branch: baseBranch, expected_commit: mergeCommit, status: 'absent', commit: null }],
          remaining_refs: []
        };
      }
    }
  });

  const result = await admission.checkRunAdmission();

  assert.equal(reconciliations, 1);
  assert.equal(result.workload, workload);
  assert.deepEqual(record.evidence.owned_branch_cleanup.remaining_refs, []);
});

test('admission rechecks a recorded runtime and blocks when it remains dispatch-capable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-admission-live-runtime-'));
  const config = {
    notion_database_url: 'https://notion.example/database',
    run_record_directory: directory + '/runs',
    workspace_root: directory + '/workspaces'
  };
  const workload = { id: 'fixture', identifier: 'PLAN-FIXTURE', accepted_plan: '# Fixture\n', accepted_plan_sha256: 'hash', hard_cap_ms: 10 };
  const record = createRunRecord({ config, runId: 'run-live-runtime', workload, paths: createRunPaths(config, 'run-live-runtime') });
  record.status = 'finished';
  record.runtime = { dashboard: 'http://127.0.0.1:4410', runtime_id: 'runtime-live' };
  record.timing.symphony.started_at = new Date().toISOString();
  record.artifacts.task_id = 'page-1';
  record.artifacts.task_identifier = 'PLAN-FIXTURE';
  record.finalization.complete = true;
  record.cleanup.runtime_stopped = true;
  const task = { id: 'page-1', identifier: 'PLAN-FIXTURE', state: 'Cancelled', accepted_plan: workload.accepted_plan };
  let reconciliationCalls = 0;
  let taskListCalls = 0;
  const admission = new RunAdmission({
    config,
    catalog: workload,
    runRecordStore: { async listRecords() { return [record]; }, async save() {} },
    notionClient: {
      async readTask() { return task; },
      async listTasks() { taskListCalls += 1; return []; }
    },
    operatorClient: {
      async readSymphonyRuntimeStatus() { return { runtime_id: 'runtime-live', dispatch_capable: true }; },
      async workspaceExists() { return false; }
    },
    runFinalizer: {
      async finalizeRun({ record: previous }) {
        reconciliationCalls += 1;
        previous.cleanup.runtime_stopped = false;
        previous.finalization.complete = false;
        previous.finalization.unresolved.push('stop_run_owned_symphony');
        previous.cleanup.unresolved.push('stop_run_owned_symphony');
      }
    }
  });

  await assert.rejects(admission.checkRunAdmission(), /previous E2E run run-live-runtime has unresolved owned runtime cleanup/);

  assert.equal(reconciliationCalls, 1);
  assert.equal(taskListCalls, 0);
  assert.equal(record.evidence.owned_runtime_cleanup.status, 'present');
  assert.ok(record.finalization.unresolved.includes('verify_run_owned_symphony_runtime'));
  assert.ok(record.cleanup.unresolved.includes('verify_run_owned_symphony_runtime'));
  assert.equal(record.finalization.complete, false);
});
