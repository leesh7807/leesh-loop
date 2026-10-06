import { randomUUID } from 'node:crypto';

export const DATABASE_STATES = Object.freeze({ AVAILABLE: 'available', IN_USE: 'in use', UNAVAILABLE: 'unavailable' });
const TERMINAL_RUN_STATES = new Set(['completed', 'failed', 'interrupted', 'resource_unavailable_admission']);

const initialState = databaseId => ({
  schema_version: 1,
  kind: 'database_reservation',
  database_id: databaseId,
  status: DATABASE_STATES.AVAILABLE,
  reservation: null,
  recovery_marker: null,
  unavailable: null
});

const sameSnapshot = (left, right) => left.status === right.status
  && left.database_id === right.database_id
  && left.sequence === right.sequence
  && left.sha === right.sha
  && left.recovery_marker === right.recovery_marker;

export class DatabaseReservationAuthority {
  constructor({ eventStore, now = () => new Date().toISOString(), identity = randomUUID } = {}) {
    this.eventStore = eventStore;
    this.now = now;
    this.identity = identity;
  }

  async read(databaseId) {
    const current = await this.eventStore.read(`reservations/${databaseId.replaceAll('-', '')}`);
    const stored = current.event;
    if ((current.sequence > 0 && !stored) || (stored && (stored.kind !== 'database_reservation' || !stored.state || typeof stored.state !== 'object' || Array.isArray(stored.state)))) {
      throw new Error(`reservation authority state is invalid for ${databaseId}`);
    }
    const state = stored?.state || initialState(databaseId);
    if (state.database_id !== databaseId) throw new Error(`reservation authority database identity mismatch for ${databaseId}`);
    if (!Object.values(DATABASE_STATES).includes(state.status)) throw new Error(`reservation authority status is invalid for ${databaseId}`);
    return { ...state, sequence: current.sequence, sha: current.sha, ref: current.ref };
  }

  async commit(current, nextState) {
    const stream = `reservations/${current.database_id.replaceAll('-', '')}`;
    const { sequence: _sequence, sha: _sha, ref: _ref, ...persistentState } = nextState;
    const result = await this.eventStore.compareAndAppend(stream, current, {
      kind: 'database_reservation',
      database_id: current.database_id,
      state: persistentState
    });
    return result.committed ? { committed: true, state: { ...result.current.event.state, sequence: result.current.sequence, sha: result.current.sha, ref: result.current.ref } } : { committed: false, state: result.current.event?.state || initialState(current.database_id) };
  }

  async reserve(databaseId, { run_id }) {
    const current = await this.read(databaseId);
    if (current.status !== DATABASE_STATES.AVAILABLE) return { reserved: false, current };
    const reservation = {
      run_id,
      acquired_at: this.now()
    };
    const result = await this.commit(current, { ...current, status: DATABASE_STATES.IN_USE, reservation, recovery_marker: null, unavailable: null });
    return result.committed ? { reserved: true, state: result.state } : { reserved: false, current: result.state };
  }

  async updateRunLifecycleForReservation(databaseId, runId, lifecycle) {
    const current = await this.read(databaseId);
    if (current.status !== DATABASE_STATES.IN_USE || current.reservation?.run_id !== runId) return { committed: false, state: current };
    if (lifecycle.selected_database_id !== undefined && lifecycle.selected_database_id !== databaseId) return { committed: false, state: current, reason: 'run lifecycle database identity does not match its reservation' };
    const updated = await this.writeRunLifecycle(runId, { selected_database_id: databaseId, ...lifecycle });
    return { committed: true, state: current, lifecycle: updated };
  }

  async recordActiveRecoveryObservation(expected, evidence) {
    const current = await this.read(expected.database_id);
    if (current.status !== DATABASE_STATES.IN_USE || current.reservation?.run_id !== expected.reservation?.run_id || current.sha !== expected.sha) {
      return { committed: false, state: current };
    }
    return { committed: true, state: current, evidence };
  }

  async release(databaseId, runId, evidence = {}) {
    const current = await this.read(databaseId);
    if (current.status !== DATABASE_STATES.IN_USE || current.reservation?.run_id !== runId) return { committed: false, state: current };
    const lifecycle = await this.readRunLifecycle(runId);
    if (!lifecycle || lifecycle.run_id !== runId || !['completed', 'failed'].includes(lifecycle.status)
      || lifecycle.selected_database_id !== databaseId
      || !['not_started', 'stopped'].includes(lifecycle.child_runtime?.status)) {
      return { committed: false, state: current, reason: 'run lifecycle or child runtime is still active' };
    }
    const released = await this.eventStore.delete('reservations/' + databaseId.replaceAll('-', ''), current);
    return released.committed
      ? { committed: true, state: initialState(databaseId), released_at: this.now() }
      : { committed: false, state: released.current.event?.state || initialState(databaseId) };
  }

