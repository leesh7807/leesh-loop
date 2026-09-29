import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunFinalizer } from '../run/finalization/run-finalizer.mjs';
import { createRunPaths } from '../model/e2e-project-config.mjs';
import { createRunRecord } from '../model/run-record-store.mjs';
import { GitHubClient } from '../systems/github/github-client.mjs';

test('finalization preserves an external stop failure and still converges finitely', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-finalize-'));
  const config = { notion_database_url: 'https://notion.example/database', repository_url: 'git@github.com:owner/repo.git', run_record_directory: directory + '/runs', workspace_root: directory + '/workspaces', finalization_timeout_ms: 20, runtime_stop_timeout_ms: 20 };
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
  const git = { async readRemoteBranchCommit() { return null; }, async deleteRemoteBranch() { deleteCalls += 1; return { already_absent: true }; } };
  const evidence = { async collectSnapshot() { return { observed_at: new Date().toISOString(), notion: { id: 'page-1', identifier: 'PLAN-FIXTURE', state: 'In Progress', accepted_plan: '# Fixture\n', workpad: '' }, github: { delivery_prs: [] }, symphony: {}, chatgpt_shot: null, errors: [] }; } };
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
  const config = { notion_database_url: 'https://notion.example/database', repository_url: 'git@github.com:owner/repo.git', run_record_directory: directory + '/runs', workspace_root: directory + '/workspaces', finalization_timeout_ms: 20, runtime_stop_timeout_ms: 20 };
  const workload = { id: 'fixture', identifier: 'PLAN-FIXTURE', accepted_plan: '# Fixture\n', accepted_plan_sha256: 'hash', hard_cap_ms: 10 };
  const record = createRunRecord({ config, runId: 'run-1', workload, paths: createRunPaths(config, 'run-1') });
  record.binding.base_branch = 'base/run-1';
  record.timing.symphony.started_at = new Date().toISOString();
  let stopCalls = 0;
  const notion = { async readTask() { return { id: 'page-1', identifier: 'PLAN-FIXTURE', state: 'Cancelled', accepted_plan: '# Fixture\n', workpad: '' }; } };
  const store = { async save() {} };
  const runtime = { async stopConfiguredOperatorProject() { stopCalls += 1; if (stopCalls === 1) throw new Error('temporary stop failure'); return { stopped: true }; }, async removeWorkspaceRoot(path) { return { path, removed: true }; } };
  const git = { async readRemoteBranchCommit() { return null; }, async deleteRemoteBranch() { return { already_absent: true }; } };
  const evidence = { async collectSnapshot() { return { observed_at: new Date().toISOString(), notion: { id: 'page-1', identifier: 'PLAN-FIXTURE', state: 'Cancelled', accepted_plan: '# Fixture\n', workpad: '' }, github: { delivery_prs: [] }, symphony: {}, chatgpt_shot: null, errors: [] }; } };
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
  const config = { notion_database_url: 'https://notion.example/database', repository_url: 'git@github.com:owner/repo.git', run_record_directory: directory + '/runs', workspace_root: directory + '/workspaces', finalization_timeout_ms: 20, runtime_stop_timeout_ms: 20 };
  const workload = { id: 'fixture', identifier: 'PLAN-FIXTURE', accepted_plan: '# Fixture\n', accepted_plan_sha256: 'hash', hard_cap_ms: 10 };
  const record = createRunRecord({ config, runId: 'run-starting', workload, paths: createRunPaths(config, 'run-starting') });
  record.binding.base_branch = 'base/run-starting';
  record.timing.symphony.start_requested_at = new Date().toISOString();
  let stopCalls = 0;
  const notion = { async readTask() { return { id: 'page-1', identifier: 'PLAN-FIXTURE', state: 'Cancelled', accepted_plan: '# Fixture\n', workpad: '' }; } };
  const store = { async save() {} };
  const runtime = { async stopConfiguredOperatorProject() { stopCalls += 1; return { stopped: true }; }, async removeWorkspaceRoot(path) { return { path, removed: true }; } };
  const git = { async readRemoteBranchCommit() { return null; }, async deleteRemoteBranch() { return { already_absent: true }; } };
  const evidence = { async collectSnapshot() { return { observed_at: new Date().toISOString(), notion: { id: 'page-1', identifier: 'PLAN-FIXTURE', state: 'Cancelled', accepted_plan: '# Fixture\n', workpad: '' }, github: {}, symphony: {}, chatgpt_shot: null, errors: [] }; } };
  const finalizer = new RunFinalizer({ config, runRecordStore: store, notionClient: notion, operatorClient: runtime, gitClient: git, githubClient: {}, runEvidenceCollector: evidence });
  const result = await finalizer.finalizeRun({ record, reason: 'admission_reconciliation', task: await notion.readTask(), baseBranch: 'base/run-starting', workspaceRoot: directory + '/workspaces' });
  assert.equal(stopCalls, 1);
  assert.equal(result.cleanup.runtime_stopped, true);
  assert.equal(result.finalization.complete, true);
});

