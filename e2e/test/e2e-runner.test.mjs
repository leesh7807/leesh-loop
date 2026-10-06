import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateWorkloadCatalog } from '../model/workload-catalog.mjs';
import { derivePlanIdentifier, sha256 } from '../model/plan-identity.mjs';
import { E2ERunner } from '../run/e2e-runner.mjs';
import { RunCompletionVerifier } from '../run/lifecycle/run-completion-verifier.mjs';
import { RunRecordStore } from '../model/run-record-store.mjs';
import { readProjectConfiguration } from '../../operator/project-config.mjs';

const plan = '# Representative task\n\nInspect the repository and write a concise note under docs/.\n';

function fixture({ states, clock, includeTrackerInput = true, reviewWorkpad, reviewEvidence, runInput, runtimePortPairs, runtimePortConflicts = [], runtimePortConflictResults = [] } = {}) {
  const root = '/repo';
  const config = {
    repository_url: 'git@github.com:owner/repo.git',
    workflow_path: '/repo/WORKFLOW.md',
    notion_database_url: 'https://www.notion.so/3ea8a2658625812c8849fa1087a2272a',
    notion_database_id: '3ea8a265-8625-812c-8849-fa1087a2272a',
    database_pool: [{ database_id: '3ea8a265-8625-812c-8849-fa1087a2272a', database_url: 'https://www.notion.so/3ea8a2658625812c8849fa1087a2272a' }],
    seed_source_ref: 'refs/heads/main',
    run_record_directory: root + '/e2e/runs',
    workspace_root: root + '/e2e/workspaces',
    poll_interval_ms: 1,
    evidence_snapshot_timeout_ms: 30_000,
    finalization_timeout_ms: 100,
    runtime_start_timeout_ms: 100,
    runtime_stop_timeout_ms: 100,
    runtime_port_attempts: 8,
  };
  let reservationSequence = 0;
  const reservationState = { database_id: config.database_pool[0].database_id, status: 'available', sequence: 0, sha: null, reservation: null, recovery_marker: null };
  const runLifecycles = new Map();
  const reservationAuthority = {
    async read() { return structuredClone(reservationState); },
    async reserve(_databaseId, reservation) { if (reservationState.status !== 'available') return { reserved: false, current: structuredClone(reservationState) }; reservationState.status = 'in use'; reservationState.reservation = { run_id: reservation.run_id, acquired_at: new Date(clock()).toISOString() }; reservationState.sequence = ++reservationSequence; reservationState.sha = `sha-${reservationSequence}`; return { reserved: true, state: structuredClone(reservationState) }; },
    async updateReservationMetadata(_databaseId, runId, metadata) { reservationState.reservation = { ...reservationState.reservation, ...metadata }; reservationState.sequence = ++reservationSequence; reservationState.sha = `sha-${reservationSequence}`; return { committed: reservationState.reservation.run_id === runId, state: structuredClone(reservationState) }; },
    async markUnavailable(_databaseId, runId, reason) { if (reservationState.reservation?.run_id !== runId) return { committed: false }; reservationState.status = 'unavailable'; reservationState.recovery_marker = `marker-${runId}`; reservationState.unavailable = { reason, run_id: runId, marker: reservationState.recovery_marker }; reservationState.reservation = null; return { committed: true, recovery_marker: reservationState.recovery_marker, state: structuredClone(reservationState) }; },
    async recordActiveRecoveryObservation() { return { committed: true }; },
    async updateRunLifecycleForReservation(_databaseId, runId, lifecycle) {
      if (reservationState.status !== 'in use' || reservationState.reservation?.run_id !== runId) return { committed: false };
      const next = { ...(runLifecycles.get(runId) || {}), ...lifecycle, run_id: runId };
      runLifecycles.set(runId, next);
      return { committed: true, lifecycle: next };
    },
    async writeRunLifecycle(runId, lifecycle) { runLifecycles.set(runId, { ...(runLifecycles.get(runId) || {}), ...lifecycle, run_id: runId }); return runLifecycles.get(runId); },
    async readRunLifecycle(runId) { return runLifecycles.get(runId) || null; }
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
  const publishedDatabaseUrls = [];
  const notionDatabaseReads = [];
  const notionAdmissionReads = [];
  const task = state => ({ id: 'page-1', url: 'https://notion/page-1', identifier: taskIdentifier, state, accepted_plan: publishedPlan, workpad: state === 'Human Review' ? humanReviewWorkpad : '' });
  const transitions = [];
  const notion = {
    async listTasks(databaseUrl) { notionAdmissionReads.push(databaseUrl); return []; },
    async listTasksForPlanIdentifier() { return [{ id: 'page-1', created_at: new Date(Date.now() + 1_000).toISOString() }]; },
    async readTask(databaseUrl) { notionDatabaseReads.push(databaseUrl); return task(observedState); },
    async updateTaskState(databaseUrl, _taskId, nextState) { notionDatabaseReads.push(databaseUrl); transitions.push(nextState); observedState = nextState; return task(observedState); },
    async appendWorkpad() {}
  };
  const startedDatabaseUrls = [];
  const portPairs = runtimePortPairs || [{ symphony_port: 4410, ui_port: 4610 }];
  let portPairIndex = 0;
  let currentPorts = portPairs[0];
  const portConflicts = [...runtimePortConflicts];
  const portConflictResults = [...runtimePortConflictResults];
  let runtimeStopCalls = 0;
  let runtimeStoppedVerificationCalls = 0;
  const runtime = {
    async findAvailableRuntimePorts() {
      currentPorts = portPairs[Math.min(portPairIndex++, portPairs.length - 1)];
      return { ...currentPorts, async release() {} };
    },
    async startConfiguredOperatorProject(_projectPath, _timeout, databaseUrl) {
      runtimeStartingAtCall.push(structuredClone([...runLifecycles.values()].at(-1)?.child_runtime || null));
      startedDatabaseUrls.push(databaseUrl);
      const conflict = portConflicts.shift();
      if (conflict) throw new Error(conflict);
      const window_error = portConflictResults.shift();
      return { dashboard: `http://127.0.0.1:${currentPorts.symphony_port}`, pid: 12, ...(window_error ? { window_error } : {}) };
    },
    async readOwnedRuntimeIdentity() {
      return { runtime_id: 'runtime-fixture', status: 'active', dashboard: `http://127.0.0.1:${currentPorts.symphony_port}`, process_identity: { pid: 12, process_start_ticks: '12', boot_id: 'test-boot', host: 'test' } };
    },
    async stopConfiguredOperatorProject() { runtimeStopCalls += 1; return { stopped: true }; },
    async verifyRuntimeStopped() { runtimeStoppedVerificationCalls += 1; return { stopped: true }; }
  };
  const git = {
    async listRemoteBranchRefs() { return {}; },
    async resolveSeedCommit() { return '0123456789012345678901234567890123456789'; },
    async createRunScopedBaseBranch(_branch, commit) { return commit; },
    async readRemoteBranchCommit() { return mergeCommit; },
    async verifyCommitOnRemoteBranch() { return true; },
    async deleteRemoteBranch() {}
  };
  const publisher = { async publishAcceptedPlan({ plan: acceptedPlan, databaseUrl }) { publishedPlan = acceptedPlan; publishedPlans.push(acceptedPlan); publishedDatabaseUrls.push(databaseUrl); return { page_id: 'page-1', url: 'https://notion/page-1', identifier: taskIdentifier, plan_identifier: derivePlanIdentifier(acceptedPlan) }; }, async prepareProductionPublisher() {} };
  const github = {
    repository: 'owner/repo',
    async pullRequestsForBase(baseBranch) {
      return [{ number: 4, url: deliveryUrl, baseRefName: baseBranch, headRefName: 'feature', headRefOid: deliveryHead, isCrossRepository: false, headRepository: { nameWithOwner: 'owner/repo' }, mergedAt: observedState === 'Done' ? new Date(clock()).toISOString() : null, mergeCommit: observedState === 'Done' ? { oid: mergeCommit } : null }];
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
  const runtimeStartingAtCall = [];
  const finalizer = { async finalizeRun({ record, reason, task: currentTask }) { finalized.push(reason); if (reason === 'reentered_human_review') { const cancelled = await notion.updateTaskState(config.notion_database_url, currentTask.id, 'Cancelled'); assert.equal(cancelled.state, 'Cancelled'); record.cleanup.task_terminalized = true; } record.status = 'finished'; record.finalization.reason = reason; record.finalization.complete = true; record.ended_at = new Date(clock()).toISOString(); await store.save(record); return record; } };
  return { config, runInput, catalog: validateWorkloadCatalog([{ id: 'representative', hard_cap_ms: 5, accepted_plan: plan }]), notionClient: notion, operatorClient: runtime, gitClient: git, notionPublisherClient: publisher, githubClient: github, runEvidenceCollector: evidence, runFinalizer: finalizer, runRecordStore: store, reservationAuthority, finalized, transitions, publishedPlans, publishedDatabaseUrls, notionDatabaseReads, notionAdmissionReads, startedDatabaseUrls, runtimeStartingAtCall, get runtimeStopCalls() { return runtimeStopCalls; }, get runtimeStoppedVerificationCalls() { return runtimeStoppedVerificationCalls; } };
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
  assert.equal(harness.runtimeStartingAtCall.length, 1);
  assert.equal(harness.runtimeStartingAtCall[0].status, 'starting');
  assert.equal(harness.runtimeStartingAtCall[0].state_path, record.paths.runtime_state);
  assert.deepEqual(harness.startedDatabaseUrls, [harness.config.notion_database_url]);
  assert.equal(record.lifecycle.observations[0].state, 'Ready');
  assert.equal(record.workload.execution_number, 1);
  assert.equal(harness.publishedPlans[0].startsWith('# Representative task-1\n'), true);
  assert.equal(record.artifacts.merged_head, '0123456789012345678901234567890123456789');
  assert.equal(record.artifacts.remote_base_commit, 'abcdefabcdefabcdefabcdefabcdefabcdefabcd');
  assert.match(await readFile(record.paths.record, 'utf8'), /production_done/);
  const runtimeProject = await readProjectConfiguration(record.paths.runtime_project);
  assert.equal(runtimeProject.skip_external_readiness, true);
  assert.equal(runtimeProject.open_project_surfaces, false);
  assert.deepEqual(harness.transitions, ['Merging']);
  assert.equal(record.lifecycle.mechanical_human_review_transition.performed, true);
  assert.equal(Object.hasOwn(record.artifacts, 'mechanical_approval'), false);
});

test('E2ERunner keeps selected database binding explicit instead of mutating shared runtime config', async () => {
  let current = 0;
  const harness = fixture({ states: ['Ready', 'In Progress', 'Human Review', 'Merging', 'Done'], clock: () => current++ });
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-selected-database-'));
  harness.config.run_record_directory = directory + '/runs';
  harness.config.workspace_root = directory + '/workspaces';
  const selected = harness.config.database_pool[0];
  const unselectedDefaultUrl = 'https://www.notion.so/cccccccccccc4ccc8ccccccccccccccc';
  harness.config.notion_database_url = unselectedDefaultUrl;

  const record = await new E2ERunner({ ...harness, random: () => 0, clock: () => current++, waitForPoll: async () => {} }).runProductionE2E();

  assert.equal(harness.config.notion_database_url, unselectedDefaultUrl);
  assert.equal(record.binding.notion_database_url, selected.database_url);
  assert.equal(record.binding.database_id, selected.database_id);
  assert.deepEqual(harness.startedDatabaseUrls, [selected.database_url]);
  assert.deepEqual(harness.publishedDatabaseUrls, [selected.database_url]);
  assert.ok(harness.notionAdmissionReads.every(databaseUrl => databaseUrl === selected.database_url));
  assert.ok(harness.notionDatabaseReads.length > 0);
  assert.ok(harness.notionDatabaseReads.every(databaseUrl => databaseUrl === selected.database_url));
});

test('E2ERunner retries a run-owned Operator startup with a new port pair after a bind conflict', async () => {
  let current = 0;
  const harness = fixture({
    states: ['Ready', 'In Progress', 'Human Review', 'Merging', 'Done'],
    clock: () => current++,
    runtimePortPairs: [
      { symphony_port: 4410, ui_port: 4610 },
      { symphony_port: 4420, ui_port: 4620 }
    ],
    runtimePortConflicts: ['Operator UI at http://127.0.0.1:4610 is not owned by this project']
  });
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-port-retry-'));
  harness.config.run_record_directory = directory + '/runs';
  harness.config.workspace_root = directory + '/workspaces';

  const record = await new E2ERunner({ ...harness, random: () => 0, clock: () => current++, waitForPoll: async () => {} }).runProductionE2E();

  assert.equal(record.status, 'finished');
  assert.deepEqual(record.runtime.port_start_attempts.map(attempt => attempt.result), ['port_conflict', 'started']);
  assert.deepEqual(record.runtime.port_start_attempts.map(attempt => attempt.ports), [
    { symphony_port: 4410, ui_port: 4610 },
    { symphony_port: 4420, ui_port: 4620 }
  ]);
  const runtimeProject = await readProjectConfiguration(record.paths.runtime_project);
  assert.equal(runtimeProject.symphony_port, 4420);
  assert.equal(runtimeProject.ui_port, 4620);
  assert.equal(record.run_input.runtime_options.symphony_port, 4420);
  assert.equal(record.run_input.runtime_options.ui_port, 4620);
  assert.equal(harness.runtimeStopCalls, 1);
  assert.equal(harness.runtimeStoppedVerificationCalls, 1);
});

test('E2ERunner retries when production Operator reports a UI port conflict in a successful start response', async () => {
  let current = 0;
  const harness = fixture({
    states: ['Ready', 'In Progress', 'Human Review', 'Merging', 'Done'],
    clock: () => current++,
    runtimePortPairs: [
      { symphony_port: 4430, ui_port: 4630 },
      { symphony_port: 4440, ui_port: 4640 }
    ],
    runtimePortConflictResults: ['Operator UI at http://127.0.0.1:4630 is not owned by this project']
  });
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-port-result-retry-'));
  harness.config.run_record_directory = directory + '/runs';
  harness.config.workspace_root = directory + '/workspaces';

  const record = await new E2ERunner({ ...harness, random: () => 0, clock: () => current++, waitForPoll: async () => {} }).runProductionE2E();

  assert.equal(record.status, 'finished');
  assert.deepEqual(record.runtime.port_start_attempts.map(attempt => attempt.result), ['port_conflict', 'started']);
  assert.deepEqual(record.runtime.port_start_attempts.map(attempt => attempt.ports), [
    { symphony_port: 4430, ui_port: 4630 },
    { symphony_port: 4440, ui_port: 4640 }
  ]);
  const runtimeProject = await readProjectConfiguration(record.paths.runtime_project);
  assert.equal(runtimeProject.symphony_port, 4440);
  assert.equal(runtimeProject.ui_port, 4640);
  assert.equal(harness.runtimeStopCalls, 1);
  assert.equal(harness.runtimeStoppedVerificationCalls, 1);
});

test('E2ERunner retries when an occupied UI port makes production Operator UI startup time out', async () => {
  let current = 0;
  const harness = fixture({
    states: ['Ready', 'In Progress', 'Human Review', 'Merging', 'Done'],
    clock: () => current++,
    runtimePortPairs: [
      { symphony_port: 4450, ui_port: 4650 },
      { symphony_port: 4460, ui_port: 4660 }
    ],
    runtimePortConflictResults: ['timed out waiting for Operator UI']
  });
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-ui-timeout-retry-'));
  harness.config.run_record_directory = directory + '/runs';
  harness.config.workspace_root = directory + '/workspaces';

  const record = await new E2ERunner({ ...harness, random: () => 0, clock: () => current++, waitForPoll: async () => {} }).runProductionE2E();

  assert.equal(record.status, 'finished');
  assert.deepEqual(record.runtime.port_start_attempts.map(attempt => attempt.result), ['port_conflict', 'started']);
  assert.deepEqual(record.runtime.port_start_attempts.map(attempt => attempt.ports), [
    { symphony_port: 4450, ui_port: 4650 },
    { symphony_port: 4460, ui_port: 4660 }
  ]);
  assert.equal(harness.runtimeStopCalls, 1);
  assert.equal(harness.runtimeStoppedVerificationCalls, 1);
});

test('E2ERunner publishes a provided H1-less Plan unchanged through the production path', async () => {
  let current = 0;
  const providedPlan = 'Accepted work without a Markdown heading.\n한국어 내용.\n';
  const harness = fixture({
    states: ['Ready', 'In Progress', 'Human Review', 'Merging', 'Done'],
    clock: () => current++,
    runInput: {
      workload: {
        source: 'provided',
        source_path: '/input/provided.md',
        accepted_plan: providedPlan,
        accepted_plan_sha256: sha256(providedPlan),
        plan_identifier: derivePlanIdentifier(providedPlan),
        hard_cap_ms: 1_800_000,
        hard_cap_provenance: 'provided_default'
      },
      workflow: { source: 'default', source_path: '/repo/e2e/WORKFLOW.md', resolved_workflow: 'default workflow', resolved_workflow_sha256: sha256('default workflow') }
    }
  });
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-provided-plan-'));
  harness.config.run_record_directory = directory + '/runs';
  harness.config.workspace_root = directory + '/workspaces';
  const record = await new E2ERunner({ ...harness, clock: () => current++, waitForPoll: async () => {} }).runProductionE2E();
  assert.equal(record.workload.source, 'provided');
  assert.equal(record.workload.accepted_plan, providedPlan);
  assert.equal(record.workload.hard_cap_ms, 1_800_000);
  assert.equal(record.run_input.workload.catalog_entry, null);
  assert.equal(record.run_input.workload.supplied.accepted_plan, providedPlan);
  assert.equal(record.run_input.workload.publisher.accepted_plan, providedPlan);
  assert.equal(harness.publishedPlans[0], providedPlan);
  assert.equal(record.runtime.project.workflow_path, record.paths.workflow_snapshot);
  assert.equal(await readFile(record.paths.workload_input_snapshot, 'utf8'), providedPlan);
  assert.equal(await readFile(record.paths.workload_publisher_snapshot, 'utf8'), providedPlan);
  assert.equal(await readFile(record.paths.workflow_snapshot, 'utf8'), 'default workflow');
  const persisted = JSON.parse(await readFile(record.paths.record, 'utf8'));
  assert.equal(persisted.run_input.workload.publisher.accepted_plan_sha256, sha256(providedPlan));
  assert.equal(persisted.run_input.workflow.resolved_workflow_sha256, sha256('default workflow'));
});

test('E2ERunner records a provided workflow sandbox policy instead of default policy evidence', async () => {
  let current = 0;
  const workflow = '---\ncodex:\n  turn_sandbox_policy:\n    type: workspaceWrite\n    writableRoots: [/workspace]\n---\nprovided workflow\n';
  const harness = fixture({
    states: ['Ready', 'In Progress', 'Human Review', 'Merging', 'Done'],
    clock: () => current++,
    runInput: {
      workload: {
        source: 'provided',
        source_path: '/input/provided.md',
        accepted_plan: 'Provided task.\n',
        accepted_plan_sha256: sha256('Provided task.\n'),
        plan_identifier: derivePlanIdentifier('Provided task.\n'),
        hard_cap_ms: 1_800_000,
        hard_cap_provenance: 'provided_default'
      },
      workflow: { source: 'provided', source_path: '/input/workflow.md', resolved_workflow: workflow, resolved_workflow_sha256: sha256(workflow) }
    }
  });
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-provided-workflow-'));
  harness.config.run_record_directory = directory + '/runs';
  harness.config.workspace_root = directory + '/workspaces';
  const record = await new E2ERunner({ ...harness, clock: () => current++, waitForPoll: async () => {} }).runProductionE2E();
  assert.equal(record.runtime.resolved_environment.codex_runtime.policy_source, 'provided workflow snapshot passed through unchanged; effective policy is runtime-owned');
  assert.equal(record.runtime.resolved_environment.codex_runtime.system_temporary_directory, 'determined by the provided workflow and Symphony runtime; E2E adds no override');
  assert.equal(record.runtime.resolved_environment.codex_runtime.e2e_specific_sandbox_policy, false);
});

test('provided duplicate publication remains a production failure without Plan mutation or fallback', async () => {
  const providedPlan = 'Duplicate publication input without H1.\n';
  const harness = fixture({
    states: ['Ready'],
    clock: () => 0,
    runInput: {
      workload: {
        source: 'provided',
        source_path: '/input/duplicate.md',
        accepted_plan: providedPlan,
        accepted_plan_sha256: sha256(providedPlan),
        plan_identifier: derivePlanIdentifier(providedPlan),
        hard_cap_ms: 1_800_000,
        hard_cap_provenance: 'provided_default'
      },
      workflow: { source: 'default', source_path: '/repo/e2e/WORKFLOW.md', resolved_workflow: 'default workflow', resolved_workflow_sha256: sha256('default workflow') }
    }
  });
  harness.notionPublisherClient.publishAcceptedPlan = async ({ plan }) => {
    harness.publishedPlans.push(plan);
    throw new Error('duplicate publication: PLAN-EXAMPLE already exists');
  };
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-provided-duplicate-'));
  harness.config.run_record_directory = directory + '/runs';
  harness.config.workspace_root = directory + '/workspaces';
  const record = await new E2ERunner({ ...harness, waitForPoll: async () => {} }).runProductionE2E();
  assert.equal(record.status, 'finished');
  assert.equal(record.artifacts.publisher_failure.error, 'duplicate publication: PLAN-EXAMPLE already exists');
  assert.equal(record.failures.at(-1).error, 'duplicate publication: PLAN-EXAMPLE already exists');
  assert.deepEqual(harness.publishedPlans, [providedPlan]);
  assert.equal(record.run_input.workload.publisher.accepted_plan, providedPlan);
  assert.equal(record.run_input.workload.publisher.accepted_plan_sha256, sha256(providedPlan));
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

test('E2E run-local Operator Project contains only configured Codex overrides', async () => {
  let current = 0;
  const harness = fixture({ states: ['Ready', 'In Progress', 'Human Review', 'Merging', 'Done'], clock: () => current++ });
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-codex-overrides-'));
  harness.config.run_record_directory = directory + '/runs';
  harness.config.workspace_root = directory + '/workspaces';
  harness.config.codex_model = 'example-model';
  const record = await new E2ERunner({ ...harness, random: () => 0, clock: () => current++, waitForPoll: async () => {} }).runProductionE2E();
  const project = await readProjectConfiguration(record.paths.runtime_project);
  assert.equal(project.codex_model, 'example-model');
  assert.equal(Object.hasOwn(project, 'codex_reasoning_effort'), false);
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

test('a timed-out evidence snapshot is aborted and the run continues on its next poll', async () => {
  const clock = () => Date.now();
  const harness = fixture({ states: ['Ready', 'In Progress', 'Human Review', 'Merging', 'Done'], clock });
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-snapshot-timeout-'));
  harness.config.run_record_directory = directory + '/runs';
  harness.config.workspace_root = directory + '/workspaces';
  harness.config.evidence_snapshot_timeout_ms = 5;
  harness.catalog = validateWorkloadCatalog([{ id: 'representative', hard_cap_ms: 60_000, accepted_plan: plan }]);

  const collectSnapshot = harness.runEvidenceCollector.collectSnapshot.bind(harness.runEvidenceCollector);
  let snapshotAttempts = 0;
  let aborted = false;
  let polls = 0;
  harness.runEvidenceCollector.collectSnapshot = async input => {
    snapshotAttempts += 1;
    if (snapshotAttempts === 1) {
      return new Promise((resolve, reject) => {
        input.signal.addEventListener('abort', () => {
          aborted = true;
          reject(input.signal.reason || new Error('snapshot aborted'));
        }, { once: true });
      });
    }
    return collectSnapshot(input);
  };

  const record = await new E2ERunner({
    ...harness,
    random: () => 0,
    clock,
    waitForPoll: async () => { polls += 1; }
  }).runProductionE2E();

  assert.equal(aborted, true);
  assert.ok(polls > 0);
  assert.ok(snapshotAttempts > 1);
  assert.equal(record.evidence.snapshot_timeouts.length, 1);
  assert.equal(record.evidence.snapshot_timeouts[0].timeout_ms, 5);
  assert.equal(record.failures.length, 0);
  assert.deepEqual(harness.finalized, ['production_done']);
  assert.equal(record.finalization.complete, true);
});
