export class RunCompletionVerifier {
  constructor({ gitClient, githubClient }) {
    this.gitClient = gitClient;
    this.githubClient = githubClient;
  }

  async verifyDoneDelivery(record, baseBranch) {
    let prs;
    try { prs = await this.githubClient.pullRequestsForBase(baseBranch); }
    catch (error) { return { ok: false, reason: `GitHub delivery inspection failed: ${error.message}` }; }
    const observedPrs = [
      ...(record.evidence?.snapshots || []).flatMap(snapshot => snapshot.github?.delivery_prs || []),
      ...(record.artifacts?.delivery_prs || [])
    ];
    const observedKeys = new Set(observedPrs.filter(pr => pr.baseRefName === baseBranch).map(pr => `${pr.url || ''}#${pr.number || ''}`));
    const runOwnedBranches = new Set(this.githubClient.findRunOwnedDeliveryBranches?.(prs, record) || []);
    const runDeliveries = prs.filter(pr => pr.baseRefName === baseBranch && (runOwnedBranches.has(pr.headRefName) || observedKeys.has(`${pr.url || ''}#${pr.number || ''}`)));
    const mergedDeliveries = runDeliveries.filter(pr => pr.mergedAt);
    if (mergedDeliveries.length === 0) return { ok: false, reason: 'no run-owned delivery PR is merged into the configured base' };
    if (mergedDeliveries.length > 1) return { ok: false, reason: 'multiple run-owned delivery PRs are merged into the configured base' };
    const pr = mergedDeliveries[0];
    const firstObserved = observedPrs.find(candidate => (candidate.url && candidate.url === pr.url) || (candidate.number && String(candidate.number) === String(pr.number)));
    const deliveredHead = firstObserved?.headRefOid || record.artifacts?.delivered_head || null;
    if (!/^[0-9a-f]{40}$/i.test(deliveredHead || '')) return { ok: false, reason: 'run-owned delivery PR has no observed immutable source HEAD' };
    if (pr.headRefOid?.toLowerCase() !== deliveredHead.toLowerCase()) return { ok: false, reason: 'run-owned delivery PR source HEAD changed after its delivery observation' };
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
    if (remoteBaseCommit.toLowerCase() !== mergeCommit.toLowerCase()) return { ok: false, reason: 'configured base tip contains changes after the run-owned delivery merge' };
    let contained;
    try { contained = await this.gitClient.verifyCommitOnRemoteBranch(baseBranch, mergeCommit); }
    catch (error) { return { ok: false, reason: `configured base merge readback failed: ${error.message}` }; }
    if (!contained) return { ok: false, reason: 'merged delivery commit is not present on fetched remote configured base' };
    return { ok: true, delivered_head: deliveredHead, merge_commit: mergeCommit, remote_base_commit: remoteBaseCommit };
  }
}
