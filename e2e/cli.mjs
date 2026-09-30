#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdir, open, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorkloadCatalog } from './model/workload-catalog.mjs';
import { loadE2ERuntimeConfig } from './model/e2e-runtime-config.mjs';
import { resolveE2ERunInput } from './model/run-input.mjs';
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
import { GitEventStore } from './systems/git/git-event-store.mjs';
import { DatabaseReservationAuthority } from './run/admission/database-reservation-authority.mjs';
import { RunCompletionVerifier } from './run/lifecycle/run-completion-verifier.mjs';
import { RunLifecycleObserver } from './run/lifecycle/run-lifecycle-observer.mjs';
import { RunDoneVerifier } from './run/lifecycle/run-done-verifier.mjs';
import { RunTimingRecorder } from './run/run-timing.mjs';
import { readRepositoryEnvironmentValue } from '../operator/local-environment.mjs';
import { createRunId, waitForNextPoll } from './run/run-timing.mjs';
import { currentProcessIdentity, inspectProcessIdentity } from './model/process-identity.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

async function createProductionRunDependencies(config, catalog) {
  const token = await readRepositoryEnvironmentValue('NOTION_TOKEN');
  const notionClient = new NotionClient({ token });
  const runRecordStore = new RunRecordStore(config);
  const operatorClient = new OperatorClient({ root });
  const gitClient = new GitClient({ repositoryUrl: config.repository_url });
  const githubClient = new GitHubClient({ repositoryUrl: config.repository_url });
  const chatgptShotClient = new ChatgptShotClient();
  const runEvidenceCollector = new RunEvidenceCollector({ notionClient, operatorClient, githubClient, gitClient, chatgptShotClient });
  const runTimingRecorder = new RunTimingRecorder();
  const eventStore = new GitEventStore({ repositoryUrl: config.repository_url, workspaceRoot: config.run_record_directory });
  const reservationAuthority = new DatabaseReservationAuthority({ eventStore });
  const runFinalizer = new RunFinalizer({ config, runRecordStore, notionClient, operatorClient, gitClient, githubClient, runEvidenceCollector, runTimingRecorder, reservationAuthority });
  const runCompletionVerifier = new RunCompletionVerifier({ gitClient, githubClient });
  const runDoneVerifier = new RunDoneVerifier({ runCompletionVerifier });
  const runAdmission = new RunAdmission({ config, catalog, runRecordStore, notionClient, gitClient, operatorClient, runFinalizer, runEvidenceCollector, runCompletionVerifier, runDoneVerifier, runTimingRecorder, reservationAuthority });
  const runLifecycleObserver = new RunLifecycleObserver({ config, notionClient, githubClient, runEvidenceCollector, runRecordStore, lifecycleInterpreter: new E2ELifecycleInterpreter(), runCompletionVerifier, runDoneVerifier, runFinalizer, runTimingRecorder });
  const notionPublisherClient = new NotionPublisherClient({ root, notionClient });
  return { notionClient, notionPublisherClient, gitClient, githubClient, operatorClient, chatgptShotClient, runEvidenceCollector, runRecordStore, runFinalizer, runCompletionVerifier, runDoneVerifier, runTimingRecorder, runAdmission, runLifecycleObserver, reservationAuthority };
}

function parseArguments(argv) {
  const values = [...argv];
  const commands = new Set(['run', 'admit', 'execute']);
  const command = commands.has(values[0]) ? values.shift() : 'run';
  const options = {};
  const supported = new Set(['--plan', '--hard-cap-ms', '--workflow', '--run-id']);
  while (values.length) {
    const name = values.shift();
    if (!supported.has(name)) throw new Error(`unknown E2E option: ${name}`);
    if (Object.hasOwn(options, name)) throw new Error(`duplicate E2E option: ${name}`);
    const value = values.shift();
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
    options[name] = value;
  }
  if (options['--hard-cap-ms'] !== undefined) {
    if (!/^\d+$/.test(options['--hard-cap-ms'])) throw new Error('--hard-cap-ms must be a positive integer');
    const hardCapMs = Number(options['--hard-cap-ms']);
    if (!Number.isSafeInteger(hardCapMs) || hardCapMs <= 0) throw new Error('--hard-cap-ms must be a positive integer');
    options.hardCapMs = hardCapMs;
  }
  if (command !== 'execute' && options['--run-id'] !== undefined) throw new Error('--run-id is reserved for the E2E execution boundary');
  if (command === 'execute' && (!/^[0-9a-f-]{36}$/i.test(options['--run-id'] || '') || process.env.LEESH_LOOP_E2E_EXECUTION_BOUNDARY !== '1')) {
    throw new Error('execute is an internal E2E-owned runtime command');
  }
  return { command, planPath: options['--plan'], workflowPath: options['--workflow'], hardCapMs: options.hardCapMs, runId: options['--run-id'] };
}

