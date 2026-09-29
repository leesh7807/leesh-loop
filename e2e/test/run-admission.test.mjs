import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseReservationAuthority, DATABASE_STATES } from '../run/admission/database-reservation-authority.mjs';
import { RunAdmission } from '../run/admission/run-admission.mjs';
import { currentProcessIdentity } from '../model/process-identity.mjs';

class MemoryEventStore {
  constructor() { this.streams = new Map(); this.sequence = 0; }
  async read(stream) { return structuredClone(this.streams.get(stream) || { sequence: 0, sha: null, ref: null, event: null }); }
  async compareAndAppend(stream, expected, event) {
    const current = await this.read(stream);
    if (current.sequence !== expected.sequence || current.sha !== expected.sha) return { committed: false, current };
    const sequence = current.sequence + 1;
    const next = { sequence, sha: `event-${++this.sequence}`, ref: `memory/${sequence}`, event: { ...structuredClone(event), event_sequence: sequence } };
    this.streams.set(stream, next);
    return { committed: true, current: structuredClone(next) };
  }
}

const databaseA = { database_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', database_url: 'https://www.notion.so/aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa' };
const databaseB = { database_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', database_url: 'https://www.notion.so/bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb' };

function createAdmission({ authority, pool = [databaseA], notionClient = { async listTasks() { return []; } }, runRecordStore = { async saveAdmissionFailure() {} }, operatorClient } = {}) {
  return new RunAdmission({
    config: { database_pool: pool },
    catalog: [{ id: 'fixture' }],
    runRecordStore,
    notionClient,
    gitClient: { async listRemoteBranchRefs() { return {}; } },
    operatorClient,
    reservationAuthority: authority
  });
}

test('recovery preserves an in-use reservation while its run process is active', async () => {
  const authority = new DatabaseReservationAuthority({ eventStore: new MemoryEventStore() });
  const process = await currentProcessIdentity();
  await authority.reserve(databaseA.database_id, { run_id: 'old-run', run_process: process, origin: 'worker-originated' });
  await authority.writeRunLifecycle('old-run', { run_id: 'old-run', status: 'active', run_process: process, origin: 'worker-originated' });
  let taskReads = 0;
  const admission = createAdmission({ authority, notionClient: { async listTasks() { taskReads += 1; return []; } } });
  const result = await admission.recoveryPass();
  assert.equal(result[0].status, DATABASE_STATES.IN_USE);
  assert.match(result[0].result, /preserved/);
  assert.equal(taskReads, 0);
  assert.equal((await authority.read(databaseA.database_id)).status, DATABASE_STATES.IN_USE);
});

test('recovery preserves an in-use reservation when child runtime startup is unresolved', async () => {
  const authority = new DatabaseReservationAuthority({ eventStore: new MemoryEventStore() });
  const current = await currentProcessIdentity();
  const dead = { ...current, pid: 2_000_000_000 };
  await authority.reserve(databaseA.database_id, { run_id: 'starting-run', run_process: dead, origin: 'worker-originated' });
  await authority.updateRuntime(databaseA.database_id, 'starting-run', {
    status: 'starting',
    state_path: '/worker-workspace/e2e/runs/starting-run/operator-state',
    process_identity: null
  });
  await authority.writeRunLifecycle('starting-run', { run_id: 'starting-run', status: 'active', run_process: dead });
  let taskReads = 0;
  const admission = createAdmission({ authority, notionClient: { async listTasks() { taskReads += 1; return []; } } });
  const result = await admission.recoveryPass();
  assert.equal(result[0].status, DATABASE_STATES.IN_USE);
  assert.match(result[0].result, /active or cannot be authoritatively checked/);
  assert.equal(taskReads, 0);
  assert.equal((await authority.read(databaseA.database_id)).reservation.child_runtime.status, 'starting');
});

test('recovery trusts a matching live child runtime endpoint over a foreign PID namespace', async () => {
  const authority = new DatabaseReservationAuthority({ eventStore: new MemoryEventStore() });
  const current = await currentProcessIdentity();
  const deadRun = { ...current, pid: 2_000_000_000 };
  await authority.reserve(databaseA.database_id, { run_id: 'outer-dead', run_process: deadRun, origin: 'worker-originated' });
  await authority.updateRuntime(databaseA.database_id, 'outer-dead', {
    status: 'active', runtime_id: 'child-runtime', dashboard: 'http://127.0.0.1:45183', process_identity: { ...deadRun, pid: 845, pid_namespace: 'pid:[foreign]' }
  });
  await authority.writeRunLifecycle('outer-dead', { run_id: 'outer-dead', status: 'active', run_process: deadRun });
  const admission = createAdmission({ authority, operatorClient: { async inspectChildRuntimeLiveness() { return 'active'; } } });
  const result = await admission.recoveryPass();
  assert.equal(result[0].status, DATABASE_STATES.IN_USE);
  assert.match(result[0].result, /active or cannot be authoritatively checked/);
  assert.equal((await authority.read(databaseA.database_id)).reservation.run_id, 'outer-dead');
});

test('dead run recovery cancels stale task only after Workpad provenance readback, then admits through a new reservation', async () => {
  const authority = new DatabaseReservationAuthority({ eventStore: new MemoryEventStore() });
  const current = await currentProcessIdentity();
  const dead = { ...current, pid: 2_000_000_000 };
  await authority.reserve(databaseA.database_id, { run_id: 'old-run', run_process: dead, origin: 'direct' });
  await authority.updateReservationMetadata(databaseA.database_id, 'old-run', { base_branch: 'base/old-run' });
  await authority.writeRunLifecycle('old-run', { run_id: 'old-run', status: 'active', run_process: dead, origin: 'direct' });

  const tasks = [
    { id: 'backlog', identifier: 'T-BACKLOG', state: 'Backlog', workpad: '' },
    { id: 'done', identifier: 'T-DONE', state: 'Done', workpad: '' },
    { id: 'cancelled', identifier: 'T-CANCELLED', state: 'Cancelled', workpad: '' },
    { id: 'stale', identifier: 'T-STALE', state: 'Ready', workpad: 'existing notes\n' }
  ];
  const mutationOrder = [];
  const notionClient = {
    async listTasks(url) { assert.equal(url, databaseA.database_url); return tasks.map(({ id, identifier, state }) => ({ id, identifier, state })); },
    async readTask(_url, id) { return structuredClone(tasks.find(task => task.id === id)); },
    async appendWorkpad(id, text) { mutationOrder.push(`workpad:${id}`); const task = tasks.find(value => value.id === id); task.workpad += `${task.workpad.endsWith('\n') ? '' : '\n'}${text}\n`; },
    async updateTaskState(_url, id, state) { mutationOrder.push(`state:${id}`); const task = tasks.find(value => value.id === id); task.state = state; return structuredClone(task); }
  };
  const admission = createAdmission({ authority, notionClient });
  const result = await admission.checkRunAdmission({ runId: 'new-run', runProcess: current, origin: 'direct' });
  assert.equal(result.admitted, true);
  assert.equal(result.database.database_id, databaseA.database_id);
  assert.equal(tasks.find(task => task.id === 'stale').state, 'Cancelled');
  assert.match(tasks.find(task => task.id === 'stale').workpad, /previous_state: Ready/);
  assert.match(tasks.find(task => task.id === 'stale').workpad, /previous_run_id: old-run/);
  assert.ok(mutationOrder.indexOf('workpad:stale') < mutationOrder.indexOf('state:stale'));
  assert.deepEqual(tasks.slice(0, 3).map(task => task.state), ['Backlog', 'Done', 'Cancelled']);
  assert.equal((await authority.read(databaseA.database_id)).reservation.run_id, 'new-run');
  assert.equal((await authority.readRunLifecycle('old-run')).status, 'interrupted');
});

test('recovery classifies the authoritative task State instead of a stale list snapshot', async () => {
  const authority = new DatabaseReservationAuthority({ eventStore: new MemoryEventStore() });
  const current = await currentProcessIdentity();
  const dead = { ...current, pid: 2_000_000_000 };
  await authority.reserve(databaseA.database_id, { run_id: 'old-run', run_process: dead, origin: 'direct' });
  await authority.writeRunLifecycle('old-run', { run_id: 'old-run', status: 'active', run_process: dead });
  const task = { id: 'changed', identifier: 'T-CHANGED', state: 'Ready', workpad: 'existing notes\n' };
  const mutationOrder = [];
  const notionClient = {
    async listTasks() { return [{ id: task.id, identifier: task.identifier, state: 'Cancelled' }]; },
    async readTask(_url, id) { assert.equal(id, task.id); return structuredClone(task); },
    async appendWorkpad(id, text) { mutationOrder.push(`workpad:${id}`); task.workpad += `${task.workpad.endsWith('\n') ? '' : '\n'}${text}\n`; },
    async updateTaskState(_url, id, state) { mutationOrder.push(`state:${id}`); task.state = state; }
  };
  await authority.markUnavailable(databaseA.database_id, 'old-run', 'interrupted E2E run');
  const admission = createAdmission({ authority, notionClient });
  const result = await admission.recoveryPass();
  assert.equal(result[0].result, 'recovered');
  assert.equal(task.state, 'Cancelled');
  assert.match(task.workpad, /previous_state: Ready/);
  assert.ok(mutationOrder.indexOf('workpad:changed') < mutationOrder.indexOf('state:changed'));
});

test('failed recovery remains unavailable while another clean database admits a run', async () => {
  const authority = new DatabaseReservationAuthority({ eventStore: new MemoryEventStore() });
  await authority.reserve(databaseA.database_id, { run_id: 'old-run', run_process: { pid: 2_000_000_000, process_start_ticks: '1', boot_id: (await currentProcessIdentity()).boot_id }, origin: 'direct' });
  await authority.updateRuntime(databaseA.database_id, 'old-run', { status: 'stopped' });
  await authority.writeRunLifecycle('old-run', { run_id: 'old-run', status: 'completed', ended_at: new Date().toISOString(), run_process: { pid: 2_000_000_000, process_start_ticks: '1', boot_id: (await currentProcessIdentity()).boot_id } });
  await authority.markUnavailable(databaseA.database_id, 'old-run', 'cleanup failed');
  const notionClient = { async listTasks(url) { if (url === databaseA.database_url) throw new Error('Notion read unavailable'); return []; } };
  const admission = createAdmission({ authority, pool: [databaseA, databaseB], notionClient });
  const result = await admission.checkRunAdmission({ runId: 'new-run', runProcess: await currentProcessIdentity(), origin: 'worker-originated' });
  assert.equal(result.admitted, true);
  assert.equal(result.database.database_id, databaseB.database_id);
  assert.equal((await authority.read(databaseA.database_id)).status, DATABASE_STATES.UNAVAILABLE);
  assert.equal((await authority.read(databaseB.database_id)).reservation.run_id, 'new-run');
});

test('capacity contention ends as resource unavailable admission without database task reads', async () => {
  const authority = new DatabaseReservationAuthority({ eventStore: new MemoryEventStore() });
  const current = await currentProcessIdentity();
  for (const candidate of [databaseA, databaseB]) {
    await authority.reserve(candidate.database_id, { run_id: `active-${candidate.database_id}`, run_process: current, origin: 'direct' });
    await authority.writeRunLifecycle(`active-${candidate.database_id}`, { run_id: `active-${candidate.database_id}`, status: 'active', run_process: current });
    await authority.updateRuntime(candidate.database_id, `active-${candidate.database_id}`, { status: 'active', process_identity: current });
  }
  let taskReads = 0;
  let admissionRecord;
  const admission = createAdmission({
    authority,
    pool: [databaseA, databaseB],
    notionClient: { async listTasks() { taskReads += 1; return []; } },
    runRecordStore: { async saveAdmissionFailure(error, metadata) { admissionRecord = { code: error.code, ...metadata }; } }
  });
  const result = await admission.checkRunAdmission({ runId: 'new-run', runProcess: current, origin: 'direct' });
  assert.equal(result.admitted, false);
  assert.equal(result.failure, 'RESOURCE_UNAVAILABLE_ADMISSION');
  assert.equal(taskReads, 0);
  assert.equal(admissionRecord.code, 'RESOURCE_UNAVAILABLE_ADMISSION');
  assert.equal((await authority.read(databaseA.database_id)).status, DATABASE_STATES.IN_USE);
  assert.equal((await authority.read(databaseB.database_id)).status, DATABASE_STATES.IN_USE);
});
