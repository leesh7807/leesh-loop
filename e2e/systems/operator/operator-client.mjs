import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { command, parseJsonOutput } from '../command-runner.mjs';
import { pathWithin, removePath } from '../filesystem/file-safety.mjs';
import { readFile } from 'node:fs/promises';
import { currentProcessIdentity, inspectProcessIdentity } from '../../model/process-identity.mjs';

async function reserveAvailablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { port: server.address().port, server };
}

export function isRuntimePortConflict(error) {
  const message = String(error?.message || error || '');
  return /\bEADDRINUSE\b|address already in use|Operator UI at .* is not owned by this project|Operator UI is already owned on |Operator UI startup failed: timed out waiting for Operator UI/i.test(message);
}

export class OperatorClient {
  constructor({ root, app = join(root, 'operator/app/leesh-loop.mjs'), commandRunner = command } = {}) {
    this.root = root;
    this.app = app;
    this.commandRunner = commandRunner;
  }

  async startConfiguredOperatorProject(projectPath, timeoutMs, notionDatabaseUrl) {
    const env = notionDatabaseUrl ? { ...process.env, LEESH_LOOP_NOTION_DATABASE_URL: notionDatabaseUrl } : process.env;
    const { stdout } = await this.commandRunner('node', [this.app, 'start', projectPath], { cwd: this.root, timeout: timeoutMs, env });
    return parseJsonOutput(stdout, 'Operator start');
  }

  async stopConfiguredOperatorProject(projectPath, timeoutMs, signal) {
    const { stdout } = await this.commandRunner('node', [this.app, 'stop', projectPath], { cwd: this.root, timeout: timeoutMs, signal });
    return parseJsonOutput(stdout, 'Operator stop');
  }

