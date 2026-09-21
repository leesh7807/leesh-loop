import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateWorkloadCatalog } from '../model/workload-catalog.mjs';
import { derivePlanIdentifier } from '../model/plan-identity.mjs';
import { E2ERunner } from '../run/e2e-runner.mjs';
import { RunCompletionVerifier } from '../run/lifecycle/run-completion-verifier.mjs';
import { createRunRecord, RunRecordStore } from '../model/run-record-store.mjs';
import { createRunPaths } from '../model/e2e-project-config.mjs';

const plan = '# Representative task\n\nInspect the repository and write a concise note under docs/.\n';

function fixture({ states, clock, includeTrackerInput = true, reviewWorkpad, reviewEvidence } = {}) {
  const root = '/repo';
  const config = {
    repository_url: 'git@github.com:owner/repo.git',
    workflow_path: '/repo/WORKFLOW.md',
    notion_database_url: 'https://app.notion.com/p/studyleesh/3e08a2658625805cad23fe1137be4a1e?v=3e08a26586258042a8e4000c945e56e7',
    seed_source_ref: 'refs/heads/main',
    run_record_directory: root + '/runs',
    workspace_root: root + '/workspaces',
    poll_interval_ms: 1,
    finalization_timeout_ms: 100,
    runtime_start_timeout_ms: 100,
    runtime_stop_timeout_ms: 100,
    symphony_port: 4410,
    ui_port: 4610
  };
  let snapshotIndex = 0;
  let observedState = states[0];
  const deliveryHead = '0123456789012345678901234567890123456789';
  const mergeCommit = 'abcdefabcdefabcdefabcdefabcdefabcdefabcd';
  const deliveryUrl = 'https://github.com/owner/repo/pull/4';
  const humanReviewWorkpad = reviewWorkpad ?? `review target: ${deliveryUrl}\nreview head: ${deliveryHead}\nJob ID: 123e4567-e89b-42d3-a456-426614174000\n# Verdict\nPASS\nHuman Review\ncycle: 1\nreason: review\ndelivered_pr: ${deliveryUrl}\ndelivered_head: ${deliveryHead}\n`;
  const humanReviewEvidence = reviewEvidence ?? { job_id: '123e4567-e89b-42d3-a456-426614174000', terminal_state: 'completed', result: '# Verdict\nPASS' };
  const taskIdentifier = 'TASK-fixture-1';
  let publishedPlan = plan;
  const publishedPlans = [];
  const task = state => ({ id: 'page-1', url: 'https://notion/page-1', identifier: taskIdentifier, state, accepted_plan: publishedPlan, workpad: state === 'Human Review' ? humanReviewWorkpad : '' });
  const transitions = [];
  const notion = {
    async listTasks() { return []; },
    async listTasksForPlanIdentifier() { return [{ id: 'page-1', created_at: new Date(Date.now() + 1_000).toISOString() }]; },
    async readTask() { return task(observedState); },
    async updateTaskState(_databaseUrl, _taskId, nextState) { transitions.push(nextState); observedState = nextState; return task(observedState); },
    async appendWorkpad() {}
  };
  const runtime = { async startConfiguredOperatorProject() { return { dashboard: 'http://127.0.0.1:4410' }; }, async stopConfiguredOperatorProject() { return { stopped: true }; } };
  const git = {
    async listRemoteBranchRefs() { return {}; },
    async resolveSeedCommit() { return '0123456789012345678901234567890123456789'; },
    async createRunScopedBaseBranch(_branch, commit) { return commit; },
    async readRemoteBranchCommit() { return mergeCommit; },
    async verifyCommitOnRemoteBranch() { return true; },
    async deleteRemoteBranch() {}
  };
  const publisher = { async publishAcceptedPlan({ plan: acceptedPlan }) { publishedPlan = acceptedPlan; publishedPlans.push(acceptedPlan); return { page_id: 'page-1', url: 'https://notion/page-1', identifier: taskIdentifier, plan_identifier: derivePlanIdentifier(acceptedPlan) }; }, async prepareProductionPublisher() {} };
  const github = {
    async pullRequestsForBase(baseBranch) {
      return [{ number: 4, url: deliveryUrl, baseRefName: baseBranch, headRefName: 'feature', headRefOid: deliveryHead, mergedAt: observedState === 'Done' ? new Date(clock()).toISOString() : null, mergeCommit: observedState === 'Done' ? { oid: mergeCommit } : null }];
    },
    findRunOwnedDeliveryBranches() { return ['feature']; },
    findDeliveryPullRequest(prs, deliveredPr) { return prs.find(pr => pr.url === deliveredPr || String(pr.number) === String(deliveredPr).split('/').at(-1)); }
  };
  const evidence = {
    async collectSnapshot({ baseBranch }) {
      observedState = states[Math.min(snapshotIndex++, states.length - 1)];
      return { observed_at: new Date(clock()).toISOString(), notion: { id: 'page-1', url: 'https://notion/page-1', identifier: taskIdentifier, state: observedState, accepted_plan: publishedPlan, workpad: observedState === 'Human Review' ? humanReviewWorkpad : '' }, symphony: { runtime: {}, state: {}, issue: null, tracker_input: includeTrackerInput ? { description: publishedPlan } : null }, github: { delivery_prs: await github.pullRequestsForBase(baseBranch) }, git: { remote_refs: {} }, chatgpt_shot: observedState === 'Human Review' ? humanReviewEvidence : null, errors: [] };
    }
  };
  const store = new RunRecordStore(config);
  const finalized = [];
  const finalizer = { async finalizeRun({ record, reason, task: currentTask }) { finalized.push(reason); if (reason === 'reentered_human_review') { const cancelled = await notion.updateTaskState(config.notion_database_url, currentTask.id, 'Cancelled'); assert.equal(cancelled.state, 'Cancelled'); record.cleanup.task_terminalized = true; } record.status = 'finished'; record.finalization.reason = reason; record.finalization.complete = true; record.ended_at = new Date(clock()).toISOString(); await store.save(record); return record; } };
  return { config, catalog: validateWorkloadCatalog([{ id: 'representative', hard_cap_ms: 5, accepted_plan: plan }]), notionClient: notion, operatorClient: runtime, gitClient: git, notionPublisherClient: publisher, githubClient: github, runEvidenceCollector: evidence, runFinalizer: finalizer, runRecordStore: store, finalized, transitions, publishedPlans };
}

