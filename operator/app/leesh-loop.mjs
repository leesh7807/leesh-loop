#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { chmod, mkdir, open, readFile, readlink, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { normalizeWorkspaceFiles, validateWorkspaceFiles } from './workspace-files.mjs';
import { validateBaseBranch } from './git-target.mjs';
import { readRepositoryEnvironmentValue } from '../local-environment.mjs';
import { resolveProjectPath } from '../local-path.mjs';
import { PROJECT_DEFAULTS } from '../project-defaults.mjs';
import { defaultOperatorUiDependencies, readRequestBody, startOperatorUiServer } from './operator-ui-server.mjs';

const appScript = fileURLToPath(import.meta.url);
const root = resolve(dirname(appScript), '../..');
const appRoot = join(root, 'operator');
const defaultConfig = join(appRoot, 'project.json');
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
const canonical = value => resolve(value);
const stateRoot = config => canonical(config.state_directory || join(appRoot, '.runtime'));
const paths = config => { const dir = stateRoot(config); return { dir, state: join(dir, 'runtime.json'), ui: join(dir, 'publish-ui.json'), lock: join(dir, 'lifecycle.lock'), ownership: join(dir, 'ownership.json'), authorization: join(dir, 'dispatch-authorization.json'), acknowledgement: join(dir, 'dispatch-acknowledgement.json'), startup_status: join(dir, 'startup-status'), startup_log: join(dir, 'symphony-startup.log') }; };

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}
async function atomicText(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${value}\n`, { mode: 0o600 });
  await rename(temporary, path);
}
async function json(path) { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; } }
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
function processStartTicks(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/);
    return fields[19] || null;
  } catch { return null; }
}
async function remove(path) { await rm(path, { force: true }); }

async function loadConfig(file, { validateWorkspaceFileSources = true, requireNotionDatabase = true, environment = process.env, envFile = join(root, '.env'), homeDirectory } = {}) {
  const config = await json(canonical(file));
  if (!config || typeof config !== 'object') throw new Error(`missing or invalid project configuration: ${file}`);
  for (const key of ['workflow_path', 'symphony_workspace_root', 'github_repository_url', 'github_base_branch']) if (typeof config[key] !== 'string' || !config[key]) throw new Error(`project configuration requires ${key}`);
  const notion_database_url = await readRepositoryEnvironmentValue('LEESH_LOOP_NOTION_DATABASE_URL', { environment, envFile });
  if (requireNotionDatabase && !notion_database_url) throw new Error('missing LEESH_LOOP_NOTION_DATABASE_URL: set it in the Operator environment or repository-root .env');
  for (const key of ['codex_model', 'codex_reasoning_effort']) if (config[key] !== undefined && (typeof config[key] !== 'string' || !config[key].trim())) throw new Error(`${key} must be a non-empty string`);
  await validateBaseBranch(config.github_base_branch);
  if (config.skip_external_readiness !== undefined && typeof config.skip_external_readiness !== 'boolean') throw new Error('skip_external_readiness must be a boolean');
  if (config.open_project_surfaces !== undefined && typeof config.open_project_surfaces !== 'boolean') throw new Error('open_project_surfaces must be a boolean');
  if (config.allow_workspace_root_inside_repository !== undefined && typeof config.allow_workspace_root_inside_repository !== 'boolean') throw new Error('allow_workspace_root_inside_repository must be a boolean');
  if (config.startup_timeout_ms !== undefined && (!Number.isSafeInteger(config.startup_timeout_ms) || config.startup_timeout_ms <= 0)) throw new Error('startup_timeout_ms must be a positive integer');
  if (config.browser_acknowledgement_timeout_ms !== undefined && (!Number.isSafeInteger(config.browser_acknowledgement_timeout_ms) || config.browser_acknowledgement_timeout_ms <= 0)) throw new Error('browser_acknowledgement_timeout_ms must be a positive integer');
  const configuration_path = canonical(file);
  const projectDirectory = dirname(configuration_path);
  const workspace_files = normalizeWorkspaceFiles(config.workspace_files, projectDirectory, homeDirectory);
  if (validateWorkspaceFileSources) await validateWorkspaceFiles(workspace_files);
  const resolved = { ...config, notion_database_url, skip_external_readiness: config.skip_external_readiness === true, open_project_surfaces: config.open_project_surfaces ?? PROJECT_DEFAULTS.open_project_surfaces, workflow_path: resolveProjectPath(config.workflow_path, projectDirectory, homeDirectory), symphony_workspace_root: resolveProjectPath(config.symphony_workspace_root, projectDirectory, homeDirectory), workspace_files, ...(config.state_directory === undefined ? {} : { state_directory: resolveProjectPath(config.state_directory, projectDirectory, homeDirectory) }), ...(config.symphony_command === undefined ? {} : { symphony_command: resolveProjectPath(config.symphony_command, projectDirectory, homeDirectory) }), configuration_path };
  return resolved;
}
async function withLock(config, action) {
  return action();
}
function effective(config, runtimeId, port) {
  return { workflow_path: config.workflow_path, notion_database_url: config.notion_database_url, symphony_workspace_root: config.symphony_workspace_root, allow_workspace_root_inside_repository: config.allow_workspace_root_inside_repository === true, workspace_files: config.workspace_files, codex_model: config.codex_model ?? null, codex_reasoning_effort: config.codex_reasoning_effort ?? null, worker_interface_identity: config.worker_interface_identity || 'operator/external/chatgpt-shot/chatgpt-shot', skip_external_readiness: config.skip_external_readiness === true, github_repository_url: config.github_repository_url, github_base_branch: config.github_base_branch, symphony_command: canonical(config.symphony_command || join(root, 'operator/app/run-symphony')), dashboard: `http://127.0.0.1:${port}`, runtime_id: runtimeId };
}
function compatibilityIdentity(value) { const { runtime_id: _runtimeId, skip_external_readiness, codex_model, codex_reasoning_effort, ...identity } = value || {}; return { ...identity, codex_model: codex_model ?? null, codex_reasoning_effort: codex_reasoning_effort ?? null, skip_external_readiness: skip_external_readiness === true }; }
function compatible(oldValue, current) { return JSON.stringify(compatibilityIdentity(oldValue)) === JSON.stringify(compatibilityIdentity(current)); }
function operatorBootstrapArgs(config, symphony, port) { return [join(root, 'operator/app/operator-bootstrap'), ...(config.skip_external_readiness ? ['--skip-external-readiness'] : []), '--', symphony, '--port', String(port), '--i-understand-that-this-will-be-running-without-the-usual-guardrails', config.workflow_path]; }
async function request(url) { const response = await fetch(url, { signal: AbortSignal.timeout(1_000) }); if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }
async function reachable(url) { const response = await fetch(url, { signal: AbortSignal.timeout(1_000) }); if (!response.ok) throw new Error(`HTTP ${response.status}`); }
async function runtimeObserved(state, requireAck = true) {
  if (!state?.pid || !alive(state.pid) || !state.effective?.dashboard) return false;
  try {
    const observed = await request(`${state.effective.dashboard}/api/v1/runtime`);
    const ack = await json(state.acknowledgement_path);
    return observed.pid === state.pid && observed.runtime_id === state.runtime_id && (!requireAck || (observed.dispatch_capable === true && ack?.runtime_id === state.runtime_id && ack?.pid === state.pid && ack?.dispatch_capable === true));
  } catch { return false; }
}
async function terminate(state) {
  if (state?.pid && alive(state.pid)) {
    if (!state.process_start_ticks || processStartTicks(state.pid) !== state.process_start_ticks) return false;
    process.kill(state.pid, 'SIGTERM'); for (let i = 0; i < 50 && alive(state.pid); i += 1) await sleep(100); if (alive(state.pid)) { process.kill(state.pid, 'SIGKILL'); await sleep(100); }
  }
  if (state?.pid && alive(state.pid)) throw new Error(`owned Symphony process ${state.pid} did not terminate`);
  return true;
}
async function clear(config) { const p = paths(config); await Promise.all([remove(p.state), remove(p.ownership), remove(p.authorization), remove(p.acknowledgement), remove(p.startup_status)]); }
async function reconcile(config, desired) {
  const p = paths(config); const state = await json(p.state); if (!state) return null;
  if (state.status === 'running' && await runtimeObserved(state) && compatible(state.effective, desired)) return state;
  if (state.status === 'running' && await runtimeObserved(state) && !compatible(state.effective, desired)) throw new Error('a live acknowledged runtime has incompatible configuration; run stop explicitly');
  await terminate(state); await clear(config); return null;
}
async function launch(command, args, env, outputPath) {
  const output = await open(outputPath, 'w', 0o600);
  try {
    // Symphony continuously renders its dashboard to stdout. Preserve only
    // stderr here so a long-running dashboard cannot grow an unbounded log.
    const child = spawn(command, args, { cwd: root, detached: true, stdio: ['ignore', 'ignore', output.fd], env });
    child.unref();
    return child.pid;
  } finally { await output.close(); }
}
async function waitFor(check, description, timeoutMs = 15_000, progress, failure) {
  const started = Date.now(), deadline = started + timeoutMs; let nextProgress = started;
  do {
    if (await check()) return;
    if (failure) { const error = await failure(); if (error) throw error; }
    if (progress && Date.now() >= nextProgress) { await progress(Math.floor((Date.now() - started) / 1_000)); nextProgress = Date.now() + 10_000; }
    await sleep(100);
  } while (Date.now() < deadline);
  throw new Error(`timed out waiting for ${description}`);
}
async function openWindow(config, dashboard) {
  await ensureUi(config);
  await openProjectSurfaces(config, dashboard);
}
function projectSurfaces(config) { return [uiUrl(config)]; }
function browserAcknowledgementTimeout(config) { return config.browser_acknowledgement_timeout_ms || PROJECT_DEFAULTS.browser_acknowledgement_timeout_ms; }
async function openProjectSurfaces(config, dashboard) {
  const surfaces = projectSurfaces(config, dashboard);
  if (process.env.LEESH_LOOP_BROWSER_COMMAND) {
    if (await spawnBrowser(process.env.LEESH_LOOP_BROWSER_COMMAND, surfaces)) return;
    throw new Error(`could not launch ${process.env.LEESH_LOOP_BROWSER_COMMAND}`);
  }
  // The Operator is the sole startup surface; related systems remain in-app navigation.
  const requests = await Promise.all(surfaces.map(url => dispatchBrowser('xdg-open', [url])));
  await Promise.all(requests.map(request => acknowledgeBrowser(request, browserAcknowledgementTimeout(config))));
}
function spawnBrowser(command, args) { return new Promise(resolveBrowser => { const child = spawn(command, args, { detached: true, stdio: 'ignore' }); child.once('error', () => resolveBrowser(false)); child.once('spawn', () => { child.unref(); resolveBrowser(true); }); }); }
function dispatchBrowser(command, args) {
  return new Promise((resolveBrowser, rejectBrowser) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    let settleExit;
    const exit = new Promise(resolveExit => { settleExit = resolveExit; });
    child.once('exit', (code, signal) => settleExit({ code, signal }));
    child.once('error', error => rejectBrowser(new Error(`could not launch ${command}: ${error.message}`)));
    child.once('spawn', () => { child.unref(); resolveBrowser({ command, args, exit }); });
  });
}
async function acknowledgeBrowser(request, timeoutMs) {
  let timeout;
  const result = await Promise.race([request.exit, new Promise(resolveTimeout => { timeout = setTimeout(() => resolveTimeout(null), timeoutMs); })]);
  clearTimeout(timeout);
  if (!result) return;
  if (result.code === 0 && result.signal === null) return;
  const outcome = result.signal ? `was terminated by ${result.signal}` : `exited with status ${result.code}`;
  throw new Error(`${request.command} ${request.args.join(' ')} ${outcome}`);
}
function uiPort(config) { return Number(config.ui_port || PROJECT_DEFAULTS.ui_port); }
let publisherBuilt = false;
let operatorUiBuilt = false;
function ensurePublisher() {
  if (publisherBuilt) return;
  const publisher = join(root, 'operator/notion_publisher');
  if (!existsSync(join(publisher, 'node_modules/.bin/tsc'))) {
    const install = runPublisherCommand(['ci']);
    if (install.status !== 0) throw new Error('publisher preparation failed: npm ci');
  }
  const build = runPublisherCommand(['run', 'build']);
  if (build.status !== 0) throw new Error('publisher preparation failed: npm run build');
  publisherBuilt = true;
}
function runPublisherCommand(args) {
  // Operator start returns JSON on stdout for machine consumers. Keep Publisher
  // install/build output on stderr so first-run diagnostics cannot corrupt it.
  return spawnSync('npm', args, { cwd: join(root, 'operator/notion_publisher'), stdio: ['ignore', process.stderr.fd, 'inherit'] });
}
function ensureOperatorUi() {
  if (operatorUiBuilt) return;
  const ui = join(root, 'operator/ui');
  if (!existsSync(join(ui, 'node_modules/.bin/vite'))) {
    const install = runOperatorUiCommand(ui, ['ci']);
    if (install.status !== 0) throw new Error('Operator UI preparation failed: npm ci');
  }
  const build = runOperatorUiCommand(ui, ['run', 'build']);
  if (build.status !== 0) throw new Error('Operator UI preparation failed: npm run build');
  operatorUiBuilt = true;
}
function runOperatorUiCommand(directory, args) {
  return spawnSync('npm', args, { cwd: directory, stdio: ['ignore', process.stderr.fd, 'inherit'] });
}
function uiUrl(config) { return `http://127.0.0.1:${uiPort(config)}`; }
function projectWindowNeedsOpening(state) { return !state?.project_window_surfaces?.includes('operator-ui-v1'); }
function uiRuntimeSourceFiles() {
  const files = new Set();
  const pending = [appScript];
  const imports = /\b(?:import|export)\s+(?:[^'";]*?\sfrom\s*)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;
  while (pending.length) {
    const file = resolve(pending.pop());
    if (files.has(file)) continue;
    files.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(imports)) {
      const specifier = match[1] || match[2];
      if (specifier.startsWith('.')) {
        const dependency = resolve(dirname(file), specifier);
        if (existsSync(dependency)) pending.push(dependency);
      }
    }
  }
  const addTree = directory => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) addTree(path);
      else if (entry.isFile()) files.add(path);
    }
  };
  addTree(join(root, 'operator/notion_publisher/dist'));
  addTree(join(root, 'operator/ui/dist'));
  files.add(join(root, 'operator/notion_publisher/examples/publisher-config.json'));
  return [...files].sort();
}
function uiIdentity(config) {
  const revision = createHash('sha256');
  for (const path of uiRuntimeSourceFiles()) {
    revision.update(relative(root, path));
    revision.update('\0');
    revision.update(readFileSync(path));
    revision.update('\0');
  }
  return { notion_database_url: config.notion_database_url, ui_port: uiPort(config), dashboard_port: Number(config.symphony_port || PROJECT_DEFAULTS.symphony_port), publisher: join(root, 'operator/notion_publisher/dist/src/cli.js'), revision: revision.digest('hex') };
}
function sameIdentity(first, second) { return JSON.stringify(first) === JSON.stringify(second); }
async function stopUi(config) { const ui = await json(paths(config).ui); if (ui) await terminate(ui); await remove(paths(config).ui); }
async function ensureUi(config) {
  const p = paths(config), identity = uiIdentity(config), ui = await json(p.ui);
  if (ui && await processStartTicks(ui.pid) === ui.process_start_ticks && sameIdentity(ui.identity, identity)) {
    try { await reachable(uiUrl(config)); return; } catch { await stopUi(config); }
  } else if (ui) await stopUi(config);
  let unmanaged = false;
  try { await reachable(uiUrl(config)); unmanaged = true; } catch { /* start the project-local Operator UI */ }
  if (unmanaged) throw new Error(`Operator UI at ${uiUrl(config)} is not owned by this project`);
  const child = spawn(process.execPath, [appScript, 'serve-prepared', config.configuration_path], { cwd: root, detached: true, stdio: 'ignore', env: process.env });
  child.unref();
  const process_start_ticks = processStartTicks(child.pid);
  if (!process_start_ticks) throw new Error(`could not record startup identity for publish UI PID ${child.pid}`);
  await atomicJson(p.ui, { pid: child.pid, process_start_ticks, identity });
  await waitFor(async () => { try { await reachable(uiUrl(config)); return true; } catch { return false; } }, 'Operator UI');
}

