import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../../../bin/leesh-loop.mjs', import.meta.url));

test('global CLI exposes project-centered operations and no per-instance npm delegation', () => {
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /leesh-loop\s+Open the central Manager UI/);
  assert.match(help.stdout, /leesh-loop add \[path\]\s+Add a local Git project/);
  assert.match(help.stdout, /leesh-loop init\s+Add the current Git project/);
  assert.match(help.stdout, /leesh-loop list\s+List managed projects and Loop states/);
  assert.match(help.stdout, /leesh-loop start \[project\]/);
  assert.match(help.stdout, /leesh-loop stop \[project\]/);
  assert.match(help.stdout, /leesh-loop stop --all/);
  assert.match(help.stdout, /leesh-loop manager stop/);
  assert.doesNotMatch(help.stdout, /npm (?:start|stop)|instance-registry/);
});
