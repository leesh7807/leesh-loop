#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeDistribution, managerMustRestartForRuntime } from '../operator/app/runtime-distribution.mjs';
import { managerPaths, readJsonFile } from '../operator/app/manager-storage.mjs';
import { ensureManagerService, managerRequest, stopManagerService } from '../operator/app/manager-service.mjs';

const cliPath = realpathSync(fileURLToPath(import.meta.url));
const distributionRoot = resolve(dirname(cliPath), '..');
let sourceRoot = distributionRoot;
try {
  const distribution = JSON.parse(readFileSync(resolve(distributionRoot, '.distribution.json'), 'utf8'));
  if (typeof distribution.source_root === 'string' && existsSync(distribution.source_root)) sourceRoot = realpathSync(distribution.source_root);
} catch { /* A source checkout is used directly when no central distribution metadata exists. */ }
const usage = [
  'Usage:',
  '  leesh-loop                 Open the central Manager UI',
  '  leesh-loop add [path]      Add a local Git project (default: current directory)',
  '  leesh-loop init            Add the current Git project (compatibility alias)',
  '  leesh-loop update          Install and activate the central Runtime',
  '  leesh-loop list            List managed projects and Loop states',
  '  leesh-loop start [project] Start a project Loop (default: current directory)',
  '  leesh-loop stop [project]  Stop a project Loop (default: current directory)',
  '  leesh-loop stop --all      Stop all active project Loops',
  '  leesh-loop manager stop    Stop Manager Service; running Loops continue',
  '',
  'Use a project name or repository path. If names are duplicated, use the full path.'
].join('\n');

function printInstances(instances) {
  if (instances.length === 0) {
    console.log('No Git projects are registered. Add one with `leesh-loop add <path>` or from Manager.');
    return;
  }
  const rows = instances.map(value => [value.repository_name, value.status, value.repository_root]);
  const headers = ['PROJECT', 'LOOP', 'REPOSITORY PATH'];
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map(row => String(row[index]).length)));
  console.log(headers.map((value, index) => value.padEnd(widths[index])).join('  '));
  for (const row of rows) console.log(row.map((value, index) => String(value).padEnd(widths[index])).join('  '));
  for (const value of instances) if (value.detail) console.error(`leesh-loop: ${value.repository_name} (${value.repository_root}): ${value.detail}`);
}

function resolveManagedProject(instances, requested) {
  const target = requested || process.cwd();
  const byId = instances.find(instance => instance.id === target);
  if (byId) return byId;

  const hasPathSyntax = !requested || target === '.' || target === '..' || target.includes('/') || target.includes('\\');
  const named = instances.filter(instance => instance.repository_name === target);
  if (!hasPathSyntax && named.length === 1) return named[0];
  if (!hasPathSyntax && named.length > 1) {
    throw new Error(`Project name '${target}' is ambiguous. Use its full repository path:\n${named.map(instance => `  ${instance.repository_root}`).join('\n')}`);
  }

  let path = resolve(target);
  try { path = realpathSync(path); } catch { /* A missing path is reported as an unregistered project below. */ }
  let repositoryRoot = path;
  try {
    repositoryRoot = realpathSync(execFileSync('git', ['-C', path, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    }).trim());
  } catch { /* Non-Git directories can still be matched by their registered path. */ }
  const byPath = instances.find(instance => instance.repository_root === path || instance.repository_root === repositoryRoot);
  if (byPath) return byPath;

  if (named.length === 1) return named[0];
  throw new Error(`No managed Git project matches '${target}'. Run \`leesh-loop list\` to see registered project names and paths.`);
}

function reportAddedProject(instance, manager) {
  console.log(`Added project ${instance.repository_name}.`);
  console.log(`Repository: ${instance.repository_root}`);
  console.log(`Loop: ${instance.status}`);
  console.log(`Manager: ${manager.url}`);
}

function reportLoopStatus(project, instance) {
  const name = project.repository_name || instance.repository_name || project.id;
  const repositoryRoot = project.repository_root || instance.repository_root;
  console.log(`${name} at ${repositoryRoot}: Loop ${instance.status}${instance.port ? ` on port ${instance.port}` : ''}.`);
}

