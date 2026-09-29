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
