import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { assertBranch, normalizeRef, notionId } from './common.mjs';

export const E2E_DATABASE_URL = 'https://app.notion.com/p/studyleesh/3e08a2658625805cad23fe1137be4a1e?v=3e08a26586258042a8e4000c945e56e7';
export const E2E_DATABASE_ID = notionId(E2E_DATABASE_URL);

const positiveInteger = (value, name) => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
};

export async function loadConfig(configPath) {
  const absolutePath = resolve(configPath);
  let raw;
  try { raw = JSON.parse(await readFile(absolutePath, 'utf8')); }
  catch { throw new Error(`missing or invalid E2E project configuration: ${absolutePath}`); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('E2E project configuration must be an object');
  if (raw.notion_database_url !== E2E_DATABASE_URL) throw new Error('E2E project must keep the fixed E2E Notion database binding');
  for (const key of ['repository_url', 'workflow_path', 'seed_source_ref']) if (typeof raw[key] !== 'string' || !raw[key].trim()) throw new Error(`E2E project configuration requires ${key}`);
  const base = dirname(absolutePath);
  const config = {
    ...raw,
    configuration_path: absolutePath,
    repository_url: raw.repository_url,
    workflow_path: resolve(base, raw.workflow_path),
    notion_database_url: E2E_DATABASE_URL,
    notion_database_id: E2E_DATABASE_ID,
    seed_source_ref: normalizeRef(raw.seed_source_ref),
    run_record_directory: resolve(base, raw.run_record_directory || 'runs'),
    workspace_root: raw.workspace_root ? resolve(base, raw.workspace_root) : join(tmpdir(), 'leesh-loop-e2e-workspaces'),
    poll_interval_ms: positiveInteger(raw.poll_interval_ms ?? 15_000, 'poll_interval_ms'),
    finalization_timeout_ms: positiveInteger(raw.finalization_timeout_ms ?? 30_000, 'finalization_timeout_ms'),
    runtime_start_timeout_ms: positiveInteger(raw.runtime_start_timeout_ms ?? 1_800_000, 'runtime_start_timeout_ms'),
    runtime_stop_timeout_ms: positiveInteger(raw.runtime_stop_timeout_ms ?? 30_000, 'runtime_stop_timeout_ms'),
    symphony_port: positiveInteger(raw.symphony_port ?? 4_410, 'symphony_port'),
    ui_port: positiveInteger(raw.ui_port ?? 4_610, 'ui_port')
  };
  if (!config.workflow_path.startsWith('/')) throw new Error('workflow_path must resolve to an absolute path');
  return config;
}

export function runBranch(runId) {
  const branch = `base/${runId}`;
  return assertBranch(branch);
}

export function runPaths(config, runId) {
  const runDirectory = join(config.run_record_directory, runId);
  return {
    directory: runDirectory,
    record: join(runDirectory, 'run.json'),
    runtimeProject: join(runDirectory, 'project.json'),
    runtimeState: join(runDirectory, 'operator-state'),
    workspaceRoot: join(config.workspace_root, runId),
    log: join(runDirectory, 'publisher.log')
  };
}

export function runtimeProject(config, paths, baseBranch) {
  return {
    workflow_path: config.workflow_path,
    notion_database_url: config.notion_database_url,
    symphony_workspace_root: paths.workspaceRoot,
    github_repository_url: config.repository_url,
    github_base_branch: baseBranch,
    symphony_port: config.symphony_port,
    ui_port: config.ui_port,
    state_directory: paths.runtimeState
  };
}