async function start(config) {
  return withLock(config, async () => {
    const port = Number(config.symphony_port || PROJECT_DEFAULTS.symphony_port); const p = paths(config); const desired = effective(config, 'pending', port); const existing = await reconcile(config, desired);
    if (!existing) console.error('Operator: preparing Publisher and Symphony startup.');
    ensurePublisher();
    ensureOperatorUi();
    if (existing) {
      let window_error;
      try { await ensureUi(config); } catch (error) { window_error = String(error.message || error); }
      if (config.open_project_surfaces && projectWindowNeedsOpening(existing)) {
        try {
          await openWindow(config, existing.effective.dashboard);
          await atomicJson(paths(config).state, { ...existing, project_window_opened_at: new Date().toISOString(), project_window_surfaces: ['operator-ui-v1'] });
          await remove(p.startup_status);
        } catch (error) { window_error = String(error.message || error); }
      }
      return { reused: true, pid: existing.pid, dashboard: existing.effective.dashboard, ...(window_error ? { window_error } : {}) };
    }
    const runtimeId = randomUUID(); const identity = effective(config, runtimeId, port);
    const starting = { status: 'starting', runtime_id: runtimeId, effective: identity, authorization_path: p.authorization, acknowledgement_path: p.acknowledgement, ownership_path: p.ownership, created_at: new Date().toISOString() };
    await atomicJson(p.state, starting); await remove(p.ownership); await remove(p.authorization); await remove(p.acknowledgement); await atomicText(p.startup_status, 'launching Operator readiness checks');
    try {
      const symphony = identity.symphony_command;
      const args = operatorBootstrapArgs(config, symphony, port);
      const notionToken = await readRepositoryEnvironmentValue('NOTION_TOKEN');
      if (!notionToken) throw new Error('missing NOTION_TOKEN: set it in the Operator environment or the project-root .env file');
      const env = { ...process.env, NOTION_TOKEN: notionToken, LEESH_LOOP_NOTION_DATABASE_URL: config.notion_database_url, LEESH_LOOP_WORKSPACE_FILES: JSON.stringify(config.workspace_files), SYMPHONY_WORKSPACE_ROOT: config.symphony_workspace_root, SYMPHONY_ALLOW_WORKSPACE_ROOT_INSIDE_REPOSITORY: config.allow_workspace_root_inside_repository === true ? 'true' : 'false', SYMPHONY_GITHUB_REPOSITORY_URL: config.github_repository_url, SYMPHONY_GITHUB_BASE_BRANCH: config.github_base_branch, SYMPHONY_DISPATCH_BARRIER: 'closed', SYMPHONY_RUNTIME_ID: runtimeId, SYMPHONY_DISPATCH_AUTHORIZATION_FILE: p.authorization, SYMPHONY_DISPATCH_ACK_FILE: p.acknowledgement, SYMPHONY_OWNERSHIP_FILE: p.ownership, SYMPHONY_OPERATOR_STARTUP_STATUS_FILE: p.startup_status };
      if (identity.codex_model === null) delete env.SYMPHONY_CODEX_MODEL;
      else env.SYMPHONY_CODEX_MODEL = identity.codex_model;
      if (identity.codex_reasoning_effort === null) delete env.SYMPHONY_CODEX_REASONING_EFFORT;
      else env.SYMPHONY_CODEX_REASONING_EFFORT = identity.codex_reasoning_effort;
      const pid = await launch(join(root, 'operator/app/owned-symphony'), args, env, p.startup_log);
      const process_start_ticks = await processStartTicks(pid);
      if (!process_start_ticks) throw new Error(`could not record startup identity for owned Symphony PID ${pid}`);
      const ownedStarting = { ...starting, pid, process_start_ticks };
      await atomicJson(p.state, ownedStarting);
      await atomicJson(p.ownership, { project_root: root, runtime_id: runtimeId, pid, process_start_ticks, created_at: new Date().toISOString() });
      const provisional = { ...ownedStarting, status: 'provisional' }; await atomicJson(p.state, provisional);
      let reportedStartupStatus;
      const reportProgress = description => async elapsed => {
        const status = (await readFile(p.startup_status, 'utf8').catch(() => '')).trim();
        if (status && status !== reportedStartupStatus) { console.error(`Operator: ${status}.`); reportedStartupStatus = status; return; }
        console.error(`Operator: still waiting for ${description} (${elapsed}s elapsed; current step: ${status || 'starting child process'}).`);
      };
      const childFailure = async description => {
        if (alive(pid)) return null;
        const output = (await readFile(p.startup_log, 'utf8').catch(() => '')).trim();
        const detail = output ? `: ${output.slice(-4_000)}` : '';
        return new Error(`owned Symphony process ${pid} exited before ${description}${detail}`);
      };
      await waitFor(() => runtimeObserved({ ...provisional, effective: identity }, false), 'Symphony observability', config.startup_timeout_ms || 30 * 60_000, reportProgress('Symphony observability'), () => childFailure('Symphony observability'));
      const committed = { ...provisional, status: 'committed-disabled' }; await atomicJson(p.state, committed);
      const running = { ...committed, status: 'running', authorized_at: new Date().toISOString() }; await atomicJson(p.state, running);
      await atomicJson(p.authorization, { state: 'running', runtime_id: runtimeId, published_at: new Date().toISOString() });
      await atomicText(p.startup_status, 'waiting for Symphony dispatch acknowledgement');
      await waitFor(() => runtimeObserved(running, true), 'dispatch acknowledgement', 15_000, reportProgress('dispatch acknowledgement'), () => childFailure('dispatch acknowledgement'));
      try {
        if (config.open_project_surfaces) {
          await openWindow(config, identity.dashboard);
          await atomicJson(p.state, { ...running, project_window_opened_at: new Date().toISOString(), project_window_surfaces: ['operator-ui-v1'] });
        } else {
          await ensureUi(config);
        }
        await remove(p.startup_status);
        return { reused: false, pid, dashboard: identity.dashboard };
      }
      catch (windowError) { return { reused: false, pid, dashboard: identity.dashboard, window_error: String(windowError.message || windowError) }; }
    } catch (error) { const state = await json(p.state); try { await terminate(state); await clear(config); } catch (cleanupError) { await atomicJson(p.state, { ...(state || starting), status: 'failed', cleanup_error: String(cleanupError) }); } throw error; }
  });
}
async function stop(config) { return withLock(config, async () => { const state = await json(paths(config).state); if (state) await terminate(state); await stopUi(config); await clear(config); return { stopped: Boolean(state) }; }); }
async function stopOwnedRuntime(config, runtimeId) {
  if (!runtimeId) throw new Error('stop-owned requires a runtime ID');
  return withLock(config, async () => {
    const state = await json(paths(config).state);
    if (!state) return { stopped: false, already_absent: true, expected_runtime_id: runtimeId };
    if (state.runtime_id !== runtimeId) {
      return { stopped: false, identity_mismatch: true, expected_runtime_id: runtimeId, observed_runtime_id: state.runtime_id || null };
    }
    if (!await terminate(state)) {
      return { stopped: false, process_identity_mismatch: true, expected_runtime_id: runtimeId };
    }
    let observed;
    try {
      if (typeof state.effective?.dashboard !== 'string' || !state.effective.dashboard) {
        return { stopped: false, runtime_unconfirmed: true, expected_runtime_id: runtimeId };
      }
      observed = await request(`${state.effective.dashboard}/api/v1/runtime`);
    } catch (error) {
      if (error?.cause?.code !== 'ECONNREFUSED') {
        return { stopped: false, runtime_unconfirmed: true, expected_runtime_id: runtimeId, error: String(error?.message || error) };
      }
    }
    if (observed && (typeof observed.runtime_id !== 'string' || !observed.runtime_id)) {
      return { stopped: false, runtime_unconfirmed: true, expected_runtime_id: runtimeId };
    }
    if (observed?.runtime_id === runtimeId) {
      return { stopped: false, runtime_still_present: true, expected_runtime_id: runtimeId, observed_runtime_id: observed.runtime_id };
    }
    await stopUi(config);
    await clear(config);
    return { stopped: true, runtime_id: runtimeId };
  });
}

