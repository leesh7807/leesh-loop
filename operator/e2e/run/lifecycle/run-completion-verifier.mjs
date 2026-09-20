export class RunCompletionVerifier {
  constructor({ gitClient, githubClient }) {
    this.gitClient = gitClient;
    this.githubClient = githubClient;
  }

  async verifyDoneDelivery(record, baseBranch) {
    const approved = record.artifacts.approved_delivery;
    if (!approved) return { ok: false, reason: 'Done was observed without an E2E mechanical approval identity' };
    let prs;
    try { prs = await this.githubClient.pullRequestsForBase(baseBranch); }
    catch (error) { return { ok: false, reason: `GitHub delivery inspection failed: ${error.message}` }; }
    const pr = this.githubClient.findDeliveryPullRequest(prs, approved.pr);
    if (!pr) return { ok: false, reason: 'approved delivery PR was not found for the configured run-scoped base' };
    if (pr.baseRefName !== baseBranch || pr.headRefOid?.toLowerCase() !== approved.head.toLowerCase()) return { ok: false, reason: 'approved delivery PR base or head does not match the Human Review identity' };
    if (!pr.mergedAt) return { ok: false, reason: 'approved delivery PR is not merged' };
    const runStartedAt = Date.parse(record.started_at || '');
    const unrelatedMerged = prs.filter(candidate => {
      if (candidate.url === pr.url || String(candidate.number) === String(pr.number)) return false;
      if (candidate.baseRefName !== baseBranch || !candidate.mergedAt) return false;
      const mergedAt = Date.parse(candidate.mergedAt);
      return Number.isFinite(mergedAt) && (!Number.isFinite(runStartedAt) || mergedAt >= runStartedAt);
    });
    if (unrelatedMerged.length > 0) return { ok: false, reason: 'an unrelated PR merged into the run-scoped base during this E2E run' };
    const mergeCommit = pr.mergeCommit?.oid;
    if (!/^[0-9a-f]{40}$/i.test(mergeCommit || '')) return { ok: false, reason: 'merged delivery PR has no authoritative merge commit' };
    let remoteBaseCommit;
    try { remoteBaseCommit = await this.gitClient.readRemoteBranchCommit(baseBranch); }
    catch (error) { return { ok: false, reason: `configured base remote readback failed: ${error.message}` }; }
    if (!remoteBaseCommit) return { ok: false, reason: 'configured base remote ref is missing after Done' };
    if (remoteBaseCommit.toLowerCase() !== mergeCommit.toLowerCase()) return { ok: false, reason: 'configured base tip contains changes after the approved delivery merge' };
    let contained;
    try { contained = await this.gitClient.verifyCommitOnRemoteBranch(baseBranch, mergeCommit); }
    catch (error) { return { ok: false, reason: `configured base merge readback failed: ${error.message}` }; }
    if (!contained) return { ok: false, reason: 'merged delivery commit is not present on fetched remote configured base' };
    return { ok: true, delivered_head: approved.head, merge_commit: mergeCommit, remote_base_commit: remoteBaseCommit };
  }
}
