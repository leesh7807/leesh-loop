import { execFile as execFileCallback, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { constants, readFileSync } from 'node:fs';
import { lstat, open, readFile, unlink } from 'node:fs/promises';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { managerPaths, ensurePrivateDirectory, getLoopInstance, listLoopInstances, readJsonFile, validateManagedInstanceConfiguration, writeAtomic, writeAtomicJson } from './manager-storage.mjs';
import { resolveRuntimePath } from './runtime-distribution.mjs';
import { parseProjectToml, readProjectConfiguration, stringifyProjectConfiguration, validateProjectConfiguration } from '../project-config.mjs';
import { validateWorkspaceFiles } from './workspace-files.mjs';

const execFile = promisify(execFileCallback);
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
const managerRuntimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const executionRecordPath = (paths, id) => join(paths.loopExecutionRoot, id, 'execution.json');
const runtimeStatePath = (paths, id) => join(paths.loopExecutionRoot, id, 'runtime.json');
const launcherLogPath = (paths, id) => join(paths.loopExecutionRoot, id, 'start-command.log');
const processLogPath = (paths, id) => join(paths.loopExecutionRoot, id, 'symphony-startup.log');

function processStartTicks(pid) {
  try {
    const statText = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return statText.slice(statText.lastIndexOf(')') + 1).trim().split(/\s+/)[19] || null;
  } catch { return null; }
}

function processExists(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === 'EPERM'; }
}

function processIdentityIsAbsent(pid, startTicks) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  const observedTicks = processStartTicks(pid);
  if (observedTicks) return typeof startTicks === 'string' && startTicks.length > 0 && observedTicks !== startTicks;
  return !processExists(pid);
}

function recordedProcessesAreAbsent(execution, { requireLauncher = false, requireRuntime = false } = {}) {
  if (requireLauncher && (!Number.isSafeInteger(execution.launcher_pid) || execution.launcher_pid <= 0)) return false;
  if (requireRuntime && (!Number.isSafeInteger(execution.pid) || execution.pid <= 0)) return false;
  let hasRecordedProcess = false;
  for (const [pidKey, ticksKey] of [['pid', 'process_start_ticks'], ['launcher_pid', 'launcher_start_ticks']]) {
    const pid = execution[pidKey];
    const ticks = execution[ticksKey];
    if (pid === undefined || pid === null) {
      if (ticks !== undefined && ticks !== null) return false;
      continue;
    }
    hasRecordedProcess = true;
    if (!processIdentityIsAbsent(pid, ticks)) return false;
  }
  return hasRecordedProcess;
}

async function readExecution(paths, id) {
  return readJsonFile(executionRecordPath(paths, id), 'Loop execution record');
}

async function readRuntimeState(paths, id) {
  return readJsonFile(runtimeStatePath(paths, id), 'Loop runtime state');
}

async function runtimePortRefused(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  try {
    await fetch(`http://127.0.0.1:${port}/api/v1/runtime`, { signal: AbortSignal.timeout(1000) });
    return false;
  } catch (error) { return error?.cause?.code === 'ECONNREFUSED'; }
}

function unconfirmed(instance, detail, execution = null) {
  return { id: instance.id, name: instance.repository_name, repository_root: instance.repository_root, repository_url: instance.repository_url, status: 'Unconfirmed', detail, ...(execution?.port ? { port: execution.port } : {}) };
}

async function verifyRuntimeResponse(state, execution, runtimePath) {
  const dashboard = state?.effective?.dashboard;
  if (typeof dashboard !== 'string' || !/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(dashboard)) return { ready: false, ownership_verified: false, detail: 'runtime dashboard address is invalid' };
  const expectedDashboard = `http://127.0.0.1:${execution.port}`;
  if (dashboard !== expectedDashboard) return { ready: false, ownership_verified: false, detail: 'runtime dashboard does not match the assigned port' };
  let ownership;
  try {
    ownership = await readJsonFile(state.ownership_path, 'Loop process ownership record');
  } catch (error) { return { ready: false, ownership_verified: false, detail: error.message }; }
  if (ownership?.project_root !== runtimePath.path
    || ownership.runtime_id !== state.runtime_id
    || ownership.pid !== state.pid
    || ownership.process_start_ticks !== state.process_start_ticks) {
    return { ready: false, ownership_verified: false, detail: 'runtime ownership identity does not match' };
  }
  let observed;
  try {
    const response = await fetch(`${dashboard}/api/v1/runtime`, { signal: AbortSignal.timeout(1000) });
    if (!response.ok) return { ready: false, ownership_verified: true, detail: `runtime status returned HTTP ${response.status}` };
    observed = await response.json();
    if (typeof observed?.runtime_id === 'string'
      && observed.runtime_id
      && observed.runtime_id !== state.runtime_id
      && Number.isSafeInteger(observed.pid)
      && observed.pid > 0
      && observed.dispatch_capable === true) {
      return { ready: false, ownership_verified: true, runtime_absent: true, detail: `a different Loop runtime ${observed.runtime_id} responds on the assigned port` };
    }
    if (observed?.runtime_id !== state.runtime_id || observed?.pid !== state.pid || observed?.dispatch_capable !== true) {
      return { ready: false, ownership_verified: true, detail: 'runtime API identity does not match the recorded Loop process' };
    }
  } catch (error) {
    if (error?.cause?.code === 'ECONNREFUSED' && processIdentityIsAbsent(state.pid, state.process_start_ticks)) {
      return { ready: false, ownership_verified: true, stopped: true };
    }
    return { ready: false, ownership_verified: true, detail: `runtime readiness could not be confirmed: ${error.message}` };
  }
  let acknowledgement;
  try {
    acknowledgement = await readJsonFile(state.acknowledgement_path, 'Loop readiness acknowledgement');
  } catch (error) { return { ready: false, ownership_verified: true, detail: error.message }; }
  if (acknowledgement?.runtime_id !== state.runtime_id
    || acknowledgement.pid !== state.pid
    || acknowledgement.dispatch_capable !== true) {
    return { ready: false, ownership_verified: true, detail: 'runtime readiness acknowledgement does not match' };
  }
  return { ready: true, ownership_verified: true };
}

