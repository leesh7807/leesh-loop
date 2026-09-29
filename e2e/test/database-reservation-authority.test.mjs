import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { GitEventStore } from '../systems/git/git-event-store.mjs';
import { DatabaseReservationAuthority, DATABASE_STATES } from '../run/admission/database-reservation-authority.mjs';
import { command } from '../systems/command-runner.mjs';

async function gitFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-reservation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const remote = join(root, 'origin.git');
  await command('git', ['init', '--bare', remote]);
  const store = workspace => new GitEventStore({ repositoryUrl: remote, workspaceRoot: workspace });
  return { root, remote, store };
}

const databaseId = '3ea8a265-8625-812c-8849-fa1087a2272a';
const processIdentity = { pid: 10, process_start_ticks: '100', boot_id: 'boot', host: 'test' };

test('two checkouts share one stable database reservation and one atomic winner', async t => {
  const fixture = await gitFixture(t);
  const left = new DatabaseReservationAuthority({ eventStore: fixture.store(join(fixture.root, 'checkout-a', 'runs')) });
  const right = new DatabaseReservationAuthority({ eventStore: fixture.store(join(fixture.root, 'checkout-b', 'runs')) });
  const [first, second] = await Promise.all([
    left.reserve(databaseId, { run_id: 'run-a', run_process: processIdentity, origin: 'direct' }),
    right.reserve(databaseId, { run_id: 'run-b', run_process: processIdentity, origin: 'worker-originated' })
  ]);
  assert.equal([first, second].filter(result => result.reserved).length, 1);
  const current = await left.read(databaseId);
  assert.equal(current.status, DATABASE_STATES.IN_USE);
  assert.ok(['run-a', 'run-b'].includes(current.reservation.run_id));
  assert.equal(current.sequence, 1);
});

test('a malformed durable reservation event is an authority read failure, not available capacity', async () => {
  const authority = new DatabaseReservationAuthority({ eventStore: {
    async read() { return { sequence: 1, sha: 'event-sha', ref: 'reservation/1', event: { kind: 'unexpected' } }; }
  } });
  await assert.rejects(authority.read(databaseId), /reservation authority state is invalid/);
});

test('unavailable transition never exposes available and recovery is bound to its marker', async t => {
  const fixture = await gitFixture(t);
  const authority = new DatabaseReservationAuthority({ eventStore: fixture.store(join(fixture.root, 'workspace', 'runs')), identity: () => `marker-${Math.random()}` });
  assert.equal((await authority.reserve(databaseId, { run_id: 'run-a', run_process: processIdentity, origin: 'direct' })).reserved, true);
  const unavailable = await authority.markUnavailable(databaseId, 'run-a', 'required cleanup failed', { action: 'readback' });
  assert.equal(unavailable.committed, true);
  let current = await authority.read(databaseId);
  assert.equal(current.status, DATABASE_STATES.UNAVAILABLE);
  assert.equal(current.recovery_marker, unavailable.recovery_marker);

  const oldRecovery = await authority.beginRecovery(databaseId);
  const recovered = await authority.completeRecovery(oldRecovery, { readback: true, cleanup: [] });
  assert.equal(recovered.recovered, true);
  assert.equal((await authority.read(databaseId)).status, DATABASE_STATES.AVAILABLE);

  await authority.reserve(databaseId, { run_id: 'run-b', run_process: processIdentity, origin: 'direct' });
  const secondUnavailable = await authority.markUnavailable(databaseId, 'run-b', 'new cleanup failure');
  assert.notEqual(secondUnavailable.recovery_marker, oldRecovery.recovery_marker);
  const stale = await authority.completeRecovery(oldRecovery, { stale: true });
  assert.equal(stale.committed, false);
  assert.equal(stale.reason, 'stale_recovery_marker');
  current = await authority.read(databaseId);
  assert.equal(current.status, DATABASE_STATES.UNAVAILABLE);
  assert.equal(current.recovery_marker, secondUnavailable.recovery_marker);
  const history = await authority.recoveryHistory(databaseId);
  assert.ok(history.some(event => event.state?.last_transition?.type === 'stale_recovery_rejected'));
  assert.equal(history.at(-1).state.recovery_marker, secondUnavailable.recovery_marker);
});

test('release requires terminal run and stopped child runtime', async t => {
  const fixture = await gitFixture(t);
  const authority = new DatabaseReservationAuthority({ eventStore: fixture.store(join(fixture.root, 'workspace', 'runs')) });
  await authority.reserve(databaseId, { run_id: 'run-a', run_process: processIdentity, origin: 'direct' });
  assert.equal((await authority.release(databaseId, 'run-a')).committed, false);
  await authority.updateRuntime(databaseId, 'run-a', { status: 'stopped' });
  await authority.updateRunLifecycle(databaseId, 'run-a', 'completed');
  assert.equal((await authority.release(databaseId, 'run-a', { cleanup: true })).committed, true);
  assert.equal((await authority.read(databaseId)).status, DATABASE_STATES.AVAILABLE);
});

test('separate event-store workspaces observe the same durable run lifecycle', async t => {
  const fixture = await gitFixture(t);
  const first = new DatabaseReservationAuthority({ eventStore: fixture.store(join(fixture.root, 'worker-a', 'runs')) });
  const second = new DatabaseReservationAuthority({ eventStore: fixture.store(join(fixture.root, 'worker-b', 'runs')) });
  await first.writeRunLifecycle('run-identity', { run_id: 'run-identity', status: 'active', origin: 'worker-originated', run_process: processIdentity });
  assert.equal((await second.readRunLifecycle('run-identity')).status, 'active');
  await first.writeRunLifecycle('run-identity', { status: 'completed', ended_at: '2026-09-29T00:00:00Z' });
  assert.equal((await second.readRunLifecycle('run-identity')).status, 'completed');
});

test('one durable run identity cannot be started twice across workspaces', async t => {
  const fixture = await gitFixture(t);
  const first = new DatabaseReservationAuthority({ eventStore: fixture.store(join(fixture.root, 'worker-a', 'runs')) });
  const second = new DatabaseReservationAuthority({ eventStore: fixture.store(join(fixture.root, 'worker-b', 'runs')) });
  const results = await Promise.allSettled([
    first.writeRunLifecycle('same-run', { run_id: 'same-run', status: 'active', run_process: processIdentity }),
    second.writeRunLifecycle('same-run', { run_id: 'same-run', status: 'active', run_process: processIdentity })
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.equal((await first.readRunLifecycle('same-run')).status, 'active');
});
