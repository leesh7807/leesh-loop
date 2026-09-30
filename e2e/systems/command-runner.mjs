import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';

export const execFile = promisify(nodeExecFile);

export function commandError(error) {
  const detail = String(error?.stderr || error?.stdout || error?.message || error).trim();
  return detail.replace(/\s+/g, ' ').slice(0, 1_000);
}

export async function command(commandName, args, { cwd, timeout = 30_000, env = process.env, signal } = {}) {
  try {
    const result = await execFile(commandName, args, { cwd, env: { ...env, GIT_TERMINAL_PROMPT: '0' }, timeout, signal, maxBuffer: 4 * 1024 * 1024 });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    throw new Error(`${commandName} ${args.join(' ')} failed${commandError(error) ? `: ${commandError(error)}` : ''}`);
  }
}

export function parseJsonOutput(stdout, description) {
  try { return JSON.parse(stdout.trim()); }
  catch { throw new Error(`${description} returned invalid JSON`); }
}
