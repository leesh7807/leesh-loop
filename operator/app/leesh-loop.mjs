#!/usr/bin/env node
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { chmod, mkdir, open, readFile, readlink, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { validateWorkspaceFiles } from './workspace-files.mjs';

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
async function localEnvironmentValue(name) {
  try {
    const contents = await readFile(join(root, '.env'), 'utf8');
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (match?.[1] === name) return match[2].trim().replace(/^['"]|['"]$/g, '');
    }
  } catch { /* a caller may instead provide the environment variable */ }
  return undefined;
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
function processStartTicks(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/);
    return fields[19] || null;
  } catch { return null; }
}
async function remove(path) { await rm(path, { force: true }); }

async function loadConfig(file) {
  const config = await json(canonical(file));
  if (!config || typeof config !== 'object') throw new Error(`missing or invalid project configuration: ${file}`);
  for (const key of ['workflow_path', 'notion_database_url', 'symphony_workspace_root']) if (typeof config[key] !== 'string' || !config[key]) throw new Error(`project configuration requires ${key}`);
  if (!isAbsolute(config.workflow_path) || !isAbsolute(config.symphony_workspace_root)) throw new Error('workflow_path and symphony_workspace_root must be absolute');
  if (config.startup_timeout_ms !== undefined && (!Number.isSafeInteger(config.startup_timeout_ms) || config.startup_timeout_ms <= 0)) throw new Error('startup_timeout_ms must be a positive integer');
  if (config.browser_acknowledgement_timeout_ms !== undefined && (!Number.isSafeInteger(config.browser_acknowledgement_timeout_ms) || config.browser_acknowledgement_timeout_ms <= 0)) throw new Error('browser_acknowledgement_timeout_ms must be a positive integer');
  const workspace_files = await validateWorkspaceFiles(config.workspace_files);
  const resolved = { ...config, workflow_path: canonical(config.workflow_path), symphony_workspace_root: canonical(config.symphony_workspace_root), workspace_files, configuration_path: canonical(file) };
  return resolved;
}
async function withLock(config, action) {
  return action();
}
function effective(config, runtimeId, port) {
  return { workflow_path: config.workflow_path, notion_database_url: config.notion_database_url, symphony_workspace_root: config.symphony_workspace_root, workspace_files: config.workspace_files, worker_interface_identity: config.worker_interface_identity || 'operator/external/chatgpt-shot/chatgpt-shot', github_repository_url: config.github_repository_url || null, symphony_command: canonical(config.symphony_command || join(root, 'operator/app/run-symphony')), dashboard: `http://127.0.0.1:${port}`, runtime_id: runtimeId };
}
function compatible(oldValue, current) { const { runtime_id: _old, ...oldIdentity } = oldValue || {}; const { runtime_id: _new, ...newIdentity } = current; return JSON.stringify(oldIdentity) === JSON.stringify(newIdentity); }
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
function projectSurfaces(config, dashboard) { return [uiUrl(config), config.notion_database_url, dashboard]; }
function browserAcknowledgementTimeout(config) { return config.browser_acknowledgement_timeout_ms || 1_000; }
async function openProjectSurfaces(config, dashboard) {
  const surfaces = projectSurfaces(config, dashboard);
  if (process.env.LEESH_LOOP_BROWSER_COMMAND) {
    if (await spawnBrowser(process.env.LEESH_LOOP_BROWSER_COMMAND, surfaces)) return;
    throw new Error(`could not launch ${process.env.LEESH_LOOP_BROWSER_COMMAND}`);
  }
  // Hand every surface to the desktop before waiting: one opener may intentionally stay alive.
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
function uiPort(config) { return Number(config.ui_port || 4310); }
function ensurePublisher() { const publisher = join(root, 'operator/notion_publisher'); if (existsSync(join(publisher, 'dist/src/cli.js'))) return; for (const args of [['ci'], ['run', 'build']]) { const result = spawnSync('npm', args, { cwd: publisher, stdio: 'inherit' }); if (result.status !== 0) throw new Error(`publisher preparation failed: npm ${args.join(' ')}`); } }
function uiUrl(config) { return `http://127.0.0.1:${uiPort(config)}`; }
function uiIdentity(config) { return { notion_database_url: config.notion_database_url, ui_port: uiPort(config), publisher: join(root, 'operator/notion_publisher/dist/cli.js') }; }
function sameIdentity(first, second) { return JSON.stringify(first) === JSON.stringify(second); }
async function stopUi(config) { const ui = await json(paths(config).ui); if (ui) await terminate(ui); await remove(paths(config).ui); }
async function ensureUi(config) {
  const p = paths(config), identity = uiIdentity(config), ui = await json(p.ui);
  if (ui && await processStartTicks(ui.pid) === ui.process_start_ticks && sameIdentity(ui.identity, identity)) {
    try { await reachable(uiUrl(config)); return; } catch { await stopUi(config); }
  } else if (ui) await stopUi(config);
  let unmanaged = false;
  try { await reachable(uiUrl(config)); unmanaged = true; } catch { /* start the project-local publish surface */ }
  if (unmanaged) throw new Error(`publish surface at ${uiUrl(config)} is not owned by this project`);
  const child = spawn(process.execPath, [appScript, 'serve', config.configuration_path], { cwd: root, detached: true, stdio: 'ignore', env: process.env });
  child.unref();
  const process_start_ticks = processStartTicks(child.pid);
  if (!process_start_ticks) throw new Error(`could not record startup identity for publish UI PID ${child.pid}`);
  await atomicJson(p.ui, { pid: child.pid, process_start_ticks, identity });
  await waitFor(async () => { try { await reachable(uiUrl(config)); return true; } catch { return false; } }, 'publish surface');
}

async function start(config) {
  return withLock(config, async () => {
    const port = Number(config.symphony_port || 4100); const p = paths(config); const desired = effective(config, 'pending', port); const existing = await reconcile(config, desired);
    if (existing) {
      let window_error;
      try { await ensureUi(config); } catch (error) { window_error = String(error.message || error); }
      if (!existing.project_window_opened_at) {
        try {
          await openWindow(config, existing.effective.dashboard);
          await atomicJson(paths(config).state, { ...existing, project_window_opened_at: new Date().toISOString() });
          await remove(p.startup_status);
        } catch (error) { window_error = String(error.message || error); }
      }
      return { reused: true, pid: existing.pid, dashboard: existing.effective.dashboard, ...(window_error ? { window_error } : {}) };
    }
    console.error('Operator: preparing Publisher and Symphony startup.');
    ensurePublisher();
    const runtimeId = randomUUID(); const identity = effective(config, runtimeId, port);
    const starting = { status: 'starting', runtime_id: runtimeId, effective: identity, authorization_path: p.authorization, acknowledgement_path: p.acknowledgement, ownership_path: p.ownership, created_at: new Date().toISOString() };
    await atomicJson(p.state, starting); await remove(p.ownership); await remove(p.authorization); await remove(p.acknowledgement); await atomicText(p.startup_status, 'launching Operator readiness checks');
    try {
      const symphony = identity.symphony_command;
      const args = [join(root, 'operator/app/operator-bootstrap'), '--', symphony, '--port', String(port), '--i-understand-that-this-will-be-running-without-the-usual-guardrails', config.workflow_path];
      const notionToken = process.env.NOTION_TOKEN || await localEnvironmentValue('NOTION_TOKEN');
      if (!notionToken) throw new Error('missing NOTION_TOKEN: set it in the Operator environment or the project-root .env file');
      const env = { ...process.env, NOTION_TOKEN: notionToken, LEESH_LOOP_NOTION_DATABASE_URL: config.notion_database_url, LEESH_LOOP_WORKSPACE_FILES: JSON.stringify(config.workspace_files), SYMPHONY_WORKSPACE_ROOT: config.symphony_workspace_root, SYMPHONY_GITHUB_REPOSITORY_URL: config.github_repository_url || '', SYMPHONY_DISPATCH_BARRIER: 'closed', SYMPHONY_RUNTIME_ID: runtimeId, SYMPHONY_DISPATCH_AUTHORIZATION_FILE: p.authorization, SYMPHONY_DISPATCH_ACK_FILE: p.acknowledgement, SYMPHONY_OWNERSHIP_FILE: p.ownership, SYMPHONY_OPERATOR_STARTUP_STATUS_FILE: p.startup_status };
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
        await openWindow(config, identity.dashboard);
        await atomicJson(p.state, { ...running, project_window_opened_at: new Date().toISOString() }); await remove(p.startup_status);
        return { reused: false, pid, dashboard: identity.dashboard };
      }
      catch (windowError) { return { reused: false, pid, dashboard: identity.dashboard, window_error: String(windowError.message || windowError) }; }
    } catch (error) { const state = await json(p.state); try { await terminate(state); await clear(config); } catch (cleanupError) { await atomicJson(p.state, { ...(state || starting), status: 'failed', cleanup_error: String(cleanupError) }); } throw error; }
  });
}
async function stop(config) { return withLock(config, async () => { const state = await json(paths(config).state); if (state) await terminate(state); await stopUi(config); await clear(config); return { stopped: Boolean(state) }; }); }

const html = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function page(config, { plan = '', result = '' } = {}) { return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Leesh Loop Publish</title><main><h1>Leesh Loop Publish</h1><form method="post"><label for="plan">Plan</label><textarea id="plan" name="plan" rows="20" required>${html(plan)}</textarea><button>Publish</button></form><p><a href="${html(config.notion_database_url)}">Notion Tasks</a> · <a href="${`http://127.0.0.1:${Number(config.symphony_port || 4100)}`}">Symphony Dashboard</a></p><output>${html(result)}</output></main>`; }
async function serve(config) { const existing = await json(paths(config).ui), process_start_ticks = processStartTicks(process.pid); if (!process_start_ticks) throw new Error(`could not record startup identity for publish UI PID ${process.pid}`); if (existing && (existing.pid !== process.pid || existing.process_start_ticks !== process_start_ticks) && processStartTicks(existing.pid) === existing.process_start_ticks) throw new Error(`publish UI is already owned on ${uiUrl(config)}`); await atomicJson(paths(config).ui, { pid: process.pid, process_start_ticks, identity: uiIdentity(config) }); const server = createServer(async (req, res) => { if (req.method === 'GET') { res.end(page(config)); return; } if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; } let body = ''; for await (const chunk of req) body += chunk; const plan = new URLSearchParams(body).get('plan') || ''; const temp = join(paths(config).dir, `publish-${randomUUID()}.md`); try { await writeFile(temp, plan); const publisher = spawn('node', [join(root, 'operator/notion_publisher/dist/src/cli.js'), '--plan', temp, '--config', join(root, 'operator/notion_publisher/examples/publisher-config.json'), '--database-url', config.notion_database_url], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }); let output = '', errors = ''; for await (const chunk of publisher.stdout) output += chunk; for await (const chunk of publisher.stderr) errors += chunk; const code = await new Promise(resolveExit => publisher.on('close', resolveExit)); res.end(page(config, { plan: code === 0 ? '' : plan, result: code === 0 ? output : errors || 'Publishing failed.' })); } finally { await remove(temp); } }); server.listen(uiPort(config), '127.0.0.1'); }

const args = process.argv.slice(2);
const locked = args[0] === '__locked';
const [command, configFile = defaultConfig] = locked ? args.slice(1) : args;
if (process.argv[1] && resolve(process.argv[1]) === appScript && !['start', 'stop', 'serve'].includes(command)) { console.error('Usage: leesh-loop <start|stop|serve> [project-config.json]'); process.exitCode = 2; }
else if (process.argv[1] && resolve(process.argv[1]) === appScript) {
  loadConfig(configFile).then(async config => {
    if (!locked && ['start', 'stop'].includes(command)) {
      await mkdir(stateRoot(config), { recursive: true, mode: 0o700 });
      const lockPath = join(stateRoot(config), 'lifecycle.flock');
      const result = spawnSync('flock', ['-x', lockPath, process.execPath, process.argv[1], '__locked', command, config.configuration_path], { cwd: root, stdio: 'inherit' });
      if (result.error) throw result.error;
      process.exitCode = result.status ?? 1;
      return undefined;
    }
    return command === 'start' ? start(config) : command === 'stop' ? stop(config) : serve(config);
  }).then(value => { if (value) console.log(JSON.stringify(value)); }).catch(error => { console.error(`Operator failed: ${error.message}`); process.exitCode = 1; });
}

export { acknowledgeBrowser, dispatchBrowser, effective, loadConfig, openProjectSurfaces, projectSurfaces };
