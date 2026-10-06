import { DATABASE_STATES } from './database-reservation-authority.mjs';
import { currentTimeIso, createRunId } from '../run-timing.mjs';
import { inspectProcessIdentity } from '../../model/process-identity.mjs';

const PRESERVED_STATES = new Set(['Backlog', 'Done', 'Cancelled']);
const TERMINAL_RUN_STATES = new Set(['completed', 'failed', 'interrupted', 'resource_unavailable_admission']);

export class ResourceUnavailableAdmissionError extends Error {
  constructor(runId) {
    super(`E2E run ${runId} could not acquire an available database reservation`);
    this.name = 'ResourceUnavailableAdmissionError';
    this.code = 'RESOURCE_UNAVAILABLE_ADMISSION';
    this.run_id = runId;
  }
}

export class RunAdmission {
  constructor({ config, catalog, runRecordStore, notionClient, gitClient, operatorClient, reservationAuthority, identity = createRunId } = {}) {
    this.config = config;
    this.catalog = catalog;
    this.runRecordStore = runRecordStore;
    this.notionClient = notionClient;
    this.gitClient = gitClient;
    this.operatorClient = operatorClient;
    this.reservationAuthority = reservationAuthority;
    this.identity = identity;
  }

  async settleUnadmittedRunLifecycle(runId) {
    const cleanup = { runtime_stopped: true, branches_deleted: [], workspaces_deleted: [], run_lifecycle_coordination_deleted: false, unresolved: [] };
    let databaseReservation = { status: 'not acquired' };
    try {
      const result = await this.reservationAuthority.deleteRunLifecycle(runId);
      if (result.committed) {
        cleanup.run_lifecycle_coordination_deleted = true;
      } else {
        databaseReservation = { status: 'unavailable' };
        cleanup.unresolved.push('run_lifecycle_coordination_cleanup');
      }
    } catch {
      databaseReservation = { status: 'unknown' };
      cleanup.unresolved.push('run_lifecycle_coordination_cleanup');
    }
    return { cleanup, databaseReservation };
  }

  async checkRunAdmission({ runId = this.identity(), runProcess, workload = null } = {}) {
    if (!runProcess) throw new Error('E2E admission requires a durable run process identity');
    await this.reservationAuthority.writeRunLifecycle(runId, {
      run_id: runId,
      status: 'active',
      started_at: currentTimeIso(),
      run_process: runProcess,
      child_runtime: { status: 'not_started' }
    });

    const recovery = await this.recoveryPass();
    const recoveryCleanupBlocked = new Set(recovery
      .filter(item => item.result === 'recovered; run lifecycle cleanup pending')
      .map(item => item.database_id));
    let databaseAdmissionFailures = [];
    let contentionObserved = false;
    for (let pass = 0; pass < 2; pass += 1) {
      let acquired = false;
      for (const candidate of this.config.database_pool) {
        if (recoveryCleanupBlocked.has(candidate.database_id)) continue;
        let current;
        try { current = await this.reservationAuthority.read(candidate.database_id); }
        catch (error) {
          databaseAdmissionFailures.push({ database_id: candidate.database_id, error: String(error?.message || error) });
          continue;
        }
        if (current.status !== DATABASE_STATES.AVAILABLE) continue;
        const result = await this.reservationAuthority.reserve(candidate.database_id, { run_id: runId });
        if (!result.reserved) {
          contentionObserved = true;
          continue;
        }
        acquired = true;
        try {
          const tasks = await this.notionClient.listTasks(candidate.database_url);
          const conflicting = tasks.filter(task => !PRESERVED_STATES.has(task.state));
          if (conflicting.length) {
            const details = conflicting.map(task => ({ id: task.id, identifier: task.identifier, state: task.state }));
            const transition = await this.reservationAuthority.markUnavailable(candidate.database_id, runId, 'database-specific admission found task residue', { tasks: details, recovery_pass: recovery.find(item => item.database_id === candidate.database_id) || null });
            if (!transition.committed) throw new Error(`database reservation ownership changed during admission for ${candidate.database_id}`);
            databaseAdmissionFailures.push({ database_id: candidate.database_id, error: 'active E2E task residue requires recovery', tasks: details });
            acquired = false;
            continue;
          }
          const refs = await this.gitClient.listRemoteBranchRefs();
          await this.reservationAuthority.writeRunLifecycle(runId, { selected_database_id: candidate.database_id });
          return { admitted: true, run_id: runId, database: candidate, workload: this.catalog, tasks, refs, recovery };
        } catch (error) {
          if (acquired) {
            const transition = await this.reservationAuthority.markUnavailable(candidate.database_id, runId, 'database-specific admission or required readback failed', { error: String(error?.message || error) }).catch(() => ({ committed: false }));
            if (!transition.committed) {
              await this.reservationAuthority.writeRunLifecycle(runId, { status: 'failed', ended_at: currentTimeIso() }).catch(() => {});
              throw new Error(`E2E database admission failed and database ${candidate.database_id} could not be made unavailable: ${error.message}`);
            }
          }
          databaseAdmissionFailures.push({ database_id: candidate.database_id, error: String(error?.message || error) });
          acquired = false;
        }
      }
      if (!contentionObserved) break;
      const newlyAvailable = await this.anyAvailableDatabase();
      if (!newlyAvailable || pass > 0) break;
    }

    if (databaseAdmissionFailures.length) {
      const error = new Error(`E2E database admission failed for ${databaseAdmissionFailures.map(item => item.database_id).join(', ')}`);
      error.database_admission_failures = databaseAdmissionFailures;
      await this.reservationAuthority.writeRunLifecycle(runId, { status: 'failed', ended_at: currentTimeIso() }).catch(() => {});
      const settlement = await this.settleUnadmittedRunLifecycle(runId);
      await this.runRecordStore?.saveAdmissionFailure(error, { runId, databasePool: this.config.database_pool, recovery, workload, ...settlement }).catch(() => {});
      return { admitted: false, failure: 'database_admission_failed', run_id: runId, recovery, error: error.message };
    }

    const admission = new ResourceUnavailableAdmissionError(runId);
    await this.reservationAuthority.writeRunLifecycle(runId, { status: 'resource_unavailable_admission', ended_at: currentTimeIso() }).catch(error => {
      throw new Error(`resource unavailable admission could not be recorded durably: ${error.message}`);
    });
    const settlement = await this.settleUnadmittedRunLifecycle(runId);
    await this.runRecordStore?.saveAdmissionFailure(admission, { runId, databasePool: this.config.database_pool, recovery, workload, ...settlement });
    return { admitted: false, failure: admission.code, run_id: runId, recovery, error: admission.message };
  }

