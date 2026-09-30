import { runScopedDeliveryBranchPrefix } from '../../model/run-scoped-delivery-branch.mjs';

function expectedDeliveryCommit(record, branch, baseBranch) {
  const observedPullRequests = (record.evidence?.snapshots || [])
    .flatMap(snapshot => snapshot.github?.delivery_prs || [])
    .filter(pullRequest => pullRequest.headRefName === branch && pullRequest.baseRefName === baseBranch);
  const latestObserved = observedPullRequests.at(-1);
  const ownedDelivery = [...(record.artifacts?.owned_deliveries || [])].reverse()
    .find(delivery => delivery.branch === branch);
  return latestObserved?.headRefOid || ownedDelivery?.head || null;
}

export async function deleteRunOwnedDeliveryBranch({ record, branch, baseBranch, gitClient, timeout, signal }) {
  const branchPrefix = runScopedDeliveryBranchPrefix(record.binding?.base_branch);
  if (!branch.startsWith(branchPrefix)) {
    throw new Error(`delivery branch ${branch} is not namespaced to run base ${record.binding?.base_branch || 'unknown'}`);
  }

  const expectedCommit = expectedDeliveryCommit(record, branch, baseBranch);
  await gitClient.deleteRemoteBranch(branch, { expectedCommit, timeout, signal });
  return { branch, expected_commit: expectedCommit };
}
