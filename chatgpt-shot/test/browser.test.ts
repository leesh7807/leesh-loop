import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RuntimeLock } from '../src/browser.js';

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
