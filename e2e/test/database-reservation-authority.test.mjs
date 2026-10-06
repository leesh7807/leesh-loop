import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
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
  const refs = (await command('git', ['ls-remote', '--heads', fixture.remote])).stdout.split(/\r?\n/).filter(Boolean);
  assert.equal(refs.filter(ref => ref.includes('/e2e-internal/current/reservations/')).length, 1);
  assert.equal(refs.some(ref => /\/e2e-internal\/reservations\/[^\s]+\/\d+$/.test(ref)), false);
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
  assert.equal(current.reservation, null);
  assert.equal(current.unavailable.run_id, 'run-a');

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
  assert.equal(current.reservation, null);
  assert.equal(current.unavailable.run_id, 'run-b');
  const refs = (await command('git', ['ls-remote', '--heads', fixture.remote])).stdout.split(/\r?\n/).filter(Boolean);
  assert.equal(refs.filter(ref => ref.includes('/e2e-internal/current/reservations/')).length, 1);
  assert.equal(refs.some(ref => /\/e2e-internal\/reservations\/[^\s]+\/\d+$/.test(ref)), false);
});

test('release reads the authoritative run lifecycle and requires a stopped child runtime', async t => {
  const fixture = await gitFixture(t);
  const authority = new DatabaseReservationAuthority({ eventStore: fixture.store(join(fixture.root, 'workspace', 'runs')) });
  await authority.reserve(databaseId, { run_id: 'run-a', run_process: processIdentity, origin: 'direct' });
  assert.deepEqual(Object.keys((await authority.read(databaseId)).reservation).sort(), ['acquired_at', 'run_id']);
  await authority.writeRunLifecycle('run-a', { run_id: 'run-a', status: 'active', selected_database_id: databaseId, child_runtime: { status: 'not_started' } });
  assert.equal((await authority.release(databaseId, 'run-a')).committed, false);
  await authority.updateRunLifecycleForReservation(databaseId, 'run-a', { child_runtime: { status: 'stopped' } });
  assert.equal((await authority.release(databaseId, 'run-a')).committed, false);
  await authority.updateRunLifecycleForReservation(databaseId, 'run-a', { status: 'completed', child_runtime: { status: 'stopped' } });
  assert.equal((await authority.release(databaseId, 'run-a', { cleanup: true })).committed, true);
  assert.equal((await authority.read(databaseId)).status, DATABASE_STATES.AVAILABLE);
  assert.equal((await authority.read(databaseId)).ref, null);
  assert.equal((await authority.deleteRunLifecycle('run-a')).committed, true);
  assert.equal((await authority.readRunLifecycle('run-a')), null);
});

test('run lifecycle remains until every database reservation owned by the run is settled', async t => {
  const fixture = await gitFixture(t);
  const authority = new DatabaseReservationAuthority({ eventStore: fixture.store(join(fixture.root, 'workspace', 'runs')) });
  const otherDatabaseId = '4ea8a265-8625-812c-8849-fa1087a2272b';

  await authority.reserve(databaseId, { run_id: 'run-a' });
  const unavailable = await authority.markUnavailable(databaseId, 'run-a', 'stale task residue');
  assert.equal(unavailable.committed, true);
  await authority.reserve(otherDatabaseId, { run_id: 'run-a' });
  await authority.writeRunLifecycle('run-a', {
    run_id: 'run-a',
    status: 'active',
    selected_database_id: otherDatabaseId,
    child_runtime: { status: 'not_started' }
  });
  await authority.updateRunLifecycleForReservation(otherDatabaseId, 'run-a', {
    status: 'completed',
    child_runtime: { status: 'stopped' }
  });
  assert.equal((await authority.release(otherDatabaseId, 'run-a')).committed, true);

  const retained = await authority.deleteRunLifecycle('run-a');
  assert.equal(retained.committed, false);
  assert.equal(retained.reason, 'database recovery still depends on this run lifecycle');
  assert.equal((await authority.readRunLifecycle('run-a')).status, 'completed');

  const recovery = await authority.beginRecovery(databaseId);
  assert.equal((await authority.completeRecovery(recovery, {})).recovered, true);
  assert.equal((await authority.deleteRunLifecycle('run-a')).committed, true);
  assert.equal(await authority.readRunLifecycle('run-a'), null);
});