test('E2ERunner reaches terminal Done through injected production dependencies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-orchestrator-'));
  let current = 0;
  const harness = fixture({ states: ['Ready', 'In Progress', 'Human Review', 'Merging', 'Done'], clock: () => current++ });
  harness.config.run_record_directory = directory + '/runs';
  harness.config.workspace_root = directory + '/workspaces';
  const persistedStartRequests = [];
  const start = harness.operatorClient.startConfiguredOperatorProject;
  harness.operatorClient.startConfiguredOperatorProject = async (...args) => {
    const persisted = (await harness.runRecordStore.listRecords()).at(-1);
    persistedStartRequests.push(persisted.timing.symphony.start_requested_at);
    return start(...args);
  };
  const record = await new E2ERunner({ ...harness, random: () => 0, clock: () => current++, waitForPoll: async () => {} }).runProductionE2E();
  assert.equal(record.status, 'finished');
  assert.deepEqual(harness.finalized, ['production_done']);
  assert.equal(record.binding.seed_commit.length, 40);
  assert.equal(persistedStartRequests.length, 1);
  assert.ok(persistedStartRequests[0]);
  assert.equal(record.lifecycle.observations[0].state, 'Ready');
  assert.equal(record.workload.execution_number, 1);
  assert.equal(harness.publishedPlans[0].startsWith('# Representative task-1\n'), true);
  assert.equal(record.artifacts.merged_head, '0123456789012345678901234567890123456789');
  assert.equal(record.artifacts.remote_base_commit, 'abcdefabcdefabcdefabcdefabcdefabcdefabcd');
  assert.match(await readFile(record.paths.record, 'utf8'), /production_done/);
  assert.deepEqual(harness.transitions, ['Merging']);
  assert.equal(record.lifecycle.mechanical_human_review_transition.performed, true);
  assert.equal(Object.hasOwn(record.artifacts, 'mechanical_approval'), false);
});

