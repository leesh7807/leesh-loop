import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(appDirectory, '../local_task_store');
const databaseFile = 'local-task-store.sqlite';
const databaseDirectory = 'local-task-store';

function preparePackage() {
  if (existsSync(join(packageDirectory, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'))) return;
  const install = spawnSync('npm', ['ci'], { cwd: packageDirectory, stdio: ['ignore', process.stderr.fd, 'inherit'], env: process.env });
  if (install.error) throw new Error(`Local Task Store dependency preparation failed: ${install.error.message}`);
  if (install.status !== 0) throw new Error(`Local Task Store dependency preparation failed${install.signal ? ` (${install.signal})` : ` (exit code ${install.status})`}`);
}

export async function openLoopTaskStore(stateDirectory) {
  if (typeof stateDirectory !== 'string' || !stateDirectory.trim()) throw new TypeError('stateDirectory must be a non-empty path');
  preparePackage();
  const { openLocalTaskStore } = await import('../local_task_store/src/local-task-store.mjs');
  return openLocalTaskStore(join(resolve(stateDirectory), databaseDirectory, databaseFile));
}

export async function initializeLoopTaskStore(stateDirectory) {
  const store = await openLoopTaskStore(stateDirectory);
  store.close();
  return join(resolve(stateDirectory), databaseDirectory, databaseFile);
}
