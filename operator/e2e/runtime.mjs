import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { command, parseJsonOutput, pathWithin, remove } from './common.mjs';

export class RuntimeCapability {
  constructor({ root, app = join(root, 'operator/app/leesh-loop.mjs'), commandRunner = command } = {}) {
    this.root = root;
    this.app = app;
    this.commandRunner = commandRunner;
  }

  async start(projectPath, timeoutMs) {
    const { stdout } = await this.commandRunner('node', [this.app, 'start', projectPath], { cwd: this.root, timeout: timeoutMs });
    return parseJsonOutput(stdout, 'Operator start');
  }

  async stop(projectPath, timeoutMs, signal) {
    const { stdout } = await this.commandRunner('node', [this.app, 'stop', projectPath], { cwd: this.root, timeout: timeoutMs, signal });
    return parseJsonOutput(stdout, 'Operator stop');
  }

  requestSignal(signal, timeoutMs) {
    return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  }

  async runtime(dashboard, signal) {
    const response = await fetch(`${dashboard}/api/v1/runtime`, { signal: this.requestSignal(signal, 5_000) });
    if (!response.ok) throw new Error(`Symphony runtime inspection failed with HTTP ${response.status}`);
    return response.json();
  }

  async state(dashboard, signal) {
    const response = await fetch(`${dashboard}/api/v1/state`, { signal: this.requestSignal(signal, 5_000) });
    if (!response.ok) throw new Error(`Symphony state inspection failed with HTTP ${response.status}`);
    return response.json();
  }

  async issue(dashboard, identifier, signal) {
    const response = await fetch(`${dashboard}/api/v1/${encodeURIComponent(identifier)}`, { signal: this.requestSignal(signal, 5_000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Symphony issue inspection failed with HTTP ${response.status}`);
    return response.json();
  }

  async trackerInput(dashboard, identifier, signal) {
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
    await remove(workspace);
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
