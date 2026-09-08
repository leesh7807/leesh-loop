import test from 'node:test';
import assert from 'node:assert/strict';
import { brokerSocket } from '../src/broker.js';

test('uses a short hashed owner-runtime socket path for deep repositories', () => {
  const root = `/tmp/${'deep/'.repeat(80)}repository`;
  const socket = brokerSocket(root);
  assert.ok(Buffer.byteLength(socket) < 100);
  assert.match(socket, /chatgpt-shot-/);
  assert.doesNotMatch(socket, /deep/);
});
