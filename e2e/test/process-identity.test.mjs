import assert from 'node:assert/strict';
import test from 'node:test';
import { currentProcessIdentity, inspectProcessIdentity } from '../model/process-identity.mjs';

test('process identity is active in its PID namespace and unknown from another namespace', async () => {
  const identity = await currentProcessIdentity();
  assert.equal(identity.pid_namespace.startsWith('pid:['), true);
  assert.equal(await inspectProcessIdentity(identity), 'active');
  assert.equal(await inspectProcessIdentity({ ...identity, pid_namespace: 'pid:[different]' }), 'unknown');
});

test('missing PID namespace evidence never classifies an old identity as dead', async () => {
  const identity = await currentProcessIdentity();
  const { pid_namespace: _namespace, ...legacy } = identity;
  assert.equal(await inspectProcessIdentity({ ...legacy, pid: 2_000_000_000 }), 'unknown');
});
