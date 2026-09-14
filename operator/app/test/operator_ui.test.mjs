import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';

const root = resolve(import.meta.dirname, '../../..');
const cli = join(root, 'operator/app/leesh-loop.mjs');

test('the publish surface exposes the configured external links without custom styling', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-ui-'));
  const port = 43_500 + Math.floor(Math.random() * 500);
  const config = join(directory, 'project.json');
  await writeFile(config, JSON.stringify({
    workflow_path: join(root, 'WORKFLOW.md'),
    notion_database_url: 'https://www.notion.so/example',
    symphony_workspace_root: join(directory, 'workspaces'),
    ui_port: port
  }));
  const child = spawn(process.execPath, [cli, 'serve', config], { stdio: 'ignore' });
  t.after(() => child.kill('SIGTERM'));
  let response;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { response = await fetch(`http://127.0.0.1:${port}`); break; } catch { await new Promise(done => setTimeout(done, 50)); }
  }
  assert.equal(response?.status, 200);
  const page = await response.text();
  assert.match(page, /Leesh Loop Publish/);
  assert.match(page, /https:\/\/www.notion.so\/example/);
  assert.match(page, /Symphony Dashboard/);
  assert.doesNotMatch(page, /<style|stylesheet/i);
});