async function recordedRuntimeIsAbsent(execution, state, options = {}) {
  if (!state) {
    const hasProcessIdentity = execution.pid != null || execution.process_start_ticks != null
      || execution.launcher_pid != null || execution.launcher_start_ticks != null;
    if (hasProcessIdentity && !recordedProcessesAreAbsent(execution)) return false;
    return runtimePortRefused(execution.port);
  }
  if (!processIdentityIsAbsent(state.pid, state.process_start_ticks)) return false;
  let runtimePath;
  try { runtimePath = await resolveRuntimePath(execution.runtime_path, options); }
  catch { return false; }
  const observed = await verifyRuntimeResponse(state, execution, runtimePath);
  return observed.stopped === true || observed.runtime_absent === true;
}

async function clearRuntimeExecutionState(paths, id) {
  const directory = join(paths.loopExecutionRoot, id);
  const directoryDetails = await lstat(directory).catch(error => error?.code === 'ENOENT' ? null : Promise.reject(error));
  if (!directoryDetails) return;
  if (directoryDetails.isSymbolicLink() || !directoryDetails.isDirectory()) throw new Error('Loop execution state directory must be a real directory');
  await ensurePrivateDirectory(directory);
  for (const name of ['runtime.json', 'ownership.json', 'dispatch-authorization.json', 'dispatch-acknowledgement.json', 'startup-status']) {
    const path = join(directory, name);
    const details = await lstat(path).catch(error => error?.code === 'ENOENT' ? null : Promise.reject(error));
    if (!details) continue;
    if (details.isSymbolicLink() || !details.isFile()) throw new Error(`Loop runtime record must be a regular file: ${path}`);
    await unlink(path);
  }
}

async function saveObservedStatus(paths, execution, status, details = {}) {
  const updated = { ...execution, status, ...details, observed_at: new Date().toISOString() };
  await writeAtomicJson(executionRecordPath(paths, execution.id), updated);
  return updated;
}

async function recordRuntimeExit(paths, instance, execution, state, options = {}) {
  const status = ['Stopping', 'Stopped'].includes(execution.status) ? 'Stopped' : 'Failed';
  const detail = status === 'Failed' ? 'Loop process exited without a confirmed stop request' : undefined;
  await saveStatusObservation(paths, execution, status, {
    pid: state.pid,
    process_start_ticks: state.process_start_ticks,
    ...(detail ? { detail } : {})
  }, options);
  return {
    id: instance.id,
    name: instance.repository_name,
    repository_root: instance.repository_root,
    repository_url: instance.repository_url,
    status,
    ...(detail ? { detail } : {}),
    ...(status === 'Failed' && recordedProcessesAreAbsent(execution, { requireLauncher: true, requireRuntime: true }) ? { can_update_workflow: true, process_absence_confirmed: true } : {}),
    ...(Number.isInteger(execution.port) ? { port: execution.port } : {})
  };
}

async function saveStatusObservation(paths, execution, status, details = {}, options = {}) {
  if (options.persistObservedStatus === false) return;
  await saveObservedStatus(paths, execution, status, details);
}

async function refreshReadOnlyStatusIfExecutionChanged(id, instance, paths, execution, options) {
  if (options.persistObservedStatus !== false || options.refreshingStatusObservation) return null;
  let current;
  try { current = await readExecution(paths, id); }
  catch (error) { return unconfirmed(instance, error.message, execution); }
  const sameObservation = current
    && current.status === execution.status
    && current.started_at === execution.started_at
    && current.runtime_version === execution.runtime_version
    && current.port === execution.port
    && current.pid === execution.pid
    && current.process_start_ticks === execution.process_start_ticks;
  if (sameObservation) return null;
  return loopInstanceStatus(id, { ...options, refreshingStatusObservation: true });
}

