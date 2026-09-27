#!/usr/bin/env node
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { basename, extname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readRepositoryEnvironmentValue } from '../local-environment.mjs';

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.woff2', 'font/woff2']
]);

export async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}

function sendJson(response, status, value) {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.end(JSON.stringify(value));
}

async function collect(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function publishPlan({ plan, state, config, root, stateDirectory, publisherConfigPath, notionToken }) {
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const temp = join(stateDirectory, `publish-${randomUUID()}.md`);
  try {
    await writeFile(temp, plan, { mode: 0o600 });
    const args = [join(root, 'operator/notion_publisher/dist/src/cli.js'), '--plan', temp, '--config', publisherConfigPath, '--database-url', config.notion_database_url];
    if (state !== '') args.push('--state', state);
    const env = { ...process.env };
    if (notionToken) env.NOTION_TOKEN = notionToken;
    const publisher = spawn(process.execPath, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env });
    const output = collect(publisher.stdout), errors = collect(publisher.stderr);
    const code = await new Promise((resolveExit, rejectExit) => {
      publisher.once('error', rejectExit);
      publisher.once('close', resolveExit);
    });
    const [stdout, stderr] = await Promise.all([output, errors]);
    if (code !== 0) throw Object.assign(new Error(stderr.trim() || 'Publishing failed.'), { status: 400 });
    try { return JSON.parse(stdout.trim()); }
    catch { throw Object.assign(new Error('Publisher returned a successful response that the Operator could not read. Check Notion Tasks before retrying.'), { status: 502 }); }
  } finally {
    await rm(temp, { force: true });
  }
}

export async function createOperatorUiServer({ root, config, stateDirectory, publisherConfigPath, loadTaskReader, publisherState, notionToken: configuredToken, runPublisher }) {
  const uiDirectory = resolve(root, 'operator/ui/dist');
  const notionToken = configuredToken ?? await readRepositoryEnvironmentValue('NOTION_TOKEN');
  let taskReaderPromise;
  const getTaskReader = async () => {
    if (!taskReaderPromise) {
      taskReaderPromise = Promise.resolve().then(async () => {
        if (!notionToken) throw new Error('missing NOTION_TOKEN: task read requires server-side Notion credentials');
        return loadTaskReader(notionToken);
      }).catch(error => { taskReaderPromise = undefined; throw error; });
    }
    return taskReaderPromise;
  };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    try {
      if (request.method === 'GET' && url.pathname === '/api/v1/config') {
        sendJson(response, 200, {
          states: publisherState.states,
          defaultState: publisherState.defaultState,
          notionTasksUrl: config.notion_database_url,
          dashboardUrl: `http://127.0.0.1:${Number(config.symphony_port || 4100)}`
        });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/tasks') {
        try {
          const reader = await getTaskReader();
          sendJson(response, 200, { tasks: await reader.listTasks() });
        } catch (error) {
          sendJson(response, 503, { error: error instanceof Error ? error.message : 'Task refresh failed.' });
        }
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/publish') {
        let submitted;
        try { submitted = JSON.parse(await readRequestBody(request)); }
        catch { sendJson(response, 400, { error: 'Plan request body must be valid UTF-8 JSON.' }); return; }
        if (!submitted || typeof submitted.plan !== 'string' || typeof submitted.state !== 'string') {
          sendJson(response, 400, { error: 'Plan and publication State must be strings.' });
          return;
        }
        try {
          const publication = await (runPublisher
            ? runPublisher({ plan: submitted.plan, state: submitted.state })
            : publishPlan({ plan: submitted.plan, state: submitted.state, config, root, stateDirectory, publisherConfigPath, notionToken }));
          sendJson(response, 200, publication);
        } catch (error) {
          sendJson(response, error?.status || 500, { error: error instanceof Error ? error.message : 'Publishing failed.' });
        }
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.statusCode = 405;
        response.end();
        return;
      }
      const relativePath = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const filePath = resolve(uiDirectory, relativePath);
      if (filePath !== uiDirectory && !filePath.startsWith(`${uiDirectory}${sep}`)) { response.statusCode = 404; response.end(); return; }
      const body = await readFile(filePath);
      response.statusCode = 200;
      response.setHeader('content-type', MIME_TYPES.get(extname(filePath)) || 'application/octet-stream');
      response.setHeader('cache-control', basename(filePath) === 'index.html' ? 'no-store' : 'public, max-age=31536000, immutable');
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch (error) {
      if (error?.code === 'ENOENT' || error instanceof URIError) { response.statusCode = 404; response.end(); return; }
      if (!response.headersSent) sendJson(response, 500, { error: error instanceof Error ? error.message : 'Operator UI request failed.' });
      else response.destroy(error);
    }
  });
  return server;
}

export async function startOperatorUiServer(options) {
  const server = await createOperatorUiServer(options);
  server.listen(Number(options.config.ui_port || 4310), '127.0.0.1');
  return server;
}

export async function loadPublisherUiState(root) {
  const publisherRoot = join(root, 'operator/notion_publisher');
  const configModule = await import(pathToFileURL(join(publisherRoot, 'dist/src/config.js')).href);
  const core = await import(pathToFileURL(join(publisherRoot, 'dist/src/core.js')).href);
  const { policy } = await configModule.loadConfig(join(publisherRoot, 'examples/publisher-config.json'));
  return { states: policy.stateSeeds, defaultState: core.PUBLISHER_READY_STATE };
}

export async function loadPublisherTaskReader(root, databaseUrl, notionToken) {
  const publisherRoot = join(root, 'operator/notion_publisher');
  const [{ policy }, notionModule, readerModule] = await Promise.all([
    import(pathToFileURL(join(publisherRoot, 'dist/src/config.js')).href).then(configModule => configModule.loadConfig(join(publisherRoot, 'examples/publisher-config.json'))),
    import(pathToFileURL(join(publisherRoot, 'dist/src/notion.js')).href),
    import(pathToFileURL(join(publisherRoot, 'dist/src/task-reader.js')).href)
  ]);
  return new readerModule.NotionTaskReader(new notionModule.NotionClient(notionToken), databaseUrl, policy);
}

export async function defaultOperatorUiDependencies(root, config, stateDirectory) {
  const publisherRoot = join(root, 'operator/notion_publisher');
  const publisherConfigPath = join(publisherRoot, 'examples/publisher-config.json');
  const publisherState = await loadPublisherUiState(root);
  return {
    root,
    config,
    stateDirectory,
    publisherConfigPath,
    publisherState,
    loadTaskReader: notionToken => loadPublisherTaskReader(root, config.notion_database_url, notionToken)
  };
}
