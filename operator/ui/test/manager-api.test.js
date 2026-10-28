import assert from 'node:assert/strict';
import test from 'node:test';
import { createManagerApiFetch } from '../src/manager-api.js';

test('Operator requests stay bound to the instance mounted in their own tab', async () => {
  const requests = [];
  const fetchImpl = async (input, init) => {
    requests.push({ input, headers: init.headers });
    return new Response('{}');
  };
  const firstTabFetch = createManagerApiFetch({ token: 'manager-token', instanceId: 'instance-a', fetchImpl });
  const secondTabFetch = createManagerApiFetch({ token: 'manager-token', instanceId: 'instance-b', fetchImpl });

  await firstTabFetch('/api/v1/tasks');
  await secondTabFetch('/api/v1/tasks');

  assert.equal(requests[0].headers.get('x-leesh-loop-instance-id'), 'instance-a');
  assert.equal(requests[1].headers.get('x-leesh-loop-instance-id'), 'instance-b');
  assert.equal(requests[0].headers.get('x-leesh-loop-token'), 'manager-token');
});

test('Manager-wide requests remove any caller-supplied instance routing header', async () => {
  let requestHeaders;
  const apiFetch = createManagerApiFetch({
    token: 'manager-token',
    fetchImpl: async (_input, init) => { requestHeaders = init.headers; return new Response('{}'); }
  });

  await apiFetch('/api/v1/instances', { headers: { 'x-leesh-loop-instance-id': 'stale-instance' } });

  assert.equal(requestHeaders.get('x-leesh-loop-instance-id'), null);
});

test('Manager API refreshes its in-memory credential after a Runtime change', async () => {
  const requests = [];
  let credentialsIssued = 0;
  const apiFetch = createManagerApiFetch({
    tokenProvider: async () => {
      credentialsIssued += 1;
      return credentialsIssued === 1 ? 'old-runtime-token' : 'active-runtime-token';
    },
    fetchImpl: async (_input, init) => {
      const token = init.headers.get('x-leesh-loop-token');
      requests.push(token);
      return new Response('{}', { status: token === 'old-runtime-token' ? 401 : 200 });
    }
  });

  const response = await apiFetch('/api/v1/manager');

  assert.equal(response.status, 200);
  assert.deepEqual(requests, ['old-runtime-token', 'active-runtime-token']);
  assert.equal(credentialsIssued, 2);
});
