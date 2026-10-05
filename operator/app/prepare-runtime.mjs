#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const symphonyDirectory = resolve(root, 'operator/symphony');
const result = spawnSync('mise', ['exec', '--', 'mix', 'deps.get'], {
  cwd: symphonyDirectory,
  stdio: 'inherit',
  env: process.env
});

if (result.error) {
  console.error(`This Loop needs mise to prepare its runtime dependencies. Install mise and retry npm start. ${result.error.message}`);
  process.exitCode = 1;
} else if (result.status !== 0) {
  console.error(`This Loop could not prepare its runtime dependencies${result.signal ? ` (${result.signal})` : ` (exit code ${result.status})`}. Check the setup output above, then retry npm start.`);
  process.exitCode = result.status || 1;
}
