import { execFile as nodeExecFile } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

export const execFile = promisify(nodeExecFile);
export const sleep = milliseconds => new Promise(resolveSleep => setTimeout(resolveSleep, milliseconds));
export const nowIso = () => new Date().toISOString();
export const newRunId = () => randomUUID();

export async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { return null; }
}

export async function bounded(operation, timeoutMs, description) {
  let timeout;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${description} timed out after ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function commandError(error) {
  const detail = String(error?.stderr || error?.stdout || error?.message || error).trim();
  return detail.replace(/\s+/g, ' ').slice(0, 1_000);
}

export async function command(command, args, { cwd, timeout = 30_000, env = process.env } = {}) {
  try {
    const result = await execFile(command, args, { cwd, env: { ...env, GIT_TERMINAL_PROMPT: '0' }, timeout, maxBuffer: 4 * 1024 * 1024 });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    throw new Error(`${command} ${args.join(' ')} failed${commandError(error) ? `: ${commandError(error)}` : ''}`);
  }
}

export function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function deriveIdentifier(plan) {
  return `PLAN-${sha256(plan).slice(0, 12).toUpperCase()}`;
}

export function notionId(databaseUrl) {
  const url = new URL(databaseUrl);
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!['notion.so', 'app.notion.com'].includes(host) && !host.endsWith('.notion.so') && !host.endsWith('.notion.site')) {
    throw new Error('E2E database URL must be an HTTP(S) Notion URL');
  }
  const raw = url.pathname.split('/').pop() || '';
  const match = raw.match(/([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}|[\da-f]{32})$/i);
  if (!match) throw new Error('E2E database URL must end in a Notion database id');
  const compact = match[1].replaceAll('-', '').toLowerCase();
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

export function normalizeRef(ref) {
  if (typeof ref !== 'string' || !/^refs\/heads\/[A-Za-z0-9._/-]+$/.test(ref) || ref.includes('..')) {
    throw new Error(`seed_source_ref must be a safe remote branch ref: ${ref}`);
  }
  return ref;
}

export function assertBranch(branch) {
  if (typeof branch !== 'string' || !branch || branch.includes('..') || branch.startsWith('-') || branch.endsWith('/') || branch.includes('\\')) {
    throw new Error(`invalid run-scoped branch name: ${branch}`);
  }
  return branch;
}

export function pathWithin(child, parent) {
  const childPath = resolve(child);
  const parentPath = resolve(parent);
  const suffix = relative(parentPath, childPath);
  return suffix === '' || (suffix && !suffix.startsWith('..') && !isAbsolute(suffix));
}

export async function remove(path) {
  await rm(path, { recursive: true, force: true });
}

export function parseJsonOutput(stdout, description) {
  try { return JSON.parse(stdout.trim()); }
  catch { throw new Error(`${description} returned invalid JSON`); }
}

export function textValue(property) {
  const values = property?.type === 'title' ? property.title : property?.type === 'rich_text' ? property.rich_text : null;
  return Array.isArray(values) ? values.map(value => value?.plain_text ?? value?.text?.content ?? '').join('') : null;
}

export function selectValue(property) {
  return property?.type === 'select' && (property.select === null || typeof property.select?.name === 'string') ? property.select?.name ?? '' : null;
}

export function relationIds(property) {
  if (property?.type !== 'relation' || !Array.isArray(property.relation)) return null;
  return property.relation.map(value => value?.id).every(value => typeof value === 'string') ? property.relation.map(value => value.id) : null;
}

export function paragraphText(blocks) {
  return blocks.map(block => block?.type === 'paragraph' ? (block.paragraph?.rich_text || []).map(value => value?.plain_text ?? value?.text?.content ?? '').join('') : '').join('');
}
