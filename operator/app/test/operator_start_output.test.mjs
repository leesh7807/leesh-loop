import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile as execute } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const execFile = promisify(execute);
const operatorModule = pathToFileURL(join(import.meta.dirname, '../leesh-loop.mjs')).href;

test('Publisher preparation keeps diagnostics off Operator JSON stdout', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-publisher-output-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fakeNpm = join(directory, 'npm');
  await writeFile(fakeNpm, '#!/bin/sh\nprintf "publisher stdout noise\\n"\nprintf "publisher stderr diagnostic\\n" >&2\nexit 0\n');
  await chmod(fakeNpm, 0o755);

  const script = `import { runPublisherCommand } from ${JSON.stringify(operatorModule)}; const result = runPublisherCommand(['run', 'build']); console.log(JSON.stringify({status: result.status}));`;
  const { stdout, stderr } = await execFile(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}` }
  });

  assert.equal(stdout, '{"status":0}\n');
  assert.match(stderr, /publisher stderr diagnostic/);
  assert.match(stderr, /publisher stdout noise/);
  assert.doesNotMatch(stdout, /publisher stdout noise/);
});
