import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile as execute } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const execFile = promisify(execute);
const root = join(import.meta.dirname, '../../..');
const worker = join(root, 'operator/external/chatgpt-shot/chatgpt-shot');
const id = '123e4567-e89b-42d3-a456-426614174000';

test('worker-facing chatgpt-shot exposes async submission and Job snapshots', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-chatgpt-shot-worker-'));
  const discovery = join(directory, 'runtime.json');
  const requests = [];
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => body += chunk);
    request.on('end', () => {
      requests.push({ method: request.method, url: request.url, body, authorization: request.headers.authorization });
      response.setHeader('content-type', 'application/json');
      if (request.method === 'POST' && request.url === '/jobs') {
        response.writeHead(200);
        response.end(JSON.stringify({ id }));
        return;
      }
      if (request.method === 'GET' && request.url === `/jobs/${id}`) {
        response.writeHead(200);
        response.end(JSON.stringify({ id, state: 'completed', result: '# Verdict\n\nPASS', error: null }));
        return;
      }
      response.writeHead(404);
      response.end(JSON.stringify({ code: 'NOT_FOUND', message: 'not found' }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await writeFile(discovery, JSON.stringify({ host: '127.0.0.1', port: address.port, credential: 'fixture-credential' }));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });

  const env = { ...process.env, CHATGPT_SHOT_WORKER_DISCOVERY_PATH: discovery };
  const submitted = await execFile(worker, ['submit', 'review this exact HEAD'], { env });
  assert.equal(submitted.stdout, `${id}\n`);
  const snapshot = await execFile(worker, ['jobs', id], { env });
  assert.deepEqual(JSON.parse(snapshot.stdout), { id, state: 'completed', result: '# Verdict\n\nPASS', error: null });
  assert.deepEqual(requests, [
    { method: 'POST', url: '/jobs', body: JSON.stringify({ prompt: 'review this exact HEAD' }), authorization: 'Bearer fixture-credential' },
    { method: 'GET', url: `/jobs/${id}`, body: '', authorization: 'Bearer fixture-credential' }
  ]);
});

test('worker-facing chatgpt-shot rejects unsupported commands and invalid Job IDs', async () => {
  await assert.rejects(execFile(worker, ['doctor']), error => error.code === 2 && /Usage:/.test(error.stderr));
  await assert.rejects(execFile(worker, ['jobs', 'not-a-uuid']), error => error.code === 2 && /jobs <job-id>/.test(error.stderr));
});