export async function loopInstanceStatus(id, options = {}) {
  const paths = managerPaths(options);
  const instance = await getLoopInstance(id, options);
  let execution;
  try { execution = await readExecution(paths, id); }
  catch (error) { return unconfirmed(instance, error.message); }
  if (!execution) {
    const state = await readRuntimeState(paths, id).catch(error => ({ readError: error.message }));
    if (state?.readError) return unconfirmed(instance, state.readError);
    if (state) return unconfirmed(instance, 'Loop runtime state exists but its Manager execution record is missing');
    return { id, name: instance.repository_name, repository_root: instance.repository_root, repository_url: instance.repository_url, status: 'Stopped' };
  }
  if (execution.schema_version !== 1 || execution.id !== id || !['Starting', 'Running', 'Stopping', 'Stopped', 'Failed', 'Unconfirmed'].includes(execution.status)) {
    return unconfirmed(instance, 'execution record is invalid');
  }
  if (execution.status === 'Stopping' && options.isLifecycleOperationActive?.(id)) {
    return { id, name: instance.repository_name, repository_root: instance.repository_root, repository_url: instance.repository_url, status: 'Stopping', ...(Number.isInteger(execution.port) ? { port: execution.port } : {}) };
  }
  let state;
  try { state = await readRuntimeState(paths, id); }
  catch (error) { return unconfirmed(instance, error.message, execution); }
  if (!state) {
    if (execution.status === 'Stopped') {
      if (Number.isSafeInteger(execution.pid) && execution.pid > 0) {
        const ticks = processStartTicks(execution.pid);
        if (ticks && ticks === execution.process_start_ticks) {
          return unconfirmed(instance, `Stopped record still matches live Loop process ${execution.pid}`, execution);
        }
        if (!ticks && processExists(execution.pid)) {
          return unconfirmed(instance, `cannot inspect whether former Loop process ${execution.pid} is still alive`, execution);
        }
      }
      return { id, name: instance.repository_name, repository_root: instance.repository_root, repository_url: instance.repository_url, status: 'Stopped', ...(Number.isInteger(execution.port) ? { port: execution.port } : {}) };
    }
    if (Number.isSafeInteger(execution.pid) && execution.pid > 0) {
      const ticks = processStartTicks(execution.pid);
      if (ticks && ticks !== execution.process_start_ticks) {
        if (await runtimePortRefused(execution.port) && recordedProcessesAreAbsent(execution)) {
          return recordRuntimeExit(paths, instance, execution, { pid: execution.pid, process_start_ticks: execution.process_start_ticks }, options);
        }
        return unconfirmed(instance, `PID ${execution.pid} has been reused; Loop runtime absence is not confirmed`, execution);
      }
      if (!processExists(execution.pid)) {
        return recordRuntimeExit(paths, instance, execution, { pid: execution.pid, process_start_ticks: execution.process_start_ticks }, options);
      }
      return unconfirmed(instance, `runtime state is missing while process ${execution.pid} is alive`, execution);
    }
    if (execution.status === 'Starting' && !execution.launcher_pid) {
      const age = Date.now() - Date.parse(execution.started_at || 0);
      if (age < 15_000) return { id, name: instance.repository_name, repository_root: instance.repository_root, repository_url: instance.repository_url, status: 'Starting', ...(execution.port ? { port: execution.port } : {}) };
      return unconfirmed(instance, 'startup process identity was not recorded; refusing to infer whether a Loop process is alive', execution);
    }
    if (execution.status === 'Starting' && processExists(execution.launcher_pid)) {
      if (!execution.launcher_start_ticks || processStartTicks(execution.launcher_pid) !== execution.launcher_start_ticks) {
        return unconfirmed(instance, 'startup process identity does not match', execution);
      }
      return { id, name: instance.repository_name, repository_root: instance.repository_root, repository_url: instance.repository_url, status: 'Starting', port: execution.port };
    }
    if (['Starting', 'Running', 'Stopping'].includes(execution.status)) {
      await saveStatusObservation(paths, execution, 'Failed', { detail: 'Loop process exited before reporting a confirmed runtime state' }, options);
      const detail = (await readFile(launcherLogPath(paths, id), 'utf8').catch(() => '')).trim().slice(-4000);
      return {
        id,
        name: instance.repository_name,
        repository_root: instance.repository_root,
        repository_url: instance.repository_url,
        status: 'Failed',
        detail: detail || 'Loop process exited before it became ready',
        ...(recordedProcessesAreAbsent(execution, {
          requireLauncher: true,
          requireRuntime: ['Running', 'Stopping'].includes(execution.status)
        }) ? { can_update_workflow: true, process_absence_confirmed: true } : {}),
        port: execution.port
      };
    }
    return {
      id,
      name: instance.repository_name,
      repository_root: instance.repository_root,
      repository_url: instance.repository_url,
      status: execution.status,
      ...(execution.detail ? { detail: execution.detail } : {}),
      ...(execution.status === 'Failed' && (
        execution.launcher_pid !== undefined && execution.launcher_pid !== null
          ? recordedProcessesAreAbsent(execution, { requireLauncher: true })
          : execution.pid == null && execution.process_start_ticks == null && execution.launcher_start_ticks == null
      ) ? { can_update_workflow: true, process_absence_confirmed: true } : {}),
      ...(execution.port ? { port: execution.port } : {})
    };
  }
  if (state.readError) return unconfirmed(instance, state.readError, execution);
  if (state.status === 'failed') {
    if (Number.isSafeInteger(state.pid) && processExists(state.pid)) {
      const ticks = processStartTicks(state.pid);
      if (ticks !== state.process_start_ticks) {
        if (await recordedRuntimeIsAbsent(execution, state, options)) {
          return recordRuntimeExit(paths, instance, execution, state, options);
        }
        return unconfirmed(instance, `PID ${state.pid} has been reused; Loop runtime absence is not confirmed`, execution);
      }
      return unconfirmed(instance, 'Loop reported startup failure but its recorded process is still alive', execution);
    }
    await saveStatusObservation(paths, execution, 'Failed', { detail: state.cleanup_error || state.detail || 'Loop startup failed' }, options);
    return {
      id,
      name: instance.repository_name,
      repository_root: instance.repository_root,
      repository_url: instance.repository_url,
      status: 'Failed',
      detail: state.cleanup_error || 'Loop startup failed',
      ...(Number.isSafeInteger(state.pid) && state.pid > 0 && recordedProcessesAreAbsent(execution, { requireLauncher: true }) ? { can_update_workflow: true, process_absence_confirmed: true } : {}),
      port: execution.port
    };
  }
  if (!Number.isSafeInteger(state.pid) || state.pid <= 0 || typeof state.process_start_ticks !== 'string' || !state.process_start_ticks) {
    if (state.status === 'starting' && processExists(execution.launcher_pid)) {
      if (!execution.launcher_start_ticks || processStartTicks(execution.launcher_pid) !== execution.launcher_start_ticks) return unconfirmed(instance, 'startup process identity does not match', execution);
      return { id, name: instance.repository_name, repository_root: instance.repository_root, repository_url: instance.repository_url, status: 'Starting', port: execution.port };
    }
    if (state.status === 'starting') {
      await saveStatusObservation(paths, execution, 'Failed', { detail: 'startup ended before the Symphony process identity was recorded' }, options);
      return { id, name: instance.repository_name, repository_root: instance.repository_root, repository_url: instance.repository_url, status: 'Failed', detail: 'startup ended before the Symphony process identity was recorded', port: execution.port };
    }
    return unconfirmed(instance, 'runtime process identity is incomplete', execution);
  }
  const observedTicks = processStartTicks(state.pid);
  if (!observedTicks) {
    if (!processExists(state.pid)) {
      let runtimePath;
      try { runtimePath = await resolveRuntimePath(execution.runtime_path, options); }
      catch (error) { return unconfirmed(instance, error.message, execution); }
      const readback = await verifyRuntimeResponse(state, execution, runtimePath);
      if (readback.stopped || readback.runtime_absent) {
        return recordRuntimeExit(paths, instance, execution, state, options);
      }
      return unconfirmed(instance, 'runtime process disappeared but its final state could not be confirmed', execution);
    }
    return unconfirmed(instance, `cannot inspect the identity of runtime process ${state.pid}`, execution);
  }
  if (observedTicks !== state.process_start_ticks) {
    if (await recordedRuntimeIsAbsent(execution, state, options)) {
      return recordRuntimeExit(paths, instance, execution, state, options);
    }
    return unconfirmed(instance, `PID ${state.pid} has been reused; Loop runtime absence is not confirmed`, execution);
  }
  let runtimePath;
  try { runtimePath = await resolveRuntimePath(execution.runtime_path, options); }
  catch (error) { return unconfirmed(instance, error.message, execution); }
  if (state.runtime_id !== execution.runtime_id && execution.runtime_id) return unconfirmed(instance, 'runtime identity changed from the execution record', execution);
  let observedPort;
  try { observedPort = Number(new URL(state.effective?.dashboard || 'http://127.0.0.1').port); }
  catch { return unconfirmed(instance, 'runtime dashboard address is invalid', execution); }
  if (execution.port !== observedPort) return unconfirmed(instance, 'runtime port differs from the execution record', execution);
  const ready = await verifyRuntimeResponse(state, execution, runtimePath);
  if (ready.stopped) {
    return recordRuntimeExit(paths, instance, execution, state, options);
  }
  if (ready.ready) {
    const refreshedStatus = await refreshReadOnlyStatusIfExecutionChanged(id, instance, paths, execution, options);
    if (refreshedStatus) return refreshedStatus;
    await saveStatusObservation(paths, execution, 'Running', { runtime_id: state.runtime_id, pid: state.pid, process_start_ticks: state.process_start_ticks, port: execution.port }, options);
    return { id, name: instance.repository_name, repository_root: instance.repository_root, repository_url: instance.repository_url, status: 'Running', port: execution.port, runtime_version: runtimePath.id };
  }
  if (state.status === 'starting' || state.status === 'provisional' || state.status === 'committed-disabled') {
    if (execution.status === 'Failed') {
      if (ready.ownership_verified !== true) return unconfirmed(instance, ready.detail || 'Loop process ownership could not be confirmed', execution);
      return { id, name: instance.repository_name, repository_root: instance.repository_root, repository_url: instance.repository_url, status: 'Failed', detail: execution.detail || ready.detail || 'Loop startup failed before becoming ready', port: execution.port, can_stop: true };
    }
    if (execution.status === 'Stopping') {
      if (ready.ownership_verified !== true) return unconfirmed(instance, ready.detail || 'Loop process ownership could not be confirmed', execution);
      const detail = 'Loop stop was interrupted before the runtime became ready';
      await saveStatusObservation(paths, execution, 'Failed', { detail }, options);
      return { id: instance.id, name: instance.repository_name, repository_root: instance.repository_root, repository_url: instance.repository_url, status: 'Failed', detail, port: execution.port, can_stop: true };
    }
    if (execution.status !== 'Starting') {
      return unconfirmed(instance, ready.detail || `runtime is not ready while Manager records ${execution.status}`, execution);
    }
    if (Number.isSafeInteger(execution.launcher_pid) && execution.launcher_pid > 0) {
      if (processExists(execution.launcher_pid)) {
        const launcherTicks = processStartTicks(execution.launcher_pid);
        if (!launcherTicks) return unconfirmed(instance, `cannot inspect the identity of startup launcher ${execution.launcher_pid}`, execution);
        if (launcherTicks === execution.launcher_start_ticks) {
          return { id, name: instance.repository_name, repository_root: instance.repository_root, repository_url: instance.repository_url, status: 'Starting', port: execution.port, ...(ready.detail ? { detail: ready.detail } : {}) };
        }
      }
      if (ready.ownership_verified !== true) return unconfirmed(instance, ready.detail || 'Loop process ownership could not be confirmed', execution);
      const detail = 'startup launcher exited before the Loop runtime became ready';
      await saveStatusObservation(paths, execution, 'Failed', { detail }, options);
      return { id, name: instance.repository_name, repository_root: instance.repository_root, repository_url: instance.repository_url, status: 'Failed', detail, port: execution.port, can_stop: true };
    }
    const startupAge = Date.now() - Date.parse(execution.started_at || 0);
    if (startupAge < 15_000) {
      return { id, name: instance.repository_name, repository_root: instance.repository_root, repository_url: instance.repository_url, status: 'Starting', port: execution.port, ...(ready.detail ? { detail: ready.detail } : {}) };
    }
    if (ready.ownership_verified !== true) return unconfirmed(instance, ready.detail || 'Loop process ownership could not be confirmed', execution);
    const detail = 'Loop runtime remained unready after its startup launcher identity was lost';
    await saveStatusObservation(paths, execution, 'Failed', { detail }, options);
    return { id, name: instance.repository_name, repository_root: instance.repository_root, repository_url: instance.repository_url, status: 'Failed', detail, port: execution.port, can_stop: true };
  }
  return unconfirmed(instance, ready.detail || 'runtime readiness is unconfirmed', execution);
}

