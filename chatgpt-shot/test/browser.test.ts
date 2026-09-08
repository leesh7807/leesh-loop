import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RuntimeLock, matchesManagedRuntime } from '../src/browser.js';

test('recovers an expired ownerless lock directory', async () => {
  const root = join(tmpdir(), `chatgpt-shot-lock-${process.pid}-${Date.now()}`);
  const lockPath = join(root, '.chatgpt-shot-submit.lock');
  mkdirSync(lockPath, { recursive: true });
  const old = new Date(Date.now() - 6_000);
  utimesSync(lockPath, old, old);

  try {
    let ran = false;
    await new RuntimeLock(root, 'submit').run(async () => { ran = true; });
    assert.equal(ran, true);
    assert.equal(existsSync(lockPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('accepts a remembered runtime only when its process owns the profile and CDP port', () => {
  const root = '/tmp/chatgpt-shot-runtime-test';
  const runtime = { pid: process.pid, port: 9222 };
  const command = `chrome\0--user-data-dir=${root}/.chatgpt-shot-profile\0--remote-debugging-port=9222`;
  assert.equal(matchesManagedRuntime(root, runtime, () => command), true);
  assert.equal(matchesManagedRuntime(root, runtime, () => 'chrome\0--remote-debugging-port=9222'), false);
  assert.equal(matchesManagedRuntime(root, runtime, () => `chrome\0--user-data-dir=${root}/.chatgpt-shot-profile`), false);
});
