import test from 'node:test';
import assert from 'node:assert/strict';
import { materializeRunScopedDefaultWorkflow, runScopedDeliveryBranchPrefix } from '../model/run-scoped-delivery-branch.mjs';
import { deleteRunOwnedDeliveryBranch } from '../run/finalization/run-owned-delivery-branch.mjs';

const commit = suffix => suffix.repeat(40);

test('default workflow and cleanup derive the same delivery namespace from the run base branch', () => {
  assert.equal(runScopedDeliveryBranchPrefix('base/run-current'), 'e2e/run-current/');
  const workflow = materializeRunScopedDefaultWorkflow({ source: 'default', resolved_workflow: '{{E2E_DELIVERY_BRANCH_PREFIX}}<task-identifier>' }, 'base/run-current');
  assert.equal(workflow.resolved_workflow, 'e2e/run-current/<task-identifier>');
  assert.match(workflow.resolved_workflow_sha256, /^[0-9a-f]{64}$/);
});

test('provided workflow input keeps its bytes unchanged', () => {
  const workflow = { source: 'provided', resolved_workflow: '{{E2E_DELIVERY_BRANCH_PREFIX}}<task-identifier>', resolved_workflow_sha256: 'provided-hash' };
  assert.equal(materializeRunScopedDefaultWorkflow(workflow, 'base/run-current'), workflow);
});

test('delivery cleanup rejects a branch outside the run namespace without a Git mutation', async () => {
  const calls = [];
  const record = { binding: { base_branch: 'base/run-current' }, artifacts: { owned_deliveries: [{ branch: 'e2e/run-other/PLAN-FIXTURE', head: commit('a') }] } };
  const gitClient = { async deleteRemoteBranch(...args) { calls.push(args); } };

  await assert.rejects(() => deleteRunOwnedDeliveryBranch({ record, branch: 'e2e/run-other/PLAN-FIXTURE', baseBranch: 'base/run-current', gitClient }), /not namespaced to run base/);
  assert.deepEqual(calls, []);
});

test('delivery cleanup leases the latest observed head inside the current run namespace', async () => {
  const calls = [];
  const branch = 'e2e/run-current/PLAN-FIXTURE';
  const record = {
    binding: { base_branch: 'base/run-current' },
    artifacts: { owned_deliveries: [{ branch, head: commit('a') }] },
    evidence: { snapshots: [{ github: { delivery_prs: [{ baseRefName: 'base/run-current', headRefName: branch, headRefOid: commit('b') }] } }] }
  };
  const gitClient = { async deleteRemoteBranch(...args) { calls.push(args); } };

  const result = await deleteRunOwnedDeliveryBranch({ record, branch, baseBranch: 'base/run-current', gitClient, timeout: 5000 });

  assert.deepEqual(result, { branch, expected_commit: commit('b') });
  assert.deepEqual(calls, [[branch, { expectedCommit: commit('b'), timeout: 5000, signal: undefined }]]);
});