  async anyAvailableDatabase() {
    for (const database of this.config.database_pool) {
      try { if ((await this.reservationAuthority.read(database.database_id)).status === DATABASE_STATES.AVAILABLE) return true; }
      catch { /* a different database may still be available */ }
    }
    return false;
  }

  async inspectPool() {
    const recovery = await this.recoveryPass();
    const databases = [];
    for (const candidate of this.config.database_pool) {
      try {
        const state = await this.reservationAuthority.read(candidate.database_id);
        databases.push({ database_id: candidate.database_id, status: state.status, run_id: state.reservation?.run_id || null, recovery_marker: state.recovery_marker || null });
      } catch (error) {
        databases.push({ database_id: candidate.database_id, status: 'unknown', error: String(error?.message || error) });
      }
    }
    return { recovery, databases };
  }

  async recoveryPass() {
    await this.reservationAuthority.reconcileCurrentState?.(this.config.database_pool);
    const results = [];
    for (const candidate of this.config.database_pool) {
      try {
        const state = await this.reservationAuthority.read(candidate.database_id);
        if (state.status === DATABASE_STATES.IN_USE) results.push(await this.recoverInUse(candidate, state));
        else if (state.status === DATABASE_STATES.UNAVAILABLE) results.push(await this.recoverUnavailable(candidate, state));
        else results.push({ database_id: candidate.database_id, status: DATABASE_STATES.AVAILABLE, result: 'available' });
      } catch (error) {
        results.push({ database_id: candidate.database_id, status: 'unknown', result: 'recovery could not verify database; other pool entries continue', error: String(error?.message || error) });
      }
    }
    return results;
  }

