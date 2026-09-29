import { command, parseJsonOutput } from '../command-runner.mjs';

function repositorySlug(repositoryUrl) {
  const match = repositoryUrl.match(/github\.com[/:]([^/]+)\/([^/#]+?)(?:\.git)?$/i);
  if (!match) throw new Error(`cannot derive GitHub repository from ${repositoryUrl}`);
  return `${match[1]}/${match[2]}`;
}

const PULL_REQUEST_FIELDS = 'number,url,state,isDraft,headRefName,headRefOid,baseRefName,mergedAt,mergeCommit,createdAt,headRepository,headRepositoryOwner,isCrossRepository';

export function isSameRepositoryDelivery(pr, repository) {
  return pr?.isCrossRepository === false && pr.headRepository?.nameWithOwner === repository;
}

export class GitHubClient {
  constructor({ repositoryUrl, ghCommand = command } = {}) {
    this.repository = repositorySlug(repositoryUrl);
    this.ghCommand = ghCommand;
  }

  async pullRequestsForBase(baseBranch, signal) {
    const { stdout } = await this.ghCommand('gh', ['pr', 'list', '--repo', this.repository, '--base', baseBranch, '--state', 'all', '--limit', '100', '--json', PULL_REQUEST_FIELDS], { timeout: 30_000, signal });
    const rows = parseJsonOutput(stdout, 'GitHub PR inspection');
    if (!Array.isArray(rows)) throw new Error('GitHub PR inspection returned a non-array');
    return rows;
  }

  async readPullRequest(identity, signal) {
    const { stdout } = await this.ghCommand('gh', ['pr', 'view', String(identity), '--repo', this.repository, '--json', PULL_REQUEST_FIELDS], { timeout: 30_000, signal });
    const row = parseJsonOutput(stdout, 'GitHub delivery PR readback');
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('GitHub delivery PR readback returned an invalid result');
    return row;
  }

  async branchNamesForBase(baseBranch) {
    return (await this.pullRequestsForBase(baseBranch)).map(pr => pr.headRefName).filter(Boolean);
  }

  findDeliveryPullRequest(prs, deliveredPr) {
    const number = String(deliveredPr || '').match(/(?:\/|#)(\d+)$/)?.[1] || String(deliveredPr || '');
    return prs.find(pr => pr.url === deliveredPr || String(pr.number) === number) || null;
  }

  isSameRepositoryDelivery(pr) {
    return isSameRepositoryDelivery(pr, this.repository);
  }

  deliveryPrIdentities(record) {
    const identities = new Set();
    if (record.artifacts?.delivery_pr_url) identities.add(record.artifacts.delivery_pr_url);
    for (const delivery of record.artifacts?.owned_deliveries || []) if (delivery.pr_url) identities.add(delivery.pr_url);
    for (const identity of record.artifacts?.workpad_delivery_prs || []) identities.add(identity);
    return [...identities];
  }

  findRunOwnedDeliveryBranches(prs, record) {
    const identities = this.deliveryPrIdentities(record);
    const branches = new Set();
    for (const identity of identities) {
      const recorded = (record.artifacts?.owned_deliveries || []).find(delivery => delivery.pr_url === identity);
      if (recorded?.branch) {
        branches.add(recorded.branch);
        continue;
      }
      if (identity === record.artifacts?.delivery_pr_url && record.artifacts?.delivery_branch) {
        branches.add(record.artifacts.delivery_branch);
        continue;
      }
      const pr = this.findDeliveryPullRequest(prs, identity);
      if (pr?.headRefName && this.isSameRepositoryDelivery(pr)) branches.add(pr.headRefName);
    }
    if (identities.length > 0 && record.artifacts?.delivery_branch) branches.add(record.artifacts.delivery_branch);
    return [...branches];
  }
}