test('first Human Review transition ignores workpad and independent review semantics', async () => {
  let current = 0;
  const harness = fixture({
    states: ['Ready', 'In Progress', 'Human Review', 'Merging', 'Cancelled'],
    clock: () => current++,
    includeTrackerInput: false,
    reviewWorkpad: 'Human Review\ncycle: unknown\nreason: blocker\ndelivered_pr: none\ndelivered_head: not-a-commit\n',
    reviewEvidence: { job_id: null, terminal_state: 'failed', result: '# Verdict\nFINDINGS' }
  });
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-mechanical-review-'));
  harness.config.run_record_directory = directory + '/runs';
  harness.config.workspace_root = directory + '/workspaces';
  const record = await new E2ERunner({ ...harness, random: () => 0, clock: () => current++, waitForPoll: async () => {} }).runProductionE2E();
  assert.deepEqual(harness.transitions, ['Merging']);
  assert.equal(record.lifecycle.mechanical_human_review_transition.performed, true);
  assert.equal(record.failures.length, 0);
});

test('re-entered Human Review is cancelled without a second Merging transition', async () => {
  let current = 0;
  const harness = fixture({ states: ['Ready', 'In Progress', 'Human Review', 'Merging', 'Human Review'], clock: () => current++ });
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-reentered-review-'));
  harness.config.run_record_directory = directory + '/runs';
  harness.config.workspace_root = directory + '/workspaces';
  const record = await new E2ERunner({ ...harness, random: () => 0, clock: () => current++, waitForPoll: async () => {} }).runProductionE2E();
  assert.deepEqual(harness.transitions, ['Merging', 'Cancelled']);
  assert.deepEqual(harness.finalized, ['reentered_human_review']);
  assert.equal(record.lifecycle.mechanical_human_review_transition.performed, true);
  assert.equal(record.cleanup.task_terminalized, true);
});

test('hard cap converges through the same finalization boundary', async () => {
  let current = 0;
  const base = Date.now();
  const harness = fixture({ states: ['In Progress'], clock: () => base + current++ * 10 });
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-cap-'));
  harness.config.run_record_directory = directory + '/runs';
  harness.config.workspace_root = directory + '/workspaces';
  const record = await new E2ERunner({ ...harness, random: () => 0, clock: () => base + current++ * 10, waitForPoll: async () => {} }).runProductionE2E();
  assert.equal(record.status, 'finished');
  assert.deepEqual(harness.finalized, ['hard_cap_reached']);
});

test('Done without an approved and verified delivery is recorded as unverified', async () => {
  let current = 0;
  const harness = fixture({ states: ['Done'], clock: () => current++, includeTrackerInput: false });
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-unverified-done-'));
  harness.config.run_record_directory = directory + '/runs';
  harness.config.workspace_root = directory + '/workspaces';
  const record = await new E2ERunner({ ...harness, random: () => 0, clock: () => current++, waitForPoll: async () => {} }).runProductionE2E();
  assert.equal(record.status, 'finished');
  assert.deepEqual(harness.finalized, ['done_unverified']);
  assert.equal(record.lifecycle.verified_through, null);
  assert.equal(record.failures.at(-1).phase, 'plan_binding');
});