  async recoverInUse(candidate, state) {
    const runId = state.reservation?.run_id;
    if (!runId) return { database_id: candidate.database_id, status: DATABASE_STATES.IN_USE, result: 'preserved; reservation run identity is missing' };
    let lifecycle;
    try { lifecycle = await this.reservationAuthority.readRunLifecycle(runId); }
    catch (error) { return { database_id: candidate.database_id, status: DATABASE_STATES.IN_USE, run_id: runId, result: 'preserved; run lifecycle could not be read', error: String(error?.message || error) }; }
    if (!lifecycle || lifecycle.run_id !== runId) return { database_id: candidate.database_id, status: DATABASE_STATES.IN_USE, run_id: runId, result: 'preserved; authoritative run lifecycle is missing or mismatched' };

    const runProcess = lifecycle.run_process;
    const runProcessState = await inspectProcessIdentity(runProcess);
    const childRuntime = lifecycle.child_runtime || { status: 'unknown' };
    const childProcessState = this.operatorClient?.inspectChildRuntimeLiveness
      ? await this.operatorClient.inspectChildRuntimeLiveness(childRuntime)
      : childRuntime.status === 'not_started' || childRuntime.status === 'stopped'
        ? 'dead'
        : await inspectProcessIdentity(childRuntime.process_identity);
    const runTerminal = TERMINAL_RUN_STATES.has(lifecycle.status);
    // A terminal marker can be written while the owner is still finishing reservation
    // settlement. Require authoritative process death before reclaiming an in-use state.
    const runDead = runProcessState === 'dead';
    const childDead = childRuntime.status === 'not_started' || childRuntime.status === 'stopped' || childProcessState === 'dead';
    if (!runDead || !childDead) {
      const evidence = { run_lifecycle_status: lifecycle.status, run_process_state: runProcessState, child_runtime_id: childRuntime.runtime_id || null, child_process_state: childProcessState };
      await this.reservationAuthority.recordActiveRecoveryObservation(state, evidence).catch(() => {});
      return { database_id: candidate.database_id, status: DATABASE_STATES.IN_USE, run_id: runId, result: 'preserved; E2E run or child runtime remains active or cannot be authoritatively checked', evidence };
    }

    const evidence = {
      run_lifecycle_status: lifecycle.status,
      run_process: { identity: runProcess || null, result: runProcessState },
      child_runtime: { runtime_id: childRuntime.runtime_id || null, identity: childRuntime.process_identity || null, result: childProcessState }
    };
    const settledChildRuntime = {
      runtime_id: childRuntime.runtime_id || null,
      status: childRuntime.status === 'not_started' ? 'not_started' : 'stopped',
      process_identity: childRuntime.process_identity || null
    };
    await this.reservationAuthority.writeRunLifecycle(runId, {
      status: runTerminal ? lifecycle.status : 'interrupted',
      ended_at: lifecycle.ended_at || currentTimeIso(),
      child_runtime: settledChildRuntime
    });
    const transition = await this.reservationAuthority.markDeadRunUnavailable(state, evidence);
    if (!transition.committed) return { database_id: candidate.database_id, status: transition.state.status, run_id: runId, result: 'dead reservation changed before conditional unavailable transition', evidence };
    const unavailable = await this.reservationAuthority.read(candidate.database_id);
    return this.recoverUnavailable(candidate, unavailable);
  }

