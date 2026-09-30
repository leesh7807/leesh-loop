import { sha256 } from './plan-identity.mjs';

export const E2E_DELIVERY_BRANCH_PREFIX_TOKEN = '{{E2E_DELIVERY_BRANCH_PREFIX}}';

export function runScopedDeliveryBranchPrefix(baseBranch) {
  const runId = typeof baseBranch === 'string' ? baseBranch.match(/^base\/([^/]+)$/)?.[1] : null;
  if (!runId) throw new Error(`E2E run base branch ${baseBranch || 'unknown'} does not contain a run identity`);
  return `e2e/${runId}/`;
}

export function materializeRunScopedDefaultWorkflow(workflow, baseBranch) {
  if (workflow?.source !== 'default') return workflow;
  const content = workflow.resolved_workflow || '';
  if (!content.includes(E2E_DELIVERY_BRANCH_PREFIX_TOKEN)) return workflow;
  const resolvedWorkflow = content.replace(E2E_DELIVERY_BRANCH_PREFIX_TOKEN, runScopedDeliveryBranchPrefix(baseBranch));
  if (resolvedWorkflow.includes(E2E_DELIVERY_BRANCH_PREFIX_TOKEN)) throw new Error('default E2E workflow contains more than one delivery-branch prefix token');
  return { ...workflow, resolved_workflow: resolvedWorkflow, resolved_workflow_sha256: sha256(resolvedWorkflow) };
}