test('finalization cleans and verifies only run-owned branches when unrelated remote refs change', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-finalize-refs-'));
  const config = { notion_database_url: 'https://notion.example/database', repository_url: 'git@github.com:owner/repo.git', run_record_directory: directory + '/runs', workspace_root: directory + '/workspaces', finalization_timeout_ms: 20, runtime_stop_timeout_ms: 20 };
  const workload = { id: 'fixture', identifier: 'PLAN-FIXTURE', accepted_plan: '# Fixture\n', accepted_plan_sha256: 'hash', hard_cap_ms: 10 };
  const record = createRunRecord({ config, runId: 'run-refs', workload, paths: createRunPaths(config, 'run-refs') });
  record.binding.base_branch = 'base/run-refs';
  record.binding.base_commit = 'd'.repeat(40);
  record.timing.symphony.started_at = new Date().toISOString();
  record.evidence.branch_refs_before = { 'refs/heads/main': 'a', 'refs/heads/deleted-before-run': 'd' };
  record.evidence.branch_refs_after = { 'refs/heads/feature': 'e'.repeat(40), 'refs/heads/previous-owned': 'f'.repeat(40), 'refs/heads/base/run-refs': 'd'.repeat(40) };
  record.evidence.branch_isolation = { unrelated_changes: ['refs/heads/main'], unrelated_deletions: ['refs/heads/deleted-before-run'], unresolved_new_refs: ['refs/heads/worker-leftover'], remaining_run_owned_refs: ['refs/heads/previous-owned'] };
  record.finalization.unresolved = ['verify_remote_branch_isolation'];
  record.finalization.incomplete = true;
  record.cleanup.unresolved = ['verify_remote_branch_isolation'];
  const deliveryUrl = 'https://github.com/owner/repo/pull/7';
  record.evidence.snapshots.push({ notion: { workpad: `Human Review\ncycle: 1\ndelivered_pr: ${deliveryUrl}\n` } });
  const notion = { async readTask() { return { id: 'page-1', identifier: 'PLAN-FIXTURE', state: 'Cancelled', accepted_plan: '# Fixture\n', workpad: '' }; } };
  const store = { async save() {} };
  const runtime = { async stopConfiguredOperatorProject() { return { stopped: true }; }, async removeWorkspaceRoot(path) { return { path, removed: true }; } };
  const remoteBranches = new Map([['main', 'b'.repeat(40)], ['operator-created-during-run', 'c'.repeat(40)], ['base/run-refs', 'd'.repeat(40)], ['feature', 'e'.repeat(40)], ['previous-owned', 'f'.repeat(40)]]);
  const deletionCalls = [];
  const readCalls = [];
  const git = {
    async readRemoteBranchCommit(branch) { readCalls.push(branch); return remoteBranches.get(branch) || null; },
    async deleteRemoteBranch(branch) { deletionCalls.push(branch); remoteBranches.delete(branch); return { branch, deleted: true }; }
  };
  const deliveryPr = { number: 7, url: deliveryUrl, baseRefName: 'base/run-refs', headRefName: 'feature', headRefOid: 'e'.repeat(40), isCrossRepository: false, headRepository: { nameWithOwner: 'owner/repo' } };
  const evidence = { async collectSnapshot() { return { observed_at: new Date().toISOString(), notion: { id: 'page-1', identifier: 'PLAN-FIXTURE', state: 'Cancelled', accepted_plan: '# Fixture\n', workpad: `Human Review\ncycle: 1\ndelivered_pr: ${deliveryUrl}\n` }, github: { delivery_prs: [deliveryPr] }, symphony: {}, chatgpt_shot: null, errors: [] }; } };
  const finalizer = new RunFinalizer({ config, runRecordStore: store, notionClient: notion, operatorClient: runtime, gitClient: git, githubClient: new GitHubClient({ repositoryUrl: 'https://github.com/owner/repo.git' }), runEvidenceCollector: evidence });
  const result = await finalizer.finalizeRun({ record, reason: 'hard_cap_reached', task: await notion.readTask(), baseBranch: 'base/run-refs', workspaceRoot: directory + '/workspaces' });
  assert.deepEqual(deletionCalls, ['feature', 'previous-owned', 'base/run-refs']);
  assert.deepEqual([...new Set(readCalls)], ['feature', 'previous-owned', 'base/run-refs']);
  assert.deepEqual(result.evidence.owned_branch_cleanup.refs.map(ref => [ref.branch, ref.status]), [['feature', 'absent'], ['previous-owned', 'absent'], ['base/run-refs', 'absent']]);
  assert.equal(result.evidence.branch_refs_before['refs/heads/main'], 'a');
  assert.deepEqual(result.evidence.branch_isolation.unresolved_new_refs, ['refs/heads/worker-leftover']);
  assert.equal(result.evidence.branch_refs_after['refs/heads/feature'], 'e'.repeat(40));
  assert.equal(Object.hasOwn(result.evidence, 'branch_isolation'), true);
  assert.equal(result.finalization.complete, true);
});

