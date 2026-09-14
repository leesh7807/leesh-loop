#!/usr/bin/env node
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { chmod, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const root = resolve(dirname(new URL(import.meta.url).pathname), '../..');
const appRoot = join(root, 'operator');
const defaultConfig = join(appRoot, 'project.json');
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
const canonical = value => resolve(value);
const stateRoot = config => canonical(config.state_directory || join(appRoot, '.runtime'));
const paths = config => { const dir = stateRoot(config); return { dir, state: join(dir, 'runtime.json'), lock: join(dir, 'lifecycle.lock'), ownership: join(dir, 'ownership.json'), authorization: join(dir, 'dispatch-authorization.json'), acknowledgement: join(dir, 'dispatch-acknowledgement.json') }; };

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}
async function json(path) { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; } }
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function remove(path) { await rm(path, { force: true }); }

async function loadConfig(file) {
  const config = await json(canonical(file));
  if (!config || typeof config !== 'object') throw new Error(`missing or invalid project configuration: ${file}`);
  for (const key of ['workflow_path', 'notion_database_url', 'symphony_workspace_root']) if (typeof config[key] !== 'string' || !config[key]) throw new Error(`project configuration requires ${key}`);
  const resolved = { ...config, workflow_path: canonical(config.workflow_path), symphony_workspace_root: canonical(config.symphony_workspace_root), configuration_path: canonical(file) };
  if (!isAbsolute(resolved.workflow_path) || !isAbsolute(resolved.symphony_workspace_root)) throw new Error('workflow_path and symphony_workspace_root must be absolute');
  return resolved;
}
async function withLock(config, action) {
  const { lock } = paths(config); await mkdir(dirname(lock), { recursive: true, mode: 0o700 });
  for (;;) {
    try { await mkdir(lock, { mode: 0o700 }); await atomicJson(join(lock, 'owner.json'), { pid: process.pid, started_at: new Date().toISOString() }); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const owner = await json(join(lock, 'owner.json'));
      if (!owner?.pid || !alive(owner.pid)) { await rm(lock, { recursive: true, force: true }); continue; }
      await sleep(50);
    }
  }
  try { return await action(); } finally { await rm(lock, { recursive: true, force: true }); }
}
function effective(config, runtimeId, port) {
  return { workflow_path: config.workflow_path, notion_database_url: config.notion_database_url, symphony_workspace_root: config.symphony_workspace_root, worker_interface_identity: config.worker_interface_identity || 'operator/external/chatgpt-shot/chatgpt-shot', github_repository_url: config.github_repository_url || null, dashboard: `http://127.0.0.1:${port}`, runtime_id: runtimeId };
}
function compatible(oldValue, current) { const { runtime_id: _old, ...oldIdentity } = oldValue || {}; const { runtime_id: _new, ...newIdentity } = current; return JSON.stringify(oldIdentity) === JSON.stringify(newIdentity); }
async function request(url) { const response = await fetch(url, { signal: AbortSignal.timeout(1_000) }); if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }
async function runtimeObserved(state, requireAck = true) {
  if (!state?.pid || !alive(state.pid) || !state.effective?.dashboard) return false;
  try {
    const observed = await request(`${state.effective.dashboard}/api/v1/runtime`);
    const ack = await json(state.acknowledgement_path);
    return observed.pid === state.pid && observed.runtime_id === state.runtime_id && (!requireAck || (observed.dispatch_capable === true && ack?.runtime_id === state.runtime_id && ack?.pid === state.pid && ack?.dispatch_capable === true));
  } catch { return false; }
}
async function terminate(state) {
  if (state?.pid && alive(state.pid)) { process.kill(state.pid, 'SIGTERM'); for (let i = 0; i < 50 && alive(state.pid); i += 1) await sleep(100); if (alive(state.pid)) { process.kill(state.pid, 'SIGKILL'); await sleep(100); } }
  if (state?.pid && alive(state.pid)) throw new Error(`owned Symphony process ${state.pid} did not terminate`);
}
async function clear(config) { const p = paths(config); await Promise.all([remove(p.state), remove(p.ownership), remove(p.authorization), remove(p.acknowledgement)]); }
async function reconcile(config, desired) {
  const p = paths(config); const state = await json(p.state); if (!state) return null;
  if (state.status === 'running' && await runtimeObserved(state) && compatible(state.effective, desired)) return state;
  if (state.status === 'running' && await runtimeObserved(state) && !compatible(state.effective, desired)) throw new Error('a live acknowledged runtime has incompatible configuration; run stop explicitly');
  await terminate(state); await clear(config); return null;
}
function launch(command, args, env) { const child = spawn(command, args, { cwd: root, detached: true, stdio: 'ignore', env }); child.unref(); return child.pid; }
async function waitFor(check, description) { for (let i = 0; i < 150; i += 1) { if (await check()) return; await sleep(100); } throw new Error(`timed out waiting for ${description}`); }
async function openWindow(config, dashboard) {
  await ensureUi(config);
  if (process.env.LEESH_LOOP_BROWSER_COMMAND) {
    if (await spawnBrowser(process.env.LEESH_LOOP_BROWSER_COMMAND, [uiUrl(config), config.notion_database_url, dashboard])) return;
    throw new Error(`could not launch ${process.env.LEESH_LOOP_BROWSER_COMMAND}`);
  }
  const candidates = ['google-chrome', 'chromium', 'chromium-browser'];
  for (const browser of candidates) if (await spawnBrowser(browser, ['--new-window', uiUrl(config), config.notion_database_url, dashboard])) return;
  throw new Error('no supported browser is available for the project window');
}
function spawnBrowser(command, args) { return new Promise(resolveBrowser => { const child = spawn(command, args, { detached: true, stdio: 'ignore' }); child.once('error', () => resolveBrowser(false)); child.once('spawn', () => { child.unref(); resolveBrowser(true); }); }); }
function uiPort(config) { return Number(config.ui_port || 4310); }
function uiUrl(config) { return `http://127.0.0.1:${uiPort(config)}`; }
async function ensureUi(config) {
  try { await request(uiUrl(config)); return; } catch { /* start the project-local publish surface */ }
  const child = spawn(process.execPath, [new URL(import.meta.url).pathname, 'serve', config.configuration_path], { cwd: root, detached: true, stdio: 'ignore', env: process.env });
  child.unref();
  await waitFor(async () => { try { await request(uiUrl(config)); return true; } catch { return false; } }, 'publish surface');
}