async function availablePort(port) {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, '127.0.0.1', resolveListen);
  });
  await new Promise(resolveClose => server.close(resolveClose));
  return true;
}

export async function allocatePort(paths, { minPort = 4100, maxPort = 4199, environment = process.env, homeDirectory = homedir() } = {}) {
  if (!Number.isInteger(minPort) || !Number.isInteger(maxPort) || minPort < 1 || maxPort > 65535 || minPort > maxPort) {
    throw new Error('Manager Symphony port range is invalid');
  }
  await ensurePrivateDirectory(paths.loopExecutionRoot);
  const reserved = new Set();
  for (const instance of await listLoopInstances({ environment, homeDirectory })) {
    const status = await loopInstanceStatus(instance.id, { environment, homeDirectory, persistObservedStatus: false });
    if ((['Starting', 'Running', 'Stopping', 'Unconfirmed'].includes(status.status)
      || (status.status === 'Failed' && status.can_stop === true)) && Number.isInteger(status.port)) reserved.add(status.port);
  }
  for (let port = minPort; port <= maxPort; port += 1) {
    if (reserved.has(port)) continue;
    try { await availablePort(port); return port; }
    catch (error) { if (error?.code !== 'EADDRINUSE' && error?.code !== 'EACCES') throw error; }
  }
  throw new Error(`no available Symphony port in configured range ${minPort}-${maxPort}`);
}

