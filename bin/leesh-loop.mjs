#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initLoop } from '../operator/app/init.mjs';
import { updateLoop } from '../operator/app/update.mjs';
import { listLoopInstances, registerLoop, resolveLoopInstance } from '../operator/app/instance-registry.mjs';

const usage = [
  'Usage:',
  '  leesh-loop init             Create a Loop from the target repository root',
  '  leesh-loop update           Update runtime files from the installed distribution',
  '  leesh-loop update --workflow Replace only the generated WORKFLOW.md',
  '  leesh-loop list             List registered Loop instances',
  '  leesh-loop start <instance> Start a registered Loop',
  '  leesh-loop stop <instance>  Stop a registered Loop'
].join('\n');

function printInstances(instances) {
  if (instances.length === 0) {
    console.log('No Loop instances are registered.');
    return;
  }
  const rows = instances.map(value => [value.id, value.name, value.status, value.path]);
  const headers = ['ID', 'NAME', 'STATUS', 'PATH'];
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map(row => row[index].length)));
  console.log(headers.map((value, index) => value.padEnd(widths[index])).join('  '));
  for (const row of rows) console.log(row.map((value, index) => value.padEnd(widths[index])).join('  '));
  for (const value of instances) {
    if (value.detail) console.error(`leesh-loop: ${value.id}: ${value.detail}`);
  }
}

async function registerCompletedOperation(result, action) {
  try {
    const instance = await registerLoop({ cwd: result.destination || process.cwd() });
    console.log(`Global instance: ${instance.name} (${instance.id})`);
    return true;
  } catch (error) {
    const completed = action === 'init'
      ? `init completed and created ${result.destination}`
      : `${action} completed successfully`;
    console.error(`leesh-loop: ${completed}, but global registration failed: ${error.message}`);
    process.exitCode = 1;
    return false;
  }
}

async function runNpm(action, instance) {
  const selected = await resolveLoopInstance(instance);
  const result = spawnSync('npm', [action], { cwd: selected.path, stdio: 'inherit' });
  if (result.error) throw new Error(`could not run npm ${action} in ${selected.path}: ${result.error.message}`);
  if (result.signal) {
    console.error(`leesh-loop: npm ${action} for ${selected.id} ended from signal ${result.signal}`);
    process.exitCode = 1;
    return;
  }
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === '--help' || command === '-h') {
    console.log(usage);
    return;
  }
  if (command === 'init' && args.length === 0) {
    const cliPath = realpathSync(fileURLToPath(import.meta.url));
    const sourceRoot = resolve(dirname(cliPath), '..');
    const result = await initLoop({ cwd: process.cwd(), sourceRoot });
    console.log(result.completionOutput);
    await registerCompletedOperation(result, 'init');
    return;
  }
  if (command === 'update' && (args.length === 0 || (args.length === 1 && args[0] === '--workflow'))) {
    const cliPath = realpathSync(fileURLToPath(import.meta.url));
    const sourceRoot = resolve(dirname(cliPath), '..');
    const result = await updateLoop({ cwd: process.cwd(), sourceRoot, workflowOnly: args[0] === '--workflow' });
    console.log(`Leesh Loop ${result.area} update applied (${result.distributionId}).`);
    await registerCompletedOperation({}, `update${args[0] === '--workflow' ? ' --workflow' : ''}`);
    return;
  }
  if (command === 'list' && args.length === 0) {
    printInstances(await listLoopInstances());
    return;
  }
  if ((command === 'start' || command === 'stop') && args.length === 1 && !args[0].startsWith('-')) {
    await runNpm(command, args[0]);
    return;
  }
  console.error(usage);
  process.exitCode = 2;
}

main().catch(error => {
  console.error(`leesh-loop: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
