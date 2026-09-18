import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { EvidenceWriter, SelfVerificationStore, admissionNamespace, runWithDeadline } from '../self-verification.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-self-verification-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function binding(runId, database = 'https://app.notion.com/p/3df8a265862580cfb1ebda7e3337d9fa') {
  return {
    repository: 'https://github.com/example/project.git',
    configuredBase: 'main',
    seedCommit: '0123456789abcdef0123456789abcdef01234567',
    temporaryBase: `self-verification/${runId}`,
    trackerDatabase: database
  };
}

test('admission is exclusive and concurrent invocations converge on one durable run', async t => {
  const directory = await fixture(t);
  const database = 'https://app.notion.com/p/3df8a265862580cfb1ebda7e3337d9fa?v=anything';
  const first = new SelfVerificationStore(directory, database);
  const second = new SelfVerificationStore(directory, database);
  const admissions = await Promise.all([
    first.admit({ bindingFactory: async runId => binding(runId, database) }),
    second.admit({ bindingFactory: async runId => binding(runId, database) })
  ]);
  assert.equal(new Set(admissions.map(result => result.run.run_id)).size, 1);
  assert.equal(admissions.filter(result => result.resumed).length, 1);
  assert.equal(admissionNamespace(database), admissions[0].run.admission_namespace);
  assert.equal((await first.read()).finalization.finalized, false);
});

test('a stale pre-commit lock is recoverable and committed runs resume after runtime restart', async t => {
  const directory = await fixture(t);
  const store = new SelfVerificationStore(directory, 'https://app.notion.com/p/3df8a265862580cfb1ebda7e3337d9fa');
  await mkdir(store.paths.lock, { recursive: true });
  await writeFile(join(store.paths.lock, 'owner.json'), JSON.stringify({ pid: 999999, started_at: new Date().toISOString() }));
  const admitted = await store.admit({ bindingFactory: async runId => binding(runId) });
  assert.equal(admitted.resumed, false);
  await store.attachRuntime('runtime-a');
  const resumed = await store.admit({ bindingFactory: async () => { throw new Error('must not create a second run'); } });
  assert.equal(resumed.resumed, true);
  assert.deepEqual(resumed.run.runtime_id_history, ['runtime-a']);
});

test('an interrupted lock marker without an owner is recoverable', async t => {
  const directory = await fixture(t);
  const store = new SelfVerificationStore(directory, 'https://app.notion.com/p/3df8a265862580cfb1ebda7e3337d9fa');
  await mkdir(store.paths.lock, { recursive: true });
  const stale = new Date(Date.now() - 2_000);
  await utimes(store.paths.lock, stale, stale);
  const admitted = await store.admit({ bindingFactory: async runId => binding(runId) });
  assert.equal(admitted.resumed, false);
});

test('an admitted run record is discoverable if the current-run pointer write is interrupted', async t => {
  const directory = await fixture(t);
  const database = 'https://app.notion.com/p/3df8a265862580cfb1ebda7e3337d9fa';
  const first = new SelfVerificationStore(directory, database);
  const admitted = await first.admit({ bindingFactory: async runId => binding(runId, database) });
  await rm(first.paths.run, { force: true });
  const resumed = await new SelfVerificationStore(directory, database).admit({ bindingFactory: async () => { throw new Error('must resume the orphaned durable run'); } });
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.run.run_id, admitted.run.run_id);
});

test('logical task binding is idempotent and never republishes an acknowledged task', async t => {
  const store = new SelfVerificationStore(await fixture(t), 'https://app.notion.com/p/3df8a265862580cfb1ebda7e3337d9fa');
  await store.admit({ bindingFactory: async runId => binding(runId) });
  let publishes = 0;
  await store.bindLogicalTask({ identifier: 'SELF-1', title: 'bounded investigation' }, async logical => {
    publishes += 1;
    return { id: 'notion-task-1', identifier: logical.identifier, url: 'https://notion.example/task' };
  });
  await store.bindLogicalTask({ identifier: 'SELF-1', title: 'same task' }, async () => { publishes += 1; return { id: 'duplicate' }; });
  assert.equal(publishes, 1);
  assert.equal((await store.read()).authoritative_task.id, 'notion-task-1');
});

test('logical and authoritative task identities must agree before binding is durable', async t => {
  const store = new SelfVerificationStore(await fixture(t), 'https://app.notion.com/p/3df8a265862580cfb1ebda7e3337d9fa');
  await store.admit({ bindingFactory: async runId => binding(runId) });
  await assert.rejects(
    store.bindLogicalTask({ identifier: 'SELF-2', title: 'bounded investigation' }, async () => ({ id: 'task', identifier: 'PLAN-DIFFERENT' })),
    /publisher identity mismatch/
  );
  assert.equal((await store.read()).authoritative_task, null);
});

