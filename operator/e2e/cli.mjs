#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorkloadCatalog } from './model/workload-catalog.mjs';
import { loadE2EProjectConfig } from './model/e2e-project-config.mjs';
import { GitClient } from './systems/git/git-client.mjs';
import { GitHubClient } from './systems/github/github-client.mjs';
import { E2ELifecycleInterpreter } from './run/lifecycle/lifecycle-interpreter.mjs';
import { NotionClient } from './systems/notion/notion-client.mjs';
import { E2ERunner } from './run/e2e-runner.mjs';
import { NotionPublisherClient } from './systems/notion/notion-publisher-client.mjs';
import { RunEvidenceCollector } from './run/evidence/run-evidence-collector.mjs';
import { ChatgptShotClient } from './systems/chatgpt-shot/chatgpt-shot-client.mjs';
import { RunRecordStore } from './model/run-record-store.mjs';
import { OperatorClient } from './systems/operator/operator-client.mjs';
import { RunFinalizer } from './run/finalization/run-finalizer.mjs';
import { RunAdmission } from './run/admission/run-admission.mjs';
import { RunCompletionVerifier } from './run/lifecycle/run-completion-verifier.mjs';
import { RunLifecycleObserver } from './run/lifecycle/run-lifecycle-observer.mjs';
import { RunDoneVerifier } from './run/lifecycle/run-done-verifier.mjs';
import { RunTimingRecorder } from './run/run-timing.mjs';

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

async function createProductionRunDependencies(config, catalog) {
  const token = await localEnv('NOTION_TOKEN');
  const notionClient = new NotionClient({ token });
  const runRecordStore = new RunRecordStore(config);
  const operatorClient = new OperatorClient({ root });
  const gitClient = new GitClient({ repositoryUrl: config.repository_url });
  const githubClient = new GitHubClient({ repositoryUrl: config.repository_url });
  const chatgptShotClient = new ChatgptShotClient();
  const runEvidenceCollector = new RunEvidenceCollector({ notionClient, operatorClient, githubClient, gitClient, chatgptShotClient });
  const runTimingRecorder = new RunTimingRecorder();
  const runFinalizer = new RunFinalizer({ config, runRecordStore, notionClient, operatorClient, gitClient, githubClient, runEvidenceCollector, runTimingRecorder });
  const runCompletionVerifier = new RunCompletionVerifier({ gitClient, githubClient });
  const runDoneVerifier = new RunDoneVerifier({ runCompletionVerifier });
  const runAdmission = new RunAdmission({ config, catalog, runRecordStore, notionClient, gitClient, operatorClient, runFinalizer, runEvidenceCollector, runCompletionVerifier, runDoneVerifier, runTimingRecorder });
  const runLifecycleObserver = new RunLifecycleObserver({ config, notionClient, githubClient, runEvidenceCollector, runRecordStore, lifecycleInterpreter: new E2ELifecycleInterpreter(), runCompletionVerifier, runDoneVerifier, runFinalizer, runTimingRecorder });
  const notionPublisherClient = new NotionPublisherClient({ root, notionClient });
  return { notionClient, notionPublisherClient, gitClient, githubClient, operatorClient, chatgptShotClient, runEvidenceCollector, runRecordStore, runFinalizer, runCompletionVerifier, runDoneVerifier, runTimingRecorder, runAdmission, runLifecycleObserver };
}

async function main() {
  const [command = 'run', configArgument = join(here, 'project.json')] = process.argv.slice(2);
  const configPath = resolve(configArgument);
  const config = await loadE2EProjectConfig(configPath);
  const catalog = await loadWorkloadCatalog(join(dirname(configPath), 'catalog.json'));
  const dependencies = await createProductionRunDependencies(config, catalog);
  const runner = new E2ERunner({ config, catalog, ...dependencies });
  if (command === 'run') {
    await dependencies.notionPublisherClient.prepareProductionPublisher();
    const record = await runner.runProductionE2E();
    console.log(JSON.stringify({ run_id: record.run_id, status: record.status, terminal_state: record.lifecycle.terminal_state, verified_through: record.lifecycle.verified_through, finalization_complete: record.finalization.complete, record: record.paths.record }, null, 2));
    return;
  }
  if (command === 'admit') {
    const admission = await dependencies.runAdmission.checkRunAdmission();
    console.log(JSON.stringify({ candidates: admission.workload.map(candidate => candidate.id), task_count: admission.tasks.length, remote_ref_count: Object.keys(admission.refs).length }, null, 2));
    return;
  }
  throw new Error('Usage: node operator/e2e/cli.mjs <run|admit> [project.json]');
}

main().catch(error => { console.error(`E2E harness failed: ${error.message}`); process.exitCode = 1; });