async function readProject(instance) {
  const details = await lstat(instance.project_file);
  if (details.isSymbolicLink() || !details.isFile()) throw new Error('instance project.toml must be a regular file');
  const config = await readProjectConfiguration(instance.project_file, { validateWorkspaceFileSources: true });
  await validateManagedInstanceConfiguration(instance, config);
  await validateWorkspaceFiles(config.workspace_files);
  return config;
}

const PROJECT_WORKER_SETTING_KEYS = new Set(['codex_model', 'codex_reasoning_effort']);

function validateProjectWorkerSettingsPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw Object.assign(new Error('Project Worker settings must be an object.'), { status: 400 });
  }
  const keys = Object.keys(patch);
  if (keys.length === 0) throw Object.assign(new Error('Set or clear codex_model or codex_reasoning_effort.'), { status: 400 });
  for (const key of keys) {
    if (!PROJECT_WORKER_SETTING_KEYS.has(key)) {
      throw Object.assign(new Error('Only codex_model and codex_reasoning_effort can be changed.'), { status: 400 });
    }
    const value = patch[key];
    if (value !== null && (typeof value !== 'string' || !value.trim())) {
      throw Object.assign(new Error(`${key} must be a non-empty string or null to clear it.`), { status: 400 });
    }
  }
  return patch;
}

