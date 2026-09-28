import { RunTimingRecorder, runWithTimeout, currentTimeIso } from '../run-timing.mjs';
import { TERMINAL_STATES } from '../lifecycle/lifecycle-interpreter.mjs';
import { addFailure, recordFinalizationAction } from '../../model/run-record-store.mjs';

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

  async finalizeRun({ record, reason, task, dashboard, baseBranch, workspaceRoot, normalDone = false }) {
    record.finalization.reason = reason;
    if (!normalDone) {
      await this.runFinalizationAction(record, 'stop_run_owned_symphony', async signal => {
        if (record.cleanup.runtime_stopped === true) return { skipped: true, already_stopped: true };
        if (!record.timing?.symphony?.start_requested_at && !record.timing?.symphony?.started_at) {
          record.cleanup.runtime_stopped = true;
          return { skipped: true };
        }
        const value = await this.operatorClient.stopConfiguredOperatorProject(record.paths.runtime_project, this.config.runtime_stop_timeout_ms, signal);
        record.cleanup.runtime_stopped = true;
        this.runTimingRecorder.recordSymphonyStopped(record, currentTimeIso());
        return value;
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
        if (record.cleanup.runtime_stopped === true) return { skipped: true, already_stopped: true };
        if (!record.timing?.symphony?.start_requested_at && !record.timing?.symphony?.started_at) {
          record.cleanup.runtime_stopped = true;
          return { skipped: true };
        }
        const value = await this.operatorClient.stopConfiguredOperatorProject(record.paths.runtime_project, this.config.runtime_stop_timeout_ms, signal);
        record.cleanup.runtime_stopped = true;
        this.runTimingRecorder.recordSymphonyStopped(record, currentTimeIso());
        return value;
      });
    }

    await this.runFinalizationAction(record, 'final_evidence_snapshot', async signal => {
      const snapshot = await this.runEvidenceCollector.collectSnapshot({ databaseUrl: this.config.notion_database_url, identifier: record.artifacts.task_identifier, dashboard, baseBranch, workspaceRoot, signal });
      record.evidence.snapshots.push(snapshot);
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
            if (!observed?.headRefName || observed.isCrossRepository !== false || observed.headRepository?.nameWithOwner !== this.githubClient.repository) {
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
        if (pr.isCrossRepository !== false || pr.headRepository?.nameWithOwner !== this.githubClient.repository || !pr.headRefName) {
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
      for (const branch of branches) {
        await this.runFinalizationAction(record, branch === baseBranch ? `delete_run_scoped_base:${branch}` : `delete_delivery_branch:${branch}`, async signal => {
          await this.gitClient.deleteRemoteBranch(branch, { timeout: this.config.finalization_timeout_ms, signal });
          if (!record.cleanup.branches_deleted.includes(branch)) record.cleanup.branches_deleted.push(branch);
          return { branch };
        });
      }
      const branchCleanup = await this.runFinalizationAction(record, 'verify_run_owned_branch_cleanup', async signal => {
        const checkedAt = currentTimeIso();
        const refs = [];
        for (const branch of branches) {
          try {
            const commit = await this.gitClient.readRemoteBranchCommit(branch, { timeout: this.config.finalization_timeout_ms, signal });
            refs.push({ branch, status: commit ? 'present' : 'absent', commit });
          } catch (error) {
            refs.push({ branch, status: 'unconfirmed', commit: null, error: String(error?.message || error) });
          }
        }
        const remaining = refs.filter(ref => ref.status !== 'absent');
        record.evidence.owned_branch_cleanup = { checked_at: checkedAt, refs, remaining_refs: remaining.map(ref => ref.branch) };
        if (remaining.length) throw new Error(`run-owned branch cleanup unresolved: ${remaining.map(ref => ref.status === 'unconfirmed' ? `${ref.branch} could not be read (${ref.error})` : `${ref.branch} remains at ${ref.commit}`).join('; ')}`);
        return record.evidence.owned_branch_cleanup;
      });
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
