#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { basename, extname, resolve, sep } from 'node:path';
import { githubRepositoryDetails } from './github-repository-url.mjs';
import { openLoopTaskStore } from './local-task-store-runtime.mjs';
import { publishAcceptedPlan } from '../local_task_store/src/local-publisher.mjs';

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.woff2', 'font/woff2']
]);

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const WORKFLOW_STATES = Object.freeze([
  'Backlog', 'Ready', 'In Progress', 'Human Review', 'Rework', 'Merging', 'Done', 'Cancelled'
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

function errorStatus(error) {
  if (error?.status) return error.status;
  if (/^Task not found:/.test(error?.message || '')) return 404;
  if (error instanceof TypeError || /^(a task cannot|publicationKey was already used|Task not found:)/.test(error?.message || '') || /FOREIGN KEY constraint failed/.test(error?.message || '')) return 400;
  return 500;
}

function taskView(task, tasksById) {
  return {
    ...task,
    blockedBy: task.blockedBy.map(taskId => {
      const blocker = tasksById.get(taskId);
      return blocker
        ? { taskId, identifier: blocker.identifier, title: blocker.title, state: blocker.state }
        : { taskId, identifier: taskId, title: taskId, state: 'Unavailable' };
    })
  };
}

function readTask(store, taskId) {
  const task = store.getTask(taskId);
  if (!task) throw Object.assign(new Error(`Task not found: ${taskId}`), { status: 404 });
  return task;
}

function requireString(value, name, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) throw Object.assign(new TypeError(`${name} must be a non-empty string`), { status: 400 });
  return value;
}

function requireTaskIds(value, name) {
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !id.trim())) {
    throw Object.assign(new TypeError(`${name} must be a list of task IDs`), { status: 400 });
  }
  return value;
}

async function requestJson(request) {
  const mediaType = request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json') {
    throw Object.assign(new Error('Content-Type must be application/json.'), { status: 415 });
  }
  try { return JSON.parse(await readRequestBody(request)); }
  catch { throw Object.assign(new Error('Request body must be valid UTF-8 JSON.'), { status: 400 }); }
}

function requireLocalSameOriginMutation(request) {
  const fetchSite = request.headers['sec-fetch-site'];
  if (fetchSite && fetchSite !== 'same-origin') {
    throw Object.assign(new Error('Cross-origin task changes are not allowed.'), { status: 403 });
  }

  const originHeader = request.headers.origin;
  if (!originHeader) return;

  let origin;
  let requestOrigin;
  try {
    origin = new URL(originHeader);
    requestOrigin = new URL(`http://${request.headers.host}`);
  } catch {
    throw Object.assign(new Error('A valid same-origin request is required.'), { status: 403 });
  }

  if (origin.protocol !== 'http:' || !LOOPBACK_HOSTS.has(origin.hostname) || origin.origin !== requestOrigin.origin) {
    throw Object.assign(new Error('Cross-origin task changes are not allowed.'), { status: 403 });
  }
}