function projectWorkerSettingsResult(instance, config, status) {
  const canUpdate = status.status === 'Stopped'
    || (status.status === 'Failed' && status.process_absence_confirmed === true);
  return {
    project: { name: instance.repository_name, repositoryPath: instance.repository_root },
    status: status.status,
    ...(status.detail ? { detail: status.detail } : {}),
    canUpdate,
    settings: {
      codex_model: config.codex_model ?? null,
      codex_reasoning_effort: config.codex_reasoning_effort ?? null
    }
  };
}

export async function readProjectWorkerSettings(id, options = {}) {
  const instance = await getLoopInstance(id, options);
  const [config, status] = await Promise.all([
    readProject(instance),
    loopInstanceStatus(id, { ...options, persistObservedStatus: false })
  ]);
  return projectWorkerSettingsResult(instance, config, status);
}

export async function updateProjectWorkerSettings(id, patch, options = {}) {
  const submitted = validateProjectWorkerSettingsPatch(patch);
  const instance = await getLoopInstance(id, options);
  const status = await loopInstanceStatus(id, { ...options, persistObservedStatus: false });
  const canUpdate = status.status === 'Stopped'
    || (status.status === 'Failed' && status.process_absence_confirmed === true);
  if (!canUpdate) {
    const nextStep = status.status === 'Running'
      ? 'Stop the Loop in Manager, then try again.'
      : status.status === 'Failed'
        ? 'Resolve process ownership so Manager can confirm there is no active process, then try again.'
        : status.status === 'Unconfirmed'
          ? 'Review the Loop diagnosis and confirm process ownership before trying again.'
          : 'Wait until Manager confirms the Loop is Stopped, then try again.';
    throw Object.assign(new Error(`Worker settings can be changed only when Manager confirms Stopped or Failed with no active process. Current status: ${status.status}. ${nextStep}`), { status: 409 });
  }

  await readProject(instance);
  const details = await lstat(instance.project_file);
  if (details.isSymbolicLink() || !details.isFile()) throw Object.assign(new Error('instance project.toml must be a regular file'), { status: 409 });
  const source = await readFile(instance.project_file, 'utf8');
  const current = validateProjectConfiguration(parseProjectToml(source, instance.project_file));
  const updated = { ...current };
  for (const [key, value] of Object.entries(submitted)) {
    if (value === null) delete updated[key];
    else updated[key] = value;
  }
  const contents = stringifyProjectConfiguration(updated);
  if (contents !== `${source.trimEnd()}\n`) await writeAtomic(instance.project_file, contents, 0o600);
  return readProjectWorkerSettings(id, options);
}

async function invokeLoopCommand({ runtimePath, instance, command, args = [], timeout = 30_000, environment = process.env }) {
  const executionDirectory = join(managerPaths({ environment }).loopExecutionRoot, instance.id);
  const env = { ...environment, LEESH_LOOP_EXECUTION_STATE_DIRECTORY: executionDirectory, LEESH_LOOP_MANAGER_MANAGED: 'true' };
  try {
    // A Loop keeps its pinned Runtime across updates; lifecycle control must use
    // the Manager's current CLI so older immutable distributions remain stoppable.
    const commandRuntimeRoot = command === 'stop-owned-managed' ? managerRuntimeRoot : runtimePath.path;
    const cliArguments = command === 'stop-owned-managed'
      ? [join(commandRuntimeRoot, 'operator/app/leesh-loop.mjs'), command, instance.id, ...args]
      : [join(commandRuntimeRoot, 'operator/app/leesh-loop.mjs'), command, instance.project_file, ...args];
    const result = await execFile(process.execPath, cliArguments, {
      cwd: commandRuntimeRoot,
      env,
      timeout,
      maxBuffer: 1024 * 1024
    });
    return result.stdout.trim() ? JSON.parse(result.stdout.trim().split('\n').at(-1)) : {};
  } catch (error) {
    const detail = error.stderr?.trim().slice(-4000) || error.message;
    throw new Error(`Loop ${command} failed: ${detail}`);
  }
}