  async markUnavailable(databaseId, runId, reason, evidence = {}) {
    const current = await this.read(databaseId);
    if (current.status !== DATABASE_STATES.IN_USE || current.reservation?.run_id !== runId) return { committed: false, state: current };
    const marker = this.identity();
    const unavailable = { marker, at: this.now(), reason, run_id: runId };
    const result = await this.commit(current, { ...current, status: DATABASE_STATES.UNAVAILABLE, reservation: null, recovery_marker: marker, unavailable });
    return result.committed ? { ...result, recovery_marker: marker } : result;
  }

  async markDeadRunUnavailable(expected, evidence = {}) {
    const current = await this.read(expected.database_id);
    if (current.status !== DATABASE_STATES.IN_USE || current.reservation?.run_id !== expected.reservation?.run_id || current.sha !== expected.sha) return { committed: false, state: current };
    const marker = this.identity();
    const reason = 'previous E2E run and child runtime are authoritatively inactive';
    const runId = expected.reservation.run_id;
    const unavailable = { marker, at: this.now(), reason, run_id: runId };
    const result = await this.commit(current, { ...current, status: DATABASE_STATES.UNAVAILABLE, reservation: null, recovery_marker: marker, unavailable });
    return result.committed ? { ...result, recovery_marker: marker } : result;
  }

  async beginRecovery(databaseId) {
    const current = await this.read(databaseId);
    if (current.status !== DATABASE_STATES.UNAVAILABLE || !current.recovery_marker) return null;
    const attempt = { id: this.identity(), started_at: this.now(), recovery_marker: current.recovery_marker };
    return { ...current, recovery_attempt: attempt };
  }

  async completeRecovery(snapshot, evidence) {
    const current = await this.read(snapshot.database_id);
    if (current.status !== DATABASE_STATES.UNAVAILABLE || current.recovery_marker !== snapshot.recovery_marker) {
      return this.recordStaleRecoveryResult(snapshot, current, 'unavailable_to_available');
    }
    const result = await this.eventStore.delete('reservations/' + snapshot.database_id.replaceAll('-', ''), current);
    if (!result.committed) return this.recordStaleRecoveryResult(snapshot, result.current, 'unavailable_to_available');
    return { committed: true, state: initialState(snapshot.database_id), recovered: true };
  }

  async recordRecoveryFailure(snapshot, evidence) {
    const current = await this.read(snapshot.database_id);
    if (current.status !== DATABASE_STATES.UNAVAILABLE || current.recovery_marker !== snapshot.recovery_marker) {
      return this.recordStaleRecoveryResult(snapshot, current, 'recovery_attempt_failed');
    }
    return { committed: true, state: current, recovered: false, evidence };
  }

  async recordStaleRecoveryResult(snapshot, latest, operation) {
    const current = latest || await this.read(snapshot.database_id);
    return {
      committed: false,
      reason: 'stale_recovery_marker',
      state: current,
      evidence: {
        attempted_marker: snapshot.recovery_marker,
        current_status: current.status,
        current_recovery_marker: current.recovery_marker || null,
        authoritative_sequence: current.sequence,
        attempted_operation: operation
      }
    };
  }