test('finalization records and blocks admission on a run-owned branch that remains', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-finalize-owned-residue-'));
  const config = { notion_database_url: 'https://notion.example/database', repository_url: 'git@github.com:owner/repo.git', run_record_directory: directory + '/runs', workspace_root: directory + '/workspaces', finalization_timeout_ms: 20, runtime_stop_timeout_ms: 20 };
  const workload = { id: 'fixture', identifier: 'PLAN-FIXTURE', accepted_plan: '# Fixture\n', accepted_plan_sha256: 'hash', hard_cap_ms: 10 };
  const record = createRunRecord({ config, runId: 'run-owned-residue', workload, paths: createRunPaths(config, 'run-owned-residue') });
  record.binding.base_branch = 'base/run-owned-residue';
  record.binding.base_commit = 'a'.repeat(40);
  record.timing.symphony.started_at = new Date().toISOString();
  const notion = { async readTask() { return { id: 'page-1', identifier: 'PLAN-FIXTURE', state: 'Cancelled', accepted_plan: '# Fixture\n', workpad: '' }; } };
  const runtime = { async stopConfiguredOperatorProject() { return { stopped: true }; }, async removeWorkspaceRoot(path) { return { path, removed: true }; } };
  const git = { async deleteRemoteBranch() { return { branch: 'base/run-owned-residue', deleted: true }; }, async readRemoteBranchCommit() { return 'a'.repeat(40); } };
  const evidence = { async collectSnapshot() { return { observed_at: new Date().toISOString(), notion: { state: 'Cancelled' }, github: { delivery_prs: [] }, symphony: {}, errors: [] }; } };
  const finalizer = new RunFinalizer({ config, runRecordStore: { async save() {} }, notionClient: notion, operatorClient: runtime, gitClient: git, githubClient: {}, runEvidenceCollector: evidence });

  const result = await finalizer.finalizeRun({ record, reason: 'hard_cap_reached', task: await notion.readTask(), baseBranch: record.binding.base_branch, workspaceRoot: directory + '/workspaces' });
  assert.equal(result.finalization.complete, false);
  assert.ok(result.finalization.unresolved.includes('verify_run_owned_branch_cleanup'));
  assert.deepEqual(result.evidence.owned_branch_cleanup.remaining_refs, ['base/run-owned-residue']);
  assert.equal(result.failures.at(-1).phase, 'finalization');
});

