#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from './catalog.mjs';
import { loadConfig } from './config.mjs';
import { GitCapability } from './git.mjs';
import { GitHubCapability } from './github.mjs';
import { LifecycleInterpreter } from './lifecycle.mjs';
import { NotionCapability } from './notion.mjs';
import { E2EOrchestrator } from './orchestrator.mjs';
import { PublisherCapability } from './publisher.mjs';
import { EvidenceCollector } from './evidence.mjs';
import { ChatgptShotCapability } from './review.mjs';
import { RunStore } from './record.mjs';
import { RuntimeCapability } from './runtime.mjs';
import { Finalizer } from './finalize.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

async function localEnv(name) {
  if (process.env[name]) return process.env[name];
  try {
    const content = await readFile(join(root, '.env'), 'utf8');
    const line = content.split(/\r?\n/).find(value => value.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, '');
  } catch { return undefined; }
}

async function buildHarness(config, catalog) {
  const token = await localEnv('NOTION_TOKEN');
  const notion = new NotionCapability({ token });
  const store = new RunStore(config);
  const runtime = new RuntimeCapability({ root });
  const git = new GitCapability({ repositoryUrl: config.repository_url });
  const github = new GitHubCapability({ repositoryUrl: config.repository_url });
  const review = new ChatgptShotCapability();
  const evidence = new EvidenceCollector({ notion, runtime, github, git, review });
  const finalizer = new Finalizer({ config, store, notion, runtime, git, github, evidence });
  const publisher = new PublisherCapability({ root, notion });
  return { config, catalog, capabilities: { notion, publisher, git, github, runtime, review, evidence, finalizer, store, lifecycle: new LifecycleInterpreter() } };
}

async function main() {
  const [command = 'run', configArgument = join(here, 'project.json')] = process.argv.slice(2);
  const configPath = resolve(configArgument);
  const config = await loadConfig(configPath);
  const catalog = await loadCatalog(join(dirname(configPath), 'catalog.json'));
  const harness = await buildHarness(config, catalog);
  const orchestrator = new E2EOrchestrator(harness);
  if (command === 'run') {
    await harness.capabilities.publisher.prepare();
    const record = await orchestrator.run();
    console.log(JSON.stringify({ run_id: record.run_id, status: record.status, terminal_state: record.lifecycle.terminal_state, verified_through: record.lifecycle.verified_through, finalization_complete: record.finalization.complete, record: record.paths.record }, null, 2));
    return;
  }
  if (command === 'admit') {
    const admission = await orchestrator.admit();
    console.log(JSON.stringify({ candidates: admission.workload.map(candidate => candidate.id), task_count: admission.tasks.length, remote_ref_count: Object.keys(admission.refs).length }, null, 2));
    return;
  }
  throw new Error('Usage: node operator/e2e/cli.mjs <run|admit> [project.json]');
}

main().catch(error => { console.error(`E2E harness failed: ${error.message}`); process.exitCode = 1; });