  async deleteRunLifecycle(runId) {
    const stream = 'runs/' + runId.replaceAll('-', '');
    const current = await this.eventStore.read(stream);
    const lifecycle = current.event?.lifecycle;
    if (!lifecycle) return { committed: true, already_absent: true };
    if (lifecycle.run_id !== runId || !TERMINAL_RUN_STATES.has(lifecycle.status)
      || !['not_started', 'stopped'].includes(lifecycle.child_runtime?.status)) {
      return { committed: false, reason: 'run lifecycle is not safely settled', lifecycle };
    }
    // A run can mark one candidate unavailable because it contains stale task
    // residue, then continue on a different database. Keep its lifecycle until
    // every reservation it touched is settled so recovery can still establish
    // whether the former run and child runtime are safe to ignore.
    const reservationStreams = await this.eventStore.listCurrentStreams('reservations');
    for (const databaseStream of reservationStreams) {
      const compactDatabaseId = databaseStream.replaceAll('-', '');
      if (!/^[0-9a-f]{32}$/i.test(compactDatabaseId)) {
        return { committed: false, reason: 'reservation identity could not be safely verified', lifecycle };
      }
      const databaseId = `${compactDatabaseId.slice(0, 8)}-${compactDatabaseId.slice(8, 12)}-${compactDatabaseId.slice(12, 16)}-${compactDatabaseId.slice(16, 20)}-${compactDatabaseId.slice(20)}`;
      const state = await this.read(databaseId);
      if ((state?.status === DATABASE_STATES.IN_USE && state.reservation?.run_id === runId)
        || (state?.status === DATABASE_STATES.UNAVAILABLE && state.unavailable?.run_id === runId)) {
        return { committed: false, reason: 'database recovery still depends on this run lifecycle', lifecycle };
      }
    }
    const result = await this.eventStore.delete(stream, current);
    return result.committed ? { committed: true, state: result.current } : { committed: false, reason: 'run lifecycle changed before cleanup', state: result.current };
  }

  async reconcileCurrentState(databasePool = []) {
    await this.eventStore.migrateLegacyRefs();
    const databaseIds = [...new Set(databasePool.map(database => database.database_id).filter(Boolean))];
    for (const databaseId of databaseIds) {
      const state = await this.read(databaseId);
      if (state.status === DATABASE_STATES.AVAILABLE && state.ref) await this.eventStore.delete('reservations/' + databaseId.replaceAll('-', ''), state);
    }

    const streams = await this.eventStore.listCurrentStreams('runs');
    const terminalRefs = [];
    for (const streamId of streams) {
      const stream = 'runs/' + streamId;
      const current = await this.eventStore.read(stream);
      const lifecycle = current.event?.lifecycle;
      if (!lifecycle || !TERMINAL_RUN_STATES.has(lifecycle.status)
        || !['not_started', 'stopped'].includes(lifecycle.child_runtime?.status)) continue;
      const relatedDatabaseIds = [...new Set([...databaseIds, lifecycle.selected_database_id].filter(Boolean))];
      let stillReferenced = false;
      for (const databaseId of relatedDatabaseIds) {
        let database;
        try { database = await this.read(databaseId); }
        catch { stillReferenced = true; break; }
        if ((database.status === DATABASE_STATES.IN_USE && database.reservation?.run_id === lifecycle.run_id)
          || (database.status === DATABASE_STATES.UNAVAILABLE && database.unavailable?.run_id === lifecycle.run_id)) {
          stillReferenced = true;
          break;
        }
      }
      if (!stillReferenced) terminalRefs.push({ stream, current });
    }
    let removedRunLifecycles = 0;
    for (const item of terminalRefs) {
      const result = await this.eventStore.delete(item.stream, item.current);
      if (result.committed) removedRunLifecycles += 1;
    }
    return { legacy_migrated: true, terminal_run_lifecycles_removed: removedRunLifecycles };
  }

  async readRunLifecycle(runId) {
    const current = await this.eventStore.read(`runs/${runId.replaceAll('-', '')}`);
    return current.event?.lifecycle || null;
  }

  async writeRunLifecycle(runId, lifecycle) {
    const stream = `runs/${runId.replaceAll('-', '')}`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.eventStore.read(stream);
      const previous = current.event?.lifecycle || {};
      if (lifecycle.status === 'active' && previous.status) throw new Error(`E2E run identity ${runId} already has an authoritative lifecycle`);
      const next = { ...previous };
      for (const key of ['run_id', 'status', 'started_at', 'ended_at', 'run_process', 'selected_database_id', 'child_runtime_id']) {
        if (lifecycle[key] !== undefined) next[key] = lifecycle[key];
      }
      if (lifecycle.child_runtime !== undefined) {
        const child = lifecycle.child_runtime || {};
        next.child_runtime = {
          ...(child.runtime_id === undefined ? {} : { runtime_id: child.runtime_id }),
          ...(child.status === undefined ? {} : { status: child.status }),
          ...(child.process_identity === undefined ? {} : { process_identity: child.process_identity })
        };
      }
      next.updated_at = this.now();
      const result = await this.eventStore.compareAndAppend(stream, current, { kind: 'e2e_run_lifecycle', run_id: runId, lifecycle: next });
      if (result.committed) return result.current.event.lifecycle;
    }
    throw new Error(`could not conditionally write E2E run lifecycle for ${runId}`);
  }
}
