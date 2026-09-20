import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunFinalizer } from '../run/finalization/run-finalizer.mjs';
import { createRunPaths } from '../model/e2e-project-config.mjs';
import { createRunRecord } from '../model/run-record-store.mjs';

test('finalization preserves an external stop failure and still converges finitely', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-finalize-'));
  const config = { notion_database_url: 'https://app.notion.com/p/studyleesh/3e08a2658625805cad23fe1137be4a1e?v=3e08a26586258042a8e4000c945e56e7', repository_url: 'git@github.com:owner/repo.git', run_record_directory: directory + '/runs', workspace_root: directory + '/workspaces', finalization_timeout_ms: 20, runtime_stop_timeout_ms: 20 };
  const workload = { id: 'fixture', identifier: 'PLAN-FIXTURE', accepted_plan: '# Fixture\n', accepted_plan_sha256: 'hash', hard_cap_ms: 10 };
  const record = createRunRecord({ config, runId: 'run-1', workload, paths: createRunPaths(config, 'run-1') });
  record.binding.base_branch = 'base/run-1';
  record.timing.symphony.started_at = new Date().toISOString();
  record.evidence.workspace_paths = [directory + '/workspaces/page-1'];
  const notion = {
    async readTask() { return { id: 'page-1', identifier: 'PLAN-FIXTURE', state: 'In Progress', accepted_plan: '# Fixture\n', workpad: '' }; },
    async updateTaskState() { throw new Error('must not mutate task while runtime stop is unconfirmed'); }
  };
  const store = { async save() {} };
  const runtime = { async stopConfiguredOperatorProject() { throw new Error('stop unavailable'); } };
  let deleteCalls = 0;
  const git = { async listRemoteBranchRefs() { return {}; }, async deleteRemoteBranch() { deleteCalls += 1; return { already_absent: true }; } };
  const evidence = { async collectSnapshot() { return { observed_at: new Date().toISOString(), notion: { id: 'page-1', identifier: 'PLAN-FIXTURE', state: 'In Progress', accepted_plan: '# Fixture\n', workpad: '' }, github: { delivery_prs: [] }, symphony: {}, git: { remote_refs: {} }, chatgpt_shot: null, errors: [] }; } };
  const finalizer = new RunFinalizer({ config, runRecordStore: store, notionClient: notion, operatorClient: runtime, gitClient: git, githubClient: {}, runEvidenceCollector: evidence });
  const result = await finalizer.finalizeRun({ record, reason: 'hard_cap_reached', task: await notion.readTask(), baseBranch: 'base/run-1', workspaceRoot: directory + '/workspaces' });
  assert.equal(result.status, 'finished');
  assert.equal(result.cleanup.task_terminalized, false);
  assert.equal(result.finalization.complete, false);
  assert.ok(result.finalization.unresolved.some(action => action === 'stop_run_owned_symphony'));
  assert.equal(deleteCalls, 0);
  assert.deepEqual(result.cleanup.workspaces_deleted, []);
});

test('successful reconciliation clears an earlier unresolved action', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-finalize-retry-'));
  const config = { notion_database_url: 'https://app.notion.com/p/studyleesh/3e08a2658625805cad23fe1137be4a1e?v=3e08a26586258042a8e4000c945e56e7', repository_url: 'git@github.com:owner/repo.git', run_record_directory: directory + '/runs', workspace_root: directory + '/workspaces', finalization_timeout_ms: 20, runtime_stop_timeout_ms: 20 };
  const workload = { id: 'fixture', identifier: 'PLAN-FIXTURE', accepted_plan: '# Fixture\n', accepted_plan_sha256: 'hash', hard_cap_ms: 10 };
  const record = createRunRecord({ config, runId: 'run-1', workload, paths: createRunPaths(config, 'run-1') });
  record.binding.base_branch = 'base/run-1';
  record.timing.symphony.started_at = new Date().toISOString();
  let stopCalls = 0;
  const notion = { async readTask() { return { id: 'page-1', identifier: 'PLAN-FIXTURE', state: 'Cancelled', accepted_plan: '# Fixture\n', workpad: '' }; } };
  const store = { async save() {} };
  const runtime = { async stopConfiguredOperatorProject() { stopCalls += 1; if (stopCalls === 1) throw new Error('temporary stop failure'); return { stopped: true }; }, async removeWorkspaceRoot(path) { return { path, removed: true }; } };
  const git = { async listRemoteBranchRefs() { return {}; }, async deleteRemoteBranch() { return { already_absent: true }; } };
  const evidence = { async collectSnapshot() { return { observed_at: new Date().toISOString(), notion: { id: 'page-1', identifier: 'PLAN-FIXTURE', state: 'Cancelled', accepted_plan: '# Fixture\n', workpad: '' }, github: { delivery_prs: [] }, symphony: {}, git: { remote_refs: {} }, chatgpt_shot: null, errors: [] }; } };
  const finalizer = new RunFinalizer({ config, runRecordStore: store, notionClient: notion, operatorClient: runtime, gitClient: git, githubClient: {}, runEvidenceCollector: evidence });
  const first = await finalizer.finalizeRun({ record, reason: 'first_attempt', task: await notion.readTask(), baseBranch: 'base/run-1', workspaceRoot: directory + '/workspaces' });
  assert.equal(first.finalization.complete, false);
  const second = await finalizer.finalizeRun({ record, reason: 'reconciliation', task: await notion.readTask(), baseBranch: 'base/run-1', workspaceRoot: directory + '/workspaces' });
  assert.equal(second.finalization.complete, true);
  assert.deepEqual(second.finalization.unresolved, []);
  assert.deepEqual(second.cleanup.unresolved, []);
});

