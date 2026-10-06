import assert from 'node:assert/strict';
import { execFile as execute } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import test from 'node:test';
import { join } from 'node:path';
import { effective, operatorBootstrapArgs, parseStartArguments, startConfiguration } from '../leesh-loop.mjs';

const execFile = promisify(execute);
const root = join(import.meta.dirname, '../../..');

test('start:fast uses the same start command and project config with the existing readiness skip', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const normalInvocation = manifest.scripts.start.split(' ');
  const fastInvocation = manifest.scripts['start:fast'].split(' ');

  assert.deepEqual(normalInvocation.slice(0, 3), fastInvocation.slice(0, 3));
  assert.equal(normalInvocation[2], 'start');
  assert.deepEqual(fastInvocation.slice(3), ['operator/project.json', '--skip-external-readiness']);

  const normal = parseStartArguments(normalInvocation.slice(3));
  const fast = parseStartArguments(fastInvocation.slice(3));
  assert.equal(normal.configurationPath, fast.configurationPath);
  assert.equal(normal.skipExternalReadiness, false);
  assert.equal(fast.skipExternalReadiness, true);

  const projectConfig = { workflow_path: '/tmp/workflow.md', skip_external_readiness: false };
  const normalConfig = startConfiguration(projectConfig, normal);
  const fastConfig = startConfiguration(projectConfig, fast);
  const normalIdentity = effective(normalConfig, 'same-runtime', 4100);
  const fastIdentity = effective(fastConfig, 'same-runtime', 4100);
  assert.deepEqual({ ...fastIdentity, skip_external_readiness: normalIdentity.skip_external_readiness }, normalIdentity);
  const normalBootstrapArgs = operatorBootstrapArgs(normalConfig, '/tmp/symphony', 4100);
  const fastBootstrapArgs = operatorBootstrapArgs(fastConfig, '/tmp/symphony', 4100);
  assert.deepEqual(normalBootstrapArgs.slice(1, 2), ['--']);
  assert.deepEqual(fastBootstrapArgs.slice(1, 3), ['--skip-external-readiness', '--']);
  assert.deepEqual(fastBootstrapArgs.filter(argument => argument !== '--skip-external-readiness'), normalBootstrapArgs);
});

test('start rejects malformed fast-start arguments before treating an option as a config path', async () => {
  await assert.rejects(
    execFile('npm', ['run', 'start:fast', '--', '/tmp/custom-project.json', 'unexpected'], { cwd: root }),
    error => {
      assert.equal(error.code, 2);
      assert.match(error.stderr, /start accepts at most one project configuration path/);
      assert.doesNotMatch(error.stderr, /missing or invalid project configuration/);
      return true;
    }
  );
});
