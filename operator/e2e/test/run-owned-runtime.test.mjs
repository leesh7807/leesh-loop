import test from 'node:test';
import assert from 'node:assert/strict';
import { readRunOwnedRuntime } from '../run/run-owned-runtime.mjs';

const record = {
  runtime: { dashboard: 'http://127.0.0.1:4410', runtime_id: 'runtime-owned' },
  evidence: { snapshots: [] }
};

test('run-owned runtime readback treats an invalid identity response as unconfirmed', async () => {
  const result = await readRunOwnedRuntime(record, { async readSymphonyRuntimeStatus() { return {}; } });

  assert.equal(result.status, 'unconfirmed');
  assert.match(result.error, /did not include a runtime identity/);
});

test('run-owned runtime readback does not classify a replacement runtime as run-owned', async () => {
  const result = await readRunOwnedRuntime(record, { async readSymphonyRuntimeStatus() { return { runtime_id: 'another-runtime', dispatch_capable: true }; } });

  assert.equal(result.status, 'absent');
  assert.equal(result.observed_runtime_id, 'another-runtime');
});

test('run-owned runtime readback confirms absence when its dashboard refuses the connection', async () => {
  const error = new TypeError('fetch failed', { cause: Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }) });
  const result = await readRunOwnedRuntime(record, { async readSymphonyRuntimeStatus() { throw error; } });

  assert.equal(result.status, 'absent');
  assert.equal(result.runtime_id, 'runtime-owned');
});

test('run-owned runtime readback confirms a stopped startup with no stored ID when its endpoint is absent', async () => {
  const startupRecord = { runtime: { dashboard: record.runtime.dashboard }, evidence: { snapshots: [] } };
  const error = new TypeError('fetch failed', { cause: Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }) });
  const result = await readRunOwnedRuntime(startupRecord, { async readSymphonyRuntimeStatus() { throw error; } });

  assert.equal(result.status, 'absent');
  assert.equal(result.runtime_id, null);
});

test('run-owned runtime readback stays unconfirmed when a live runtime has no recorded owner identity', async () => {
  const startupRecord = { runtime: { dashboard: record.runtime.dashboard }, evidence: { snapshots: [] } };
  const result = await readRunOwnedRuntime(startupRecord, { async readSymphonyRuntimeStatus() { return { runtime_id: 'runtime-unknown', dispatch_capable: true }; } });

  assert.equal(result.status, 'unconfirmed');
  assert.equal(result.observed.runtime_id, 'runtime-unknown');
});
