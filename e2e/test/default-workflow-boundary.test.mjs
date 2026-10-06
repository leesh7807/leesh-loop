import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('default E2E workspace bootstrap keeps Mix and Hex setup inside the worker workspace', async () => {
  const workflow = await readFile(join(root, 'WORKFLOW.md'), 'utf8');
  const hook = workflow.match(/hooks:\n  after_create: \|\n([\s\S]*?)\nagent:/)?.[1] || '';
  assert.match(hook, /MIX_HOME="\$symphony_dir\/\.mix"/);
  assert.match(hook, /MIX_ARCHIVES="\$MIX_HOME\/archives"/);
  assert.match(hook, /HEX_HOME="\$symphony_dir\/\.hex"/);
  assert.match(hook, /git rev-parse --git-path info\/exclude/);
  assert.match(hook, /operator\/symphony\/\.mix\/.*operator\/symphony\/\.hex\//);
  assert.match(hook, /mix local\.hex --if-missing --force && mix local\.rebar --if-missing --force && mix deps\.get/);
  assert.doesNotMatch(hook, /\bmise\b/);
  assert.match(hook, /node operator\/app\/workspace-files\.mjs/);
});

test('worker E2E requests and root npm script resolve to the same harness entry point', async () => {
  const [workflow, packageText] = await Promise.all([
    readFile(join(root, 'WORKFLOW.md'), 'utf8'),
    readFile(join(root, '..', 'package.json'), 'utf8')
  ]);
  assert.match(workflow, /request the repository-owned boundary with\n`npm run e2e`/);
  assert.equal(JSON.parse(packageText).scripts.e2e, 'node e2e/cli.mjs run');
  assert.doesNotMatch(workflow, /node operator\/app\/leesh-loop\.mjs start|operator\/symphony\/mix run/);
});

test('default workflow keeps recovery Workpad entries focused on task outcomes', async () => {
  const workflow = await readFile(join(root, 'WORKFLOW.md'), 'utf8');
  assert.match(workflow, /Keep Workpad entries focused on repository work, verification, delivery, blockers, and recovery/);
  assert.match(workflow, /Do not explain invocation mechanics or mention\s+internal coordination refs or harness logging there/);
});
