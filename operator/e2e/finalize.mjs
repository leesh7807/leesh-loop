import { nowIso, bounded, pathWithin } from './common.mjs';
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
      await this.store.save(record);
      return value;
    } catch (error) {
      recordAction(record, name, { status: 'failed', error: String(error?.message || error) });
      record.finalization.incomplete = true;
      record.finalization.unresolved.push(name);
      record.cleanup.unresolved.push(name);
      await this.store.save(record).catch(() => {});
      return null;
    }
  }

  async finalize({ record, reason, task, dashboard, baseBranch, workspaceRoot, normalDone = false }) {
    record.finalization.reason = reason;
    if (!normalDone) {
      await this.action(record, 'stop_run_owned_symphony', async () => {
        if (record.cleanup.runtime_stopped === true) return { skipped: true, already_stopped: true };
        if (!record.timing.symphony.started_at) {
          record.cleanup.runtime_stopped = true;
          return { skipped: true };
        }
        const value = await this.runtime.stop(record.paths.runtime_project, this.config.runtime_stop_timeout_ms);
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
        record.finalization.incomplete = true;
        record.finalization.unresolved.push('run-owned Symphony stop confirmation');
        record.cleanup.unresolved.push('run-owned Symphony stop confirmation');
        await this.store.save(record);
      }
    } else {
      await this.action(record, 'stop_run_owned_symphony_after_done', async () => {
        if (record.cleanup.runtime_stopped === true) return { skipped: true, already_stopped: true };
        if (!record.timing.symphony.started_at) {
          record.cleanup.runtime_stopped = true;
          return { skipped: true };
        }
        const value = await this.runtime.stop(record.paths.runtime_project, this.config.runtime_stop_timeout_ms);
        record.cleanup.runtime_stopped = true;
        record.timing.symphony.stopped_at = nowIso();
        return value;
      });
    }

    await this.action(record, 'final_evidence_snapshot', async () => {
      const snapshot = await this.evidence.snapshot({ record, databaseUrl: this.config.notion_database_url, identifier: record.artifacts.task_identifier, dashboard, baseBranch, workspaceRoot });
      record.evidence.snapshots.push(snapshot);
      return { observed_at: snapshot.observed_at, errors: snapshot.errors };
    });

    const prs = record.evidence.snapshots.flatMap(snapshot => snapshot.github?.delivery_prs || []);
    const branches = new Set(prs.map(pr => pr.headRefName).filter(Boolean));
    for (const branch of branches) {
      await this.action(record, `delete_delivery_branch:${branch}`, async () => {
        await this.git.deleteBranch(branch);
        record.cleanup.branches_deleted.push(branch);
        return { branch };
      });
    }
    if (baseBranch) {
      await this.action(record, `delete_run_scoped_base:${baseBranch}`, async () => {
        await this.git.deleteBranch(baseBranch);
        record.cleanup.branches_deleted.push(baseBranch);
        return { branch: baseBranch };
      });
    }
    await this.action(record, 'verify_remote_branch_isolation', async () => {
      const after = await this.git.remoteRefs();
      record.evidence.branch_refs_after = after;
      const before = record.evidence.branch_refs_before || {};
      const knownDeliveryBranches = record.evidence.snapshots.flatMap(snapshot => snapshot.github?.delivery_prs || []).map(pr => pr.headRefName).filter(Boolean);
      const runBranches = new Set([baseBranch, ...knownDeliveryBranches, ...record.cleanup.branches_deleted].filter(Boolean).map(branch => `refs/heads/${branch}`));
      const unrelatedChanges = new Set([...new Set([...Object.keys(before), ...Object.keys(after)])].filter(ref => !runBranches.has(ref)).filter(ref => before[ref] !== after[ref]));
      const remainingRunBranches = Object.keys(after).filter(ref => runBranches.has(ref));
      record.evidence.branch_isolation = { unrelated_changes: [...unrelatedChanges], remaining_run_owned_refs: remainingRunBranches, transient_mutations_unobservable: true };
      return record.evidence.branch_isolation;
    });
    const observedWorkspaces = [...record.evidence.workspace_paths, ...record.evidence.snapshots.flatMap(snapshot => {
      const path = snapshot.symphony?.issue?.workspace?.path;
      return path && pathWithin(path, workspaceRoot) ? [path] : [];
    })];
    for (const workspace of new Set(observedWorkspaces)) {
      await this.action(record, `delete_workspace:${workspace}`, async () => {
        const result = await this.runtime.removeWorkspace?.(workspace, workspaceRoot);
        record.cleanup.workspaces_deleted.push(workspace);
        return result ?? { path: workspace };
      });
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
