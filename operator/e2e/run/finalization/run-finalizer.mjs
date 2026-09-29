import { RunTimingRecorder, runWithTimeout, currentTimeIso } from '../run-timing.mjs';
import { TERMINAL_STATES } from '../lifecycle/lifecycle-interpreter.mjs';
import { addFailure, recordFinalizationAction } from '../../model/run-record-store.mjs';
import { recordSnapshotWorkpadEvidence, recordRunWorkpadEvidence } from '../../model/run-workpad-evidence.mjs';
import { isSameRepositoryDelivery } from '../../systems/github/github-client.mjs';
import { readRunOwnedRuntime, recordedRunRuntimeId } from '../run-owned-runtime.mjs';

const COMMIT_SHA = /^[0-9a-f]{40}$/i;

function completedBranchDeletion(record, action, branch) {
  return (record.finalization?.actions || []).some(item => item.action === action && item.status === 'completed')
    || (record.cleanup?.branches_deleted || []).includes(branch);
}

function authorizedMergeTarget(record, identities, branch, prs, githubClient) {
  for (const target of [...(record.artifacts?.workpad_merge_targets || [])].reverse()) {
    if (!identities.includes(target.approved_pr) || !COMMIT_SHA.test(target.merge_target_head || '')) continue;
    const recordedDelivery = [...(record.artifacts?.owned_deliveries || [])].reverse().find(delivery => delivery.pr_url === target.approved_pr && delivery.branch);
    const recordedBranch = recordedDelivery?.branch
      || (target.approved_pr === record.artifacts?.delivery_pr_url ? record.artifacts?.delivery_branch : null);
    if (recordedBranch === branch) return target.merge_target_head;
    const pr = githubClient.findDeliveryPullRequest?.(prs, target.approved_pr);
    if (pr?.headRefName === branch) return target.merge_target_head;
  }
  return null;
}

function authorizedRunScopedBaseCommit(record, identities, baseBranch, prs, githubClient) {
  for (const identity of identities) {
    const pr = githubClient.findDeliveryPullRequest?.(prs, identity);
    if (pr?.baseRefName !== baseBranch || !pr.mergedAt || !isSameRepositoryDelivery(pr, githubClient.repository)) continue;
    const targetHead = authorizedMergeTarget(record, identities, pr.headRefName, prs, githubClient);
    if (!targetHead || pr.headRefOid?.toLowerCase() !== targetHead.toLowerCase()) continue;
    const mergeCommit = pr.mergeCommit?.oid;
    if (COMMIT_SHA.test(mergeCommit || '')) return mergeCommit;
  }
  return null;
}

export class RunFinalizer {
  constructor({ config, runRecordStore, notionClient, operatorClient, gitClient, githubClient, runEvidenceCollector, runTimingRecorder }) {
    this.config = config;
    this.runRecordStore = runRecordStore;
    this.notionClient = notionClient;
    this.operatorClient = operatorClient;
    this.gitClient = gitClient;
    this.githubClient = githubClient;
    this.runEvidenceCollector = runEvidenceCollector;
    this.runTimingRecorder = runTimingRecorder || new RunTimingRecorder();
  }

  async runFinalizationAction(record, name, operation) {
    try {
      const value = await runWithTimeout(operation, this.config.finalization_timeout_ms, name);
      recordFinalizationAction(record, name, { status: 'completed', value });
      record.finalization.unresolved = record.finalization.unresolved.filter(action => action !== name);
      record.cleanup.unresolved = record.cleanup.unresolved.filter(action => action !== name);
      record.finalization.incomplete = record.finalization.unresolved.length > 0;
      await this.runRecordStore.save(record);
      return value;
    } catch (error) {
      recordFinalizationAction(record, name, { status: 'failed', error: String(error?.message || error) });
      record.finalization.incomplete = true;
      if (!record.finalization.unresolved.includes(name)) record.finalization.unresolved.push(name);
      if (!record.cleanup.unresolved.includes(name)) record.cleanup.unresolved.push(name);
      await this.runRecordStore.save(record).catch(() => {});
      return null;
    }
  }

