#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initLoop } from '../operator/app/init.mjs';
import { updateLoop } from '../operator/app/update.mjs';

const usage = [
  'Usage:',
  '  leesh-loop init             Create a Loop from the target repository root',
  '  leesh-loop update           Update runtime files from the installed distribution',
  '  leesh-loop update --workflow Replace only the generated WORKFLOW.md'
].join('\n');

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
    return;
  }
  if (command === 'update' && (args.length === 0 || (args.length === 1 && args[0] === '--workflow'))) {
    const cliPath = realpathSync(fileURLToPath(import.meta.url));
    const sourceRoot = resolve(dirname(cliPath), '..');
    const result = await updateLoop({ cwd: process.cwd(), sourceRoot, workflowOnly: args[0] === '--workflow' });
    console.log(`Leesh Loop ${result.area} update applied (${result.distributionId}).`);
    return;
  }
  if (command !== 'init' && command !== 'update' || args.length) {
    console.error(usage);
    process.exitCode = 2;
    return;
  }
}

main().catch(error => {
  console.error(`leesh-loop: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