test('pool replacement reconciliation preserves lifecycle for an unavailable reservation outside the pool', async t => {
  const fixture = await gitFixture(t);
  const authority = new DatabaseReservationAuthority({ eventStore: fixture.store(join(fixture.root, 'workspace', 'runs')) });
  const replacementPoolDatabaseId = '4ea8a265-8625-812c-8849-fa1087a2272b';

  await authority.reserve(databaseId, { run_id: 'run-a' });
  const unavailable = await authority.markUnavailable(databaseId, 'run-a', 'stale task residue');
  assert.equal(unavailable.committed, true);
  await authority.reserve(replacementPoolDatabaseId, { run_id: 'run-a' });
  await authority.writeRunLifecycle('run-a', {
    run_id: 'run-a',
    status: 'active',
    selected_database_id: replacementPoolDatabaseId,
    child_runtime: { status: 'not_started' }
  });
  await authority.updateRunLifecycleForReservation(replacementPoolDatabaseId, 'run-a', {
    status: 'completed',
    child_runtime: { status: 'stopped' }
  });
  assert.equal((await authority.release(replacementPoolDatabaseId, 'run-a')).committed, true);

  await authority.reconcileCurrentState([{ database_id: replacementPoolDatabaseId }]);

  assert.equal((await authority.read(databaseId)).status, DATABASE_STATES.UNAVAILABLE);
  assert.equal((await authority.readRunLifecycle('run-a')).status, 'completed');
  const recovery = await authority.beginRecovery(databaseId);
  assert.equal((await authority.completeRecovery(recovery, {})).recovered, true);
  assert.equal((await authority.deleteRunLifecycle('run-a')).committed, true);
  assert.equal(await authority.readRunLifecycle('run-a'), null);
});

