import { spawn } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { constants, readFileSync } from 'node:fs';
import { lstat, open, readFile, truncate, unlink } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { applyInstanceWorkflow, managerPaths, ensurePrivateDirectory, getLoopInstance, listLoopInstances, readInstanceWorkflow, readJsonFile, resolveManagedProject, unregisterLoopInstance, validateManagedInstanceStateDirectory, writeAtomic, writeAtomicJson } from './manager-storage.mjs';
import { discoverRunningLoops, loopInstanceStatus, readLoopLogs, readProjectWorkerSettings, startLoopInstance, stopLoopInstance, updateProjectWorkerSettings } from './manager-lifecycle.mjs';
import { activeRuntime, currentRuntimeSource, inspectRuntimeSource, installRuntimeDistribution, installRuntimeDistributionInWorker, listRuntimeDistributions, managerMustRestartForRuntime, reconcileRuntimeRecoveryRecord, recordRuntimeSource, runtimeDiagnostic } from './runtime-distribution.mjs';
import { openLoopTaskStore } from './local-task-store-runtime.mjs';
import { readProjectConfiguration } from '../project-config.mjs';
import { createOperatorUiServer } from './operator-ui-server.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const browserLaunchAckTimeoutMs = 1_000;

function processStartTicks(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/)[19] || null;
  } catch { return null; }
}

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === 'EPERM'; }
}

function respond(response, status, value) {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.end(JSON.stringify(value));
}

async function requestJson(request) {
  const mediaType = request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json') throw Object.assign(new Error('Content-Type must be application/json.'), { status: 415 });
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw Object.assign(new Error('Request body is too large.'), { status: 413 });
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw Object.assign(new Error('Request body must be valid UTF-8 JSON.'), { status: 400 }); }
}

function requireRepositoryPath(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || !isAbsolute(value)) {
    throw Object.assign(new Error('Repository path must be an absolute local path.'), { status: 400 });
  }
  return value;
}

function requireInstanceId(value) {
  if (typeof value !== 'string' || !idPattern.test(value)) throw Object.assign(new Error('Instance ID is invalid.'), { status: 400 });
  return value;
}

function projectSettingsSelector(url) {
  const allowed = new Set(['projectName', 'repositoryPath']);
  if ([...url.searchParams.keys()].some(key => !allowed.has(key))) {
    throw Object.assign(new Error('Use only projectName or repositoryPath to select a managed project.'), { status: 400 });
  }
  const names = url.searchParams.getAll('projectName');
  const paths = url.searchParams.getAll('repositoryPath');
  if (names.length + paths.length !== 1 || names.length > 1 || paths.length > 1) {
    throw Object.assign(new Error('Select one project by repository name or repository path.'), { status: 400 });
  }
  if (names.length) {
    const projectName = names[0];
    if (!projectName.trim()) throw Object.assign(new Error('Project name must be non-empty.'), { status: 400 });
    return { repositoryName: projectName };
  }
  const repositoryPath = paths[0];
  if (!repositoryPath.trim() || repositoryPath.includes('\0') || !isAbsolute(repositoryPath)) {
    throw Object.assign(new Error('Repository path must be an absolute local path.'), { status: 400 });
  }
  return { repositoryPath };
}

async function ensureManagerToken(paths) {
  await ensurePrivateDirectory(paths.managerStateRoot);
  try {
    const details = await lstat(paths.managerApiMaster);
    if (details.isSymbolicLink() || !details.isFile()) throw new Error('Manager API master path must be a regular file');
    if ((details.mode & 0o077) !== 0) throw new Error('Manager API master permissions must be restricted to the current user');
    const token = (await readFile(paths.managerApiMaster, 'utf8')).trim();
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Manager token is invalid');
    return token;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const token = randomBytes(32).toString('hex');
  let file;
  try { file = await open(paths.managerApiMaster, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600); }
  catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    return (await readFile(paths.managerApiMaster, 'utf8')).trim();
  }
  try { await file.writeFile(`${token}\n`); await file.sync(); }
  finally { await file.close(); }
  return token;
}

