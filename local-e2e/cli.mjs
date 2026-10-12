#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { localTaskStorePath, openLoopTaskStore } from '../operator/app/local-task-store-runtime.mjs';

const execFile = promisify(execFileCallback);
const sourceRoot = resolve(import.meta.dirname, '..');
const workerScript = join(import.meta.dirname, 'controlled-worker.mjs');
const acceptedPlan = runId => [
  '# ' + runId + '-local-execution-e2e',
  '',
  '## Objective',
  '',
  'Exercise the Local Publisher, Symphony dispatch, and Local Worker tools in one isolated run.',
  '',
  '## Verification Requirements',
  '',
  '- Read the bound Task and immutable Accepted Plan through the Worker tool.',
  '- Record the Task State and Workpad through the Worker tools.',
  '- Confirm the final SQLite data after Symphony completes the Worker run.'
].join('\n') + '\n';

class StageError extends Error {
  constructor(stage, message, cause) {
    super(message, { cause });
    this.stage = stage;
  }
}

function quoteShell(value) {
  return "'" + String(value).replaceAll("'", "'\"'\"'") + "'";
}

function localEnvironment(extra = {}) {
  const environment = { ...process.env };
  for (const key of [
    'NOTION_TOKEN', 'LEESH_LOOP_NOTION_DATABASE_URL', 'CHATGPT_SHOT_NOTION_DATABASE_URL',
    'SYMPHONY_RUNTIME_ID', 'SYMPHONY_DISPATCH_AUTHORIZATION_FILE', 'SYMPHONY_DISPATCH_ACK_FILE',
    'SYMPHONY_OWNERSHIP_FILE', 'SYMPHONY_OPERATOR_STARTUP_STATUS_FILE', 'SYMPHONY_OPERATOR_READINESS_FILE',
    'SYMPHONY_OPERATOR_INTERFACE_ROOT', 'CHATGPT_SHOT_WORKER_DISCOVERY_PATH', 'CHATGPT_SHOT_WORKER_INTERFACE_ROOT',
    'GH_TOKEN', 'GITHUB_TOKEN', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'GIT_ASKPASS', 'SSH_AUTH_SOCK',
    'OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_HOME'
  ]) delete environment[key];
  environment.SYMPHONY_DISPATCH_BARRIER = 'open';
  environment.npm_config_cache = join(tmpdir(), 'leesh-loop-local-e2e-npm-cache');
  return { ...environment, ...extra };
}

async function command(file, args, options = {}) {
  try {
    return await execFile(file, args, {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      timeout: 30_000,
      ...options
    });
  } catch (error) {
    const detail = String(error?.stderr || error?.stdout || error?.message || error).trim();
    throw new Error(file + ' ' + args.join(' ') + ' failed' + (detail ? ': ' + detail.slice(-3_000) : ''), { cause: error });
  }
}

async function git(cwd, ...args) {
  return command('git', args, { cwd, env: localEnvironment() });
}

async function makeLocalRemote(root) {
  const bare = join(root, 'target.git');
  const seed = join(root, 'target-seed');
  await mkdir(seed, { recursive: true });
  await git(root, 'init', '--quiet', '--bare', '--initial-branch=main', bare);
  await git(seed, 'init', '--quiet', '--initial-branch=main');
  await git(seed, 'config', 'user.name', 'Local E2E');
  await git(seed, 'config', 'user.email', 'local-e2e@example.invalid');
  await writeFile(join(seed, 'README.md'), '# Isolated Local E2E target\n');
  await git(seed, 'add', 'README.md');
  await git(seed, 'commit', '--quiet', '-m', 'Initialize isolated E2E target');
  await git(seed, 'remote', 'add', 'origin', bare);
  await git(seed, 'push', '--quiet', 'origin', 'main');
  return bare;
}

function workflowContents({ root, bareRepository, runId, expectedComment }) {
  const afterCreate = 'git clone --branch "$SYMPHONY_GITHUB_BASE_BRANCH" ' + quoteShell(bareRepository) + ' .';
  const codexCommand = process.execPath + ' ' + quoteShell(workerScript);
  return [
    '---',
    'tracker:',
    '  kind: notion',
    '  active_states: ["Ready", "In Progress", "Rework", "Merging"]',
    '  terminal_states: ["Done", "Cancelled"]',
    'workspace:',
    '  root: ' + JSON.stringify(join(root, 'workspaces')),
    '  hooks:',
    '    after_create: ' + JSON.stringify(afterCreate),
    '  timeout_ms: 30000',
    'polling:',
    '  interval_ms: 100',
    'agent:',
    '  max_concurrent_agents: 1',
    '  max_turns: 1',
    'codex:',
    '  command: ' + JSON.stringify(codexCommand),
    '  turn_timeout_ms: 20000',
    '  read_timeout_ms: 5000',
    '  stall_timeout_ms: 20000',
    '---',
    'Controlled Local E2E Worker run ' + runId + '.',
    'Expected setup Comment: ' + expectedComment
  ].join('\n') + '\n';
}