test('slow or failed evidence persistence does not block production and becomes a collection gap', async t => {
  const store = new SelfVerificationStore(await fixture(t), 'https://app.notion.com/p/3df8a265862580cfb1ebda7e3337d9fa');
  await store.admit({ bindingFactory: async runId => binding(runId) });
  const writer = new EvidenceWriter(store, { write: async () => { throw new Error('writer unavailable'); } });
  const started = Date.now();
  assert.deepEqual(writer.record({ kind: 'terminal_observation' }), { accepted: true });
  assert.ok(Date.now() - started < 100, 'production event handoff should be bounded');
  await writer.flush();
  const run = await store.read();
  assert.equal(run.collection_disposition, 'incomplete');
  assert.equal(run.evidence.dropped_count, 1);
});

test('a later evidence gap downgrades an object-valued complete disposition', async t => {
  const store = new SelfVerificationStore(await fixture(t), 'https://app.notion.com/p/3df8a265862580cfb1ebda7e3337d9fa');
  await store.admit({ bindingFactory: async runId => binding(runId) });
  await store.setCollectionDisposition('complete', { checkpoint: 'terminal' });
  await store.noteEvidenceGap({ kind: 'late_cleanup_evidence_loss' });
  const run = await store.read();
  assert.equal(run.collection_disposition.value, 'incomplete');
});

test('finalization requires authoritative admission-safe closure and preserves irrecoverable collection failure', async t => {
  const store = new SelfVerificationStore(await fixture(t), 'https://app.notion.com/p/3df8a265862580cfb1ebda7e3337d9fa');
  await store.admit({ bindingFactory: async runId => binding(runId) });
  await store.setCollectionDisposition('incomplete', { cause: 'direct observation lost' });
  let cleanupCalls = 0;
  const unsafe = await store.finalize({
    authoritativeReadback: async () => ({ admission_safe: false, task_dispatchable: true, workspace_absent: false }),
    cleanupHarness: async () => { cleanupCalls += 1; return { ok: true }; },
    irrecoverableCollection: true
  });
  assert.equal(unsafe.finalized, false);
  assert.equal(cleanupCalls, 0);
  const finalized = await store.finalize({
    authoritativeReadback: async () => ({ admission_safe: true, task_dispatchable: false, execution_owners: [], conflicting_ownership: [], workspace_absent: true }),
    cleanupHarness: async run => { cleanupCalls += 1; return { ok: true, run_id: run.run_id }; },
    irrecoverableCollection: true
  });
  assert.equal(finalized.finalized, true);
  assert.equal(finalized.run.collection_disposition.value, 'irrecoverable collection failure');
  assert.equal(cleanupCalls, 1);
  assert.match(await readFile(store.paths.bundle, 'utf8'), /irrecoverable collection failure/);
});

test('finalized runs retain separate evidence bundles before the next admission', async t => {
  const directory = await fixture(t);
  const database = 'https://app.notion.com/p/3df8a265862580cfb1ebda7e3337d9fa';
  const store = new SelfVerificationStore(directory, database);
  const first = await store.admit({ bindingFactory: async runId => binding(runId, database) });
  await store.appendEvidence({ kind: 'run_a_boundary' });
  await store.finalize({
    authoritativeReadback: async () => ({ admission_safe: true, task_dispatchable: false, execution_owners: [], conflicting_ownership: [], workspace_absent: true }),
    cleanupHarness: async () => ({ ok: true })
  });
  const firstEvidencePath = store.paths.evidence;
  const second = await store.admit({ bindingFactory: async runId => binding(runId, database) });
  assert.notEqual(second.run.run_id, first.run.run_id);
  await store.appendEvidence({ kind: 'run_b_boundary' });
  const firstEvidence = await readFile(firstEvidencePath, 'utf8');
  const secondEvidence = await readFile(store.paths.evidence, 'utf8');
  assert.match(firstEvidence, /run_a_boundary/);
  assert.doesNotMatch(firstEvidence, /run_b_boundary/);
  assert.match(secondEvidence, /run_b_boundary/);
  assert.doesNotMatch(secondEvidence, /run_a_boundary/);
});

test('artifact content is retained in the run bundle independently of cleanup metadata', async t => {
  const store = new SelfVerificationStore(await fixture(t), 'https://app.notion.com/p/3df8a265862580cfb1ebda7e3337d9fa');
  await store.admit({ bindingFactory: async runId => binding(runId) });
  const run = await store.preserveArtifact({ content: '# Investigation\n\nObserved contract.\n', source: 'GitHub PR patch', deliveredPr: 'https://github.com/example/project/pull/1', deliveredHead: '0123456789abcdef0123456789abcdef01234567' });
  assert.equal(run.artifact.source, 'GitHub PR patch');
  assert.match(await readFile(run.artifact.path, 'utf8'), /Observed contract/);
  assert.equal((await store.read()).artifact.sha256.length, 64);
});

test('observer deadline aborts the resumable observation loop without changing production state', async () => {
  let iterations = 0;
  const result = await runWithDeadline(async signal => {
    while (!signal.aborted) {
      iterations += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    return { stopped: true };
  }, 15);
  const observedAtTimeout = iterations;
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.deepEqual(result, { timed_out: true });
  assert.equal(iterations, observedAtTimeout);
});