  async stopRunOwnedRuntime(record, signal) {
    record.cleanup.runtime_stopped = false;
    const beforeStop = await readRunOwnedRuntime(record, this.operatorClient, signal);
    record.evidence.owned_runtime_cleanup = { ...beforeStop, checked_at: currentTimeIso() };
    if (beforeStop.status === 'unconfirmed') {
      throw new Error(`run-owned Symphony runtime identity could not be confirmed before stop: ${beforeStop.error}`);
    }
    if (beforeStop.status === 'absent') {
      record.cleanup.runtime_stopped = true;
      this.runTimingRecorder.recordSymphonyStopped(record, currentTimeIso());
      return { skipped: true, runtime_readback: beforeStop };
    }

    const value = await this.operatorClient.stopRunOwnedSymphonyRuntime(
      record.paths.runtime_project,
      recordedRunRuntimeId(record),
      this.config.runtime_stop_timeout_ms,
      signal
    );
    const runtimeReadback = await readRunOwnedRuntime(record, this.operatorClient, signal);
    record.evidence.owned_runtime_cleanup = { ...runtimeReadback, checked_at: currentTimeIso(), stop_result: value };
    if (runtimeReadback.status !== 'absent') {
      throw new Error(runtimeReadback.status === 'present'
        ? `run-owned Symphony runtime ${runtimeReadback.runtime_id} still responds after stop`
        : `run-owned Symphony runtime stop could not be confirmed: ${runtimeReadback.error}`);
    }
    record.cleanup.runtime_stopped = true;
    this.runTimingRecorder.recordSymphonyStopped(record, currentTimeIso());
    return { ...value, runtime_readback: runtimeReadback };
  }

