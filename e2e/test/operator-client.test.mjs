import assert from 'node:assert/strict';
import test from 'node:test';
import { OperatorClient } from '../systems/operator/operator-client.mjs';

test('nested Operator start receives the resolved E2E database binding through its process environment', async () => {
  let invocation;
  const client = new OperatorClient({
    root: '/repository',
    app: '/repository/operator/app/leesh-loop.mjs',
    commandRunner: async (...args) => {
      invocation = args;
      return { stdout: '{"dashboard":"http://127.0.0.1:4410"}' };
    }
  });
  const databaseUrl = 'https://notion.example/e2e-binding';
  await client.startConfiguredOperatorProject('/tmp/run/project.toml', 1_000, databaseUrl);
  assert.equal(invocation[0], 'node');
  assert.deepEqual(invocation[1], ['/repository/operator/app/leesh-loop.mjs', 'start', '/tmp/run/project.toml']);
  assert.equal(invocation[2].env.LEESH_LOOP_NOTION_DATABASE_URL, databaseUrl);
});

test('run-local ports are distinct ephemeral ports held until the E2E runtime starts', async () => {
  const client = new OperatorClient({ root: '/repository' });
  const lease = await client.findAvailableRuntimePorts();
  assert.ok(lease.symphony_port > 0 && lease.symphony_port <= 65_535);
  assert.ok(lease.ui_port > 0 && lease.ui_port <= 65_535);
  assert.notEqual(lease.symphony_port, lease.ui_port);
  const ports = [lease.symphony_port, lease.ui_port];
  await lease.release();
  await lease.release();
  assert.deepEqual(ports, [lease.symphony_port, lease.ui_port]);
});

test('child runtime liveness accepts a matching Symphony runtime readback across PID namespaces', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, async json() { return { pid: 845, runtime_id: 'runtime-child', dispatch_capable: true }; } });
  try {
    const client = new OperatorClient({ root: '/repository' });
    const status = await client.inspectChildRuntimeLiveness({
      status: 'active',
      runtime_id: 'runtime-child',
      dashboard: 'http://127.0.0.1:45183',
      process_identity: { pid: 845 }
    });
    assert.equal(status, 'active');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('failed runtime health read does not turn an uninspectable process into a dead runtime', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('connection refused'); };
  try {
    const client = new OperatorClient({ root: '/repository' });
    const status = await client.inspectChildRuntimeLiveness({
      status: 'active', runtime_id: 'runtime-child', dashboard: 'http://127.0.0.1:45183', process_identity: { pid: 2_000_000_000 }
    });
    assert.equal(status, 'unknown');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Symphony execution history is read through the production observability route', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl;
  globalThis.fetch = async url => {
    requestedUrl = String(url);
    return { ok: true, async json() { return { issue_identifier: 'PLAN-1', executions: [] }; } };
  };
  try {
    const client = new OperatorClient({ root: '/repository' });
    const result = await client.readSymphonyExecutions('http://127.0.0.1:4410', 'PLAN-1');
    assert.equal(requestedUrl, 'http://127.0.0.1:4410/api/v1/executions?issue_identifier=PLAN-1');
    assert.deepEqual(result, { issue_identifier: 'PLAN-1', executions: [] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