async function serve(config, { prepared = false } = {}) {
  if (!prepared) {
    ensurePublisher();
    ensureOperatorUi();
  }
  const existing = await json(paths(config).ui), process_start_ticks = processStartTicks(process.pid);
  if (!process_start_ticks) throw new Error(`could not record startup identity for Operator UI PID ${process.pid}`);
  if (existing && (existing.pid !== process.pid || existing.process_start_ticks !== process_start_ticks) && processStartTicks(existing.pid) === existing.process_start_ticks) throw new Error(`Operator UI is already owned on ${uiUrl(config)}`);
  const identity = uiIdentity(config);
  const dependencies = await defaultOperatorUiDependencies(root, config, paths(config).dir);
  await atomicJson(paths(config).ui, { pid: process.pid, process_start_ticks, identity });
  const server = await startOperatorUiServer(dependencies);
  server.once('error', error => { console.error(`Operator UI server failed: ${error.message}`); process.exitCode = 1; });
}

const args = process.argv.slice(2);
const locked = args[0] === '__locked';
const [command, ...commandArgs] = locked ? args.slice(1) : args;
const configFile = commandArgs[0] || defaultConfig;
let directExecution = false;
try { directExecution = Boolean(process.argv[1] && realpathSync(process.argv[1]) === appScript); } catch { /* Node may be importing this module from another entry point. */ }
if (directExecution && !['start', 'stop', 'stop-owned', 'serve', 'serve-prepared'].includes(command)) {
  const usage = 'Usage: node operator/app/leesh-loop.mjs <start|stop|stop-owned|serve> [project-config.json] [runtime-id]';
  if (command === '--help' || command === '-h') console.log(usage);
  else { console.error(usage); process.exitCode = 2; }
} else if (directExecution) {
  loadConfig(configFile, { validateWorkspaceFileSources: command === 'start', requireNotionDatabase: !['stop', 'stop-owned'].includes(command) }).then(async config => {
    if (!locked && ['start', 'stop', 'stop-owned'].includes(command)) {
      await mkdir(stateRoot(config), { recursive: true, mode: 0o700 });
      const lockPath = join(stateRoot(config), 'lifecycle.flock');
      const lockedArgs = ['-x', lockPath, process.execPath, process.argv[1], '__locked', command, config.configuration_path];
      if (command === 'stop-owned') lockedArgs.push(commandArgs[1] || '');
      const result = spawnSync('flock', lockedArgs, { cwd: root, stdio: 'inherit' });
      if (result.error) throw result.error;
      process.exitCode = result.status ?? 1;
      return undefined;
    }
    return command === 'start' ? start(config) : command === 'stop' ? stop(config) : command === 'stop-owned' ? stopOwnedRuntime(config, commandArgs[1]) : serve(config, { prepared: command === 'serve-prepared' });
  }).then(value => { if (value) console.log(JSON.stringify(value)); }).catch(error => { console.error(`Operator failed: ${error.message}`); process.exitCode = 1; });
}

export { acknowledgeBrowser, compatible, dispatchBrowser, effective, ensurePublisher, loadConfig, openProjectSurfaces, operatorBootstrapArgs, projectSurfaces, projectWindowNeedsOpening, readRequestBody, runPublisherCommand, uiIdentity, uiRuntimeSourceFiles };