  async finalizeRun({ record, reason, task, dashboard, baseBranch, workspaceRoot, normalDone = false }) {
    record.finalization.reason = reason;
    if (!normalDone) {
      await this.runFinalizationAction(record, 'stop_run_owned_symphony', async signal => {
        if (!record.timing?.symphony?.start_requested_at && !record.timing?.symphony?.started_at && !recordedRunRuntimeId(record)) {
          record.cleanup.runtime_stopped = true;
          return { skipped: true };
        }
        return this.stopRunOwnedRuntime(record, signal);
      });
      if (record.cleanup.runtime_stopped) {
        const reread = task?.id
          ? await this.runFinalizationAction(record, 'reread_task_after_runtime_stop', () => this.notionClient.readTask(this.config.notion_database_url, task.id))
          : null;
        const rereadAction = record.finalization.actions.at(-1);
        if (rereadAction?.status === 'completed' && reread) task = reread;
        if (rereadAction?.status === 'completed' && task && !TERMINAL_STATES.has(task.state)) {
          await this.runFinalizationAction(record, 'cancel_nonterminal_task', async () => {
            const cancelled = await this.notionClient.updateTaskState(this.config.notion_database_url, task.id, 'Cancelled');
            if (cancelled.state !== 'Cancelled') throw new Error(`Cancelled transition readback was ${cancelled.state}`);
            task = cancelled;
            record.cleanup.task_terminalized = true;
            return { state: cancelled.state, actor: 'e2e-harness', reason };
          });
        }
      } else {
        recordFinalizationAction(record, 'skip_task_terminalization_without_runtime_confirmation', { status: 'blocked', reason: 'run-owned Symphony stop was not confirmed' });
        await this.runRecordStore.save(record);
      }
    } else {
      await this.runFinalizationAction(record, 'stop_run_owned_symphony_after_done', async signal => {
        if (!record.timing?.symphony?.start_requested_at && !record.timing?.symphony?.started_at && !recordedRunRuntimeId(record)) {
          record.cleanup.runtime_stopped = true;
          return { skipped: true };
        }
        return this.stopRunOwnedRuntime(record, signal);
      });
    }

    recordSnapshotWorkpadEvidence(record);

    await this.runFinalizationAction(record, 'final_evidence_snapshot', async signal => {
      const snapshot = await this.runEvidenceCollector.collectSnapshot({ databaseUrl: this.config.notion_database_url, identifier: record.artifacts.task_identifier, dashboard, baseBranch, workspaceRoot, signal });
      record.evidence.snapshots.push(snapshot);
      recordRunWorkpadEvidence(record, snapshot.notion?.workpad);
      this.runTimingRecorder.recordEvidenceSnapshot(record, snapshot);
      return { observed_at: snapshot.observed_at, errors: snapshot.errors };
    });

    const cleanupAllowed = record.cleanup.runtime_stopped === true;
    if (!cleanupAllowed) {
      const action = 'skip_run_owned_resource_cleanup_without_runtime_confirmation';
      recordFinalizationAction(record, action, { status: 'blocked', reason: 'run-owned Symphony stop was not confirmed' });
      if (!record.finalization.unresolved.includes(action)) record.finalization.unresolved.push(action);
      if (!record.cleanup.unresolved.includes(action)) record.cleanup.unresolved.push(action);
      record.finalization.incomplete = true;
      await this.runRecordStore.save(record);
    } else {
      const skippedCleanupAction = 'skip_run_owned_resource_cleanup_without_runtime_confirmation';
      record.finalization.unresolved = record.finalization.unresolved.filter(action => action !== skippedCleanupAction);
      record.cleanup.unresolved = record.cleanup.unresolved.filter(action => action !== skippedCleanupAction);
      record.finalization.incomplete = record.finalization.unresolved.length > 0;
      const prs = record.evidence.snapshots.flatMap(snapshot => snapshot.github?.delivery_prs || []);
      const ownedBranches = new Set(this.githubClient.findRunOwnedDeliveryBranches?.(prs, record) || []);
      const deliveryPrs = this.githubClient.deliveryPrIdentities?.(record) || [];
      for (const identity of deliveryPrs) {
        const recordedDelivery = (record.artifacts.owned_deliveries || []).find(delivery => delivery.pr_url === identity)
          || (identity === record.artifacts.delivery_pr_url && record.artifacts.delivery_branch ? { pr_url: identity, branch: record.artifacts.delivery_branch } : null);
        if (recordedDelivery?.branch) {
          ownedBranches.add(recordedDelivery.branch);
          continue;
        }
        let pr = this.githubClient.findDeliveryPullRequest?.(prs, identity) || null;
        if (!pr) {
          const readback = await this.runFinalizationAction(record, `read_run_owned_delivery_pr:${identity}`, async signal => {
            const observed = await this.githubClient.readPullRequest(identity, signal);
            if (!observed?.headRefName || !isSameRepositoryDelivery(observed, this.githubClient.repository)) {
              throw new Error(`delivery PR ${identity} does not identify a same-repository run-owned head`);
            }
            record.artifacts.delivery_pr_url = observed.url || identity;
            record.artifacts.delivery_branch = observed.headRefName;
            record.artifacts.delivery_branches ||= [];
            if (!record.artifacts.delivery_branches.includes(observed.headRefName)) record.artifacts.delivery_branches.push(observed.headRefName);
            record.artifacts.owned_deliveries ||= [];
            if (!record.artifacts.owned_deliveries.some(delivery => delivery.pr_url === record.artifacts.delivery_pr_url)) record.artifacts.owned_deliveries.push({ pr_url: record.artifacts.delivery_pr_url, branch: observed.headRefName, head: observed.headRefOid || null, observed_at: currentTimeIso() });
            return { url: record.artifacts.delivery_pr_url, branch: observed.headRefName };
          });
          if (readback?.branch) ownedBranches.add(readback.branch);
          continue;
        }
        if (!isSameRepositoryDelivery(pr, this.githubClient.repository) || !pr.headRefName) {
          await this.runFinalizationAction(record, `read_run_owned_delivery_pr:${identity}`, async () => {
            throw new Error(`delivery PR ${identity} does not identify a same-repository run-owned head`);
          });
          continue;
        }
        record.artifacts.delivery_pr_url = pr.url || identity;
        record.artifacts.delivery_branch = pr.headRefName;
        record.artifacts.delivery_branches ||= [];
        if (!record.artifacts.delivery_branches.includes(pr.headRefName)) record.artifacts.delivery_branches.push(pr.headRefName);
        record.artifacts.owned_deliveries ||= [];
        if (!record.artifacts.owned_deliveries.some(delivery => delivery.pr_url === record.artifacts.delivery_pr_url)) record.artifacts.owned_deliveries.push({ pr_url: record.artifacts.delivery_pr_url, branch: pr.headRefName, head: pr.headRefOid || null, observed_at: currentTimeIso() });
        ownedBranches.add(pr.headRefName);
      }
      const legacyOwnedBranches = (record.evidence.branch_isolation?.remaining_run_owned_refs || [])
        .map(ref => /^refs\/heads\/(.+)$/.exec(ref)?.[1])
        .filter(Boolean);
      const branches = new Set([...ownedBranches, ...(record.artifacts.delivery_branches || []), ...legacyOwnedBranches, record.artifacts.delivery_branch, baseBranch].filter(Boolean));
      const branchCommits = new Map();
      const addBranch = (branch, commit) => {
        if (!branch) return;
        branchCommits.set(branch, COMMIT_SHA.test(commit || '') ? commit : null);
      };
      const latestRecordedDelivery = branch => [...(record.artifacts.owned_deliveries || [])].reverse().find(delivery => delivery.branch === branch && COMMIT_SHA.test(delivery.head || ''));
      const mergingTarget = branch => authorizedMergeTarget(record, deliveryPrs, branch, prs, this.githubClient);
      const historicalDeliveryCommit = branch => {
        for (const identity of deliveryPrs) {
          const pullRequest = this.githubClient.findDeliveryPullRequest?.(prs, identity);
          if (pullRequest?.headRefName === branch && COMMIT_SHA.test(pullRequest.headRefOid || '')) return pullRequest.headRefOid;
        }
        return null;
      };
      for (const branch of branches) {
        const baseBranchCommit = branch === baseBranch
          ? record.artifacts?.remote_base_commit || authorizedRunScopedBaseCommit(record, deliveryPrs, baseBranch, prs, this.githubClient) || record.binding?.base_commit
          : null;
        const authorizedTarget = mergingTarget(branch);
        const ownedDelivery = latestRecordedDelivery(branch);
        const legacyRefCommit = record.evidence.branch_refs_after?.[`refs/heads/${branch}`];
        const currentDeliveryCommit = branch === record.artifacts.delivery_branch ? record.artifacts.delivered_head : null;
        addBranch(branch, baseBranchCommit || authorizedTarget || currentDeliveryCommit || ownedDelivery?.head || legacyRefCommit || historicalDeliveryCommit(branch));
      }
      const branchesToCheck = [];
      for (const [branch, expectedCommit] of branchCommits) {
        const action = branch === baseBranch ? `delete_run_scoped_base:${branch}` : `delete_delivery_branch:${branch}`;
        if (completedBranchDeletion(record, action, branch)) continue;
        const deliveryIdentity = branch !== baseBranch && (record.artifacts.owned_deliveries || []).some(delivery => delivery.branch === branch && delivery.pr_url)
          || branch === record.artifacts.delivery_branch && Boolean(record.artifacts.delivery_pr_url)
          || deliveryPrs.some(identity => this.githubClient.findDeliveryPullRequest?.(prs, identity)?.headRefName === branch);
        branchesToCheck.push({ branch, expected_commit: expectedCommit, action, requires_github_evidence: Boolean(deliveryIdentity) });
        await this.runFinalizationAction(record, action, async signal => {
          const result = await this.gitClient.deleteRemoteBranch(branch, { expectedCommit, timeout: this.config.finalization_timeout_ms, signal });
          if (!record.cleanup.branches_deleted.includes(branch)) record.cleanup.branches_deleted.push(branch);
          return { branch, expected_commit: expectedCommit, ...result };
        });
      }
      const branchCleanup = await this.runFinalizationAction(record, 'verify_run_owned_branch_cleanup', async signal => {
        const checkedAt = currentTimeIso();
        const refs = [];
        const currentSnapshot = record.evidence.snapshots.at(-1);
        const currentDeliveryPrs = Array.isArray(currentSnapshot?.github?.delivery_prs) ? currentSnapshot.github.delivery_prs : null;
        const currentNotionReadbackAvailable = typeof currentSnapshot?.notion?.workpad === 'string';
        for (const { branch, expected_commit: expectedCommit, requires_github_evidence: requiresGitHubEvidence } of branchesToCheck) {
          try {
            const commit = await this.gitClient.readRemoteBranchCommit(branch, { timeout: this.config.finalization_timeout_ms, signal });
            const currentDeliveryObserved = !requiresGitHubEvidence || Boolean(currentDeliveryPrs && deliveryPrs.some(identity => {
              const pr = this.githubClient.findDeliveryPullRequest?.(currentDeliveryPrs, identity);
              return pr?.headRefName === branch && isSameRepositoryDelivery(pr, this.githubClient.repository);
            }));
            const deliveryEvidenceUnavailable = requiresGitHubEvidence && (!currentDeliveryObserved || !currentNotionReadbackAvailable);
            const baseIdentityChanged = branch === baseBranch && commit && expectedCommit && commit.toLowerCase() !== expectedCommit.toLowerCase();
            const status = !commit
              ? 'absent'
              : !expectedCommit
                ? 'unconfirmed'
                : commit.toLowerCase() === expectedCommit.toLowerCase()
                  ? 'present'
                  : baseIdentityChanged || deliveryEvidenceUnavailable ? 'unconfirmed' : 'identity_changed';
            const error = status === 'unconfirmed' && commit
              ? baseIdentityChanged
                ? 'run-scoped base remains at a commit different from its authorized cleanup target'
                : requiresGitHubEvidence && deliveryEvidenceUnavailable
                  ? 'current Notion/GitHub delivery evidence is unavailable; ref identity cannot be confirmed'
                  : null
              : null;
            refs.push({ branch, expected_commit: expectedCommit, status, commit, ...(error ? { error } : {}) });
          } catch (error) {
            refs.push({ branch, expected_commit: expectedCommit, status: 'unconfirmed', commit: null, error: String(error?.message || error) });
          }
        }
        const remaining = refs.filter(ref => ref.status === 'present' || ref.status === 'unconfirmed');
        record.evidence.owned_branch_cleanup = { checked_at: checkedAt, refs, remaining_refs: remaining.map(ref => ref.branch) };
        if (remaining.length) throw new Error(`run-owned branch cleanup unresolved: ${remaining.map(ref => ref.status === 'unconfirmed' ? `${ref.branch} could not be confirmed (${ref.error || 'recorded commit identity is missing'})` : `${ref.branch} remains at recorded commit ${ref.commit}`).join('; ')}`);
        return record.evidence.owned_branch_cleanup;
      });
      if (branchCleanup) {
        for (const ref of branchCleanup.refs.filter(item => item.status === 'absent' || item.status === 'identity_changed')) {
          const branchAction = branchesToCheck.find(item => item.branch === ref.branch)?.action;
          if (branchAction) {
            const wasUnresolved = record.finalization.unresolved.includes(branchAction) || record.cleanup.unresolved.includes(branchAction);
            record.finalization.unresolved = record.finalization.unresolved.filter(action => action !== branchAction);
            record.cleanup.unresolved = record.cleanup.unresolved.filter(action => action !== branchAction);
            if (wasUnresolved) {
              if (ref.status === 'absent') {
                recordFinalizationAction(record, `confirm_run_owned_branch_absent:${ref.branch}`, { status: 'completed', expected_commit: ref.expected_commit, reason: 'the final exact-ref readback confirmed the run-owned branch is absent' });
              } else {
                recordFinalizationAction(record, `preserve_replaced_run_branch:${ref.branch}`, { status: 'completed', expected_commit: ref.expected_commit, observed_commit: ref.commit, reason: 'the exact recorded ref generation is no longer present; preserve the replacement ref' });
              }
            }
          }
        }
        record.finalization.incomplete = record.finalization.unresolved.length > 0;
        await this.runRecordStore.save(record);
      }
      if (branchCleanup && record.finalization.unresolved.includes('verify_remote_branch_isolation')) {
        record.finalization.unresolved = record.finalization.unresolved.filter(action => action !== 'verify_remote_branch_isolation');
        record.cleanup.unresolved = record.cleanup.unresolved.filter(action => action !== 'verify_remote_branch_isolation');
        recordFinalizationAction(record, 'retire_legacy_repository_wide_branch_isolation', { status: 'completed', reason: 'replaced by authoritative readback of run-owned branches only' });
        await this.runRecordStore.save(record);
      }
      if (workspaceRoot) {
        await this.runFinalizationAction(record, `delete_workspace_root:${workspaceRoot}`, async signal => {
          const result = await this.operatorClient.removeWorkspaceRoot(workspaceRoot, this.config.workspace_root, { timeout: this.config.finalization_timeout_ms, signal });
          record.cleanup.workspaces_deleted.push(workspaceRoot);
          return result;
        });
      }
    }
    const finalState = task?.state || record.evidence.snapshots.at(-1)?.notion?.state || null;
    record.lifecycle.terminal_state = finalState;
    record.finalization.complete = record.finalization.unresolved.length === 0;
    record.status = 'finished';
    this.runTimingRecorder.recordRunEnded(record, currentTimeIso());
    if (record.finalization.incomplete) addFailure(record, new Error('finalization completed with unresolved actions'), 'finalization');
    await this.runRecordStore.save(record);
    return record;
  }
}
