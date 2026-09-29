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
  await client.startConfiguredOperatorProject('/tmp/run/project.json', 1_000, databaseUrl);
  assert.equal(invocation[0], 'node');
  assert.deepEqual(invocation[1], ['/repository/operator/app/leesh-loop.mjs', 'start', '/tmp/run/project.json']);
  assert.equal(invocation[2].env.LEESH_LOOP_NOTION_DATABASE_URL, databaseUrl);
});

test('run-owned Symphony stop passes the recorded runtime identity to the conditional Operator command', async () => {
  let invocation;
  const client = new OperatorClient({
    root: '/repository',
    app: '/repository/operator/app/leesh-loop.mjs',
    commandRunner: async (...args) => {
      invocation = args;
      return { stdout: '{"stopped":true}' };
    }
  });
  const result = await client.stopRunOwnedSymphonyRuntime('/tmp/run/project.json', 'runtime-run-1', 1_000);
  assert.deepEqual(result, { stopped: true });
  assert.deepEqual(invocation[1], ['/repository/operator/app/leesh-loop.mjs', 'stop-owned', '/tmp/run/project.json', 'runtime-run-1']);
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
