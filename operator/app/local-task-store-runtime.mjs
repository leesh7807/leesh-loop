import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareNpmDependencies } from './dependency-preparation.mjs';

const appDirectory = dirname(fileURLToPath(import.meta.url));
const databaseFile = 'local-task-store.sqlite';
const databaseDirectory = 'local-task-store';

export function localTaskStorePath(stateDirectory) {
  if (typeof stateDirectory !== 'string' || !stateDirectory.trim()) throw new TypeError('stateDirectory must be a non-empty path');
  return join(resolve(stateDirectory), databaseDirectory, databaseFile);
}

export async function openLoopTaskStore(stateDirectory) {
  prepareNpmDependencies({ loopRoot: resolve(appDirectory, '../..'), component: 'local-task-store' });
  const { openLocalTaskStore } = await import('../local_task_store/src/local-task-store.mjs');
  return openLocalTaskStore(localTaskStorePath(stateDirectory));
}

export async function initializeLoopTaskStore(stateDirectory) {
  const store = await openLoopTaskStore(stateDirectory);
  store.close();
  return localTaskStorePath(stateDirectory);
}
