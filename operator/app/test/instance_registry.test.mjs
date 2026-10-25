import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../../../bin/leesh-loop.mjs', import.meta.url));

test('global CLI exposes central Manager operations and no per-instance npm delegation', () => {
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /leesh-loop\s+Open the central Manager UI/);
  assert.match(help.stdout, /leesh-loop init\s+Create a managed Loop/);
  assert.match(help.stdout, /leesh-loop list\s+List managed Loop instances/);
  assert.match(help.stdout, /leesh-loop start <id>/);
  assert.match(help.stdout, /leesh-loop stop <id>/);
  assert.doesNotMatch(help.stdout, /npm (?:start|stop)|instance-registry/);
});
