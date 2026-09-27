import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { extractNotionDatabaseId } from './notion-database-id.mjs';
import { assertBranch, normalizeRef } from '../systems/git/git-ref-validation.mjs';
import { readRepositoryEnvironmentValue } from '../../local-environment.mjs';
import { resolveProjectPath } from '../../local-path.mjs';

const positiveInteger = (value, name) => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
};

export async function loadE2EProjectConfig(configPath, { environment = process.env, envFile, homeDirectory } = {}) {
  const absolutePath = resolve(configPath);
  let raw;
  try { raw = JSON.parse(await readFile(absolutePath, 'utf8')); }
  catch { throw new Error(`missing or invalid E2E project configuration: ${absolutePath}`); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('E2E project configuration must be an object');
  for (const key of ['repository_url', 'workflow_path', 'seed_source_ref']) if (typeof raw[key] !== 'string' || !raw[key].trim()) throw new Error(`E2E project configuration requires ${key}`);
  for (const key of ['codex_model', 'codex_reasoning_effort']) if (raw[key] !== undefined && (typeof raw[key] !== 'string' || !raw[key].trim())) throw new Error(`${key} must be a non-empty string`);
  const base = dirname(absolutePath);
  const repositoryRoot = resolve(base, '../..');
  const notion_database_url = await readRepositoryEnvironmentValue('LEESH_LOOP_E2E_NOTION_DATABASE_URL', { environment, envFile });
  if (!notion_database_url) throw new Error('missing LEESH_LOOP_E2E_NOTION_DATABASE_URL: set it in the E2E process environment or repository-root .env');
  const config = {
    ...raw,
    configuration_path: absolutePath,
    repository_url: raw.repository_url,
    workflow_path: resolveProjectPath(raw.workflow_path, base, homeDirectory),
    notion_database_url,
    notion_database_id: extractNotionDatabaseId(notion_database_url),
    seed_source_ref: normalizeRef(raw.seed_source_ref),
    run_record_directory: resolveProjectPath(raw.run_record_directory || 'runs', base, homeDirectory),
    workspace_root: raw.workspace_root ? resolveProjectPath(raw.workspace_root, base, homeDirectory) : join(base, 'workspaces'),
    poll_interval_ms: positiveInteger(raw.poll_interval_ms ?? 15_000, 'poll_interval_ms'),
    finalization_timeout_ms: positiveInteger(raw.finalization_timeout_ms ?? 30_000, 'finalization_timeout_ms'),
    runtime_start_timeout_ms: positiveInteger(raw.runtime_start_timeout_ms ?? 1_800_000, 'runtime_start_timeout_ms'),
    runtime_stop_timeout_ms: positiveInteger(raw.runtime_stop_timeout_ms ?? 30_000, 'runtime_stop_timeout_ms'),
    symphony_port: positiveInteger(raw.symphony_port ?? 4_410, 'symphony_port'),
    ui_port: positiveInteger(raw.ui_port ?? 4_610, 'ui_port')
  };
  if (!config.workflow_path.startsWith('/')) throw new Error('workflow_path must resolve to an absolute path');
  const workspaceRelation = relative(repositoryRoot, config.workspace_root);
  if (!isAbsolute(config.workspace_root) || workspaceRelation === '' || workspaceRelation.startsWith('..') || isAbsolute(workspaceRelation)) {
    throw new Error(`E2E workspace_root must be a non-root path inside the current repository: ${config.workspace_root}`);
  }
  config.repository_root = repositoryRoot;
  return config;
}

export function createRunScopedBaseBranchName(runId) {
  const branch = `base/${runId}`;
  return assertBranch(branch);
}

export function createRunPaths(config, runId) {
  const runDirectory = join(config.run_record_directory, runId);
  return {
    directory: runDirectory,
    record: join(runDirectory, 'run.json'),
    runtimeProject: join(runDirectory, 'project.json'),
    runtimeState: join(runDirectory, 'operator-state'),
    workloadInputSnapshot: join(runDirectory, 'workload-input.md'),
    workloadPublisherSnapshot: join(runDirectory, 'workload-publisher.md'),
    workflowSnapshot: join(runDirectory, 'workflow.md'),
    workspaceRoot: join(config.workspace_root, runId),
    log: join(runDirectory, 'publisher.log')
  };
}

export function createOperatorProjectConfig(config, paths, baseBranch, workflowPath = config.workflow_path) {
  return {
    workflow_path: workflowPath,
    symphony_workspace_root: paths.workspaceRoot,
    allow_workspace_root_inside_repository: true,
    github_repository_url: config.repository_url,
    github_base_branch: baseBranch,
    ...(config.codex_model === undefined ? {} : { codex_model: config.codex_model }),
    ...(config.codex_reasoning_effort === undefined ? {} : { codex_reasoning_effort: config.codex_reasoning_effort }),
    skip_external_readiness: true,
    symphony_port: config.symphony_port,
    ui_port: config.ui_port,
    state_directory: paths.runtimeState
  };
}