async function legacyManagerToken(paths) {
  try {
    const details = await lstat(paths.managerToken);
    if (details.isSymbolicLink() || !details.isFile()) throw new Error('Legacy Manager token path must be a regular file');
    if ((details.mode & 0o077) !== 0) throw new Error('Legacy Manager token permissions must be restricted to the current user');
    const token = (await readFile(paths.managerToken, 'utf8')).trim();
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Legacy Manager token is invalid');
    return token;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export function managerApiToken(masterToken, runtimeId) {
  return createHmac('sha256', masterToken).update(`leesh-loop-manager-api:v1:${runtimeId}`).digest('hex');
}

export async function readManagerConfiguration(options = {}) {
  const paths = managerPaths(options);
  await ensurePrivateDirectory(paths.configRoot);
  let config = await readJsonFile(paths.managerConfiguration, 'Manager configuration');
  if (!config) {
    config = { schema_version: 1, port: 4320, symphony_port_min: 4100, symphony_port_max: 4199 };
    await writeAtomicJson(paths.managerConfiguration, config);
  }
  if (config.schema_version !== 1
    || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535
    || !Number.isInteger(config.symphony_port_min) || !Number.isInteger(config.symphony_port_max)
    || config.symphony_port_min < 1 || config.symphony_port_max > 65535 || config.symphony_port_min > config.symphony_port_max
    || (config.port >= config.symphony_port_min && config.port <= config.symphony_port_max)) {
    throw new Error('Manager configuration is invalid');
  }
  return config;
}

function equalToken(received, expected) {
  if (typeof received !== 'string') return false;
  const first = Buffer.from(received);
  const second = Buffer.from(expected);
  return first.length === second.length && timingSafeEqual(first, second);
}

export function createManagerController({ runtimeRoot, token, port, sourceRoot = process.env.LEESH_LOOP_RUNTIME_SOURCE || runtimeRoot, environment = process.env, homeDirectory = homedir(), lifecycle = {}, runtimeInstaller = installRuntimeDistributionInWorker, taskStoreOpener = openLoopTaskStore } = {}) {
  const runtime = resolve(runtimeRoot);
  const paths = managerPaths({ environment, homeDirectory });
  const taskStores = new Map();
  let taskStoresClosed = false;
  let taskStoresClosePromise = null;
  let startQueue = Promise.resolve();
  let runtimeUpdateQueue = Promise.resolve();
  const lifecycleQueues = new Map();
  let registryQueue = Promise.resolve();
  const unregisteringInstances = new Set();
  const activeTaskOperations = new Map();
  const taskOperationWaiters = new Map();

  function serializeLifecycle(id, operation) {
    const previous = lifecycleQueues.get(id) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    lifecycleQueues.set(id, current);
    return current.finally(() => {
      if (lifecycleQueues.get(id) === current) lifecycleQueues.delete(id);
    });
  }

  function serializeRuntimeUpdate(operation) {
    const current = runtimeUpdateQueue.catch(() => {}).then(operation);
    runtimeUpdateQueue = current.catch(() => {});
    return current;
  }

  function lifecycleStatusOptions() {
    return {
      environment,
      homeDirectory,
      isLifecycleOperationActive: id => lifecycleQueues.has(id),
      persistObservedStatus: false
    };
  }

  function taskContext(id) {
    if (taskStoresClosed) return Promise.reject(new Error('Manager Task Stores are closing.'));
    let context = taskStores.get(id);
    if (!context) {
      context = (async () => {
        const instance = await getLoopInstance(id, { environment, homeDirectory });
        const config = await readProjectConfiguration(instance.project_file, { validateWorkspaceFileSources: true, homeDirectory });
        const stateDirectory = await validateManagedInstanceStateDirectory(instance, config);
        const store = await taskStoreOpener(stateDirectory);
        const configurationFingerprint = JSON.stringify({ state_directory: config.state_directory, github_repository_url: config.github_repository_url });
        return { instance, config, store, configurationFingerprint };
      })();
      taskStores.set(id, context);
      void context.catch(() => {
        if (taskStores.get(id) === context) taskStores.delete(id);
      });
    }
    return context.then(async initialized => {
      const currentConfig = await readProjectConfiguration(initialized.instance.project_file, { homeDirectory });
      await validateManagedInstanceStateDirectory(initialized.instance, currentConfig);
      const currentFingerprint = JSON.stringify({ state_directory: currentConfig.state_directory, github_repository_url: currentConfig.github_repository_url });
      if (currentFingerprint !== initialized.configurationFingerprint) {
        throw Object.assign(new Error('Instance project.toml changed after its Task Store was opened. Restart the Manager to reload this instance configuration.'), { status: 409 });
      }
      return initialized;
    });
  }

  function releaseTaskOperation(id) {
    const remaining = (activeTaskOperations.get(id) || 1) - 1;
    if (remaining > 0) {
      activeTaskOperations.set(id, remaining);
      return;
    }
    activeTaskOperations.delete(id);
    const waiters = taskOperationWaiters.get(id);
    taskOperationWaiters.delete(id);
    for (const resolveWaiter of waiters || []) resolveWaiter();
  }

  async function acquireTaskContext(id) {
    if (unregisteringInstances.has(id)) throw Object.assign(new Error('This Loop is being unregistered from Manager.'), { status: 409 });
    activeTaskOperations.set(id, (activeTaskOperations.get(id) || 0) + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      releaseTaskOperation(id);
    };
    try { return { ...(await taskContext(id)), release }; }
    catch (error) { release(); throw error; }
  }

  function waitForTaskOperations(id) {
    if (!activeTaskOperations.has(id)) return Promise.resolve();
    return new Promise(resolveWaiter => {
      const waiters = taskOperationWaiters.get(id) || new Set();
      waiters.add(resolveWaiter);
      taskOperationWaiters.set(id, waiters);
    });
  }

  async function unregisterInstance(id) {
    if (unregisteringInstances.has(id)) throw Object.assign(new Error('This Loop is already being unregistered.'), { status: 409 });
    if (lifecycleQueues.has(id)) throw Object.assign(new Error('Wait for the current Loop management action to finish before unregistering it.'), { status: 409 });
    unregisteringInstances.add(id);
    try {
      const instance = await getLoopInstance(id, { environment, homeDirectory });
      const status = await loopInstanceStatus(id, lifecycleStatusOptions());
      const processAbsenceConfirmed = status.status === 'Failed' && status.process_absence_confirmed === true;
      if (status.status !== 'Stopped' && !processAbsenceConfirmed) {
        throw Object.assign(new Error(`Stop this Loop or wait until Manager confirms a Failed Loop has no active processes before unregistering it. Current status: ${status.status}${status.detail ? ` — ${status.detail}` : ''}`), { status: 409 });
      }
      if (lifecycleQueues.has(id)) throw Object.assign(new Error('A Loop management action started before unregistration could complete. Retry after it finishes.'), { status: 409 });
      await waitForTaskOperations(id);
      const cached = taskStores.get(id);
      if (cached) {
        const initialized = await cached;
        await initialized.store.close();
        if (taskStores.get(id) === cached) taskStores.delete(id);
      }
      const operation = registryQueue.then(() => unregisterLoopInstance(id, { environment, homeDirectory }));
      registryQueue = operation.catch(() => {});
      const unregistered = await operation;
      return {
        instance: {
          ...unregistered,
          project_file: instance.project_file,
          state_directory: instance.state_directory,
          workspace_root: instance.workspace_root
        },
        repository_preserved: true,
        data_preserved: true
      };
    } finally { unregisteringInstances.delete(id); }
  }

  function closeTaskStores() {
    if (taskStoresClosePromise) return taskStoresClosePromise;
    taskStoresClosed = true;
    const pending = [...taskStores.values()];
    taskStores.clear();
    taskStoresClosePromise = (async () => {
      const initialized = await Promise.allSettled(pending);
      const stores = initialized.filter(result => result.status === 'fulfilled').map(result => result.value.store);
      const closed = await Promise.allSettled(stores.map(store => Promise.resolve().then(() => store.close())));
      const failures = closed.filter(result => result.status === 'rejected').map(result => result.reason);
      if (failures.length) throw new AggregateError(failures, 'One or more Manager Task Stores could not be closed.');
    })();
    return taskStoresClosePromise;
  }

  async function latestSourceRoot() {
    return currentRuntimeSource(sourceRoot, { environment, homeDirectory });
  }

  async function handleRequest(request, response, url) {
    const configuration = await readManagerConfiguration({ environment, homeDirectory });
    const pathname = url.pathname;
    if (pathname === '/api/v1/manager' && request.method === 'GET') {
      const active = await activeRuntime({ environment, homeDirectory });
      const service = await readJsonFile(paths.managerServiceRecord, 'Manager service record');
      respond(response, 200, { status: 'Running', port, runtime: active, manager_runtime_version: service?.runtime_version || null });
      return true;
    }
    if (pathname === '/api/v1/instances' && request.method === 'GET') {
      respond(response, 200, { instances: await discoverRunningLoops(lifecycleStatusOptions()) });
      return true;
    }
    if (pathname === '/api/v1/instances' && request.method === 'POST') {
      const submitted = await requestJson(request);
      const operation = registryQueue.then(async () => (await import('./manager-storage.mjs')).createLoopInstance(requireRepositoryPath(submitted?.repositoryPath), {
          sourceRoot: await latestSourceRoot(),
          environment,
          homeDirectory
        }));
      registryQueue = operation.catch(() => {});
      const instance = await operation;
      respond(response, 201, { instance });
      return true;
    }
    if (pathname === '/api/v1/project-worker-settings') {
      const selector = projectSettingsSelector(url);
      const instance = await resolveManagedProject(selector, { environment, homeDirectory });
      if (request.method === 'GET') {
        respond(response, 200, await readProjectWorkerSettings(instance.id, lifecycleStatusOptions()));
        return true;
      }
      if (request.method === 'PUT') {
        if (unregisteringInstances.has(instance.id)) throw Object.assign(new Error('This Loop is being unregistered from Manager.'), { status: 409 });
        const submitted = await requestJson(request);
        if (unregisteringInstances.has(instance.id)) throw Object.assign(new Error('This Loop is being unregistered from Manager.'), { status: 409 });
        const result = await serializeLifecycle(instance.id, () => updateProjectWorkerSettings(instance.id, submitted, { environment, homeDirectory }));
        respond(response, 200, result);
        return true;
      }
      throw Object.assign(new Error('Method not allowed.'), { status: 405 });
    }
    const instanceRoute = pathname.match(/^\/api\/v1\/instances\/([^/]+)(?:\/(start|stop|logs|workflow))?$/);
    if (instanceRoute) {
      let id;
      try { id = requireInstanceId(decodeURIComponent(instanceRoute[1])); }
      catch (error) { throw error; }
      const action = instanceRoute[2];
      if (request.method === 'DELETE' && !action) {
        const result = await unregisterInstance(id);
        respond(response, 200, result);
        return true;
      }
      if (request.method === 'POST' && action === 'start') {
        if (unregisteringInstances.has(id)) throw Object.assign(new Error('This Loop is being unregistered from Manager.'), { status: 409 });
        const operation = serializeLifecycle(id, () => {
          const startOperation = startQueue.then(() => (lifecycle.start || startLoopInstance)(id, {
            runtimeSource: sourceRoot,
            minPort: configuration.symphony_port_min,
            maxPort: configuration.symphony_port_max,
            environment,
            homeDirectory
          }));
          startQueue = startOperation.catch(() => {});
          return startOperation;
        });
        respond(response, 202, { instance: await operation });
        return true;
      }
      if (request.method === 'POST' && action === 'stop') {
        if (unregisteringInstances.has(id)) throw Object.assign(new Error('This Loop is being unregistered from Manager.'), { status: 409 });
        const operation = serializeLifecycle(id, () => (lifecycle.stop || stopLoopInstance)(id, { environment, homeDirectory }));
        respond(response, 200, { instance: await operation });
        return true;
      }
      if (request.method === 'GET' && action === 'logs') {
        respond(response, 200, await readLoopLogs(id, { environment, homeDirectory }));
        return true;
      }
      if (request.method === 'GET' && action === 'workflow') {
        respond(response, 200, await readInstanceWorkflow(id, { sourceRoot: await latestSourceRoot(), environment, homeDirectory }));
        return true;
      }
      if (request.method === 'PUT' && action === 'workflow') {
        if (unregisteringInstances.has(id)) throw Object.assign(new Error('This Loop is being unregistered from Manager.'), { status: 409 });
        const submitted = await requestJson(request);
        if (submitted?.confirm !== true) throw Object.assign(new Error('Workflow update requires explicit confirmation.'), { status: 400 });
        if (unregisteringInstances.has(id)) throw Object.assign(new Error('This Loop is being unregistered from Manager.'), { status: 409 });
        const operation = serializeLifecycle(id, async () => (lifecycle.updateWorkflow || applyInstanceWorkflow)(id, {
            expectedCurrent: submitted?.expectedCurrent,
            expectedCandidateDigest: submitted?.expectedCandidateDigest,
            sourceRoot: await latestSourceRoot(),
            isRunning: lifecycle.isRunning || (async instanceId => {
              const status = await loopInstanceStatus(instanceId, { environment, homeDirectory });
              return status.status !== 'Stopped' && status.can_update_workflow !== true;
            }),
            environment,
            homeDirectory
          }));
        const result = await operation;
        respond(response, 200, result);
        return true;
      }
      if (!action && request.method === 'GET') {
        const instances = await listLoopInstances({ environment, homeDirectory });
        const record = instances.find(value => value.id === id);
        if (!record) throw Object.assign(new Error('Loop instance was not found.'), { status: 404 });
        respond(response, 200, { instance: { ...record, ...(await loopInstanceStatus(id, lifecycleStatusOptions())) } });
        return true;
      }
      throw Object.assign(new Error('Method not allowed.'), { status: 405 });
    }
    if (pathname === '/api/v1/runtime' && request.method === 'GET') {
      let active = null;
      let activeError = null;
      try { active = await activeRuntime({ environment, homeDirectory }); }
      catch (error) { activeError = runtimeDiagnostic(error); }
      const service = await readJsonFile(paths.managerServiceRecord, 'Manager service record');
      const source = await latestSourceRoot().then(sourceRootPath => inspectRuntimeSource(sourceRootPath)).catch(error => ({ error: error.message }));
      const recovery = await reconcileRuntimeRecoveryRecord({ environment, homeDirectory });
      const managerRestartRequired = service?.manager_restart_required === true || (active ? service?.runtime_version !== active.id : false);
      respond(response, 200, {
        active,
        active_error: activeError,
        last_recovery: recovery.record,
        recovery_error: recovery.error,
        source,
        distributions: await listRuntimeDistributions({ environment, homeDirectory }),
        manager_runtime_version: service?.runtime_version || null,
        manager_restart_required: managerRestartRequired
      });
      return true;
    }
    if (pathname === '/api/v1/runtime/update' && request.method === 'POST') {
      const result = await serializeRuntimeUpdate(async () => {
        let previous = null;
        let previousRuntimeInvalid = false;
        let previousRuntimeError = null;
        try { previous = await activeRuntime({ environment, homeDirectory }); }
        catch (error) {
          previousRuntimeInvalid = true;
          previousRuntimeError = runtimeDiagnostic(error);
        }
        const service = await readJsonFile(paths.managerServiceRecord, 'Manager service record');
        const updated = await runtimeInstaller(await latestSourceRoot(), { environment, homeDirectory });
        const managerRestartRequired = service?.manager_restart_required === true || managerMustRestartForRuntime(service?.runtime_version, updated);
        if (managerRestartRequired && service) {
          await writeAtomicJson(paths.managerServiceRecord, { ...service, manager_restart_required: true });
        }
        const recovery = await reconcileRuntimeRecoveryRecord({ environment, homeDirectory });
        const recoveryRecord = previousRuntimeInvalid || updated.recovered_from_invalid_active === true || updated.repaired_distribution === true
          ? recovery.record
          : null;
        return {
          previous,
          active: updated,
          changed: updated.changed,
          recovered_from_invalid_active: previousRuntimeInvalid || updated.recovered_from_invalid_active === true,
          active_runtime_error: previousRuntimeError || updated.previous_active_error || null,
          repaired_distribution: updated.repaired_distribution === true,
          preserved_runtime_path: recoveryRecord?.preserved_runtime_path || updated.preserved_runtime_path || null,
          last_recovery: recoveryRecord,
          recovery_error: recovery.error,
          manager_runtime_version: service?.runtime_version || null,
          manager_restart_required: managerRestartRequired
        };
      });
      respond(response, 200, result);
      return true;
    }
    if (pathname === '/api/v1/manager/restart' && request.method === 'POST') {
      respond(response, 202, { accepted: true, detail: 'Restart the Manager with the leesh-loop command after the response completes.' });
      const restart = setTimeout(() => process.kill(process.pid, 'SIGTERM'), 300);
      restart.unref();
      return true;
    }
    return false;
  }

  return {
    token,
    expectedHost: `127.0.0.1:${port}`,
    async authorize(request) {
      if (request.headers.host !== `127.0.0.1:${port}`) return false;
      if (!equalToken(request.headers['x-leesh-loop-token'], token)) return false;
      if (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin') return false;
      const origin = request.headers.origin;
      if (origin) {
        try { if (new URL(origin).origin !== `http://127.0.0.1:${port}`) return false; }
        catch { return false; }
      }
      return true;
    },
    async resolveTaskContext(id) { return taskContext(id); },
    acquireTaskContext,
    handleRequest,
    closeTaskStores
  };
}

export async function startManagerServer({ runtimeRoot, environment = process.env, homeDirectory = homedir() } = {}) {
  const paths = managerPaths({ environment, homeDirectory });
  const config = await readManagerConfiguration({ environment, homeDirectory });
  const masterToken = await ensureManagerToken(paths);
  const runtime = resolve(runtimeRoot || fileURLToPath(new URL('../..', import.meta.url)));
  const active = await activeRuntime({ environment, homeDirectory });
  if (!active || resolve(active.path) !== runtime) throw new Error('Manager must run from the active central Runtime distribution');
  const token = managerApiToken(masterToken, active.id);
  const controller = createManagerController({ runtimeRoot: runtime, token, port: config.port, environment, homeDirectory });
  const dependencies = { root: runtime, managerController: controller };
  const server = await createOperatorUiServer(dependencies);
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(config.port, '127.0.0.1', resolveListen);
  });
  const ticks = processStartTicks(process.pid);
  if (!ticks) {
    server.close();
    throw new Error(`could not record Manager process identity for PID ${process.pid}`);
  }
  await ensurePrivateDirectory(paths.managerStateRoot);
  await writeAtomicJson(paths.managerServiceRecord, {
    schema_version: 1,
    pid: process.pid,
    process_start_ticks: ticks,
    host: '127.0.0.1',
    port: config.port,
    runtime_path: runtime,
    runtime_version: active?.id ?? null,
    started_at: new Date().toISOString()
  });
  server.once('close', () => {
    void controller.closeTaskStores().catch(error => console.error('Manager Task Store shutdown failed:', error));
  });
  return { server, url: `http://127.0.0.1:${config.port}`, token, record: paths.managerServiceRecord };
}

async function managerHealth(baseUrl, token) {
  try {
    const response = await fetch(`${baseUrl}/api/v1/manager`, { headers: { 'x-leesh-loop-token': token }, signal: AbortSignal.timeout(1000) });
    if (!response.ok) return null;
    return await response.json();
  } catch { return null; }
}

export function managerBrowserBootstrapHtml(baseUrl, token) {
  const browserUrl = new URL(baseUrl);
  browserUrl.hash = new URLSearchParams({ 'manager-token': token }).toString();
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'"></head><body><script>location.replace(${JSON.stringify(browserUrl.toString())});</script></body></html>`;
}

async function openManagerBrowser(baseUrl, token, environment, paths) {
  await writeAtomic(paths.managerBrowserBootstrap, managerBrowserBootstrapHtml(baseUrl, token), 0o600);
  const command = environment.LEESH_LOOP_BROWSER_COMMAND || 'xdg-open';
  const browser = spawn(command, [pathToFileURL(paths.managerBrowserBootstrap).toString()], { detached: true, stdio: 'ignore' });
  return await new Promise(resolveLaunch => {
    let acknowledgementTimer;
    const finish = result => {
      if (acknowledgementTimer) clearTimeout(acknowledgementTimer);
      resolveLaunch(result);
    };
    browser.once('spawn', () => {
      browser.unref();
      acknowledgementTimer = setTimeout(() => finish({ opened: true }), browserLaunchAckTimeoutMs);
    });
    browser.once('error', error => finish({ error: `could not launch browser command ${command}: ${error.message}` }));
    browser.once('exit', (code, signal) => {
      if (code === 0) finish({ opened: true });
      else finish({ error: `browser command ${command} exited unsuccessfully${signal ? ` after signal ${signal}` : ` with status ${code}`}` });
    });
  });
}

function browserLaunchDetails(result, paths) {
  return result?.error
    ? {
        browserLaunchError: result.error,
        browserBootstrapUrl: pathToFileURL(paths.managerBrowserBootstrap).toString()
      }
    : {};
}

export async function ensureManagerService({ sourceRoot, openBrowser = false, environment = process.env, homeDirectory = homedir() } = {}) {
  const options = { environment, homeDirectory };
  const paths = managerPaths(options);
  const config = await readManagerConfiguration(options);
  const source = sourceRoot || fileURLToPath(new URL('../..', import.meta.url));
  await recordRuntimeSource(source, options);
  let active = await activeRuntime(options);
  if (!active) active = await installRuntimeDistribution(source, options);
  await ensurePrivateDirectory(paths.managerStateRoot);
  const masterToken = await ensureManagerToken(paths);
  const legacyToken = await legacyManagerToken(paths);
  const token = managerApiToken(masterToken, active.id);
  const baseUrl = `http://127.0.0.1:${config.port}`;
  let record;
  try { record = await readJsonFile(paths.managerServiceRecord, 'Manager service record'); }
  catch (error) { throw new Error(`Manager service state is unconfirmed: ${error.message}`); }
  if (record) {
    const recordedProcessAlive = processAlive(record.pid);
    const observedStartTicks = recordedProcessAlive ? processStartTicks(record.pid) : null;
    const live = recordedProcessAlive && observedStartTicks === record.process_start_ticks;
    if (live) {
      const health = await managerHealth(baseUrl, token);
      if (health?.status === 'Running') {
        const browserResult = openBrowser ? await openManagerBrowser(baseUrl, token, environment, paths) : null;
        return {
          url: baseUrl,
          token,
          port: config.port,
          runtime: active,
          managerRestartRequired: record.manager_restart_required === true,
          alreadyRunning: true,
          ...browserLaunchDetails(browserResult, paths)
        };
      }
      let compatiblePrevious = null;
      if (record.runtime_version && record.runtime_version !== active.id) {
        const previousVersionToken = managerApiToken(masterToken, record.runtime_version);
        if ((await managerHealth(baseUrl, previousVersionToken))?.status === 'Running') compatiblePrevious = previousVersionToken;
        else if (legacyToken && (await managerHealth(baseUrl, legacyToken))?.status === 'Running') compatiblePrevious = legacyToken;
      }
      if (compatiblePrevious) {
        return {
          url: baseUrl,
          token: compatiblePrevious,
          port: config.port,
          runtime: active,
          managerRuntimeVersion: record.runtime_version,
          managerRestartRequired: true,
          alreadyRunning: true
        };
      }
      throw new Error('Manager process is alive but its HTTP identity cannot be confirmed; refusing to start a second Manager.');
    }
    if (recordedProcessAlive) {
      if (!observedStartTicks || typeof record.process_start_ticks !== 'string' || !record.process_start_ticks || observedStartTicks === record.process_start_ticks) {
        throw new Error('Manager process identity cannot be confirmed; refusing to control the process.');
      }
      // The recorded Manager is gone when start ticks differ. Leave the reused
      // PID alone; a replacement Manager will atomically write its own record
      // after binding the configured loopback port.
    } else {
      await unlink(paths.managerServiceRecord).catch(error => { if (error?.code !== 'ENOENT') throw error; });
    }
  } else if (await managerHealth(baseUrl, token) || (legacyToken && await managerHealth(baseUrl, legacyToken))) {
    throw new Error('A Manager responds without a verifiable execution record; refusing to start a second Manager.');
  }
  await ensurePrivateDirectory(paths.managerStateRoot);
  const logDetails = await lstat(paths.managerLog).catch(error => error?.code === 'ENOENT' ? null : Promise.reject(error));
  if (logDetails && (logDetails.isSymbolicLink() || !logDetails.isFile())) throw new Error('Manager log path must be a regular file');
  if (logDetails?.isFile() && logDetails.size > 2 * 1024 * 1024) await truncate(paths.managerLog, 0);
  const log = await open(paths.managerLog, constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY, 0o600);
  const child = spawn(process.execPath, [join(active.path, 'operator/app/manager.mjs'), 'serve'], {
    cwd: active.path,
    detached: true,
    stdio: ['ignore', log.fd, log.fd],
    env: { ...environment, LEESH_LOOP_RUNTIME_SOURCE: source }
  });
  try {
    await new Promise((resolveSpawn, rejectSpawn) => {
      child.once('spawn', resolveSpawn);
      child.once('error', rejectSpawn);
    });
  } finally { await log.close(); }
  child.unref();
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const health = await managerHealth(baseUrl, token);
    if (health?.status === 'Running') break;
    if (!processAlive(child.pid)) {
      const detail = (await readFile(paths.managerLog, 'utf8').catch(() => '')).trim().slice(-4000);
      throw new Error(`Manager service exited during startup${detail ? `: ${detail}` : ` (PID ${child.pid})`}.`);
    }
    await sleep(100);
  }
  const health = await managerHealth(baseUrl, token);
  if (!health) throw new Error(`Manager service did not become ready at ${baseUrl}.`);
  const browserResult = openBrowser ? await openManagerBrowser(baseUrl, token, environment, paths) : null;
  return { url: baseUrl, token, port: config.port, runtime: active, alreadyRunning: false, ...browserLaunchDetails(browserResult, paths) };
}

export async function managerRequest(manager, path, { method = 'GET', body, instanceId } = {}) {
  if (manager.managerRestartRequired && path !== '/api/v1/manager/restart') {
    throw new Error('The previous Manager credential may only be used to restart that Manager.');
  }
  const headers = { accept: 'application/json', 'x-leesh-loop-token': manager.token };
  if (instanceId) headers['x-leesh-loop-instance-id'] = instanceId;
  const options = { method, headers, signal: AbortSignal.timeout(30 * 60_000) };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${manager.url}${path}`, options);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Manager request failed with HTTP ${response.status}.`);
  return result;
}
