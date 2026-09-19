import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateCatalog } from '../catalog.mjs';
import { deriveIdentifier } from '../common.mjs';
import { E2EOrchestrator } from '../orchestrator.mjs';
import { newRunRecord, RunStore } from '../record.mjs';
import { runPaths } from '../config.mjs';

const plan = '# Representative task\n\nInspect the repository and write a concise note under docs/.\n';

function fixture({ states, clock, includeTrackerInput = true }) {
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
  const reviewWorkpad = `review target: ${deliveryUrl}\nreview head: ${deliveryHead}\nJob ID: 123e4567-e89b-42d3-a456-426614174000\n# Verdict\nPASS\nHuman Review\ncycle: 1\nreason: review\ndelivered_pr: ${deliveryUrl}\ndelivered_head: ${deliveryHead}\n`;
  const task = state => ({ id: 'page-1', url: 'https://notion/page-1', identifier: deriveIdentifier(plan), state, accepted_plan: plan, workpad: state === 'Human Review' ? reviewWorkpad : '' });
  const notion = {
    async listTasks() { return []; },
    async readTask() { return task(observedState); },
    async updateState() { observedState = 'Merging'; return task(observedState); },
    async appendWorkpad() {}
  };
  const runtime = { async start() { return { dashboard: 'http://127.0.0.1:4410' }; }, async stop() { return { stopped: true }; } };
  const git = {
    async remoteRefs() { return {}; },
    async resolveSeedCommit() { return '0123456789012345678901234567890123456789'; },
    async createBaseBranch(_branch, commit) { return commit; },
    async remoteBranchCommit() { return mergeCommit; },
    async containsCommit() { return true; },
    async deleteBranch() {}
  };
  const publisher = { async publish() { return { page_id: 'page-1', url: 'https://notion/page-1' }; }, async prepare() {} };
  const github = {
    async pullRequestsForBase(baseBranch) {
      return [{ number: 4, url: deliveryUrl, baseRefName: baseBranch, headRefName: 'feature', headRefOid: deliveryHead, mergedAt: observedState === 'Done' ? new Date(clock()).toISOString() : null, mergeCommit: observedState === 'Done' ? { oid: mergeCommit } : null }];
    },
    findDelivery(prs, deliveredPr) { return prs.find(pr => pr.url === deliveredPr || String(pr.number) === String(deliveredPr).split('/').at(-1)); }
  };
  const evidence = {
    async snapshot({ baseBranch }) {
      observedState = states[Math.min(snapshotIndex++, states.length - 1)];
      return { observed_at: new Date(clock()).toISOString(), notion: { id: 'page-1', url: 'https://notion/page-1', identifier: deriveIdentifier(plan), state: observedState, accepted_plan: plan, workpad: observedState === 'Human Review' ? reviewWorkpad : '' }, symphony: { runtime: {}, state: {}, issue: null, tracker_input: includeTrackerInput ? { description: plan } : null }, github: { delivery_prs: await github.pullRequestsForBase(baseBranch) }, git: { remote_refs: {} }, chatgpt_shot: observedState === 'Human Review' ? { job_id: '123e4567-e89b-42d3-a456-426614174000', terminal_state: 'completed', result: '# Verdict\nPASS' } : null, errors: [] };
    }
  };
  const store = new RunStore(config);
  const finalized = [];
  const finalizer = { async finalize({ record, reason }) { finalized.push(reason); record.status = 'finished'; record.finalization.reason = reason; record.finalization.complete = true; record.ended_at = new Date(clock()).toISOString(); await store.save(record); return record; } };
  return { config, catalog: validateCatalog([{ id: 'representative', hard_cap_ms: 5, accepted_plan: plan }]), capabilities: { notion, runtime, git, publisher, github, evidence, finalizer, store }, finalized };
}

test('central orchestration reaches terminal Done through injected capabilities', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-orchestrator-'));
  let current = 0;
  const harness = fixture({ states: ['Ready', 'In Progress', 'Human Review', 'Merging', 'Done'], clock: () => current++ });
  harness.config.run_record_directory = directory + '/runs';
  harness.config.workspace_root = directory + '/workspaces';
  const persistedStartRequests = [];
  const start = harness.capabilities.runtime.start;
  harness.capabilities.runtime.start = async (...args) => {
    const persisted = (await harness.capabilities.store.list()).at(-1);
    persistedStartRequests.push(persisted.timing.symphony.start_requested_at);
    return start(...args);
  };
  const record = await new E2EOrchestrator({ ...harness, random: () => 0, clock: () => current++, sleepFn: async () => {} }).run();
  assert.equal(record.status, 'finished');
  assert.deepEqual(harness.finalized, ['production_done']);
  assert.equal(record.binding.seed_commit.length, 40);
  assert.equal(persistedStartRequests.length, 1);
  assert.ok(persistedStartRequests[0]);
  assert.equal(record.lifecycle.observations[0].state, 'Ready');
  assert.match(await readFile(record.paths.record, 'utf8'), /production_done/);
});