async function start(config) {
  return withLock(config, async () => {
    const port = Number(config.symphony_port || 4100); const desired = effective(config, 'pending', port); const existing = await reconcile(config, desired);
    if (existing) { await openWindow(config, existing.effective.dashboard); return { reused: true, pid: existing.pid, dashboard: existing.effective.dashboard }; }
    const p = paths(config); const runtimeId = randomUUID(); const identity = effective(config, runtimeId, port);
    const starting = { status: 'starting', runtime_id: runtimeId, effective: identity, authorization_path: p.authorization, acknowledgement_path: p.acknowledgement, ownership_path: p.ownership, created_at: new Date().toISOString() };
    await atomicJson(p.state, starting); await remove(p.authorization); await remove(p.acknowledgement);
    try {
      const symphony = config.symphony_command || join(root, 'operator/app/run-symphony');
      const args = [join(root, 'operator/app/operator-bootstrap'), '--', symphony, '--port', String(port), '--i-understand-that-this-will-be-running-without-the-usual-guardrails', config.workflow_path];
      const env = { ...process.env, SYMPHONY_WORKSPACE_ROOT: config.symphony_workspace_root, SYMPHONY_GITHUB_REPOSITORY_URL: config.github_repository_url || '', SYMPHONY_DISPATCH_BARRIER: 'closed', SYMPHONY_RUNTIME_ID: runtimeId, SYMPHONY_DISPATCH_AUTHORIZATION_FILE: p.authorization, SYMPHONY_DISPATCH_ACK_FILE: p.acknowledgement, SYMPHONY_OWNERSHIP_FILE: p.ownership };
      const pid = launch(join(root, 'operator/app/owned-symphony'), args, env);
      const ownedStarting = { ...starting, pid };
      await atomicJson(p.state, ownedStarting);
      await atomicJson(p.ownership, { project_root: root, runtime_id: runtimeId, pid, created_at: new Date().toISOString() });
      const provisional = { ...ownedStarting, status: 'provisional' }; await atomicJson(p.state, provisional);
      await waitFor(() => runtimeObserved({ ...provisional, effective: identity }, false), 'Symphony observability');
      const committed = { ...provisional, status: 'committed-disabled' }; await atomicJson(p.state, committed);
      const running = { ...committed, status: 'running', authorized_at: new Date().toISOString() }; await atomicJson(p.state, running);
      await atomicJson(p.authorization, { state: 'running', runtime_id: runtimeId, published_at: new Date().toISOString() });
      await waitFor(() => runtimeObserved(running, true), 'dispatch acknowledgement');
      try { await openWindow(config, identity.dashboard); return { reused: false, pid, dashboard: identity.dashboard }; }
      catch (windowError) { return { reused: false, pid, dashboard: identity.dashboard, window_error: String(windowError.message || windowError) }; }
    } catch (error) { const state = await json(p.state); try { await terminate(state); await clear(config); } catch (cleanupError) { await atomicJson(p.state, { ...(state || starting), status: 'failed', cleanup_error: String(cleanupError) }); } throw error; }
  });
}
async function stop(config) { return withLock(config, async () => { const state = await json(paths(config).state); if (state) await terminate(state); await clear(config); return { stopped: Boolean(state) }; }); }

