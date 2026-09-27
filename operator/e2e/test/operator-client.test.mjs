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
