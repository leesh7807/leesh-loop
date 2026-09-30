import { randomUUID } from 'node:crypto';

export const DATABASE_STATES = Object.freeze({ AVAILABLE: 'available', IN_USE: 'in use', UNAVAILABLE: 'unavailable' });

const initialState = databaseId => ({
  schema_version: 1,
  kind: 'database_reservation',
  database_id: databaseId,
  status: DATABASE_STATES.AVAILABLE,
  reservation: null,
  recovery_marker: null,
  unavailable: null,
  last_transition: null
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

  async commit(current, nextState, eventType, details = {}) {
    const stream = `reservations/${current.database_id.replaceAll('-', '')}`;
    const { sequence: _sequence, sha: _sha, ref: _ref, ...persistentState } = nextState;
    const result = await this.eventStore.compareAndAppend(stream, current, {
      kind: 'database_reservation',
      database_id: current.database_id,
      state: { ...persistentState, last_transition: { type: eventType, at: this.now(), ...details } }
    });
    return result.committed ? { committed: true, state: { ...result.current.event.state, sequence: result.current.sequence, sha: result.current.sha, ref: result.current.ref } } : { committed: false, state: result.current.event?.state || initialState(current.database_id) };
  }

  async reserve(databaseId, { run_id, origin }) {
    const current = await this.read(databaseId);
    if (current.status !== DATABASE_STATES.AVAILABLE) return { reserved: false, current };
    const reservation = {
      run_id,
      acquired_at: this.now()
    };
    const result = await this.commit(current, { ...current, status: DATABASE_STATES.IN_USE, reservation, recovery_marker: null, unavailable: null }, 'available_to_in_use', { run_id, origin });
    return result.committed ? { reserved: true, state: result.state } : { reserved: false, current: result.state };
  }

  async updateRunLifecycleForReservation(databaseId, runId, lifecycle) {
    const current = await this.read(databaseId);
    if (current.status !== DATABASE_STATES.IN_USE || current.reservation?.run_id !== runId) return { committed: false, state: current };
    if (lifecycle.selected_database_id !== undefined && lifecycle.selected_database_id !== databaseId) return { committed: false, state: current, reason: 'run lifecycle database identity does not match its reservation' };
    const updated = await this.writeRunLifecycle(runId, { selected_database_id: databaseId, ...lifecycle });
    return { committed: true, state: current, lifecycle: updated };
  }

  async updateReservationMetadata(databaseId, runId, metadata) {
    const current = await this.read(databaseId);
    if (current.status !== DATABASE_STATES.IN_USE || current.reservation?.run_id !== runId) return { committed: false, state: current };
    const reservation = { ...current.reservation, ...metadata };
    return this.commit(current, { ...current, reservation }, 'reservation_metadata_updated', { run_id: runId, metadata });
  }

  async recordActiveRecoveryObservation(expected, evidence) {
    const current = await this.read(expected.database_id);
    if (current.status !== DATABASE_STATES.IN_USE || current.reservation?.run_id !== expected.reservation?.run_id || current.sha !== expected.sha) {
      return { committed: false, state: current };
    }
    return this.commit(current, current, 'active_run_protected', { run_id: current.reservation.run_id, evidence });
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
    const next = { ...initialState(databaseId), status: DATABASE_STATES.AVAILABLE };
    return this.commit(current, next, 'in_use_to_available', { run_id: runId, ...evidence });
  }

  async markUnavailable(databaseId, runId, reason, evidence = {}) {
    const current = await this.read(databaseId);
    if (current.status !== DATABASE_STATES.IN_USE || current.reservation?.run_id !== runId) return { committed: false, state: current };
    const marker = this.identity();
    const unavailable = { marker, at: this.now(), reason, run_id: runId, evidence };
    const result = await this.commit(current, { ...current, status: DATABASE_STATES.UNAVAILABLE, reservation: null, recovery_marker: marker, unavailable }, 'in_use_to_unavailable', { run_id: runId, recovery_marker: marker, reason, evidence });
    return result.committed ? { ...result, recovery_marker: marker } : result;
  }

  async markDeadRunUnavailable(expected, evidence = {}) {
    const current = await this.read(expected.database_id);
    if (current.status !== DATABASE_STATES.IN_USE || current.reservation?.run_id !== expected.reservation?.run_id || current.sha !== expected.sha) return { committed: false, state: current };
    const marker = this.identity();
    const reason = 'previous E2E run and child runtime are authoritatively inactive';
    const runId = expected.reservation.run_id;
    const unavailable = { marker, at: this.now(), reason, run_id: runId, evidence };
    const result = await this.commit(current, { ...current, status: DATABASE_STATES.UNAVAILABLE, reservation: null, recovery_marker: marker, unavailable }, 'dead_run_to_unavailable', { run_id: runId, recovery_marker: marker, reason, evidence });
    return result.committed ? { ...result, recovery_marker: marker } : result;
  }

  async beginRecovery(databaseId) {
    for (let retry = 0; retry < 3; retry += 1) {
      const current = await this.read(databaseId);
      if (current.status !== DATABASE_STATES.UNAVAILABLE || !current.recovery_marker) return null;
      const attempt = { id: this.identity(), started_at: this.now(), recovery_marker: current.recovery_marker };
      const started = await this.commit(current, current, 'recovery_started', { recovery_marker: current.recovery_marker, recovery_attempt_id: attempt.id });
      if (started.committed) return { ...started.state, recovery_attempt: attempt };
    }
    return null;
  }

  async completeRecovery(snapshot, evidence) {
    for (let retry = 0; retry < 3; retry += 1) {
      const current = await this.read(snapshot.database_id);
      if (current.status !== DATABASE_STATES.UNAVAILABLE || current.recovery_marker !== snapshot.recovery_marker) {
        return this.recordStaleRecoveryResult(snapshot, current, 'unavailable_to_available');
      }
      const next = { ...initialState(snapshot.database_id), status: DATABASE_STATES.AVAILABLE };
      const result = await this.commit(current, next, 'unavailable_to_available', { recovery_marker: snapshot.recovery_marker, recovery_attempt_id: snapshot.recovery_attempt?.id || null, result: 'recovered', evidence });
      if (result.committed) return { ...result, recovered: true };
    }
    return this.recordStaleRecoveryResult(snapshot, await this.read(snapshot.database_id), 'unavailable_to_available');
  }

  async recordRecoveryFailure(snapshot, evidence) {
    for (let retry = 0; retry < 3; retry += 1) {
      const current = await this.read(snapshot.database_id);
      if (current.status !== DATABASE_STATES.UNAVAILABLE || current.recovery_marker !== snapshot.recovery_marker) {
        return this.recordStaleRecoveryResult(snapshot, current, 'recovery_attempt_failed');
      }
      const attemptResult = { at: this.now(), attempt_id: snapshot.recovery_attempt?.id || null, result: 'still unavailable', evidence };
      const unavailable = { ...current.unavailable, recovery_attempts: [...(current.unavailable?.recovery_attempts || []), attemptResult] };
      const result = await this.commit(current, { ...current, unavailable }, 'recovery_attempt_failed', { recovery_marker: snapshot.recovery_marker, recovery_attempt_id: snapshot.recovery_attempt?.id || null, result: 'still unavailable', evidence });
      if (result.committed) return { ...result, recovered: false };
    }
    return this.recordStaleRecoveryResult(snapshot, await this.read(snapshot.database_id), 'recovery_attempt_failed');
  }

  async recordStaleRecoveryResult(snapshot, latest, operation) {
    for (let retry = 0; retry < 3; retry += 1) {
      const current = await this.read(snapshot.database_id);
      const evidence = {
        attempted_marker: snapshot.recovery_marker,
        current_status: current.status,
        current_recovery_marker: current.recovery_marker || null,
        authoritative_sequence: current.sequence,
        result: 'stale recovery rejected',
        attempted_operation: operation
      };
      const result = await this.commit(current, current, 'stale_recovery_rejected', {
        recovery_marker: snapshot.recovery_marker,
        recovery_attempt_id: snapshot.recovery_attempt?.id || null,
        result: evidence.result,
        final_authoritative_state: { status: evidence.current_status, recovery_marker: evidence.current_recovery_marker, sequence: evidence.authoritative_sequence }
      });
      if (result.committed) return { committed: false, reason: 'stale_recovery_marker', state: result.state, evidence };
    }
    const current = await this.read(snapshot.database_id);
    return { committed: false, reason: 'stale_recovery_marker', state: current, evidence: { attempted_marker: snapshot.recovery_marker, current_status: current.status, current_recovery_marker: current.recovery_marker || null, authoritative_sequence: current.sequence, result: 'stale recovery evidence could not be appended', attempted_operation: operation, observed_after: latest?.sequence ?? null } };
  }

  async recoveryHistory(databaseId) {
    return this.eventStore.history(`reservations/${databaseId.replaceAll('-', '')}`);
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
      const next = { ...previous, ...lifecycle, updated_at: this.now() };
      const result = await this.eventStore.compareAndAppend(stream, current, { kind: 'e2e_run_lifecycle', run_id: runId, lifecycle: next });
      if (result.committed) return result.current.event.lifecycle;
    }
    throw new Error(`could not conditionally write E2E run lifecycle for ${runId}`);
  }
}