async function cleanupPreviousRuntime(instance, options = {}) {
  const paths = managerPaths(options);
  const execution = await readExecution(paths, instance.id);
  if (!execution) return;
  const status = await loopInstanceStatus(instance.id, options);
  if (status.status === 'Unconfirmed' || status.status === 'Running' || status.status === 'Starting' || status.status === 'Stopping') {
    throw Object.assign(new Error(`Loop cannot be restarted while its status is ${status.status}${status.detail ? `: ${status.detail}` : ''}.`), { status: 409 });
  }
  if (execution.runtime_path) {
    const state = await readRuntimeState(paths, instance.id);
    if (await recordedRuntimeIsAbsent(execution, state, options)) {
      await clearRuntimeExecutionState(paths, instance.id);
      return;
    }
    const runtime = await resolveRuntimePath(execution.runtime_path, options);
    const runtimeId = execution.runtime_id || state?.runtime_id;
    if (!runtimeId) throw new Error('Loop execution record has no runtime identity for cleanup.');
    const result = await invokeLoopCommand({ runtimePath: runtime, instance, command: 'stop-owned-managed', args: [runtimeId], timeout: 30_000, environment: options.environment });
    if (result?.stopped !== true) throw new Error('Loop cleanup did not confirm that the owned runtime stopped.');
  }
}

export async function startLoopInstance(id, { runtimeSource, minPort = 4100, maxPort = 4199, ...options } = {}) {
  const paths = managerPaths(options);
  const instance = await getLoopInstance(id, options);
  const current = await loopInstanceStatus(id, options);
  if (current.status === 'Running' || current.status === 'Starting') return { ...current, reused: true };
  if (current.status === 'Unconfirmed' || current.status === 'Stopping') throw Object.assign(new Error(`Loop start is unsafe while status is ${current.status}${current.detail ? `: ${current.detail}` : ''}.`), { status: 409 });
  await cleanupPreviousRuntime(instance, options);
  const project = await readProject(instance);
  const runtimePath = await resolveRuntimePath(null, options);
  const port = await allocatePort(paths, { minPort, maxPort, environment: options.environment || process.env, homeDirectory: options.homeDirectory || homedir() });
  const executionDirectory = join(paths.loopExecutionRoot, id);
  await ensurePrivateDirectory(executionDirectory);
  const logPath = launcherLogPath(paths, id);
  let log;
  const record = {
    schema_version: 1,
    id,
    status: 'Starting',
    runtime_path: runtimePath.path,
    runtime_version: runtimePath.id,
    port,
    started_at: new Date().toISOString()
  };
  let child;
  try {
    log = await open(logPath, 'a', 0o600);
    await log.appendFile(`\n[${new Date().toISOString()}] Starting Runtime ${runtimePath.id} on Symphony port ${port}\n`);
    await writeAtomicJson(executionRecordPath(paths, id), record);
    const env = {
      ...options.environment,
      LEESH_LOOP_EXECUTION_STATE_DIRECTORY: executionDirectory,
      LEESH_LOOP_MANAGER_MANAGED: 'true',
      LEESH_LOOP_RUNTIME_SOURCE: runtimeSource || options.environment?.LEESH_LOOP_RUNTIME_SOURCE || runtimePath.path,
      LEESH_LOOP_WORKSPACE_FILES: JSON.stringify(project.workspace_files),
      SYMPHONY_WORKSPACE_ROOT: project.symphony_workspace_root,
      SYMPHONY_GITHUB_REPOSITORY_URL: project.github_repository_url,
      SYMPHONY_GITHUB_BASE_BRANCH: project.github_base_branch
    };
    if (project.codex_model) env.SYMPHONY_CODEX_MODEL = project.codex_model;
    else delete env.SYMPHONY_CODEX_MODEL;
    if (project.codex_reasoning_effort) env.SYMPHONY_CODEX_REASONING_EFFORT = project.codex_reasoning_effort;
    else delete env.SYMPHONY_CODEX_REASONING_EFFORT;
    try {
      child = spawn(process.execPath, [join(runtimePath.path, 'operator/app/leesh-loop.mjs'), 'start', instance.project_file, '--managed-instance', '--symphony-port', String(port)], {
        cwd: runtimePath.path,
        detached: true,
        stdio: ['ignore', log.fd, log.fd],
        env
      });
      await new Promise((resolveSpawn, rejectSpawn) => {
        child.once('spawn', resolveSpawn);
        child.once('error', rejectSpawn);
      });
      child.unref();
    } catch (error) {
      await saveObservedStatus(paths, record, 'Failed', { detail: `Loop start process could not be created: ${error.message}` });
      throw error;
    }
    const ticks = processStartTicks(child.pid);
    if (!ticks) {
      await saveObservedStatus(paths, record, 'Unconfirmed', { launcher_pid: child.pid, detail: `could not record startup process identity for PID ${child.pid}` });
      throw new Error(`could not record startup process identity for PID ${child.pid}`);
    }
    await writeAtomicJson(executionRecordPath(paths, id), { ...record, launcher_pid: child.pid, launcher_start_ticks: ticks });
  } catch (error) {
    const latest = await readExecution(paths, id).catch(() => null);
    if (latest?.status === 'Starting') {
      if (child?.pid) {
        await saveObservedStatus(paths, latest, 'Unconfirmed', {
          launcher_pid: child.pid,
          detail: `Loop started but its launcher identity could not be confirmed: ${error.message}`
        }).catch(() => {});
      } else {
        await saveObservedStatus(paths, latest, 'Failed', { detail: `Loop startup setup failed: ${error.message}` }).catch(() => {});
      }
    }
    throw error;
  } finally { await log?.close(); }
  return { id, name: instance.repository_name, repository_root: instance.repository_root, repository_url: instance.repository_url, status: 'Starting', port, runtime_version: runtimePath.id };
}