test('reconciliation stops a runtime whose start was durably requested before a crash', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-finalize-starting-'));
  const config = { notion_database_url: 'https://app.notion.com/p/studyleesh/3e08a2658625805cad23fe1137be4a1e?v=3e08a26586258042a8e4000c945e56e7', repository_url: 'git@github.com:owner/repo.git', run_record_directory: directory + '/runs', workspace_root: directory + '/workspaces', finalization_timeout_ms: 20, runtime_stop_timeout_ms: 20 };
  const workload = { id: 'fixture', identifier: 'PLAN-FIXTURE', accepted_plan: '# Fixture\n', accepted_plan_sha256: 'hash', hard_cap_ms: 10 };
  const record = createRunRecord({ config, runId: 'run-starting', workload, paths: createRunPaths(config, 'run-starting') });
  record.binding.base_branch = 'base/run-starting';
  record.timing.symphony.start_requested_at = new Date().toISOString();
  let stopCalls = 0;
  const notion = { async readTask() { return { id: 'page-1', identifier: 'PLAN-FIXTURE', state: 'Cancelled', accepted_plan: '# Fixture\n', workpad: '' }; } };
  const store = { async save() {} };
  const runtime = { async stopConfiguredOperatorProject() { stopCalls += 1; return { stopped: true }; }, async removeWorkspaceRoot(path) { return { path, removed: true }; } };
  const git = { async listRemoteBranchRefs() { return {}; }, async deleteRemoteBranch() { return { already_absent: true }; } };
  const evidence = { async collectSnapshot() { return { observed_at: new Date().toISOString(), notion: { id: 'page-1', identifier: 'PLAN-FIXTURE', state: 'Cancelled', accepted_plan: '# Fixture\n', workpad: '' }, github: {}, symphony: {}, git: { remote_refs: {} }, chatgpt_shot: null, errors: [] }; } };
  const finalizer = new RunFinalizer({ config, runRecordStore: store, notionClient: notion, operatorClient: runtime, gitClient: git, githubClient: {}, runEvidenceCollector: evidence });
  const result = await finalizer.finalizeRun({ record, reason: 'admission_reconciliation', task: await notion.readTask(), baseBranch: 'base/run-starting', workspaceRoot: directory + '/workspaces' });
  assert.equal(stopCalls, 1);
  assert.equal(result.cleanup.runtime_stopped, true);
  assert.equal(result.finalization.complete, true);
});

test('branch isolation distinguishes external changes from unresolved new refs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-finalize-refs-'));
  const config = { notion_database_url: 'https://app.notion.com/p/studyleesh/3e08a2658625805cad23fe1137be4a1e?v=3e08a26586258042a8e4000c945e56e7', repository_url: 'git@github.com:owner/repo.git', run_record_directory: directory + '/runs', workspace_root: directory + '/workspaces', finalization_timeout_ms: 20, runtime_stop_timeout_ms: 20 };
  const workload = { id: 'fixture', identifier: 'PLAN-FIXTURE', accepted_plan: '# Fixture\n', accepted_plan_sha256: 'hash', hard_cap_ms: 10 };
  const record = createRunRecord({ config, runId: 'run-refs', workload, paths: createRunPaths(config, 'run-refs') });
  record.binding.base_branch = 'base/run-refs';
  record.timing.symphony.started_at = new Date().toISOString();
  record.evidence.branch_refs_before = { 'refs/heads/main': 'a', 'refs/heads/deleted-before-run': 'd' };
  const notion = { async readTask() { return { id: 'page-1', identifier: 'PLAN-FIXTURE', state: 'Cancelled', accepted_plan: '# Fixture\n', workpad: '' }; } };
  const store = { async save() {} };
  const runtime = { async stopConfiguredOperatorProject() { return { stopped: true }; }, async removeWorkspaceRoot(path) { return { path, removed: true }; } };
  const git = { async listRemoteBranchRefs() { return { 'refs/heads/main': 'b', 'refs/heads/worker-leftover': 'c' }; }, async deleteRemoteBranch() { return { already_absent: true }; } };
  const evidence = { async collectSnapshot() { return { observed_at: new Date().toISOString(), notion: { id: 'page-1', identifier: 'PLAN-FIXTURE', state: 'Cancelled', accepted_plan: '# Fixture\n', workpad: '' }, github: { delivery_prs: [] }, symphony: {}, git: { remote_refs: {} }, chatgpt_shot: null, errors: [] }; } };
  const finalizer = new RunFinalizer({ config, runRecordStore: store, notionClient: notion, operatorClient: runtime, gitClient: git, githubClient: {}, runEvidenceCollector: evidence });
  const result = await finalizer.finalizeRun({ record, reason: 'hard_cap_reached', task: await notion.readTask(), baseBranch: 'base/run-refs', workspaceRoot: directory + '/workspaces' });
  assert.deepEqual(result.evidence.branch_isolation.unrelated_changes, ['refs/heads/main']);
  assert.deepEqual(result.evidence.branch_isolation.unrelated_deletions, ['refs/heads/deleted-before-run']);
  assert.deepEqual(result.evidence.branch_isolation.unresolved_new_refs, ['refs/heads/worker-leftover']);
  assert.equal(result.finalization.complete, true);
});
