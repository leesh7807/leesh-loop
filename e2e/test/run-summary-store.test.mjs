import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunSummaryStore } from '../model/run-summary-store.mjs';

async function repository(t) {
  const root = await mkdtemp(join(tmpdir(), 'leesh-loop-run-summary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function runRecord(runId, overrides = {}) {
  return {
    run_id: runId,
    status: 'finished',
    started_at: '2026-10-06T10:00:00.000Z',
    ended_at: '2026-10-06T10:04:00.000Z',
    timing: { run: { observed_duration_ms: 240000 } },
    workload: { id: 'catalog-workload', plan_identifier: 'PLAN-123ABC' },
    artifacts: { task_identifier: 'TASK-42', delivery_pr_url: 'https://github.com/owner/repo/pull/42', delivered_head: 'a'.repeat(40), merged_head: null },
    lifecycle: { observations: [{ state: 'Ready' }, { state: 'In Progress' }, { state: 'Human Review' }, { state: 'Done' }], verified_through: 'Human Review', terminal_state: 'Done' },
    finalization: { complete: true, unresolved: [] },
    cleanup: { runtime_stopped: true, branches_deleted: ['base/run'], workspaces_deleted: ['/tmp/private/workspace'], run_lifecycle_coordination_deleted: true, unresolved: [] },
    database_reservation: { database_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'available' },
    binding: { notion_database_url: 'https://notion.example/database/secret', database_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    run_input: { runtime_options: { symphony_port: 45678, ui_port: 45679, workspace_root: '/tmp/private/workspace' } },
    evidence: { snapshots: Array.from({ length: 30 }, () => ({ raw: 'snapshot detail' })) },
    ...overrides
  };
}

test('success summary is compact, useful, and excludes execution infrastructure details', async t => {
  const root = await repository(t);
  const store = new RunSummaryStore({ repositoryRoot: root });
  const record = runRecord('run-summary-success');
  record.artifacts.delivery_pr_url += '?token=private-query-value';
  const result = await store.write(record);
  const summary = await readFile(result.path, 'utf8');

  assert.equal(result.created, true);
  assert.match(summary, /Run ID: run-summary-success/);
  assert.match(summary, /Workload: catalog-workload/);
  assert.match(summary, /Task: TASK-42/);
  assert.match(summary, /Lifecycle: Ready → In Progress → Human Review → Done/);
  assert.match(summary, /Result: finished \(task Done\)/);
  assert.match(summary, /pull\/42/);
  assert.match(summary, /Run-owned branches deleted: 1/);
  assert.match(summary, /Database reservation: available/);
  assert.match(summary, /Run coordination removed: yes/);
  assert.doesNotMatch(summary, /aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/);
  assert.doesNotMatch(summary, /notion\.example/);
  assert.doesNotMatch(summary, /45678|45679/);
  assert.doesNotMatch(summary, /private\/workspace|snapshot detail|secret|private-query-value/);
  assert.equal((await stat(result.path)).mode & 0o777, 0o644);
});

test('recovery summary distinguishes unresolved pool reservations from the completed run reservation', async t => {
  const root = await repository(t);
  const store = new RunSummaryStore({ repositoryRoot: root });
  const result = await store.write(runRecord('run-summary-recovery', {
    recovery: [
      { database_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'unavailable', result: 'still unavailable' },
      { database_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', status: 'unavailable', result: 'still unavailable' },
      { database_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', status: 'available', result: 'available' },
      { database_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', status: 'available', result: 'recovered' },
      { database_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', status: 'in use', result: 'preserved; active runtime' },
      { database_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', status: 'unknown', result: 'recovery could not verify database; other pool entries continue' }
    ]
  }));
  const summary = await readFile(result.path, 'utf8');

  assert.match(summary, /Database reservation: available/);
  assert.match(summary, /Recovery: 2 pool reservations remain unavailable; 1 pool reservation recovered; 1 active pool reservation preserved; 1 pool reservation state unverified/);
  assert.doesNotMatch(summary, /aaaaaaaa-aaaa|bbbbbbbb-bbbb|recovery could not verify database/);
});

test('failed summary records a short stage and redacts identifiers, URLs, credentials, and paths', async t => {
  const root = await repository(t);
  const store = new RunSummaryStore({ repositoryRoot: root });
  const record = runRecord('run-summary-failure', {
    status: 'failed',
    failures: [{
      phase: 'database_reservation_finalization',
      error: 'could not settle database aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa at https://notion.example/private token=ntn_abcdefghijklmnop api_key=short-secret sk-proj-abcdefghijklmnopqrstuvwxyz1234567890 /tmp/private/workspace'
    }],
    finalization: { complete: false, unresolved: ['database_reservation_finalization'] },
    cleanup: { runtime_stopped: true, branches_deleted: [], workspaces_deleted: [], run_lifecycle_coordination_deleted: false, unresolved: ['run_lifecycle_coordination_cleanup'] },
    database_reservation: { database_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'unavailable' }
  });
  const result = await store.write(record);
  const summary = await readFile(result.path, 'utf8');

  assert.match(summary, /Failure stage: database_reservation_finalization/);
  assert.match(summary, /Failure summary:.*\[ID\].*\[URL\].*redacted credential.*\[path\]/);
  assert.match(summary, /Database reservation: unavailable/);
  assert.match(summary, /Run coordination removed: pending/);
  assert.doesNotMatch(summary, /aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|notion\.example|ntn_abcdefghijklmnop|short-secret|sk-proj-|private\/workspace/);
});

test('failed command summaries keep the provider reason while dropping command paths and raw response data', async t => {
  const root = await repository(t);
  const store = new RunSummaryStore({ repositoryRoot: root });
  const result = await store.write(runRecord('run-summary-provider-failure', {
    status: 'failed',
    failures: [{
      phase: 'orchestration',
      error: 'node /tmp/private/cli.js --config /tmp/private/config.json failed: publisher error: provider/API failure (429): {"status":429,"code":"rate_limited","message":"You have been rate limited. Please try again later.","request_id":"e7cbab48-bcfb-40ec-87e2-38f6bead9968"}'
    }],
    finalization: { complete: false, unresolved: ['database_reservation_finalization'] },
    cleanup: { runtime_stopped: true, branches_deleted: [], workspaces_deleted: [], unresolved: ['database_reservation_finalization'] }
  }));
  const summary = await readFile(result.path, 'utf8');

  assert.match(summary, /Failure stage: orchestration/);
  assert.match(summary, /Failure summary:.*rate_limited.*You have been rate limited/);
  assert.match(summary, /Result: failed/);
  assert.doesNotMatch(summary, /\/tmp\/private|request_id|e7cbab48-bcfb-40ec-87e2-38f6bead9968/);
});

test('failed operator setup summaries retain the actionable cause without build logs or cache paths', async t => {
  const root = await repository(t);
  const store = new RunSummaryStore({ repositoryRoot: root });
  const result = await store.write(runRecord('run-summary-setup-failure', {
    status: 'finished',
    failures: [{
      phase: 'orchestration',
      error: 'node /tmp/private/operator.mjs failed: Operator: Checking setup > vite build > ✓ built in 256ms Leesh Loop could not start: owned Symphony process 873 exited: cp: cannot create regular file \'/home/user/.cache/chatgpt-shot/worker-interface/.chatgpt-shot.873\': Read-only file system Loop setup needs attention: cannot prepare the worker-facing chatgpt-shot interface.'
    }],
    finalization: { complete: true, unresolved: [] }
  }));
  const summary = await readFile(result.path, 'utf8');

  assert.match(summary, /Result: failed/);
  assert.match(summary, /Failure summary: cannot prepare the worker-facing chatgpt-shot interface\./);
  assert.doesNotMatch(summary, /vite build|873|\.cache|operator\.mjs|Read-only file system/);
});

test('an orchestration error is failed even when the record status was finalized as finished', async t => {
  const root = await repository(t);
  const store = new RunSummaryStore({ repositoryRoot: root });
  const result = await store.write(runRecord('run-summary-error-status-mismatch', {
    error: 'Publisher request failed (429): {"code":"rate_limited","message":"Request rate limit exceeded."}'
  }));
  const summary = await readFile(result.path, 'utf8');

  assert.match(summary, /Result: failed/);
  assert.match(summary, /Failure stage: run/);
  assert.match(summary, /Failure summary: rate_limited: Request rate limit exceeded\./);
});

test('failure summaries exclude run-scoped paths and temporary local ports', async t => {
  const root = await repository(t);
  const store = new RunSummaryStore({ repositoryRoot: root });
  const result = await store.write(runRecord('run-summary-infrastructure', {
    status: 'failed',
    failures: [{ phase: 'runtime_start', error: 'unable to read e2e/runs/run-summary-infrastructure/operator-state at 0.0.0.0:45678' }],
    finalization: { complete: false, unresolved: ['runtime_start'] }
  }));
  const summary = await readFile(result.path, 'utf8');

  assert.match(summary, /Failure summary: unable to read \[path\] at \[local endpoint\]/);
  assert.doesNotMatch(summary, /e2e\/runs|operator-state|45678/);
});

test('parallel terminal runs create independent immutable summary files', async t => {
  const root = await repository(t);
  const store = new RunSummaryStore({ repositoryRoot: root });
  const results = await Promise.all([
    store.write(runRecord('run-parallel-a')),
    store.write(runRecord('run-parallel-b'))
  ]);
  assert.notEqual(results[0].path, results[1].path);
  assert.equal((await readFile(results[0].path, 'utf8')).includes('run-parallel-a'), true);
  assert.equal((await readFile(results[1].path, 'utf8')).includes('run-parallel-b'), true);

  const initial = await readFile(results[0].path, 'utf8');
  const duplicate = await store.write(runRecord('run-parallel-a', { status: 'failed' }));
  assert.equal(duplicate.created, false);
  assert.equal(await readFile(results[0].path, 'utf8'), initial);
});