function formatDuration(durationMs) {
  const seconds = Math.max(1, Math.ceil(durationMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

function reportRuntimeInstallLockWait(wait) {
  const owner = wait.owner_pid === null ? 'an owner with unknown PID' : `PID ${wait.owner_pid}`;
  console.error(`Waiting for the Runtime installation lock held by ${owner} (owner age ${formatDuration(wait.owner_age_ms)}; waited ${formatDuration(wait.waited_ms)} of ${formatDuration(wait.wait_timeout_ms)}). Ctrl-C cancels this wait without stopping the owner.`);
}

async function waitForManagerExit(record) {
  if (!record) return;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try { process.kill(record.pid, 0); }
    catch (error) { if (error?.code === 'ESRCH') return; }
    await new Promise(resolveSleep => setTimeout(resolveSleep, 100));
  }
  throw new Error('Manager restart was requested but its process did not exit.');
}

async function ensureReadyManager({ openBrowser = false } = {}) {
  let manager = await ensureManagerService({ sourceRoot, openBrowser });
  if (!manager.managerRestartRequired) return manager;
  const paths = managerPaths();
  const service = await readJsonFile(paths.managerServiceRecord, 'Manager service record');
  await managerRequest(manager, '/api/v1/manager/restart', { method: 'POST' });
  await waitForManagerExit(service);
  manager = await ensureManagerService({ sourceRoot, openBrowser });
  return manager;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === '--help' || command === '-h') {
    console.log(usage);
    return;
  }
  const selectedCommand = command || 'open';
  if (selectedCommand === 'manager' && args[0] === 'stop' && args.length === 1) {
    const result = await stopManagerService();
    if (result.alreadyStopped) {
      console.log('Manager Service is already stopped. No Loop process was changed.');
      return;
    }
    const continuing = result.loops.filter(instance => ['Running', 'Starting', 'Stopping'].includes(instance.status));
    const unconfirmed = result.loops.filter(instance => instance.status === 'Unconfirmed');
    console.log('Manager Service stopped. Running Loops and Workers continue independently.');
    if (continuing.length) console.log(`Continuing: ${continuing.map(instance => `${instance.repository_name} (${instance.repository_root})`).join(', ')}`);
    if (unconfirmed.length) console.log(`Loop ownership needs review: ${unconfirmed.map(instance => `${instance.repository_name} (${instance.repository_root})`).join(', ')}. Manager stopped without changing those Loops.`);
    if (!continuing.length && !unconfirmed.length) console.log('No active Loops were running.');
    return;
  }
  if (selectedCommand === 'open' && args.length === 0) {
    const manager = await ensureReadyManager({ openBrowser: true });
    if (manager.browserLaunchError) {
      console.error(`leesh-loop: Manager is running at ${manager.url}, but the browser could not be opened: ${manager.browserLaunchError}`);
      console.error(`Open this local address in a browser: ${manager.browserUrl}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Leesh Loop Manager: ${manager.url}`);
    return;
  }
  if ((selectedCommand === 'add' && args.length <= 1) || (selectedCommand === 'init' && args.length === 0)) {
    const repositoryPath = resolve(args[0] || process.cwd());
    const manager = await ensureReadyManager();
    const preview = await managerRequest(manager, '/api/v1/repositories/preview', { method: 'POST', body: { repositoryPath } });
    if (preview.already_managed) throw new Error(`${preview.repository.name} at ${preview.repository.root} is already registered. Use 'leesh-loop start ${preview.repository.root}' to open its Loop.`);
    console.log(`Project: ${preview.repository.name}`);
    console.log(`Repository: ${preview.repository.root}`);
    console.log(`Git upstream: ${preview.repository.upstream} (${preview.repository.url})`);
    const result = await managerRequest(manager, '/api/v1/instances', { method: 'POST', body: { repositoryPath } });
    reportAddedProject(result.instance, manager);
    return;
  }
  if (selectedCommand === 'list' && args.length === 0) {
    const manager = await ensureReadyManager();
    const result = await managerRequest(manager, '/api/v1/instances');
    printInstances(result.instances);
    return;
  }
  if (selectedCommand === 'start' && args.length <= 1) {
    const manager = await ensureReadyManager();
    const { instances } = await managerRequest(manager, '/api/v1/instances');
    const project = resolveManagedProject(instances, args[0]);
    const result = await managerRequest(manager, `/api/v1/instances/${encodeURIComponent(project.id)}/start`, { method: 'POST' });
    reportLoopStatus(project, result.instance);
    return;
  }
  if (selectedCommand === 'stop' && args.length === 1 && args[0] === '--all') {
    const manager = await ensureReadyManager();
    const { instances } = await managerRequest(manager, '/api/v1/instances');
    const active = instances.filter(instance => ['Running', 'Starting', 'Stopping'].includes(instance.status));
    const unconfirmed = instances.filter(instance => instance.status === 'Unconfirmed');
    if (active.length === 0 && unconfirmed.length === 0) {
      console.log('No active project Loops to stop.');
      return;
    }
    if (active.length) console.log(`Stopping ${active.length} project Loop(s): ${active.map(instance => `${instance.repository_name} (${instance.repository_root})`).join(', ')}`);
    const failures = unconfirmed.map(instance => `${instance.repository_name} (${instance.repository_root}): process ownership is unconfirmed; inspect this Loop with 'leesh-loop list' and retry after Manager confirms its state`);
    for (const failure of failures) console.error(`Could not stop ${failure}`);
    for (const instance of active) {
      try {
        const result = await managerRequest(manager, `/api/v1/instances/${encodeURIComponent(instance.id)}/stop`, { method: 'POST' });
        reportLoopStatus(instance, result.instance);
      } catch (error) {
        failures.push(`${instance.repository_name} (${instance.repository_root}): ${error.message}`);
        console.error(`Could not stop ${failures.at(-1)}`);
      }
    }
    if (failures.length) process.exitCode = 1;
    return;
  }
  if (selectedCommand === 'stop' && args.length <= 1) {
    const manager = await ensureReadyManager();
    const { instances } = await managerRequest(manager, '/api/v1/instances');
    const project = resolveManagedProject(instances, args[0]);
    const result = await managerRequest(manager, `/api/v1/instances/${encodeURIComponent(project.id)}/stop`, { method: 'POST' });
    reportLoopStatus(project, result.instance);
    return;
  }
  if (selectedCommand === 'update' && args.length === 0) {
    const updated = await installRuntimeDistribution(sourceRoot, {}, { onInstallLockWait: reportRuntimeInstallLockWait });
    if (updated.recovered_from_invalid_active) console.log('Recovered from an invalid active Runtime selection using the validated source checkout.');
    if (updated.previous_active_error) console.log(`Previous active Runtime validation: ${updated.previous_active_error}`);
    if (updated.preserved_runtime_path) console.log(`Damaged Runtime preserved at ${updated.preserved_runtime_path}.`);
    console.log(`Central Runtime ${updated.version} (${updated.id}) is active.`);
    let manager;
    try {
      manager = await ensureReadyManager();
      if (manager.alreadyRunning) {
        const paths = managerPaths();
        const service = await readJsonFile(paths.managerServiceRecord, 'Manager service record');
        if (managerMustRestartForRuntime(service?.runtime_version, updated)) {
          await managerRequest(manager, '/api/v1/manager/restart', { method: 'POST' });
          await waitForManagerExit(service);
          manager = await ensureManagerService({ sourceRoot });
        }
      }
    } catch (error) {
      const paths = managerPaths();
      throw new Error(`Runtime ${updated.version} (${updated.id}) is active, but Manager startup or restart did not complete or could not be confirmed: ${error.message}. Check Manager configuration at ${paths.managerConfiguration} and logs at ${paths.managerLog}; after resolving the issue, run \`leesh-loop\` to reopen Manager.`);
    }
    console.log(`Manager: ${manager.url}`);
    console.log('If an existing Manager tab stops accepting requests after this update, run `leesh-loop` to reopen Manager with fresh access.');
    return;
  }
  console.error(usage);
  process.exitCode = 2;
}

main().catch(error => {
  console.error(`leesh-loop: ${error.message}`);
  process.exitCode = 1;
});