function projectToml({ root, bareRepository }) {
  return [
    'github_repository_url = ' + JSON.stringify(bareRepository),
    'github_base_branch = "main"',
    'workflow_path = ' + JSON.stringify(join(root, 'WORKFLOW.md')),
    'symphony_workspace_root = ' + JSON.stringify(join(root, 'workspaces')),
    'state_directory = ' + JSON.stringify(join(root, 'state')),
    'task_store = "local"'
  ].join('\n') + '\n';
}

function stopProcessGroup(child, signal = 'SIGTERM') {
  if (!child?.pid) return;
  try { process.kill(-child.pid, signal); }
  catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

async function waitForProcessClose(child, milliseconds) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise(resolveClose => child.once('close', resolveClose)),
    new Promise(resolveTimeout => setTimeout(resolveTimeout, milliseconds))
  ]);
}

async function readSymphonyLog(logPath) {
  const directory = dirname(logPath);
  const base = logPath.slice(directory.length + 1);
  const files = await readdir(directory).catch(() => []);
  const matching = files.filter(name => name === base || /^\d+$/.test(name.slice(base.length + 1)) && name.startsWith(base + '.')).sort();
  const contents = await Promise.all(matching.map(name => readFile(join(directory, name), 'utf8').catch(() => '')));
  return contents.join('\n');
}

async function stopRuntime(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  stopProcessGroup(child, 'SIGTERM');
  await waitForProcessClose(child, 3_000);
  if (child.exitCode === null && child.signalCode === null) {
    stopProcessGroup(child, 'SIGKILL');
    await waitForProcessClose(child, 3_000);
  }
}

async function waitForWorker({ child, eventPath, logPath, processOutputPath, taskId, timeoutMs = 180_000 }) {
  const expires = Date.now() + timeoutMs;
  while (Date.now() < expires) {
    const event = await readFile(eventPath, 'utf8').then(JSON.parse).catch(() => null);
    const log = await readSymphonyLog(logPath);
    if (event) {
      if (!log.includes('Dispatching issue to agent: issue_id=' + taskId)) {
        await new Promise(resolveWait => setTimeout(resolveWait, 25));
        continue;
      }
      if (event.status === 'failed') throw new StageError('Worker tool', event.error || 'controlled Worker reported a failure');
      if (!log.includes('Agent task finished for issue_id=' + taskId)) {
        await new Promise(resolveWait => setTimeout(resolveWait, 25));
        continue;
      }
      return { event, log };
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      const tail = await readSymphonyLog(logPath);
      const processTail = await readFile(processOutputPath, 'utf8').catch(() => '');
      throw new StageError('Symphony process', 'Symphony exited before Worker completion (exit=' + child.exitCode + ', signal=' + child.signalCode + '). ' + (tail + processTail).slice(-3_000));
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 50));
  }
  const log = await readSymphonyLog(logPath);
  const processTail = await readFile(processOutputPath, 'utf8').catch(() => '');
  throw new StageError('Symphony dispatch', 'Timed out waiting for the Symphony Worker run. ' + (log + processTail).slice(-3_000));
}

async function publish({ root, projectFile, planFile, failAt }) {
  const actualPlanPath = failAt === 'publisher' ? join(root, 'missing-plan.md') : planFile;
  let output;
  try {
    output = await command(process.execPath, [
      join(sourceRoot, 'operator/app/publish-local-plan.mjs'),
      projectFile,
      '--plan', actualPlanPath
    ], { cwd: root, env: localEnvironment() });
  } catch (error) {
    throw new StageError('Publisher', error.message, error);
  }
  try { return JSON.parse(output.stdout); }
  catch (error) { throw new StageError('Publisher', 'Publisher returned invalid JSON: ' + output.stdout, error); }
}

