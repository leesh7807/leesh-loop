import { command, parseJsonOutput } from './common.mjs';

function repositorySlug(repositoryUrl) {
  const match = repositoryUrl.match(/github\.com[/:]([^/]+)\/([^/#]+?)(?:\.git)?$/i);
  if (!match) throw new Error(`cannot derive GitHub repository from ${repositoryUrl}`);
  return `${match[1]}/${match[2]}`;
}

export class GitHubCapability {
  constructor({ repositoryUrl, ghCommand = command } = {}) {
    this.repository = repositorySlug(repositoryUrl);
    this.ghCommand = ghCommand;
  }

  async pullRequestsForBase(baseBranch) {
    const { stdout } = await this.ghCommand('gh', ['pr', 'list', '--repo', this.repository, '--base', baseBranch, '--state', 'all', '--limit', '100', '--json', 'number,url,state,isDraft,headRefName,headRefOid,baseRefName,mergedAt,mergeCommit,createdAt,headRepository,headRepositoryOwner,isCrossRepository'], { timeout: 30_000 });
    const rows = parseJsonOutput(stdout, 'GitHub PR inspection');
    if (!Array.isArray(rows)) throw new Error('GitHub PR inspection returned a non-array');
    return rows;
  }

  async branchNamesForBase(baseBranch) {
    return (await this.pullRequestsForBase(baseBranch)).map(pr => pr.headRefName).filter(Boolean);
  }

  findDelivery(prs, deliveredPr) {
    const number = String(deliveredPr || '').match(/(?:\/|#)(\d+)$/)?.[1] || String(deliveredPr || '');
    return prs.find(pr => pr.url === deliveredPr || String(pr.number) === number) || null;
  }

  runOwnedDeliveryBranches(prs, record) {
    const before = record.evidence?.branch_refs_before || {};
    const startedAt = Date.parse(record.started_at || '');
    const baseBranch = record.binding?.base_branch;
    return [...new Set(prs.filter(pr => {
      const branch = pr.headRefName;
      const createdAt = Date.parse(pr.createdAt || '');
      const headRepository = pr.headRepository?.nameWithOwner || null;
      return Boolean(branch)
        && pr.baseRefName === baseBranch
        && pr.isCrossRepository === false
        && headRepository === this.repository
        && !before[`refs/heads/${branch}`]
        && Number.isFinite(createdAt)
        && (!Number.isFinite(startedAt) || createdAt >= startedAt);
    }).map(pr => pr.headRefName))];
  }
}
