import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractNotionDatabaseId } from './notion-database-id.mjs';
import { assertBranch, normalizeRef } from '../systems/git/git-ref-validation.mjs';
import { readRepositoryEnvironmentValue } from '../../operator/local-environment.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const INITIAL_EMPTY_E2E_DATABASE_URLS = Object.freeze([
  'https://app.notion.com/p/studyleesh/3ea8a265862580348507c385c5e9c594?v=3ea8a2658625800a9e69000cf6e055fd',
  'https://app.notion.com/p/studyleesh/3ea8a2658625804781e0ead9c231fc10?v=d3a8a26586258361bab908ea713fdf9b',
  'https://app.notion.com/p/studyleesh/3ea8a265862580fabecdd4c35fd81425?v=0058a265862582d5856a880f3f425bb3',
  'https://app.notion.com/p/studyleesh/3ea8a2658625805bb64cd3068d1794ef?v=4a78a265862583f0b4718836810b2beb'
]);

const E2E_POLICY = Object.freeze({
  poll_interval_ms: 15_000,
  finalization_timeout_ms: 30_000,
  runtime_start_timeout_ms: 1_800_000,
  runtime_stop_timeout_ms: 30_000,
  runtime_port_attempts: 8
});

function parseDatabaseUrls(value) {
  if (typeof value !== 'string') return [];
  return value.split(/[\r\n,]+/).map(url => url.trim()).filter(Boolean);
}

export function resolveE2EDatabasePool({ configuredUrls, existingUrl } = {}) {
  const urls = configuredUrls !== undefined && configuredUrls.trim()
    ? parseDatabaseUrls(configuredUrls)
    : [...(existingUrl ? [existingUrl] : []), ...INITIAL_EMPTY_E2E_DATABASE_URLS];
  const candidates = [];
  const seen = new Set();
  for (const url of urls) {
    const databaseId = extractNotionDatabaseId(url);
    if (seen.has(databaseId)) continue;
    seen.add(databaseId);
    candidates.push({ database_id: databaseId, database_url: url });
  }
  if (!candidates.length) throw new Error('missing E2E database pool: set LEESH_LOOP_E2E_NOTION_DATABASE_URL or LEESH_LOOP_E2E_NOTION_DATABASE_URLS');
  return candidates;
}

export async function loadE2ERuntimeConfig({ root = repositoryRoot, environment = process.env, envFile, productionProjectPath } = {}) {
  const absoluteRoot = resolve(root);
  const projectPath = resolve(productionProjectPath || join(absoluteRoot, 'operator/project.json'));
  let productionProject;
  try { productionProject = JSON.parse(await readFile(projectPath, 'utf8')); }
  catch { throw new Error(`missing or invalid production Operator Project: ${projectPath}`); }
  if (!productionProject || typeof productionProject !== 'object' || Array.isArray(productionProject)) {
    throw new Error('production Operator Project must be an object');
  }
  for (const key of ['github_repository_url', 'github_base_branch']) {
    if (typeof productionProject[key] !== 'string' || !productionProject[key].trim()) throw new Error(`production Operator Project requires ${key}`);
  }
  for (const key of ['codex_model', 'codex_reasoning_effort']) {
    const value = productionProject[key];
    if (value !== undefined && (typeof value !== 'string' || !value.trim())) throw new Error(`production Project ${key} must be a non-empty string`);
  }

  const configuredUrls = await readRepositoryEnvironmentValue('LEESH_LOOP_E2E_NOTION_DATABASE_URLS', { environment, envFile });
  const existingUrl = await readRepositoryEnvironmentValue('LEESH_LOOP_E2E_NOTION_DATABASE_URL', { environment, envFile });
  const databasePool = resolveE2EDatabasePool({ configuredUrls, existingUrl });
  const productionBaseBranch = assertBranch(productionProject.github_base_branch);
  const seedSourceRef = normalizeRef(`refs/heads/${productionBaseBranch}`);
  const workflowPath = join(absoluteRoot, 'e2e/WORKFLOW.md');
  const paths = {
    runRecordDirectory: join(absoluteRoot, 'e2e/runs'),
    workspaceRoot: join(absoluteRoot, 'e2e/workspaces')
  };

  return {
    repository_root: absoluteRoot,
    production_project_path: projectPath,
    repository_url: productionProject.github_repository_url,
    production_base_branch: productionBaseBranch,
    seed_source_ref: seedSourceRef,
    ...(productionProject.codex_model === undefined ? {} : { codex_model: productionProject.codex_model }),
    ...(productionProject.codex_reasoning_effort === undefined ? {} : { codex_reasoning_effort: productionProject.codex_reasoning_effort }),
    workflow_path: workflowPath,
    database_pool: databasePool,
    run_record_directory: paths.runRecordDirectory,
    workspace_root: paths.workspaceRoot,
    ...E2E_POLICY
  };
}

export function createRunScopedBaseBranchName(runId) {
  return assertBranch(`base/${runId}`);
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

export function createOperatorProjectConfig(config, paths, baseBranch, workflowPath = config.workflow_path, ports = {}) {
  return {
    workflow_path: workflowPath,
    symphony_workspace_root: paths.workspaceRoot,
    allow_workspace_root_inside_repository: true,
    github_repository_url: config.repository_url,
    github_base_branch: baseBranch,
    ...(config.codex_model === undefined ? {} : { codex_model: config.codex_model }),
    ...(config.codex_reasoning_effort === undefined ? {} : { codex_reasoning_effort: config.codex_reasoning_effort }),
    skip_external_readiness: true,
    open_project_surfaces: false,
    symphony_port: ports.symphony_port,
    ui_port: ports.ui_port,
    state_directory: paths.runtimeState
  };
}
