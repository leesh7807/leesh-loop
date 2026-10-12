#!/usr/bin/env node
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { readProjectConfiguration } from '../project-config.mjs';
import { openLoopTaskStore } from './local-task-store-runtime.mjs';
import { publishAcceptedPlan } from '../local_task_store/src/local-publisher.mjs';

const operatorRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function publishLocalPlan({ projectFile, planPath, state = 'Ready', blockedBy = [] }) {
  if (!projectFile || !planPath) throw new Error('usage: publish-local-plan PROJECT.toml --plan PATH [--state STATE] [--blocked-by-json JSON]');
  const project = await readProjectConfiguration(resolve(projectFile));
  if (project.task_store !== 'local') throw new Error('project.toml must set task_store = "local" to publish through the Local Task Store');
  const stateDirectory = project.state_directory || join(operatorRoot, '.runtime');
  const plan = await readFile(resolve(planPath), 'utf8');
  const store = await openLoopTaskStore(stateDirectory);
  try {
    const result = publishAcceptedPlan(store, plan, { state, blockedBy });
    return { identifier: result.identifier, page_id: result.page_id, state: result.state };
  } finally {
    store.close();
  }
}

async function main() {
  const [projectFile, ...args] = process.argv.slice(2);
  const get = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  const blockedByJson = get('--blocked-by-json');
  let blockedBy = [];
  if (blockedByJson !== undefined) {
    try { blockedBy = JSON.parse(blockedByJson); }
    catch { throw new Error('Blocked By must be a JSON list of task identities'); }
    if (!Array.isArray(blockedBy) || blockedBy.some(id => typeof id !== 'string')) throw new Error('Blocked By must be a JSON list of task identities');
  }
  const result = await publishLocalPlan({
    projectFile,
    planPath: get('--plan'),
    state: get('--state') || 'Ready',
    blockedBy
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`Local Publisher error: ${error instanceof Error ? error.message : 'unknown error'}`); process.exitCode = 2; });
}
