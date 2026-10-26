#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeDistribution, managerMustRestartForRuntime } from '../operator/app/runtime-distribution.mjs';
import { managerPaths, readJsonFile } from '../operator/app/manager-storage.mjs';
import { ensureManagerService, managerRequest } from '../operator/app/manager-service.mjs';

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
  '  leesh-loop init            Create a managed Loop for this Git repository',
  '  leesh-loop update          Install and activate the central Runtime',
  '  leesh-loop list            List managed Loop instances',
  '  leesh-loop start <id>      Start one managed Loop instance',
  '  leesh-loop stop <id>       Stop one managed Loop instance'
].join('\n');

function printInstances(instances) {
  if (instances.length === 0) {
    console.log('No managed Loop instances are registered.');
    return;
  }
  const rows = instances.map(value => [value.id, value.repository_name, value.status, value.repository_root]);
  const headers = ['ID', 'REPOSITORY', 'STATUS', 'PATH'];
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map(row => String(row[index]).length)));
  console.log(headers.map((value, index) => value.padEnd(widths[index])).join('  '));
  for (const row of rows) console.log(row.map((value, index) => String(value).padEnd(widths[index])).join('  '));
  for (const value of instances) if (value.detail) console.error(`leesh-loop: ${value.id}: ${value.detail}`);
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
  if (selectedCommand === 'open' && args.length === 0) {
    const manager = await ensureReadyManager({ openBrowser: true });
    if (manager.browserLaunchError) {
      console.error(`leesh-loop: Manager is running at ${manager.url}, but the browser could not be opened: ${manager.browserLaunchError}`);
      console.error(`Open this private bootstrap file in a browser to sign in: ${manager.browserBootstrapUrl}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Leesh Loop Manager: ${manager.url}`);
    return;
  }
  if (selectedCommand === 'init' && args.length === 0) {
    const manager = await ensureReadyManager();
    const result = await managerRequest(manager, '/api/v1/instances', { method: 'POST', body: { repositoryPath: process.cwd() } });
    console.log(`Leesh Loop instance created: ${result.instance.repository_name} (${result.instance.id})`);
    console.log(`Repository: ${result.instance.repository_root}`);
    console.log(`Manager: ${manager.url}`);
    return;
  }
  if (selectedCommand === 'list' && args.length === 0) {
    const manager = await ensureReadyManager();
    const result = await managerRequest(manager, '/api/v1/instances');
    printInstances(result.instances);
    return;
  }
  if (selectedCommand === 'start' && args.length === 1) {
    const manager = await ensureReadyManager();
    const result = await managerRequest(manager, `/api/v1/instances/${encodeURIComponent(args[0])}/start`, { method: 'POST' });
    console.log(`Loop ${result.instance.id}: ${result.instance.status}${result.instance.port ? ` on port ${result.instance.port}` : ''}`);
    return;
  }
  if (selectedCommand === 'stop' && args.length === 1) {
    const manager = await ensureReadyManager();
    const result = await managerRequest(manager, `/api/v1/instances/${encodeURIComponent(args[0])}/stop`, { method: 'POST' });
    console.log(`Loop ${result.instance.id}: ${result.instance.status}`);
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
