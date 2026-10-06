import { RunTimingRecorder, runWithTimeout, currentTimeIso } from '../run-timing.mjs';
import { TERMINAL_STATES } from '../lifecycle/lifecycle-interpreter.mjs';
import { addFailure, recordFinalizationAction } from '../../model/run-record-store.mjs';
import { deleteRunOwnedDeliveryBranch } from './run-owned-delivery-branch.mjs';

function coordinationChildRuntime(child) {
  return {
    runtime_id: child.runtime_id || null,
    status: child.status || 'unknown',
    process_identity: child.process_identity || null
  };
}

export class RunFinalizer {
  constructor({ config, runRecordStore, notionClient, operatorClient, gitClient, githubClient, runEvidenceCollector, runTimingRecorder, reservationAuthority }) {
    this.config = config;
    this.runRecordStore = runRecordStore;
    this.notionClient = notionClient;
    this.operatorClient = operatorClient;
    this.gitClient = gitClient;
    this.githubClient = githubClient;
    this.runEvidenceCollector = runEvidenceCollector;
    this.runTimingRecorder = runTimingRecorder || new RunTimingRecorder();
    this.reservationAuthority = reservationAuthority;
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
    const databaseUrl = record.binding?.notion_database_url;
    record.finalization.reason = reason;
    if (!normalDone) {
      await this.runFinalizationAction(record, 'stop_run_owned_symphony', async signal => {
        if (record.cleanup.runtime_stopped === true) return { skipped: true, already_stopped: true };
        if (!record.timing?.symphony?.start_requested_at && !record.timing?.symphony?.started_at) {
          record.cleanup.runtime_stopped = true;
          return { skipped: true };
        }
        const value = await this.operatorClient.stopConfiguredOperatorProject(record.paths.runtime_project, this.config.runtime_stop_timeout_ms, signal);
        const stopped = await this.operatorClient.verifyRuntimeStopped(record.paths.runtime_state, record.runtime?.child_runtime);
        record.cleanup.runtime_stopped = true;
        this.runTimingRecorder.recordSymphonyStopped(record, currentTimeIso());
        return { operator_stop: value, authoritative_readback: stopped };
      });
      if (record.cleanup.runtime_stopped) {
        const reread = task?.id
          ? await this.runFinalizationAction(record, 'reread_task_after_runtime_stop', signal => this.notionClient.readTask(databaseUrl, task.id, signal))
          : null;
        const rereadAction = record.finalization.actions.at(-1);
        if (rereadAction?.status === 'completed' && reread) task = reread;
        if (rereadAction?.status === 'completed' && task && !TERMINAL_STATES.has(task.state)) {
          await this.runFinalizationAction(record, 'cancel_nonterminal_task', async signal => {
            const cancelled = await this.notionClient.updateTaskState(databaseUrl, task.id, 'Cancelled', signal);
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
        const stopped = await this.operatorClient.verifyRuntimeStopped(record.paths.runtime_state, record.runtime?.child_runtime);
        record.cleanup.runtime_stopped = true;
        this.runTimingRecorder.recordSymphonyStopped(record, currentTimeIso());
        return { operator_stop: value, authoritative_readback: stopped };
      });
    }

    if (record.cleanup.runtime_stopped === true && record.runtime?.child_runtime) {
      record.runtime.child_runtime = {
        ...record.runtime.child_runtime,
        status: 'stopped',
        stopped_at: record.runtime.child_runtime.stopped_at || currentTimeIso()
      };
    }

    await this.runFinalizationAction(record, 'final_evidence_snapshot', async signal => {
      const snapshot = await this.runEvidenceCollector.collectSnapshot({ databaseUrl, identifier: record.artifacts.task_identifier, dashboard, baseBranch, workspaceRoot, signal });
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
      const ownedBranches = this.githubClient.findRunOwnedDeliveryBranches?.(prs, record) || [];
      const branches = new Set(ownedBranches);
      for (const branch of branches) {
        await this.runFinalizationAction(record, `delete_delivery_branch:${branch}`, async signal => {
          const result = await deleteRunOwnedDeliveryBranch({ record, branch, baseBranch, gitClient: this.gitClient, timeout: this.config.finalization_timeout_ms, signal });
          record.cleanup.branches_deleted.push(branch);
          return result;
        });
      }
      if (baseBranch) {
        await this.runFinalizationAction(record, `delete_run_scoped_base:${baseBranch}`, async signal => {
          const expectedCommit = record.artifacts?.remote_base_commit || record.binding?.base_commit || null;
          await this.gitClient.deleteRemoteBranch(baseBranch, { expectedCommit, timeout: this.config.finalization_timeout_ms, signal });
          record.cleanup.branches_deleted.push(baseBranch);
          return { branch: baseBranch, expected_commit: expectedCommit };
        });
      }
      await this.runFinalizationAction(record, 'verify_remote_branch_isolation', async signal => {
        const after = await this.gitClient.listRemoteBranchRefs({ timeout: this.config.finalization_timeout_ms, signal });
        record.evidence.branch_refs_after = after;
        const before = record.evidence.branch_refs_before || {};
        const knownDeliveryBranches = this.githubClient.findRunOwnedDeliveryBranches?.(record.evidence.snapshots.flatMap(snapshot => snapshot.github?.delivery_prs || []), record) || [];
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
    this.runTimingRecorder.recordRunEnded(record, currentTimeIso());
    if (record.finalization.incomplete) addFailure(record, new Error('finalization completed with unresolved actions'), 'finalization');
    await this.settleDatabaseReservation(record);
    record.finalization.complete = record.finalization.unresolved.length === 0;
    if (record.status !== 'failed') record.status = 'finished';
    await this.runRecordStore.save(record);
    await this.runRecordStore.writeSummary?.(record);
    return record;
  }

  async settleDatabaseReservation(record) {
    const databaseId = record.binding?.database_id;
    const runId = record.run_id;
    if (!this.reservationAuthority || !databaseId || !runId) return;
    const childRuntime = record.runtime?.child_runtime
      ? { ...record.runtime.child_runtime, status: record.cleanup.runtime_stopped ? 'stopped' : 'active' }
      : { status: record.timing?.symphony?.start_requested_at ? 'unknown' : 'not_started' };
    const lifecycleStatus = record.finalization.complete ? (record.failures.length ? 'failed' : 'completed') : 'failed';
    const endedAt = record.ended_at || currentTimeIso();
    let reservationEnded = false;
    let databaseReleased = false;
    try {
      const lifecycle = await this.reservationAuthority.updateRunLifecycleForReservation(databaseId, runId, {
        status: lifecycleStatus,
        ended_at: endedAt,
        selected_database_id: databaseId,
        child_runtime_id: childRuntime.runtime_id || null,
        child_runtime: coordinationChildRuntime(childRuntime)
      });
      if (!lifecycle.committed) throw new Error('database reservation ownership changed before run lifecycle finalization readback');
      if (record.finalization.complete && record.cleanup.runtime_stopped === true && record.cleanup.unresolved.length === 0) {
        const released = await this.reservationAuthority.release(databaseId, runId);
        if (!released.committed) throw new Error(`database reservation could not be safely returned to available: ${released.reason || released.state?.status || 'conditional transition rejected'}`);
        reservationEnded = true;
        databaseReleased = true;
        record.database_reservation = { database_id: databaseId, status: 'available', released_at: endedAt };
        const lifecycleCleanup = await this.reservationAuthority.deleteRunLifecycle(runId);
        if (!lifecycleCleanup.committed) throw new Error(`run lifecycle coordination state could not be safely removed: ${lifecycleCleanup.reason || 'conditional cleanup rejected'}`);
        record.cleanup.run_lifecycle_coordination_deleted = true;
      } else {
        const unavailable = await this.reservationAuthority.markUnavailable(databaseId, runId, 'required run cleanup or settlement did not complete');
        if (!unavailable.committed) throw new Error('current database reservation could not be atomically changed to unavailable');
        reservationEnded = true;
        record.database_reservation = { database_id: databaseId, status: 'unavailable', recovery_marker: unavailable.recovery_marker };
        record.status = 'failed';
        addFailure(record, new Error(`database ${databaseId} is unavailable until required E2E recovery completes`), 'database_reservation_finalization');
      }
    } catch (error) {
      record.status = 'failed';
      const unresolvedAction = databaseReleased ? 'run_lifecycle_coordination_cleanup' : 'database_reservation_finalization';
      if (!record.finalization.unresolved.includes(unresolvedAction)) record.finalization.unresolved.push(unresolvedAction);
      if (!record.cleanup.unresolved.includes(unresolvedAction)) record.cleanup.unresolved.push(unresolvedAction);
      record.finalization.incomplete = true;
      addFailure(record, error, unresolvedAction);
      if (!reservationEnded) {
        let current = null;
        let reservationReadError = null;
        try {
          current = await this.reservationAuthority.read(databaseId);
        } catch (readError) {
          reservationReadError = String(readError?.message || readError);
          addFailure(record, readError, 'database_reservation_readback');
        }
        if (current && (current.status !== 'in use' || current.reservation?.run_id !== runId)) {
          reservationEnded = true;
        } else {
          const unavailable = await this.reservationAuthority.markUnavailable(databaseId, runId, 'required run cleanup or settlement did not complete', {
            error: String(error?.message || error),
            ...(reservationReadError ? { reservation_state_read_error: reservationReadError } : {})
          }).catch(() => ({ committed: false }));
          if (unavailable.committed) {
            reservationEnded = true;
            record.database_reservation = { database_id: databaseId, status: 'unavailable', recovery_marker: unavailable.recovery_marker };
          }
        }
      }
      if (reservationEnded && !databaseReleased) {
        await this.reservationAuthority.writeRunLifecycle(runId, { status: 'failed', ended_at: endedAt, selected_database_id: databaseId, child_runtime: coordinationChildRuntime(childRuntime) }).catch(() => {});
      }
    }
  }
}
