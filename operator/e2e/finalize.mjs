import { nowIso, bounded } from './common.mjs';
import { TERMINAL_STATES } from './lifecycle.mjs';
import { addFailure, recordAction } from './record.mjs';

export class Finalizer {
  constructor({ config, store, notion, runtime, git, github, evidence }) {
    this.config = config;
    this.store = store;
    this.notion = notion;
    this.runtime = runtime;
    this.git = git;
    this.github = github;
    this.evidence = evidence;
  }

  async action(record, name, operation) {
    try {
      const value = await bounded(operation, this.config.finalization_timeout_ms, name);
      recordAction(record, name, { status: 'completed', value });
      record.finalization.unresolved = record.finalization.unresolved.filter(action => action !== name);
      record.cleanup.unresolved = record.cleanup.unresolved.filter(action => action !== name);
      record.finalization.incomplete = record.finalization.unresolved.length > 0;
      await this.store.save(record);
      return value;
    } catch (error) {
      recordAction(record, name, { status: 'failed', error: String(error?.message || error) });
      record.finalization.incomplete = true;
      if (!record.finalization.unresolved.includes(name)) record.finalization.unresolved.push(name);
      if (!record.cleanup.unresolved.includes(name)) record.cleanup.unresolved.push(name);
      await this.store.save(record).catch(() => {});
      return null;
    }
  }