test('finalization deletes a run-scoped base at its verified post-merge commit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-finalize-merged-base-'));
  const config = { notion_database_url: 'https://notion.example/database', repository_url: 'git@github.com:owner/repo.git', run_record_directory: directory + '/runs', workspace_root: directory + '/workspaces', finalization_timeout_ms: 20, runtime_stop_timeout_ms: 20 };
  const workload = { id: 'fixture', identifier: 'PLAN-FIXTURE', accepted_plan: '# Fixture\n', accepted_plan_sha256: 'hash', hard_cap_ms: 10 };
  const record = createRunRecord({ config, runId: 'run-merged-base', workload, paths: createRunPaths(config, 'run-merged-base') });
  const baseBranch = 'base/run-merged-base';
  const seedCommit = 'd'.repeat(40);
  const mergeCommit = 'e'.repeat(40);
  record.binding.base_branch = baseBranch;
  record.binding.base_commit = seedCommit;
  record.artifacts.remote_base_commit = mergeCommit;
  record.cleanup.runtime_stopped = true;
  let remoteBase = mergeCommit;
  const deleteCalls = [];
  const git = {
    async readRemoteBranchCommit(branch) { return branch === baseBranch ? remoteBase : null; },
    async deleteRemoteBranch(branch, { expectedCommit }) {
      deleteCalls.push({ branch, expectedCommit });
      assert.equal(branch, baseBranch);
      remoteBase = null;
      return { branch, deleted: true, expected_commit: expectedCommit };
    }
  };
  const evidence = { async collectSnapshot() { return { observed_at: new Date().toISOString(), notion: { state: 'Done', workpad: '' }, github: { delivery_prs: [] }, symphony: {}, errors: [] }; } };
  const finalizer = new RunFinalizer({ config, runRecordStore: { async save() {} }, notionClient: {}, operatorClient: {}, gitClient: git, githubClient: {}, runEvidenceCollector: evidence });

  const result = await finalizer.finalizeRun({ record, reason: 'production_done', task: { state: 'Done' }, baseBranch, normalDone: true });

  assert.deepEqual(deleteCalls, [{ branch: baseBranch, expectedCommit: mergeCommit }]);
  assert.equal(remoteBase, null);
  assert.equal(result.finalization.complete, true);
  assert.deepEqual(result.evidence.owned_branch_cleanup.refs.map(ref => [ref.branch, ref.expected_commit, ref.status]), [[baseBranch, mergeCommit, 'absent']]);
});

test('final absence readback clears a branch deletion failure after the ref was removed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-finalize-absence-retry-'));
  const config = { notion_database_url: 'https://notion.example/database', repository_url: 'git@github.com:owner/repo.git', run_record_directory: directory + '/runs', workspace_root: directory + '/workspaces', finalization_timeout_ms: 20, runtime_stop_timeout_ms: 20 };
  const workload = { id: 'fixture', identifier: 'PLAN-FIXTURE', accepted_plan: '# Fixture\n', accepted_plan_sha256: 'hash', hard_cap_ms: 10 };
  const record = createRunRecord({ config, runId: 'run-delete-readback-retry', workload, paths: createRunPaths(config, 'run-delete-readback-retry') });
  record.binding.base_branch = 'base/run-delete-readback-retry';
  record.binding.base_commit = 'a'.repeat(40);
  let branchPresent = true;
  const notion = { async readTask() { return { id: 'page-1', identifier: 'PLAN-FIXTURE', state: 'Cancelled', accepted_plan: '# Fixture\n', workpad: '' }; } };
  const evidence = { async collectSnapshot() { return { observed_at: new Date().toISOString(), notion: { state: 'Cancelled', workpad: '' }, github: { delivery_prs: [] }, symphony: {}, errors: [] }; } };
  const git = {
    async readRemoteBranchCommit(branch) { return branch === record.binding.base_branch && branchPresent ? record.binding.base_commit : null; },
    async deleteRemoteBranch(branch, { expectedCommit }) { assert.equal(branch, record.binding.base_branch); assert.equal(expectedCommit, record.binding.base_commit); branchPresent = false; throw new Error('post-delete branch readback failed transiently'); }
  };
  const finalizer = new RunFinalizer({ config, runRecordStore: { async save() {} }, notionClient: notion, operatorClient: {}, gitClient: git, githubClient: {}, runEvidenceCollector: evidence });

  const result = await finalizer.finalizeRun({ record, reason: 'admission_reconciliation', task: await notion.readTask(), baseBranch: record.binding.base_branch });
  assert.equal(result.finalization.complete, true);
  assert.deepEqual(result.finalization.unresolved, []);
  assert.deepEqual(result.cleanup.unresolved, []);
  assert.deepEqual(result.evidence.owned_branch_cleanup.refs.map(ref => [ref.branch, ref.status]), [[record.binding.base_branch, 'absent']]);
  assert.ok(result.finalization.actions.some(action => action.action === `delete_run_scoped_base:${record.binding.base_branch}` && action.status === 'failed'));
  assert.ok(result.finalization.actions.some(action => action.action === `confirm_run_owned_branch_absent:${record.binding.base_branch}` && action.status === 'completed'));
});

