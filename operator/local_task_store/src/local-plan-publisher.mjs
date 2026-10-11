#!/usr/bin/env node
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { openLoopTaskStore } from '../../app/local-task-store-runtime.mjs';
import { publishAcceptedPlan } from './local-publisher.mjs';

async function main() {
  const args = process.argv.slice(2);
  const get = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  const planPath = get('--plan');
  const stateDirectory = get('--state-directory');
  const state = get('--state') || 'Ready';
  let blockedBy = [];
  const blockedByJson = get('--blocked-by-json');
  if (!planPath || !stateDirectory) throw new Error('usage: local-plan-publisher --plan PATH --state-directory PATH [--state STATE] [--blocked-by-json JSON]');
  if (blockedByJson !== undefined) {
    try { blockedBy = JSON.parse(blockedByJson); }
    catch { throw new Error('Blocked By must be a JSON list of task identities'); }
    if (!Array.isArray(blockedBy) || blockedBy.some(id => typeof id !== 'string')) throw new Error('Blocked By must be a JSON list of task identities');
  }
  const plan = await readFile(resolve(planPath), 'utf8');
  const store = await openLoopTaskStore(resolve(stateDirectory));
  try {
    const result = publishAcceptedPlan(store, plan, { state, blockedBy });
    process.stdout.write(`${JSON.stringify({ identifier: result.identifier, page_id: result.page_id, state: result.state })}\n`);
  } finally {
    store.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`Local Publisher error: ${error instanceof Error ? error.message : 'unknown error'}`); process.exitCode = 2; });
}
