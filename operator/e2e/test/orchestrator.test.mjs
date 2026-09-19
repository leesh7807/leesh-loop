import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateCatalog } from '../catalog.mjs';
import { deriveIdentifier } from '../common.mjs';
import { E2EOrchestrator } from '../orchestrator.mjs';
import { RunStore } from '../record.mjs';

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
  const record = await new E2EOrchestrator({ ...harness, random: () => 0, clock: () => current++, sleepFn: async () => {} }).run();
  assert.equal(record.status, 'finished');
  assert.deepEqual(harness.finalized, ['production_done']);
  assert.equal(record.binding.seed_commit.length, 40);
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