export async function createOperatorUiServer({ root, config, stateDirectory, taskStore, managerController, managerToken, managerPort }) {
  const uiDirectory = resolve(root, 'operator/ui/dist');
  const store = taskStore || (!managerController ? await openLoopTaskStore(stateDirectory) : null);

  const server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    try {
      if (managerController) {
        response.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
        response.setHeader('X-Frame-Options', 'DENY');
      }
      if (managerController && request.headers.host !== managerController.expectedHost) {
        throw Object.assign(new Error('Manager requests must use its loopback address.'), { status: 403 });
      }
      if (managerController && url.pathname.startsWith('/api/v1/') && !(await managerController.authorize(request))) {
        throw Object.assign(new Error('Manager authorization failed.'), { status: 403 });
      }
      if (MUTATING_METHODS.has(request.method) && url.pathname.startsWith('/api/v1/')) {
        requireLocalSameOriginMutation(request);
      }
      if (managerController && url.pathname.startsWith('/api/v1/') && await managerController.handleRequest(request, response, url)) return;
      let requestStore = store;
      let requestConfig = config;
      if (managerController && url.pathname.startsWith('/api/v1/')) {
        const isTaskRoute = url.pathname === '/api/v1/config'
          || url.pathname === '/api/v1/tasks'
          || url.pathname === '/api/v1/publish'
          || /^\/api\/v1\/tasks\/[^/]+(?:\/(?:state|blocked-by|comments))?$/.test(url.pathname);
        if (isTaskRoute) {
          const instanceId = request.headers['x-leesh-loop-instance-id'];
          if (typeof instanceId !== 'string' || !instanceId) throw Object.assign(new Error('Select a Loop instance before using the Operator.'), { status: 400 });
          const context = await managerController.resolveTaskContext(instanceId);
          requestStore = context.store;
          requestConfig = context.config;
        }
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/config') {
        const repository = githubRepositoryDetails(requestConfig.github_repository_url);
        sendJson(response, 200, {
          states: WORKFLOW_STATES,
          defaultState: 'Ready',
          githubRepositoryIdentity: repository.identity,
          githubRepositoryName: repository.name,
          githubBrowserRepositoryUrl: repository.browserRepositoryUrl
        });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/tasks') {
        const tasks = requestStore.listTasks();
        const tasksById = new Map(tasks.map(task => [task.id, task]));
        sendJson(response, 200, { tasks: tasks.map(task => taskView(task, tasksById)) });
        return;
      }
      const taskRoute = url.pathname.match(/^\/api\/v1\/tasks\/([^/]+)(?:\/(state|blocked-by|comments))?$/);
      if (taskRoute) {
        let taskId;
        try { taskId = decodeURIComponent(taskRoute[1]); }
        catch { throw Object.assign(new Error('Task ID is malformed.'), { status: 400 }); }
        const operation = taskRoute[2];
        if (request.method === 'GET' && !operation) {
          const task = readTask(requestStore, taskId);
          sendJson(response, 200, {
            task,
            workpad: requestStore.listRecords(taskId, { kind: 'workpad' }),
            comments: requestStore.listRecords(taskId, { kind: 'comment' })
          });
          return;
        }
        if (request.method === 'PUT' && operation === 'state') {
          const submitted = await requestJson(request);
          const state = requireString(submitted?.state, 'State');
          const task = requestStore.updateTask(taskId, { state });
          sendJson(response, 200, { task });
          return;
        }
        if (request.method === 'PUT' && operation === 'blocked-by') {
          const submitted = await requestJson(request);
          const blockedBy = requireTaskIds(submitted?.blockedBy, 'Blocked By');
          requestStore.setBlockedBy(taskId, blockedBy);
          sendJson(response, 200, { task: readTask(requestStore, taskId) });
          return;
        }
        if (request.method === 'POST' && operation === 'comments') {
          const submitted = await requestJson(request);
          const content = requireString(submitted?.content, 'Comment');
          const comment = requestStore.appendComment(taskId, content, 'user');
          sendJson(response, 201, { comment });
          return;
        }
        throw Object.assign(new Error('Method not allowed.'), { status: 405 });
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/publish') {
        const submitted = await requestJson(request);
        const plan = requireString(submitted?.plan, 'Plan');
        const state = requireString(submitted?.state, 'State');
        const blockedBy = submitted?.blockedBy === undefined ? [] : requireTaskIds(submitted.blockedBy, 'Blocked By');
        const publication = publishAcceptedPlan(requestStore, plan, { state, blockedBy });
        sendJson(response, 201, {
          identifier: publication.identifier,
          page_id: publication.page_id,
          state: publication.state,
          task: publication.task
        });
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
      let body = await readFile(filePath);
      if (managerController && basename(filePath) === 'index.html' && managerToken) {
        body = Buffer.from(body.toString('utf8').replace('content="__LEESH_LOOP_MANAGER_TOKEN__"', `content="${managerToken}"`).replace('content="__LEESH_LOOP_MANAGER_PORT__"', `content="${managerPort}"`));
      }
      response.statusCode = 200;
      response.setHeader('content-type', MIME_TYPES.get(extname(filePath)) || 'application/octet-stream');
      response.setHeader('cache-control', basename(filePath) === 'index.html' ? 'no-store' : 'public, max-age=31536000, immutable');
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch (error) {
      if (error?.code === 'ENOENT' || error instanceof URIError) { response.statusCode = 404; response.end(); return; }
      if (!response.headersSent) sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : 'Operator UI request failed.' });
      else response.destroy(error);
    }
  });
  server.once('close', () => {
    if (managerController) managerController.closeTaskStores();
    else if (!taskStore) store.close();
  });
  return server;
}

export async function startOperatorUiServer(options) {
  const server = await createOperatorUiServer(options);
  server.listen(Number(options.config.ui_port || 4310), '127.0.0.1');
  return server;
}

export async function defaultOperatorUiDependencies(root, config, stateDirectory) {
  return { root, config, stateDirectory };
}