export async function stopLoopInstance(id, options = {}) {
  const paths = managerPaths(options);
  const instance = await getLoopInstance(id, options);
  let status = await loopInstanceStatus(id, options);
  if (status.status === 'Stopped') return { ...status, stopped: false };
  if (status.status === 'Starting') {
    status = await waitForLoopState(id, 'Running', { timeoutMs: 20_000, ...options });
    if (status.status === 'Stopped') return { ...status, stopped: false };
    if (status.status !== 'Running' && !(status.status === 'Failed' && status.can_stop === true)) {
      if (status.status === 'Failed') return { ...status, stopped: false };
      throw Object.assign(new Error(`Loop stop could not proceed while startup remains ${status.status}${status.detail ? `: ${status.detail}` : ''}.`), { status: 409 });
    }
  }
  if (status.status === 'Failed' && status.can_stop !== true) return { ...status, stopped: false };
  if (status.status === 'Unconfirmed') throw Object.assign(new Error(`Loop stop is unsafe while process ownership is unconfirmed: ${status.detail}`), { status: 409 });
  const execution = await readExecution(paths, id);
  if (!execution?.runtime_path) throw Object.assign(new Error('Loop execution record has no Runtime identity.'), { status: 409 });
  const runtimePath = await resolveRuntimePath(execution.runtime_path, options);
  const runtimeState = await readRuntimeState(paths, id);
  const runtimeId = execution.runtime_id || runtimeState?.runtime_id;
  if (!runtimeId || (execution.runtime_id && runtimeState?.runtime_id && execution.runtime_id !== runtimeState.runtime_id)) {
    throw Object.assign(new Error('Loop runtime identity could not be confirmed before stop.'), { status: 409 });
  }
  await saveObservedStatus(paths, execution, 'Stopping');
  try {
    const result = await invokeLoopCommand({ runtimePath, instance, command: 'stop-owned-managed', args: [runtimeId], timeout: 30 * 60_000, environment: options.environment });
    if (result?.stopped !== true) throw new Error('Loop stop command did not confirm that the owned runtime stopped.');
  } catch (error) {
    const latest = await readExecution(paths, id);
    if (latest) await saveObservedStatus(paths, latest, 'Unconfirmed', { detail: error.message });
    throw Object.assign(error, { status: 409 });
  }
  await saveObservedStatus(paths, execution, 'Stopped', { stopped_at: new Date().toISOString() });
  const after = await loopInstanceStatus(id, options);
  if (after.status !== 'Stopped') throw Object.assign(new Error(`Loop stop could not be confirmed; current status is ${after.status}${after.detail ? `: ${after.detail}` : ''}.`), { status: 409 });
  return { ...after, stopped: true };
}

export async function readLoopLogs(id, options = {}) {
  const instance = await getLoopInstance(id, options);
  const paths = managerPaths(options);
  const files = [launcherLogPath(paths, id), processLogPath(paths, id)];
  const sections = [];
  for (const file of files) {
    let handle;
    try {
      handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      const details = await handle.stat();
      if (!details.isFile()) throw Object.assign(new Error('Loop log is not a regular file'), { code: 'UNSAFE_FILE' });
      const length = Math.min(details.size, 100_000);
      const content = Buffer.alloc(length);
      const { bytesRead } = length
        ? await handle.read(content, 0, length, details.size - length)
        : { bytesRead: 0 };
      const omitted = details.size > bytesRead;
      const text = content.subarray(0, bytesRead).toString('utf8');
      const marker = omitted ? '[Earlier log output omitted; showing the last ' + bytesRead + ' bytes.]\n' : '';
      sections.push('--- ' + file.split('/').at(-1) + ' ---\n' + marker + text);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      const reason = typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'READ_FAILED';
      sections.push('--- ' + file.split('/').at(-1) + ' ---\n[Log unavailable: ' + reason + '.]');
    } finally {
      await handle?.close().catch(() => {});
    }
  }
  return { logs: sections.join('\n\n') || 'No Loop logs are available yet.' };
}

export async function discoverRunningLoops(options = {}) {
  const instances = await listLoopInstances(options);
  return Promise.all(instances.map(async instance => {
    try { return { ...instance, ...(await loopInstanceStatus(instance.id, options)) }; }
    catch (error) {
      return {
        ...instance,
        status: 'Unconfirmed',
        detail: error?.message || 'Loop status could not be confirmed'
      };
    }
  }));
}

export async function waitForLoopState(id, desired, { timeoutMs = 15_000, ...options } = {}) {
  const deadline = Date.now() + timeoutMs;
  let latest;
  do {
    latest = await loopInstanceStatus(id, options);
    if (latest.status === desired || latest.status === 'Failed' || latest.status === 'Unconfirmed') return latest;
    await sleep(100);
  } while (Date.now() < deadline);
  return latest;
}