test('hard cap converges through the same finalization boundary', async () => {
  let current = 0;
  const base = Date.now();
  const harness = fixture({ states: ['In Progress'], clock: () => base + current++ * 10 });
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-cap-'));
  harness.config.run_record_directory = directory + '/runs';
  harness.config.workspace_root = directory + '/workspaces';
  const record = await new E2EOrchestrator({ ...harness, random: () => 0, clock: () => base + current++ * 10, sleepFn: async () => {} }).run();
  assert.equal(record.status, 'finished');
  assert.deepEqual(harness.finalized, ['hard_cap_reached']);
});

test('Done without an approved and verified delivery is recorded as unverified', async () => {
  let current = 0;
  const harness = fixture({ states: ['Done'], clock: () => current++, includeTrackerInput: false });
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-unverified-done-'));
  harness.config.run_record_directory = directory + '/runs';
  harness.config.workspace_root = directory + '/workspaces';
  const record = await new E2EOrchestrator({ ...harness, random: () => 0, clock: () => current++, sleepFn: async () => {} }).run();
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
  const record = {
    started_at: new Date(0).toISOString(),
    artifacts: { approved_delivery: { pr: 'https://github.com/owner/repo/pull/4', head: '0123456789012345678901234567890123456789' } }
  };
  const original = harness.capabilities.github.pullRequestsForBase;
  harness.capabilities.github.pullRequestsForBase = async baseBranch => [
    ...(await original(baseBranch)),
    { number: 5, url: 'https://github.com/owner/repo/pull/5', baseRefName: baseBranch, headRefOid: 'fedcbafedcbafedcbafedcbafedcbafedcbafedc', mergedAt: new Date(2).toISOString(), mergeCommit: { oid: 'fedcbafedcbafedcbafedcbafedcbafedcbabbbb' } }
  ];
  const orchestrator = new E2EOrchestrator({ ...harness, random: () => 0, clock: () => current++, sleepFn: async () => {} });
  const result = await orchestrator.verifyDoneDelivery(record, 'e2e-base');
  assert.equal(result.ok, false);
  assert.match(result.reason, /unrelated PR/);
});

test('Done rejects a configured base advanced after the approved merge', async () => {
  let current = 0;
  const harness = fixture({ states: ['Done'], clock: () => current++ });
  harness.capabilities.git.remoteBranchCommit = async () => 'fedcbafedcbafedcbafedcbafedcbafedcbafedc';
  const record = { started_at: new Date(0).toISOString(), artifacts: { approved_delivery: { pr: 'https://github.com/owner/repo/pull/4', head: '0123456789012345678901234567890123456789' } } };
  const result = await new E2EOrchestrator({ ...harness, random: () => 0, clock: () => current++, sleepFn: async () => {} }).verifyDoneDelivery(record, 'e2e-base');
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
  harness.capabilities.store = { async list() { return [previous]; } };
  const result = await new E2EOrchestrator({ ...harness, random: () => 0 }).admit();
  assert.equal(result.workload.length, 1);
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
  harness.capabilities.store = { async list() { return [previous]; } };
  harness.capabilities.finalizer = { async finalize({ record }) { return record; } };
  await assert.rejects(() => new E2EOrchestrator({ ...harness, random: () => 0 }).admit(), /remains unresolved/);
});

test('reconciliation rebinds a published task from its workload identity after a crash', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-publisher-crash-'));
  const harness = fixture({ states: ['Ready'], clock: () => 0 });
  harness.config.run_record_directory = directory + '/runs';
  harness.config.workspace_root = directory + '/workspaces';
  const workload = harness.catalog[0];
  const record = newRunRecord({ config: harness.config, runId: 'run-publisher-crash', workload, paths: runPaths(harness.config, 'run-publisher-crash') });
  record.status = 'published';
  record.artifacts.task_identifier = workload.identifier;
  const orchestrator = new E2EOrchestrator({ ...harness, random: () => 0 });
  await orchestrator.reconcile(record);
  assert.equal(record.artifacts.task_id, 'page-1');
});

test('reconciliation does not accept Done without the normal delivery proof', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-done-crash-'));
  const harness = fixture({ states: ['Done'], clock: () => 0 });
  harness.config.run_record_directory = directory + '/runs';
  harness.config.workspace_root = directory + '/workspaces';
  const workload = harness.catalog[0];
  const record = newRunRecord({ config: harness.config, runId: 'run-done-crash', workload, paths: runPaths(harness.config, 'run-done-crash') });
  record.status = 'observing';
  const orchestrator = new E2EOrchestrator({ ...harness, random: () => 0 });
  await orchestrator.reconcile(record);
  assert.deepEqual(harness.finalized, ['done_unverified_reconciliation']);
  assert.equal(record.failures.at(-1).phase, 'done_verification');
});