  async recoverUnavailable(candidate, state) {
    const snapshot = await this.reservationAuthority.beginRecovery(candidate.database_id);
    if (!snapshot) return { database_id: candidate.database_id, status: state.status, result: 'state changed before recovery began' };
    const previousRunId = snapshot.unavailable?.run_id || snapshot.reservation?.run_id || null;
    let lifecycle = null;
    let lifecycleBoundElsewhere = false;
    try {
      if (previousRunId) {
        lifecycle = await this.reservationAuthority.readRunLifecycle(previousRunId);
        if (!lifecycle || lifecycle.run_id !== previousRunId) throw new Error('previous E2E run lifecycle is missing or mismatched');
        lifecycleBoundElsewhere = typeof lifecycle.selected_database_id === 'string'
          && lifecycle.selected_database_id !== candidate.database_id;
        if (!lifecycleBoundElsewhere) {
          const child = lifecycle.child_runtime || { status: 'unknown' };
          const childState = this.operatorClient?.inspectChildRuntimeLiveness
            ? await this.operatorClient.inspectChildRuntimeLiveness(child)
            : child.status === 'not_started' || child.status === 'stopped'
              ? 'dead'
              : await inspectProcessIdentity(child.process_identity);
          const runState = await inspectProcessIdentity(lifecycle.run_process);
          const runDead = TERMINAL_RUN_STATES.has(lifecycle.status) || runState === 'dead';
          if (!runDead || !['not_started', 'stopped'].includes(child.status) && childState !== 'dead') {
            const evidence = { lifecycle_status: lifecycle.status, run_process_state: runState, child_runtime_status: child.status, child_process_state: childState };
            const result = await this.reservationAuthority.recordRecoveryFailure(snapshot, { reason: 'previous E2E run or child runtime is active or unverified', lifecycle: evidence });
            return { database_id: candidate.database_id, status: DATABASE_STATES.UNAVAILABLE, recovery_marker: snapshot.recovery_marker, result: 'still unavailable', evidence: result.state?.unavailable || evidence };
          }
        }
        const child = lifecycle.child_runtime || { status: 'unknown' };
        if (!lifecycleBoundElsewhere && lifecycle && (lifecycle.status === 'active' || !['not_started', 'stopped'].includes(child.status))) {
          const terminal = TERMINAL_RUN_STATES.has(lifecycle.status);
          lifecycle = await this.reservationAuthority.writeRunLifecycle(previousRunId, {
            status: terminal ? lifecycle.status : 'interrupted',
            ended_at: lifecycle.ended_at || currentTimeIso(),
            child_runtime: {
              runtime_id: child.runtime_id || null,
              status: child.status === 'not_started' ? 'not_started' : 'stopped',
              process_identity: child.process_identity || null
            }
          });
        }
      }

      const lifecycleForDatabase = lifecycleBoundElsewhere ? null : lifecycle;
      const cleanup = await this.reconcileStaleTasks(candidate, snapshot, lifecycleForDatabase);
      const evidence = {
        stable_database_id: candidate.database_id,
        recovery_marker: snapshot.recovery_marker,
        run_id: previousRunId,
        run_lifecycle_status: lifecycle?.status || null,
        run_lifecycle_database_id: lifecycle?.selected_database_id || null,
        run_lifecycle_bound_to_database: Boolean(lifecycle && lifecycle.selected_database_id === candidate.database_id),
        child_runtime_id: lifecycleForDatabase?.child_runtime?.runtime_id || null,
        lifecycle: lifecycleBoundElsewhere
          ? 'previous run lifecycle is bound to another database; this database has no active child runtime'
          : 'run and child runtime are not active; process identity readback completed',
        cleanup
      };
      const result = await this.reservationAuthority.completeRecovery(snapshot, evidence);
      if (result.recovered && previousRunId && !lifecycleBoundElsewhere) {
        const removed = await this.reservationAuthority.deleteRunLifecycle(previousRunId).catch(() => ({ committed: false }));
        if (!removed.committed) return { database_id: candidate.database_id, status: DATABASE_STATES.AVAILABLE, recovery_marker: snapshot.recovery_marker, result: 'recovered; run lifecycle cleanup pending', evidence };
      }
      return result.recovered
        ? { database_id: candidate.database_id, status: DATABASE_STATES.AVAILABLE, recovery_marker: snapshot.recovery_marker, result: 'recovered', evidence }
        : { database_id: candidate.database_id, status: result.state.status, recovery_marker: snapshot.recovery_marker, result: result.reason, final_authoritative_state: result.state };
    } catch (error) {
      const evidence = { stable_database_id: candidate.database_id, recovery_marker: snapshot.recovery_marker, error: String(error?.message || error) };
      const result = await this.reservationAuthority.recordRecoveryFailure(snapshot, evidence).catch(failure => ({ committed: false, reason: String(failure?.message || failure) }));
      return { database_id: candidate.database_id, status: result.state?.status || DATABASE_STATES.UNAVAILABLE, recovery_marker: snapshot.recovery_marker, result: 'still unavailable', evidence };
    }
  }

  async reconcileStaleTasks(candidate, recovery, lifecycle) {
    const tasks = await this.notionClient.listTasks(candidate.database_url);
    const cleaned = [];
    const preserved = [];
    for (const summary of tasks) {
      let task = await this.notionClient.readTask(candidate.database_url, summary.id);
      if (!task) throw new Error(`recovery task ${summary.id} could not be authoritatively read`);
      if (PRESERVED_STATES.has(task.state)) {
        preserved.push({ id: task.id, identifier: task.identifier, state: task.state });
        continue;
      }
      const previousState = task.state;
      const cleanedAt = recovery.unavailable?.at || currentTimeIso();
      const provenance = [
        '[복구 기록]',
        `이전 상태: ${previousState}`,
        '처리: 남아 있던 작업을 취소 상태로 정리',
        `처리 시각: ${cleanedAt}`
      ].join('\n');
      if (!String(task.workpad || '').includes(provenance)) await this.notionClient.appendWorkpad(task.id, provenance);
      task = await this.notionClient.readTask(candidate.database_url, summary.id);
      if (!String(task?.workpad || '').includes(provenance) || task.state !== previousState) throw new Error(`stale task ${summary.id} Workpad provenance was not authoritatively read back before State mutation`);
      await this.notionClient.updateTaskState(candidate.database_url, summary.id, 'Cancelled');
      const after = await this.notionClient.readTask(candidate.database_url, summary.id);
      if (after?.state !== 'Cancelled' || !String(after.workpad || '').includes(provenance)) throw new Error(`stale task ${summary.id} cleanup Workpad/Cancelled State readback did not complete`);
      cleaned.push({ id: after.id, identifier: after.identifier, previous_state: previousState, state: after.state, provenance, verified_at: currentTimeIso() });
    }
    return { listed_task_count: tasks.length, cleaned, preserved, readback_complete: true };
  }
}