const html = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function page(config, { plan = '', result = '' } = {}) { return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Leesh Loop Publish</title><main><h1>Leesh Loop Publish</h1><form method="post"><label for="plan">Plan</label><textarea id="plan" name="plan" rows="20" required>${html(plan)}</textarea><button>Publish</button></form><p><a href="${html(config.notion_database_url)}">Notion Tasks</a> · <a href="${`http://127.0.0.1:${Number(config.symphony_port || 4100)}`}">Symphony Dashboard</a></p><output>${html(result)}</output></main>`; }
async function serve(config) { const server = createServer(async (req, res) => { if (req.method === 'GET') { res.end(page(config)); return; } if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; } let body = ''; for await (const chunk of req) body += chunk; const plan = new URLSearchParams(body).get('plan') || ''; const temp = join(paths(config).dir, `publish-${randomUUID()}.md`); try { await writeFile(temp, plan); const publisher = spawn('node', [join(root, 'operator/notion_publisher/dist/cli.js'), '--plan', temp, '--config', join(root, 'operator/notion_publisher/examples/publisher-config.json'), '--database-url', config.notion_database_url], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }); let output = '', errors = ''; for await (const chunk of publisher.stdout) output += chunk; for await (const chunk of publisher.stderr) errors += chunk; const code = await new Promise(resolveExit => publisher.on('close', resolveExit)); res.end(page(config, { plan: code === 0 ? '' : plan, result: code === 0 ? output : errors || 'Publishing failed.' })); } finally { await remove(temp); } }); server.listen(uiPort(config), '127.0.0.1'); }

const [command, configFile = defaultConfig] = process.argv.slice(2);
if (!['start', 'stop', 'serve'].includes(command)) { console.error('Usage: leesh-loop <start|stop|serve> [project-config.json]'); process.exitCode = 2; }
else { loadConfig(configFile).then(config => command === 'start' ? start(config) : command === 'stop' ? stop(config) : serve(config)).then(value => { if (value) console.log(JSON.stringify(value)); }).catch(error => { console.error(`Operator failed: ${error.message}`); process.exitCode = 1; }); }