test('Done rejects an unrelated merge into the run-scoped base', async () => {
  let current = 0;
  const harness = fixture({ states: ['Done'], clock: () => current++ });
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-unrelated-merge-'));
  harness.config.run_record_directory = directory + '/runs';
  harness.config.workspace_root = directory + '/workspaces';
  const deliveryEvidence = { github: { delivery_prs: [{ number: 4, url: 'https://github.com/owner/repo/pull/4', baseRefName: 'e2e-base', headRefOid: '0123456789012345678901234567890123456789' }] } };
  const record = {
    started_at: new Date(0).toISOString(),
    artifacts: { delivery_prs: deliveryEvidence.github.delivery_prs, delivered_head: '0123456789012345678901234567890123456789' },
    evidence: { snapshots: [deliveryEvidence] }
  };
  const original = harness.githubClient.pullRequestsForBase;
  harness.githubClient.pullRequestsForBase = async baseBranch => [
    ...(await original(baseBranch)),
    { number: 5, url: 'https://github.com/owner/repo/pull/5', baseRefName: baseBranch, headRefOid: 'fedcbafedcbafedcbafedcbafedcbafedcbafedc', mergedAt: new Date(2).toISOString(), mergeCommit: { oid: 'fedcbafedcbafedcbafedcbafedcbafedcbabbbb' } }
  ];
  const runner = new E2ERunner({ ...harness, random: () => 0, clock: () => current++ });
  const result = await runner.completionVerifier.verifyDoneDelivery(record, 'e2e-base');
  assert.equal(result.ok, false);
  assert.match(result.reason, /unrelated PR/);
});

test('Done rejects an observed but non-owned merged PR when no run delivery merged', async () => {
  const baseBranch = 'e2e-base';
  const mergeCommit = 'c'.repeat(40);
  const unrelated = { number: 5, url: 'https://github.com/owner/repo/pull/5', baseRefName: baseBranch, headRefName: 'preexisting', headRefOid: 'b'.repeat(40), mergedAt: '2026-09-21T00:02:00.000Z', mergeCommit: { oid: mergeCommit } };
  const record = {
    started_at: '2026-09-21T00:00:00.000Z',
    binding: { base_branch: baseBranch },
    evidence: { snapshots: [{ github: { delivery_prs: [unrelated] } }] }
  };
  const verifier = new RunCompletionVerifier({
    githubClient: { async pullRequestsForBase() { return [unrelated]; }, findRunOwnedDeliveryBranches() { return []; } },
    gitClient: { async readRemoteBranchCommit() { return mergeCommit; }, async verifyCommitOnRemoteBranch() { return true; } }
  });
  const result = await verifier.verifyDoneDelivery(record, baseBranch);
  assert.equal(result.ok, false);
  assert.match(result.reason, /no run-owned delivery PR is merged/);
});

test('Done uses the latest observed head after a run-owned PR is revised', async () => {
  const baseBranch = 'e2e-base';
  const deliveryUrl = 'https://github.com/owner/repo/pull/4';
  const revisedHead = 'b'.repeat(40);
  const mergeCommit = 'c'.repeat(40);
  const original = { number: 4, url: deliveryUrl, baseRefName: baseBranch, headRefName: 'feature', headRefOid: 'a'.repeat(40), mergedAt: null, mergeCommit: null };
  const revised = { ...original, headRefOid: revisedHead, mergedAt: '2026-09-21T00:02:00.000Z', mergeCommit: { oid: mergeCommit } };
  const record = {
    started_at: '2026-09-21T00:00:00.000Z',
    binding: { base_branch: baseBranch },
    artifacts: { delivered_head: revisedHead, delivered_head_locked: true },
    evidence: { snapshots: [{ github: { delivery_prs: [original] } }, { github: { delivery_prs: [revised] } }] }
  };
  const verifier = new RunCompletionVerifier({
    githubClient: { async pullRequestsForBase() { return [revised]; }, findRunOwnedDeliveryBranches() { return ['feature']; } },
    gitClient: { async readRemoteBranchCommit() { return mergeCommit; }, async verifyCommitOnRemoteBranch() { return true; } }
  });
  const result = await verifier.verifyDoneDelivery(record, baseBranch);
  assert.equal(result.ok, true);
  assert.equal(result.delivered_head, revisedHead);
});

