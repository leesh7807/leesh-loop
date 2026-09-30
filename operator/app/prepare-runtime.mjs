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
  console.error(`Generated Loop dependency preparation requires mise: ${result.error.message}`);
  process.exitCode = 1;
} else if (result.status !== 0) {
  console.error(`Generated Loop Symphony dependency preparation failed${result.signal ? ` (${result.signal})` : ` with exit code ${result.status}`}.`);
  process.exitCode = result.status || 1;
}