test('finalization keeps a changed delivery ref unresolved when current GitHub evidence is unavailable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-finalize-reused-ref-'));
  const config = { notion_database_url: 'https://notion.example/database', repository_url: 'git@github.com:owner/repo.git', run_record_directory: directory + '/runs', workspace_root: directory + '/workspaces', finalization_timeout_ms: 20, runtime_stop_timeout_ms: 20 };
  const workload = { id: 'fixture', identifier: 'PLAN-FIXTURE', accepted_plan: '# Fixture\n', accepted_plan_sha256: 'hash', hard_cap_ms: 10 };
  const record = createRunRecord({ config, runId: 'run-reused-ref', workload, paths: createRunPaths(config, 'run-reused-ref') });
  record.artifacts.delivery_pr_url = 'https://github.com/owner/repo/pull/7';
  record.artifacts.delivery_branch = 'feature';
  record.artifacts.delivery_branches = ['feature'];
  record.artifacts.delivered_head = 'a'.repeat(40);
  record.artifacts.owned_deliveries = [{ pr_url: record.artifacts.delivery_pr_url, branch: 'feature', head: 'a'.repeat(40) }];
  const mergeTargetHead = 'b'.repeat(40);
  const currentOtherTaskHead = 'c'.repeat(40);
  const workpad = `Merging\ncycle: 1\napproved_pr: ${record.artifacts.delivery_pr_url}\napproved_head: ${'a'.repeat(40)}\nmerge_target_head: ${mergeTargetHead}\nattempt: merged\n`;
  let deleteCalls = 0;
  const deleteCommits = [];
  const notion = { async readTask() { return { id: 'page-1', identifier: 'PLAN-FIXTURE', state: 'Cancelled', accepted_plan: '# Fixture\n', workpad: '' }; } };
  const evidence = { async collectSnapshot() { return { observed_at: new Date().toISOString(), notion: { state: 'Cancelled', workpad }, github: { delivery_prs: null }, symphony: {}, errors: ['GitHub PR inspection unavailable'] }; } };
  const git = {
    async readRemoteBranchCommit(branch) { return branch === 'feature' ? currentOtherTaskHead : null; },
    async deleteRemoteBranch(_branch, { expectedCommit }) { deleteCalls += 1; deleteCommits.push(expectedCommit); throw new Error(`run-owned branch feature changed before deletion (expected ${expectedCommit})`); }
  };
  const finalizer = new RunFinalizer({ config, runRecordStore: { async save() {} }, notionClient: notion, operatorClient: { async stopConfiguredOperatorProject() { return { stopped: true }; } }, gitClient: git, githubClient: new GitHubClient({ repositoryUrl: 'https://github.com/owner/repo.git' }), runEvidenceCollector: evidence });

  const result = await finalizer.finalizeRun({ record, reason: 'admission_reconciliation', task: await notion.readTask() });
  assert.equal(deleteCalls, 1);
  assert.deepEqual(deleteCommits, [mergeTargetHead]);
  assert.equal(result.finalization.complete, false);
  assert.ok(result.cleanup.unresolved.includes('delete_delivery_branch:feature'));
  assert.deepEqual(result.evidence.owned_branch_cleanup.refs.map(ref => [ref.branch, ref.status, ref.commit]), [['feature', 'unconfirmed', currentOtherTaskHead]]);
  assert.deepEqual(result.evidence.owned_branch_cleanup.remaining_refs, ['feature']);
});