test('Done rejects a delivery head changed after Human Review', async () => {
  const baseBranch = 'e2e-base';
  const deliveryUrl = 'https://github.com/owner/repo/pull/4';
  const originalHead = 'a'.repeat(40);
  const revisedHead = 'b'.repeat(40);
  const mergeCommit = 'c'.repeat(40);
  const original = { number: 4, url: deliveryUrl, baseRefName: baseBranch, headRefName: 'feature', headRefOid: originalHead, mergedAt: null, mergeCommit: null };
  const revised = { ...original, headRefOid: revisedHead, mergedAt: '2026-09-21T00:02:00.000Z', mergeCommit: { oid: mergeCommit } };
  const record = {
    started_at: '2026-09-21T00:00:00.000Z',
    binding: { base_branch: baseBranch },
    artifacts: { delivered_head: originalHead, delivered_head_locked: true },
    evidence: { snapshots: [{ github: { delivery_prs: [original] } }, { github: { delivery_prs: [revised] } }] }
  };
  const verifier = new RunCompletionVerifier({
    githubClient: { async pullRequestsForBase() { return [revised]; }, findRunOwnedDeliveryBranches() { return ['feature']; } },
    gitClient: { async readRemoteBranchCommit() { return mergeCommit; }, async verifyCommitOnRemoteBranch() { return true; } }
  });
  const result = await verifier.verifyDoneDelivery(record, baseBranch);
  assert.equal(result.ok, false);
  assert.match(result.reason, /source HEAD changed/);
});

test('Done rejects missing Human Review delivery-head evidence', async () => {
  const baseBranch = 'e2e-base';
  const revisedHead = 'b'.repeat(40);
  const mergeCommit = 'c'.repeat(40);
  const revised = { number: 4, url: 'https://github.com/owner/repo/pull/4', baseRefName: baseBranch, headRefName: 'feature', headRefOid: revisedHead, mergedAt: '2026-09-21T00:02:00.000Z', mergeCommit: { oid: mergeCommit } };
  const record = {
    started_at: '2026-09-21T00:00:00.000Z',
    binding: { base_branch: baseBranch },
    artifacts: { delivered_head: null, delivered_head_locked: true },
    evidence: { snapshots: [{ notion: { state: 'Human Review' }, github: { delivery_prs: [] } }, { notion: { state: 'Done' }, github: { delivery_prs: [revised] } }] }
  };
  const verifier = new RunCompletionVerifier({
    githubClient: { async pullRequestsForBase() { return [revised]; }, findRunOwnedDeliveryBranches() { return ['feature']; } },
    gitClient: { async readRemoteBranchCommit() { return mergeCommit; }, async verifyCommitOnRemoteBranch() { return true; } }
  });
  const result = await verifier.verifyDoneDelivery(record, baseBranch);
  assert.equal(result.ok, false);
  assert.match(result.reason, /no observed immutable source HEAD/);
});

test('Done rejects a configured base advanced after the approved merge', async () => {
  let current = 0;
  const harness = fixture({ states: ['Done'], clock: () => current++ });
  harness.gitClient.readRemoteBranchCommit = async () => 'fedcbafedcbafedcbafedcbafedcbafedcbafedc';
  const deliveryEvidence = { github: { delivery_prs: [{ number: 4, url: 'https://github.com/owner/repo/pull/4', baseRefName: 'e2e-base', headRefOid: '0123456789012345678901234567890123456789' }] } };
  const record = { started_at: new Date(0).toISOString(), artifacts: { delivery_prs: deliveryEvidence.github.delivery_prs, delivered_head: '0123456789012345678901234567890123456789' }, evidence: { snapshots: [deliveryEvidence] } };
  const result = await new E2ERunner({ ...harness, random: () => 0, clock: () => current++ }).completionVerifier.verifyDoneDelivery(record, 'e2e-base');
  assert.equal(result.ok, false);
  assert.match(result.reason, /contains changes after/);
});

test('admission does not treat unrelated branch changes as run-owned residue', async () => {
  const harness = fixture({ states: ['Ready'], clock: () => 0 });
  const previous = {
    run_id: 'run-previous',
    status: 'finished',
    failures: [],
    finalization: { complete: true },
    cleanup: { unresolved: [], runtime_stopped: true },
    evidence: { branch_isolation: { unrelated_changes: ['refs/heads/main'], remaining_run_owned_refs: [] } },
    timing: { symphony: { start_requested_at: null, started_at: null } },
    paths: {}
  };
  harness.runRecordStore = { async listRecords() { return [previous]; } };
  const result = await new E2ERunner({ ...harness, random: () => 0 }).admission.checkRunAdmission();
  assert.equal(result.workload.length, 1);
});

