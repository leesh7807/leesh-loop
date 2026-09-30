#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initLoop } from '../operator/app/init.mjs';

const usage = 'Usage: leesh-loop init';

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === '--help' || command === '-h') {
    console.log(usage);
    return;
  }
  if (command !== 'init' || args.length) {
    console.error(usage);
    process.exitCode = 2;
    return;
  }

  const cliPath = realpathSync(fileURLToPath(import.meta.url));
  const sourceRoot = resolve(dirname(cliPath), '..');
  const result = await initLoop({ cwd: process.cwd(), sourceRoot });
  console.log(result.completionOutput);
}

main().catch(error => {
  console.error(`leesh-loop: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
