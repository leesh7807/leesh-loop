import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile as execute } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const execFile = promisify(execute);
const root = join(import.meta.dirname, '../../..');
const workflows = [
  join(root, 'WORKFLOW.md'),
  join(root, 'operator/e2e/WORKFLOW.md')
];

test('repository and E2E WORKFLOW codex.command use only configured Project overrides', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-codex-workflow-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const codex = join(directory, 'codex');
  await writeFile(codex, `#!/bin/sh\nexec node -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' -- "$@"\n`);
  await chmod(codex, 0o755);

  for (const workflow of workflows) {
    const source = await readFile(workflow, 'utf8');
    assert.doesNotMatch(source, /--config\s+model="[^"]+"/);
    assert.doesNotMatch(source, /--config\s+model_reasoning_effort="[^"]+"/);
    const block = source.match(/^  command: \|\n((?:    .*\n)+)/m)?.[1];
    assert.ok(block, `${workflow} codex.command literal block exists`);
    const command = block.split('\n').map(line => line.startsWith('    ') ? line.slice(4) : line).join('\n');

    const launch = async overrides => {
      const result = await execFile('bash', ['-c', `exec ${command}`], {
        env: {
          PATH: `${directory}:${process.env.PATH}`,
          CHATGPT_SHOT_WORKER_INTERFACE_ROOT: directory,
          ...overrides
        }
      });
      return JSON.parse(result.stdout);
    };

    assert.deepEqual(await launch({}), ['app-server']);
    assert.deepEqual(await launch({ SYMPHONY_CODEX_MODEL: 'model with spaces' }), [
      '--config', 'model=model with spaces', 'app-server'
    ]);
    assert.deepEqual(await launch({ SYMPHONY_CODEX_REASONING_EFFORT: 'some-effort' }), [
      '--config', 'model_reasoning_effort=some-effort', 'app-server'
    ]);
    assert.deepEqual(await launch({
      SYMPHONY_CODEX_MODEL: 'selected-model',
      SYMPHONY_CODEX_REASONING_EFFORT: 'selected-effort'
    }), [
      '--config', 'model=selected-model',
      '--config', 'model_reasoning_effort=selected-effort',
      'app-server'
    ]);
  }
});
