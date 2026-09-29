export function recordRunDeliveryEvidence(record, identity, pullRequest, {
  sameRepository = false,
  observedAt = null,
  lockDeliveredHead = false
} = {}) {
  const artifacts = record.artifacts ||= {};
  const deliveryIdentity = typeof identity === 'string' && identity && identity !== 'none' ? identity : null;
  const branch = sameRepository && pullRequest?.headRefName ? pullRequest.headRefName : null;
  const head = branch ? pullRequest.headRefOid || null : null;

  artifacts.delivery_pr_url = deliveryIdentity;
  artifacts.delivery_branch = branch;
  if (branch) {
    artifacts.delivery_branches ||= [];
    if (!artifacts.delivery_branches.includes(branch)) artifacts.delivery_branches.push(branch);
    artifacts.owned_deliveries ||= [];
    if (deliveryIdentity && !artifacts.owned_deliveries.some(delivery => delivery.pr_url === deliveryIdentity)) {
      artifacts.owned_deliveries.push({
        pr_url: deliveryIdentity,
        branch,
        head,
        observed_at: observedAt
      });
    }
  }

  if (lockDeliveredHead) {
    artifacts.delivered_head = head;
    artifacts.delivered_head_locked = true;
  }

  return { pr_url: deliveryIdentity, branch, head };
}