test('admission keeps catalog workloads eligible when prior task instances are terminal', async () => {
  const harness = fixture({ states: ['Ready'], clock: () => 0 });
  harness.notionClient.listTasks = async () => [
    { identifier: 'TASK-previous-done', state: 'Done' },
    { identifier: 'TASK-previous-cancelled', state: 'Cancelled' }
  ];
  const result = await new E2ERunner({ ...harness, random: () => 0 }).admission.checkRunAdmission();
  assert.equal(result.workload.length, 1);
  assert.equal(result.workload[0].plan_identifier, harness.catalog[0].plan_identifier);
});

test('admission blocks an unresolved new remote ref', async () => {
  const harness = fixture({ states: ['Ready'], clock: () => 0 });
  const previous = {
    run_id: 'run-previous',
    status: 'finished',
    failures: [],
    finalization: { complete: true },
    cleanup: { unresolved: [], runtime_stopped: true },
    evidence: { branch_isolation: { unrelated_changes: [], unresolved_new_refs: ['refs/heads/worker-leftover'], remaining_run_owned_refs: [] } },
    timing: { symphony: { start_requested_at: null, started_at: null } },
    paths: {}
  };
  harness.runRecordStore = { async listRecords() { return [previous]; } };
  harness.runFinalizer = { async finalizeRun({ record }) { return record; } };
  await assert.rejects(() => new E2ERunner({ ...harness, random: () => 0 }).admission.checkRunAdmission(), /remains unresolved/);
});

test('reconciliation rebinds a published task from its workload identity after a crash', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-publisher-crash-'));
  const harness = fixture({ states: ['Ready'], clock: () => 0 });
  harness.config.run_record_directory = directory + '/runs';
  harness.config.workspace_root = directory + '/workspaces';
  const workload = harness.catalog[0];
  const record = createRunRecord({ config: harness.config, runId: 'run-publisher-crash', workload, paths: createRunPaths(harness.config, 'run-publisher-crash') });
  record.status = 'published';
  const runner = new E2ERunner({ ...harness, random: () => 0 });
  await runner.admission.reconcileInterruptedRun(record);
  assert.equal(record.artifacts.task_id, 'page-1');
});

test('reconciliation does not accept Done without the normal delivery proof', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-done-crash-'));
  const harness = fixture({ states: ['Done'], clock: () => 0 });
  harness.githubClient.pullRequestsForBase = async () => [];
  harness.config.run_record_directory = directory + '/runs';
  harness.config.workspace_root = directory + '/workspaces';
  const workload = harness.catalog[0];
  const record = createRunRecord({ config: harness.config, runId: 'run-done-crash', workload, paths: createRunPaths(harness.config, 'run-done-crash') });
  record.status = 'observing';
  const runner = new E2ERunner({ ...harness, random: () => 0 });
  await runner.admission.reconcileInterruptedRun(record);
  assert.deepEqual(harness.finalized, ['done_unverified_reconciliation']);
  assert.equal(record.failures.at(-1).phase, 'done_verification');
});

test('reconciliation accepts Done with the same plan binding and delivery proof', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-done-recovery-'));
  const harness = fixture({ states: ['Done'], clock: () => 0 });
  harness.config.run_record_directory = directory + '/runs';
  harness.config.workspace_root = directory + '/workspaces';
  const workload = harness.catalog[0];
  const record = createRunRecord({ config: harness.config, runId: 'run-done-recovery', workload, paths: createRunPaths(harness.config, 'run-done-recovery') });
  record.status = 'observing';
  const runner = new E2ERunner({ ...harness, random: () => 0 });
  await runner.admission.reconcileInterruptedRun(record);

  assert.deepEqual(harness.finalized, ['admission_reconciliation']);
  assert.equal(record.artifacts.plan_binding.status, 'verified_by_production_tracker_input');
  assert.equal(record.artifacts.merged_head, '0123456789012345678901234567890123456789');
  assert.equal(record.artifacts.remote_base_commit, 'abcdefabcdefabcdefabcdefabcdefabcdefabcd');
  assert.equal(record.failures.length, 0);
});