test('finalization cleans the same delivery branch at its recorded authorized Merging target head', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-finalize-merge-target-'));
  const config = { notion_database_url: 'https://notion.example/database', repository_url: 'git@github.com:owner/repo.git', run_record_directory: directory + '/runs', workspace_root: directory + '/workspaces', finalization_timeout_ms: 20, runtime_stop_timeout_ms: 20 };
  const workload = { id: 'fixture', identifier: 'PLAN-FIXTURE', accepted_plan: '# Fixture\n', accepted_plan_sha256: 'hash', hard_cap_ms: 10 };
  const record = createRunRecord({ config, runId: 'run-merge-target', workload, paths: createRunPaths(config, 'run-merge-target') });
  const deliveryUrl = 'https://github.com/owner/repo/pull/7';
  const approvedHead = 'a'.repeat(40);
  const mergeTargetHead = 'b'.repeat(40);
  record.artifacts.delivery_pr_url = deliveryUrl;
  record.artifacts.delivery_branch = 'feature';
  record.artifacts.delivery_branches = ['feature'];
  record.artifacts.delivered_head = approvedHead;
  record.artifacts.owned_deliveries = [{ pr_url: deliveryUrl, branch: 'feature', head: approvedHead }];
  const workpad = `Merging\ncycle: 1\napproved_pr: ${deliveryUrl}\napproved_head: ${approvedHead}\nmerge_target_head: ${mergeTargetHead}\nattempt: merged\n`;
  let remoteHead = mergeTargetHead;
  const deleteCommits = [];
  const notion = { async readTask() { return { id: 'page-1', identifier: 'PLAN-FIXTURE', state: 'Cancelled', accepted_plan: '# Fixture\n', workpad }; } };
  const evidence = { async collectSnapshot() { return { observed_at: new Date().toISOString(), notion: { state: 'Cancelled', workpad }, github: { delivery_prs: null }, symphony: {}, errors: ['GitHub PR inspection unavailable'] }; } };
  const git = {
    async readRemoteBranchCommit(branch) { return branch === 'feature' ? remoteHead : null; },
    async deleteRemoteBranch(branch, { expectedCommit }) { deleteCommits.push([branch, expectedCommit]); remoteHead = null; return { branch, deleted: true, expected_commit: expectedCommit }; }
  };
  const finalizer = new RunFinalizer({ config, runRecordStore: { async save() {} }, notionClient: notion, operatorClient: { async stopConfiguredOperatorProject() { return { stopped: true }; } }, gitClient: git, githubClient: new GitHubClient({ repositoryUrl: 'https://github.com/owner/repo.git' }), runEvidenceCollector: evidence });

  const result = await finalizer.finalizeRun({ record, reason: 'admission_reconciliation', task: await notion.readTask() });
  assert.deepEqual(deleteCommits, [['feature', mergeTargetHead]]);
  assert.equal(result.finalization.complete, true);
  assert.deepEqual(result.evidence.owned_branch_cleanup.remaining_refs, []);
});

test('reconciliation does not revisit a delivery branch after its recorded delete completed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-finalize-reused-ref-retry-'));
  const config = { notion_database_url: 'https://notion.example/database', repository_url: 'git@github.com:owner/repo.git', run_record_directory: directory + '/runs', workspace_root: directory + '/workspaces', finalization_timeout_ms: 20, runtime_stop_timeout_ms: 20 };
  const workload = { id: 'fixture', identifier: 'PLAN-FIXTURE', accepted_plan: '# Fixture\n', accepted_plan_sha256: 'hash', hard_cap_ms: 10 };
  const record = createRunRecord({ config, runId: 'run-reused-ref-retry', workload, paths: createRunPaths(config, 'run-reused-ref-retry') });
  record.artifacts.delivery_branch = 'feature';
  record.artifacts.delivery_branches = ['feature'];
  record.artifacts.delivered_head = 'a'.repeat(40);
  record.artifacts.owned_deliveries = [{ pr_url: 'https://github.com/owner/repo/pull/7', branch: 'feature', head: 'a'.repeat(40) }];
  record.cleanup.branches_deleted = ['feature'];
  record.finalization.actions.push({ action: 'delete_delivery_branch:feature', status: 'completed' });
  const remoteHead = 'b'.repeat(40);
  const reads = [];
  const deletions = [];
  const notion = { async readTask() { return { id: 'page-1', identifier: 'PLAN-FIXTURE', state: 'Cancelled', accepted_plan: '# Fixture\n', workpad: '' }; } };
  const evidence = { async collectSnapshot() { return { observed_at: new Date().toISOString(), notion: { state: 'Cancelled' }, github: { delivery_prs: [] }, symphony: {}, errors: [] }; } };
  const git = { async readRemoteBranchCommit(branch) { reads.push(branch); return branch === 'feature' ? remoteHead : null; }, async deleteRemoteBranch(branch) { deletions.push(branch); } };
  const finalizer = new RunFinalizer({ config, runRecordStore: { async save() {} }, notionClient: notion, operatorClient: { async stopConfiguredOperatorProject() { return { stopped: true }; } }, gitClient: git, githubClient: {}, runEvidenceCollector: evidence });

  const result = await finalizer.finalizeRun({ record, reason: 'admission_reconciliation', task: await notion.readTask() });
  assert.equal(result.finalization.complete, true);
  assert.deepEqual(reads, []);
  assert.deepEqual(deletions, []);
});