  async findAvailableRuntimePorts(maxAttempts = 8) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const symphony = await reserveAvailablePort();
      let ui;
      try { ui = await reserveAvailablePort(); }
      catch (error) {
        await new Promise(resolve => symphony.server.close(() => resolve()));
        throw error;
      }
      if (symphony.port !== ui.port) {
        let released = false;
        return {
          symphony_port: symphony.port,
          ui_port: ui.port,
          async release() {
            if (released) return;
            released = true;
            await Promise.all([symphony.server, ui.server].map(server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))));
          }
        };
      }
      await Promise.all([symphony.server, ui.server].map(server => new Promise(resolve => server.close(() => resolve()))));
    }
    throw new Error('could not allocate distinct temporary E2E runtime ports');
  }

  async readOwnedRuntimeIdentity(stateDirectory, runtimeResult) {
    const statePath = join(stateDirectory, 'runtime.json');
    let state;
    try { state = JSON.parse(await readFile(statePath, 'utf8')); }
    catch { throw new Error(`child Operator/Symphony runtime state is unavailable: ${statePath}`); }
    if (!Number.isSafeInteger(state.pid) || !state.runtime_id || state.status !== 'running') throw new Error('child Operator/Symphony runtime did not reach authoritative running state');
    if (runtimeResult?.pid !== state.pid || runtimeResult?.dashboard !== state.effective?.dashboard) throw new Error('child runtime startup result differs from Operator authoritative state');
    return {
      runtime_id: state.runtime_id,
      status: 'active',
      dashboard: state.effective.dashboard,
      process_identity: await currentProcessIdentity(state.pid),
      state_path: statePath
    };
  }

  async verifyRuntimeStopped(stateDirectory, childRuntime) {
    if (childRuntime?.process_identity) {
      const state = await inspectProcessIdentity(childRuntime.process_identity);
      if (state === 'active') throw new Error(`owned Symphony runtime ${childRuntime.runtime_id || ''} is still active`);
      if (state === 'unknown') throw new Error(`owned Symphony runtime ${childRuntime.runtime_id || ''} liveness could not be verified`);
      return { stopped: true, process_identity: childRuntime.process_identity };
    }
    try {
      const state = JSON.parse(await readFile(join(stateDirectory, 'runtime.json'), 'utf8'));
      if (Number.isSafeInteger(state.pid) && state.process_start_ticks) {
        const processState = await inspectProcessIdentity({ pid: state.pid, process_start_ticks: state.process_start_ticks, boot_id: (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim() });
        if (processState !== 'dead') throw new Error(`owned Symphony runtime process ${state.pid} is ${processState}`);
      }
      throw new Error('Operator runtime state still exists after stop');
    } catch (error) {
      if (error?.code === 'ENOENT') return { stopped: true, state_absent: true };
      throw error;
    }
  }

  async inspectChildRuntimeLiveness(childRuntime) {
    if (['not_started', 'stopped'].includes(childRuntime?.status)) return 'dead';
    if (childRuntime?.dashboard && childRuntime?.runtime_id) {
      try {
        const runtime = await this.readSymphonyRuntimeStatus(childRuntime.dashboard);
        if (runtime.runtime_id === childRuntime.runtime_id && (!childRuntime.process_identity?.pid || runtime.pid === childRuntime.process_identity.pid)) return 'active';
      } catch { /* a failed health read does not prove the runtime is dead */ }
    }
    return inspectProcessIdentity(childRuntime?.process_identity);
  }

  requestSignal(signal, timeoutMs) {
    return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  }

  async readSymphonyRuntimeStatus(dashboard, signal) {
    const response = await fetch(`${dashboard}/api/v1/runtime`, { signal: this.requestSignal(signal, 5_000) });
    if (!response.ok) throw new Error(`Symphony runtime inspection failed with HTTP ${response.status}`);
    return response.json();
  }

  async readSymphonyRuntimeState(dashboard, signal) {
    const response = await fetch(`${dashboard}/api/v1/state`, { signal: this.requestSignal(signal, 5_000) });
    if (!response.ok) throw new Error(`Symphony state inspection failed with HTTP ${response.status}`);
    return response.json();
  }

  async readSymphonyIssue(dashboard, identifier, signal) {
    const response = await fetch(`${dashboard}/api/v1/${encodeURIComponent(identifier)}`, { signal: this.requestSignal(signal, 5_000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Symphony issue inspection failed with HTTP ${response.status}`);
    return response.json();
  }

  async readSymphonyExecutions(dashboard, identifier, signal) {
    const query = new URLSearchParams({ issue_identifier: identifier });
    const response = await fetch(`${dashboard}/api/v1/executions?${query}`, { signal: this.requestSignal(signal, 5_000) });
    if (!response.ok) throw new Error(`Symphony execution history inspection failed with HTTP ${response.status}`);
    return response.json();
  }

  async readDispatchedTrackerInput(dashboard, identifier, signal) {
    const response = await fetch(`${dashboard}/api/v1/${encodeURIComponent(identifier)}/input`, { signal: this.requestSignal(signal, 5_000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`production tracker input inspection failed with HTTP ${response.status}`);
    return response.json();
  }

  safeWorkspacePath(workspace, root) {
    return typeof workspace === 'string' && pathWithin(workspace, root) ? workspace : null;
  }

  async removeWorkspace(workspace, root) {
    if (!this.safeWorkspacePath(workspace, root) || workspace === root) throw new Error('refusing to remove a workspace outside the run-owned workspace root');
    await removePath(workspace);
    return { path: workspace, removed: true };
  }

  async removeWorkspaceRoot(workspaceRoot, parentRoot, { timeout = 30_000, signal } = {}) {
    if (!pathWithin(workspaceRoot, parentRoot) || workspaceRoot === parentRoot) throw new Error('refusing to remove a workspace root outside the run-owned workspace parent');
    await command('rm', ['-rf', '--', workspaceRoot], { timeout, signal });
    return { path: workspaceRoot, removed: true };
  }

  async workspaceExists(workspace) {
    try {
      await lstat(workspace);
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  }
}