  async finalize({ record, reason, task, dashboard, baseBranch, workspaceRoot, normalDone = false }) {
    record.finalization.reason = reason;
    if (!normalDone) {
      await this.action(record, 'stop_run_owned_symphony', async signal => {
        if (record.cleanup.runtime_stopped === true) return { skipped: true, already_stopped: true };
        if (!record.timing?.symphony?.start_requested_at && !record.timing?.symphony?.started_at) {
          record.cleanup.runtime_stopped = true;
          return { skipped: true };
        }
        const value = await this.runtime.stop(record.paths.runtime_project, this.config.runtime_stop_timeout_ms, signal);
        record.cleanup.runtime_stopped = true;
        record.timing.symphony.stopped_at = nowIso();
        return value;
      });
      if (record.cleanup.runtime_stopped) {
        const reread = task?.id
          ? await this.action(record, 'reread_task_after_runtime_stop', () => this.notion.readTask(this.config.notion_database_url, task.id))
          : null;
        const rereadAction = record.finalization.actions.at(-1);
        if (rereadAction?.status === 'completed' && reread) task = reread;
        if (rereadAction?.status === 'completed' && task && !TERMINAL_STATES.has(task.state)) {
          await this.action(record, 'cancel_nonterminal_task', async () => {
            const cancelled = await this.notion.updateState(this.config.notion_database_url, task.id, 'Cancelled');
            if (cancelled.state !== 'Cancelled') throw new Error(`Cancelled transition readback was ${cancelled.state}`);
            task = cancelled;
            record.cleanup.task_terminalized = true;
            return { state: cancelled.state, actor: 'e2e-harness', reason };
          });
        }
      } else {
        recordAction(record, 'skip_task_terminalization_without_runtime_confirmation', { status: 'blocked', reason: 'run-owned Symphony stop was not confirmed' });
        await this.store.save(record);
      }
    } else {
      await this.action(record, 'stop_run_owned_symphony_after_done', async signal => {
        if (record.cleanup.runtime_stopped === true) return { skipped: true, already_stopped: true };
        if (!record.timing?.symphony?.start_requested_at && !record.timing?.symphony?.started_at) {
          record.cleanup.runtime_stopped = true;
          return { skipped: true };
        }
        const value = await this.runtime.stop(record.paths.runtime_project, this.config.runtime_stop_timeout_ms, signal);
        record.cleanup.runtime_stopped = true;
        record.timing.symphony.stopped_at = nowIso();
        return value;
      });
    }

    await this.action(record, 'final_evidence_snapshot', async signal => {
      const snapshot = await this.evidence.snapshot({ record, databaseUrl: this.config.notion_database_url, identifier: record.artifacts.task_identifier, dashboard, baseBranch, workspaceRoot, signal });
      record.evidence.snapshots.push(snapshot);
      return { observed_at: snapshot.observed_at, errors: snapshot.errors };
    });

    const cleanupAllowed = record.cleanup.runtime_stopped === true;
    if (!cleanupAllowed) {
      const action = 'skip_run_owned_resource_cleanup_without_runtime_confirmation';
      recordAction(record, action, { status: 'blocked', reason: 'run-owned Symphony stop was not confirmed' });
      if (!record.finalization.unresolved.includes(action)) record.finalization.unresolved.push(action);
      if (!record.cleanup.unresolved.includes(action)) record.cleanup.unresolved.push(action);
      record.finalization.incomplete = true;
      await this.store.save(record);
    } else {
      const skippedCleanupAction = 'skip_run_owned_resource_cleanup_without_runtime_confirmation';
      record.finalization.unresolved = record.finalization.unresolved.filter(action => action !== skippedCleanupAction);
      record.cleanup.unresolved = record.cleanup.unresolved.filter(action => action !== skippedCleanupAction);
      record.finalization.incomplete = record.finalization.unresolved.length > 0;
      const prs = record.evidence.snapshots.flatMap(snapshot => snapshot.github?.delivery_prs || []);
      const ownedBranches = this.github.runOwnedDeliveryBranches?.(prs, record) || [];
      const branches = new Set(ownedBranches);
      for (const branch of branches) {
        await this.action(record, `delete_delivery_branch:${branch}`, async signal => {
          await this.git.deleteBranch(branch, { timeout: this.config.finalization_timeout_ms, signal });
          record.cleanup.branches_deleted.push(branch);
          return { branch };
        });
      }
      if (baseBranch) {
        await this.action(record, `delete_run_scoped_base:${baseBranch}`, async signal => {
          await this.git.deleteBranch(baseBranch, { timeout: this.config.finalization_timeout_ms, signal });
          record.cleanup.branches_deleted.push(baseBranch);
          return { branch: baseBranch };
        });
      }
      await this.action(record, 'verify_remote_branch_isolation', async signal => {
        const after = await this.git.remoteRefs({ timeout: this.config.finalization_timeout_ms, signal });
        record.evidence.branch_refs_after = after;
        const before = record.evidence.branch_refs_before || {};
        const knownDeliveryBranches = this.github.runOwnedDeliveryBranches?.(record.evidence.snapshots.flatMap(snapshot => snapshot.github?.delivery_prs || []), record) || [];
        const runBranches = new Set([baseBranch, ...knownDeliveryBranches, ...record.cleanup.branches_deleted].filter(Boolean).map(branch => `refs/heads/${branch}`));
        const changedRefs = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(ref => !runBranches.has(ref)).filter(ref => before[ref] !== after[ref]);
        const unrelatedChanges = changedRefs.filter(ref => before[ref] !== undefined && after[ref] !== undefined);
        const unrelatedDeletions = changedRefs.filter(ref => before[ref] !== undefined && after[ref] === undefined);
        const unresolvedNewRefs = changedRefs.filter(ref => before[ref] === undefined && after[ref] !== undefined);
        const remainingRunBranches = Object.keys(after).filter(ref => runBranches.has(ref));
        record.evidence.branch_isolation = { unrelated_changes: unrelatedChanges, unrelated_deletions: unrelatedDeletions, unresolved_new_refs: unresolvedNewRefs, remaining_run_owned_refs: remainingRunBranches, transient_mutations_unobservable: true };
        return record.evidence.branch_isolation;
      });
      if (workspaceRoot) {
        await this.action(record, `delete_workspace_root:${workspaceRoot}`, async signal => {
          const result = await this.runtime.removeWorkspaceRoot(workspaceRoot, this.config.workspace_root, { timeout: this.config.finalization_timeout_ms, signal });
          record.cleanup.workspaces_deleted.push(workspaceRoot);
          return result;
        });
      }
    }
    const finalState = task?.state || record.evidence.snapshots.at(-1)?.notion?.state || null;
    record.lifecycle.terminal_state = finalState;
    record.finalization.complete = record.finalization.unresolved.length === 0;
    record.status = 'finished';
    record.ended_at = nowIso();
    record.timing.run.ended_at = record.ended_at;
    record.timing.run.observed_duration_ms = Date.parse(record.ended_at) - Date.parse(record.started_at);
    if (record.finalization.incomplete) addFailure(record, new Error('finalization completed with unresolved actions'), 'finalization');
    await this.store.save(record);
    return record;
  }
}