async function createRunner({ planPath, workflowPath, hardCapMs }) {
  const config = await loadE2ERuntimeConfig({ root });
  const runInput = await resolveE2ERunInput({ config, planPath, workflowPath, hardCapMs });
  const catalog = runInput.workload ? [] : await loadWorkloadCatalog(resolve(here, 'catalog.json'));
  const dependencies = await createProductionRunDependencies(config, catalog);
  const runner = new E2ERunner({ config, catalog, runInput, ...dependencies });
  return { config, runInput, dependencies, runner };
}

function terminalRunRecord(record) {
  return record?.kind === 'e2e_run_admission'
    || ['finished', 'failed', 'resource_unavailable_admission'].includes(record?.status);
}

async function readRunRecord(recordPath) {
  try { return JSON.parse(await readFile(recordPath, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
}

async function launchSupportedRun({ planPath, workflowPath, hardCapMs }) {
  const runId = createRunId();
  const runDirectory = join(root, 'e2e/runs', runId);
  const recordPath = join(runDirectory, 'run.json');
  const logPath = join(runDirectory, 'execution.log');
  await mkdir(runDirectory, { recursive: true, mode: 0o700 });
  const logFile = await open(logPath, 'a', 0o600);
  const childArgs = [fileURLToPath(import.meta.url), 'execute', '--run-id', runId];
  if (planPath !== undefined) childArgs.push('--plan', planPath);
  if (workflowPath !== undefined) childArgs.push('--workflow', workflowPath);
  if (hardCapMs !== undefined) childArgs.push('--hard-cap-ms', String(hardCapMs));
  let child;
  let childExitCode = null;
  try {
    child = spawn(process.execPath, childArgs, {
      cwd: root,
      detached: true,
      stdio: ['ignore', logFile.fd, logFile.fd],
      env: { ...process.env, LEESH_LOOP_E2E_EXECUTION_BOUNDARY: '1' }
    });
    await new Promise((resolveSpawn, rejectSpawn) => {
      child.once('spawn', resolveSpawn);
      child.once('error', rejectSpawn);
    });
    child.once('exit', code => { childExitCode = code ?? 1; });
  } finally {
    await logFile.close();
  }
  const executionIdentity = { pid: child.pid, process_start_ticks: null, boot_id: null };
  try { Object.assign(executionIdentity, await currentProcessIdentity(child.pid)); }
  catch { /* the durable run lifecycle remains the liveness authority */ }
  child.unref();

  while (true) {
    const record = await readRunRecord(recordPath);
    if (terminalRunRecord(record)) return record;
    if (executionIdentity.process_start_ticks && await inspectProcessIdentity(executionIdentity) === 'dead') {
      const finalReadback = await readRunRecord(recordPath);
      if (terminalRunRecord(finalReadback)) return finalReadback;
      const log = (await readFile(logPath, 'utf8').catch(() => '')).trim();
      throw new Error(`E2E-owned run process ${runId} exited without terminal lifecycle readback${log ? `: ${log.slice(-2_000)}` : ''}`);
    }
    if (childExitCode !== null) {
      const log = (await readFile(logPath, 'utf8').catch(() => '')).trim();
      throw new Error(`E2E-owned run process ${runId} exited with ${childExitCode} without terminal lifecycle readback${log ? `: ${log.slice(-2_000)}` : ''}`);
    }
    await waitForNextPoll(500);
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const { command, planPath, workflowPath, hardCapMs, runId } = args;
  if (command === 'run') {
    const record = await launchSupportedRun({ planPath, workflowPath, hardCapMs });
    console.log(JSON.stringify({ run_id: record.run_id, status: record.status, terminal_state: record.lifecycle?.terminal_state || null, verified_through: record.lifecycle?.verified_through || null, finalization_complete: record.finalization?.complete || false, database_id: record.binding?.database_id || null, run_origin: record.run_origin || null, record: record.paths?.record || join(root, 'e2e/runs', record.run_id, 'run.json') }, null, 2));
    if (record.status === 'failed') process.exitCode = 1;
    return;
  }
  if (command === 'admit') {
    const { runInput, dependencies } = await createRunner({ planPath, workflowPath, hardCapMs });
    const admission = await dependencies.runAdmission.inspectPool();
    console.log(JSON.stringify({ workload_source: runInput.workload ? 'provided' : 'catalog_random', ...admission }, null, 2));
    return;
  }
  if (command === 'execute') {
    const { runner } = await createRunner({ planPath, workflowPath, hardCapMs });
    const record = await runner.runProductionE2E({ runId });
    if (record.status === 'failed') process.exitCode = 1;
    return;
  }
  throw new Error('Usage: npm run e2e [-- --plan PATH] [--hard-cap-ms MS] [--workflow PATH]');
}

main().catch(error => { console.error(`E2E harness failed: ${error.message}`); process.exitCode = 1; });