async function runLocalE2e({ failAt } = {}) {
  if (failAt && !['publisher', 'worker-tool'].includes(failAt)) throw new Error('--fail-at must be publisher or worker-tool');
  const runId = randomUUID();
  const root = await mkdtemp(join(tmpdir(), 'leesh-loop-local-e2e-'));
  const logPath = join(root, 'logs', 'log', 'symphony.log');
  const processOutputPath = join(root, 'logs', 'symphony-process.log');
  const workerEventPath = join(root, 'worker', 'event.json');
  const comment = 'Local E2E user Comment ' + runId;
  const plan = acceptedPlan(runId);
  const planFile = join(root, 'accepted-plan.md');
  const projectFile = join(root, 'project.toml');
  const stateDirectory = join(root, 'state');
  const databasePath = localTaskStorePath(stateDirectory);
  let runSummary = { runId, root, stage: 'setup', status: 'running' };
  let runtime;
  let runtimeClose;
  let keepArtifacts = false;

  try {
    const bareRepository = await makeLocalRemote(root);
    await writeFile(planFile, plan, { mode: 0o600 });
    await writeFile(projectFile, projectToml({ root, bareRepository }), { mode: 0o600 });
    await writeFile(join(root, 'WORKFLOW.md'), workflowContents({ root, bareRepository, runId, expectedComment: comment }), { mode: 0o600 });
    await mkdir(dirname(logPath), { recursive: true, mode: 0o700 });
    await mkdir(dirname(workerEventPath), { recursive: true, mode: 0o700 });

    runSummary.stage = 'Publisher';
    const published = await publish({ root, projectFile, planFile, failAt });
    runSummary.identifier = published.identifier;
    runSummary.taskId = published.page_id;
    if (published.state !== 'Ready') throw new StageError('Publisher', 'Published Task did not enter Ready.');
    if (failAt === 'publisher') throw new StageError('Publisher', 'Injected Publisher failure was not observed.');

    const store = await openLoopTaskStore(stateDirectory);
    try {
      const task = store.getTask(published.page_id);
      if (!task || task.identifier !== published.identifier || task.acceptedPlan !== plan || task.state !== 'Ready') {
        throw new StageError('Publisher readback', 'Published Task properties or Accepted Plan did not match the submitted input.');
      }
      store.appendComment(task.id, comment, 'user');
    } finally {
      store.close();
    }
    await git(root, '--git-dir', bareRepository, 'ls-tree', '-r', '--name-only', 'main').then(({ stdout }) => {
      if (stdout.split(/\r?\n/).includes('docs/plans/active/' + runId + '-local-execution-e2e.md')) {
        throw new StageError('Publisher', 'Accepted Plan unexpectedly appeared in the target Git repository.');
      }
    });

    runSummary.stage = 'Symphony dispatch and Worker';
    const runtimeEnvironment = localEnvironment({
      LEESH_LOOP_TRACKER_KIND: 'local',
      LEESH_LOOP_LOCAL_TASK_STORE_PATH: databasePath,
      LEESH_LOOP_RUNTIME_ROOT: sourceRoot,
      LOCAL_E2E_WORKER_EVENT_FILE: workerEventPath,
      LOCAL_E2E_RUN_ID: runId,
      LOCAL_E2E_EXPECTED_TASK_ID: published.page_id,
      LOCAL_E2E_EXPECTED_PLAN_SHA256: createHash('sha256').update(plan).digest('hex'),
      LOCAL_E2E_EXPECTED_COMMENT: comment,
      ...(failAt ? { LOCAL_E2E_FAIL_AT: failAt } : {}),
      SYMPHONY_WORKSPACE_ROOT: join(root, 'workspaces'),
      SYMPHONY_GITHUB_REPOSITORY_URL: bareRepository,
      SYMPHONY_GITHUB_BASE_BRANCH: 'main'
    });
    runtime = spawn(join(sourceRoot, 'operator/app/run-symphony'), [
      '--logs-root', join(root, 'logs'),
      '--port', '0',
      '--i-understand-that-this-will-be-running-without-the-usual-guardrails',
      join(root, 'WORKFLOW.md')
    ], {
      cwd: join(sourceRoot, 'operator/symphony'),
      env: runtimeEnvironment,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const processOutput = { tail: '' };
    const outputStream = createWriteStream(processOutputPath, { flags: 'a', mode: 0o600 });
    for (const stream of [runtime.stdout, runtime.stderr]) {
      stream.on('data', chunk => {
        processOutput.tail = (processOutput.tail + chunk.toString()).slice(-20_000);
        outputStream.write(chunk);
      });
    }
    runtime.on('error', error => { processOutput.spawnError = error; });
    runtimeClose = new Promise(resolveClose => runtime.once('close', (...result) => {
      outputStream.end(() => resolveClose(result));
    }));

    const expectedTools = ['local_task_read', 'local_task_comments', 'local_task_read_workpad', 'local_task_set_state', 'local_task_append_workpad', 'local_task_read', 'local_task_read_workpad'];
    if (failAt === 'worker-tool') {
      const expires = Date.now() + 180_000;
      let event;
      while (Date.now() < expires && !event) {
        event = await readFile(workerEventPath, 'utf8').then(JSON.parse).catch(() => null);
        if (!event) await new Promise(resolveWait => setTimeout(resolveWait, 50));
      }
      if (!event) throw new StageError('Worker tool', 'Timed out waiting for the injected Worker tool failure.');
      let log = '';
      const logExpires = Date.now() + 5_000;
      while (Date.now() < logExpires && !log.includes('dynamic tool call failed (local_task_set_state)')) {
        log = await readSymphonyLog(logPath);
        if (!log.includes('dynamic tool call failed (local_task_set_state)')) await new Promise(resolveWait => setTimeout(resolveWait, 25));
      }
      if (event.status !== 'failed' || !event.calls.some(call => call.tool === 'local_task_set_state' && call.success === false)) {
        throw new StageError('Worker tool', 'Injected Local Worker tool failure was not observed.');
      }
      if (!log.includes('dynamic tool call failed (local_task_set_state)')) {
        throw new StageError('Worker tool', 'Symphony did not log the failed Local Worker tool call.');
      }
      throw new StageError('Worker tool', event.error || 'injected tool failure');
    }

    const { event, log } = await waitForWorker({
      child: runtime,
      eventPath: workerEventPath,
      logPath,
      processOutputPath,
      taskId: published.page_id
    });
    runSummary.stage = 'Authoritative SQLite readback';
    if (event.status !== 'complete' || event.runId !== runId || event.taskId !== published.page_id) {
      throw new StageError('Worker run', 'Controlled Worker event does not match this published task/run.');
    }
    const actualCalls = event.calls.map(call => call.tool);
    if (JSON.stringify(actualCalls) !== JSON.stringify(expectedTools) || event.calls.some(call => !call.success)) {
      throw new StageError('Worker tools', 'Controlled Worker did not complete the expected Local tool sequence.');
    }
    if (!log.includes('Dispatching issue to agent: issue_id=' + published.page_id) ||
        !log.includes('dynamic tool call completed (local_task_read)') ||
        !log.includes('dynamic tool call completed (local_task_append_workpad)')) {
      throw new StageError('Symphony evidence', 'Symphony dispatch or Local Worker tool completion evidence is missing.');
    }

    const resultStore = await openLoopTaskStore(stateDirectory);
    let finalTask;
    let records;
    let comments;
    try {
      finalTask = resultStore.getTask(published.page_id);
      records = resultStore.listRecords(published.page_id);
      comments = resultStore.listRecords(published.page_id, { kind: 'comment' });
    } finally {
      resultStore.close();
    }
    const expectedWorkpad = 'Local E2E ' + runId + ': controlled Worker data access completed.';
    if (!finalTask || finalTask.id !== published.page_id || finalTask.identifier !== published.identifier ||
        finalTask.state !== 'In Progress' || finalTask.acceptedPlan !== plan ||
        !records.some(record => record.kind === 'workpad' && record.content === expectedWorkpad) ||
        !comments.some(record => record.content === comment && record.author === 'user')) {
      throw new StageError('Authoritative SQLite readback', 'Final Task State, Accepted Plan, Comment, or Workpad did not match the Worker activity.');
    }

    runSummary = {
      runId,
      status: 'passed',
      taskId: published.page_id,
      identifier: published.identifier,
      initialState: published.state,
      finalState: finalTask.state,
      workerPid: event.workerPid,
      workerTools: actualCalls,
      workpadRecords: records.filter(record => record.kind === 'workpad').length,
      commentRecords: comments.length,
      localDatabase: databasePath,
      symphonyLog: logPath
    };
    await writeFile(join(root, 'run-summary.json'), JSON.stringify(runSummary, null, 2) + '\n', { mode: 0o600 });
    return { ...runSummary, artifacts: 'removed after readback' };
  } catch (error) {
    keepArtifacts = true;
    const stage = error instanceof StageError ? error.stage : runSummary.stage;
    const failure = {
      runId,
      status: 'failed',
      stage,
      error: error instanceof Error ? error.message : String(error),
      taskId: runSummary.taskId || null,
      identifier: runSummary.identifier || null,
      artifacts: root,
      symphonyLog: logPath,
      symphonyProcessLog: processOutputPath
    };
    await writeFile(join(root, 'run-summary.json'), JSON.stringify(failure, null, 2) + '\n', { mode: 0o600 }).catch(() => {});
    throw new StageError(stage, JSON.stringify(failure), error);
  } finally {
    if (runtime) {
      await stopRuntime(runtime).catch(() => {});
      await runtimeClose?.catch(() => {});
    }
    if (!keepArtifacts) await rm(root, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const failAt = args.includes('--fail-at') ? args[args.indexOf('--fail-at') + 1] : undefined;
  const summary = await runLocalE2e({ failAt });
  process.stdout.write(JSON.stringify(summary) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error('Local E2E failed: ' + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}

export { runLocalE2e };
