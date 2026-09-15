import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { openProjectSurfaces } from '../leesh-loop.mjs';

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

test('the system browser path dispatches every project surface before bounded acknowledgement', { concurrency: false }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-browser-'));
  const bin = join(directory, 'bin');
  const log = join(directory, 'openers.log');
  await writeFile(join(directory, 'xdg-open'), `#!/bin/sh\nprintf 'xdg-open %s\\n' "$1" >> "$LEESH_LOOP_TEST_LOG"\ncase "$1" in *hang*) sleep 2;; *failure*) exit 7;; *signal*) kill -TERM $$;; esac\n`);
  await writeFile(join(directory, 'override'), `#!/bin/sh\nprintf 'override %s\\n' "$*" >> "$LEESH_LOOP_TEST_LOG"\n`);
  await mkdir(bin);
  // The executable names deliberately contain neither Chrome nor Chromium.
  await writeFile(join(bin, 'xdg-open'), await readFile(join(directory, 'xdg-open')));
  await writeFile(join(bin, 'override'), await readFile(join(directory, 'override')));
  await Promise.all([chmod(join(bin, 'xdg-open'), 0o755), chmod(join(bin, 'override'), 0o755)]);
  const originalPath = process.env.PATH;
  const originalLog = process.env.LEESH_LOOP_TEST_LOG;
  const originalOverride = process.env.LEESH_LOOP_BROWSER_COMMAND;
  process.env.PATH = `${bin}:${originalPath}`;
  process.env.LEESH_LOOP_TEST_LOG = log;
  delete process.env.LEESH_LOOP_BROWSER_COMMAND;
  t.after(() => {
    process.env.PATH = originalPath;
    if (originalLog === undefined) delete process.env.LEESH_LOOP_TEST_LOG; else process.env.LEESH_LOOP_TEST_LOG = originalLog;
    if (originalOverride === undefined) delete process.env.LEESH_LOOP_BROWSER_COMMAND; else process.env.LEESH_LOOP_BROWSER_COMMAND = originalOverride;
  });
  const base = { notion_database_url: 'https://notion.example/surface', ui_port: 43444, browser_acknowledgement_timeout_ms: 80 };
  const started = Date.now();
  await openProjectSurfaces({ ...base, ui_port: 43445 }, 'http://dashboard.example/hang');
  assert.ok(Date.now() - started < 500, 'a running xdg-open is a successful handoff after the acknowledgement bound');
  let lines = (await readFile(log, 'utf8')).trim().split('\n');
  assert.deepEqual(lines.sort(), [
    'xdg-open http://127.0.0.1:43445',
    'xdg-open http://dashboard.example/hang',
    'xdg-open https://notion.example/surface'
  ].sort());
  await assert.rejects(openProjectSurfaces({ ...base, notion_database_url: 'https://notion.example/failure' }, 'http://dashboard.example'), /exited with status 7/);
  await assert.rejects(openProjectSurfaces({ ...base, notion_database_url: 'https://notion.example/signal' }, 'http://dashboard.example'), /terminated by SIGTERM/);
  process.env.PATH = directory;
  await assert.rejects(openProjectSurfaces(base, 'http://dashboard.example'), /could not launch xdg-open/);
  process.env.PATH = `${bin}:${originalPath}`;
  process.env.LEESH_LOOP_BROWSER_COMMAND = 'override';
  await openProjectSurfaces(base, 'http://dashboard.example');
  for (let attempt = 0; attempt < 20; attempt += 1) {
    lines = (await readFile(log, 'utf8')).trim().split('\n');
    if (lines.some(line => line.startsWith('override '))) break;
    await new Promise(done => setTimeout(done, 10));
  }
  lines = (await readFile(log, 'utf8')).trim().split('\n');
  assert.equal(lines.filter(line => line.startsWith('override ')).length, 1);
  assert.match(lines.at(-1), /override http:\/\/127\.0\.0\.1:43444 https:\/\/notion\.example\/surface http:\/\/dashboard\.example/);
});
