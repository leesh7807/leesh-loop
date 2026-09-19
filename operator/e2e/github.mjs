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
    const { stdout } = await this.ghCommand('gh', ['pr', 'list', '--repo', this.repository, '--base', baseBranch, '--state', 'all', '--limit', '100', '--json', 'number,url,state,isDraft,headRefName,headRefOid,baseRefName,mergedAt,mergeCommit'], { timeout: 30_000 });
    const rows = parseJsonOutput(stdout, 'GitHub PR inspection');
    if (!Array.isArray(rows)) throw new Error('GitHub PR inspection returned a non-array');
    return rows;
  }

  async branchNamesForBase(baseBranch) {
    return (await this.pullRequestsForBase(baseBranch)).map(pr => pr.headRefName).filter(Boolean);
  }
}
