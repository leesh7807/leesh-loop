import assert from 'node:assert/strict';
import test from 'node:test';
import { bootstrapManagerToken } from '../src/manager-auth.js';

test('Manager session bootstrap requests a short-lived in-memory API credential from its own origin', async () => {
  const token = 'a'.repeat(64);
  let request;
  const result = await bootstrapManagerToken(async (input, init) => {
    request = { input, init };
    return new Response(JSON.stringify({ token }), { headers: { 'content-type': 'application/json' } });
  });

  assert.equal(result, token);
  assert.equal(request.input, '/api/v1/session');
  assert.equal(request.init.cache, 'no-store');
  assert.equal(request.init.credentials, 'same-origin');
  assert.equal(request.init.headers.accept, 'application/json');
});

test('Manager session bootstrap explains when the local session endpoint is unavailable', async () => {
  await assert.rejects(
    bootstrapManagerToken(async () => new Response(JSON.stringify({ error: 'Open Manager directly from this local address.' }), { status: 403 })),
    /Open Manager directly from this local address/
  );
});