test('separate event-store workspaces observe the same durable run lifecycle', async t => {
  const fixture = await gitFixture(t);
  const first = new DatabaseReservationAuthority({ eventStore: fixture.store(join(fixture.root, 'worker-a', 'runs')) });
  const second = new DatabaseReservationAuthority({ eventStore: fixture.store(join(fixture.root, 'worker-b', 'runs')) });
  await first.writeRunLifecycle('run-identity', {
    run_id: 'run-identity',
    status: 'active',
    origin: 'worker-originated',
    outer_execution_provenance: { workspace_root: '/tmp/worker' },
    database_url: 'https://notion.example/database',
    run_process: processIdentity,
    child_runtime: { status: 'starting', state_path: '/tmp/state', ports: { symphony_port: 1234 } }
  });
  assert.equal((await second.readRunLifecycle('run-identity')).status, 'active');
  const current = await fixture.store(join(fixture.root, 'worker-b', 'runs')).read('runs/runidentity');
  assert.equal(current.event.lifecycle.origin, undefined);
  assert.equal(current.event.lifecycle.outer_execution_provenance, undefined);
  assert.equal(current.event.lifecycle.database_url, undefined);
  assert.equal(current.event.lifecycle.child_runtime.state_path, undefined);
  assert.equal(current.event.lifecycle.child_runtime.ports, undefined);
  await first.writeRunLifecycle('run-identity', { status: 'completed', ended_at: '2026-09-29T00:00:00Z' });
  assert.equal((await second.readRunLifecycle('run-identity')).status, 'completed');
  const refs = (await command('git', ['ls-remote', '--heads', fixture.remote])).stdout.split(/\r?\n/).filter(Boolean);
  assert.equal(refs.filter(ref => ref.includes('/e2e-internal/current/runs/runidentity')).length, 1);
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

test('legacy sequence refs migrate their latest state to one current ref and are removed', async t => {
  const fixture = await gitFixture(t);
  const workspace = join(fixture.root, 'legacy-writer');
  await mkdir(workspace, { recursive: true });
  await command('git', ['init', workspace]);
  await command('git', ['-C', workspace, 'config', 'user.name', 'Legacy fixture']);
  await command('git', ['-C', workspace, 'config', 'user.email', 'legacy@example.invalid']);
  const stream = 'reservations/' + databaseId.replaceAll('-', '');
  const state = { schema_version: 1, kind: 'database_reservation', database_id: databaseId, status: 'unavailable', reservation: null, recovery_marker: 'legacy-marker', unavailable: { marker: 'legacy-marker', at: '2026-10-06T00:00:00.000Z', reason: 'cleanup pending', run_id: 'legacy-run' } };
  const first = { kind: 'database_reservation', database_id: databaseId, state: { ...state, status: 'in use', recovery_marker: null, unavailable: null, reservation: { run_id: 'legacy-run', acquired_at: '2026-10-05T00:00:00.000Z' } }, event_sequence: 1, previous_event_sha: null, recorded_at: '2026-10-05T00:00:00.000Z' };
  await writeFile(join(workspace, 'event.json'), JSON.stringify(first));
  await command('git', ['-C', workspace, 'add', 'event.json']);
  await command('git', ['-C', workspace, 'commit', '-m', 'legacy sequence one']);
  const { stdout: firstSha } = await command('git', ['-C', workspace, 'rev-parse', 'HEAD']);
  await command('git', ['-C', workspace, 'push', fixture.remote, 'HEAD:refs/heads/e2e-internal/' + stream + '/0000000000000001']);
  const second = { kind: 'database_reservation', database_id: databaseId, state, event_sequence: 2, previous_event_sha: firstSha.trim(), recorded_at: '2026-10-06T00:00:00.000Z' };
  await writeFile(join(workspace, 'event.json'), JSON.stringify(second));
  await command('git', ['-C', workspace, 'commit', '-am', 'legacy sequence two']);
  await command('git', ['-C', workspace, 'push', fixture.remote, 'HEAD:refs/heads/e2e-internal/' + stream + '/0000000000000002']);

  const activeRunStream = 'runs/activerun';
  const activeRun = {
    kind: 'e2e_run_lifecycle',
    run_id: 'active-run',
    lifecycle: {
      run_id: 'active-run',
      status: 'active',
      selected_database_id: '4ea8a265-8625-812c-8849-fa1087a2272b',
      child_runtime: { runtime_id: 'runtime-active', status: 'active' }
    },
    event_sequence: 1,
    previous_event_sha: null,
    recorded_at: '2026-10-06T00:00:00.000Z'
  };
  await writeFile(join(workspace, 'event.json'), JSON.stringify(activeRun));
  await command('git', ['-C', workspace, 'add', 'event.json']);
  await command('git', ['-C', workspace, 'commit', '-m', 'legacy active run lifecycle']);
  await command('git', ['-C', workspace, 'push', fixture.remote, 'HEAD:refs/heads/e2e-internal/' + activeRunStream + '/0000000000000001']);

  const authority = new DatabaseReservationAuthority({ eventStore: fixture.store(join(fixture.root, 'new-workspace')) });
  await authority.reconcileCurrentState([{ database_id: databaseId }]);
  const current = await authority.read(databaseId);
  assert.equal(current.status, DATABASE_STATES.UNAVAILABLE);
  assert.equal(current.recovery_marker, 'legacy-marker');
  assert.equal(current.sequence, 2);
  assert.equal((await authority.readRunLifecycle('active-run')).child_runtime.status, 'active');
  const refs = (await command('git', ['ls-remote', '--heads', fixture.remote])).stdout.split(/\r?\n/).filter(Boolean);
  assert.equal(refs.filter(ref => ref.includes('/e2e-internal/current/' + stream)).length, 1);
  assert.equal(refs.filter(ref => ref.includes('/e2e-internal/current/runs/activerun')).length, 1);
  assert.equal(refs.some(ref => /refs\/heads\/e2e-internal\/(?:reservations|runs)\/[^\s]+\/\d+$/.test(ref)), false);
});
