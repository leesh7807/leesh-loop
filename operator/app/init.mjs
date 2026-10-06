import { execFileSync } from 'node:child_process';
import { lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HOST_PREREQUISITES, listRuntimeSnapshotFiles, materializeRuntimeSnapshot } from './runtime-manifest.mjs';
import { githubRepositoryTransport } from './github-repository-url.mjs';
import { readRepositoryEnvironmentValue } from '../local-environment.mjs';
import { stringifyProjectConfiguration } from '../project-config.mjs';

const runGit = (cwd, args) => execFileSync('git', args, {
  cwd,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe']
}).trim();

function gitValue(cwd, args) {
  try { return runGit(cwd, args); }
  catch { return null; }
}

function validateTargetUrl(remoteUrl) {
  githubRepositoryTransport(remoteUrl);
  return remoteUrl;
}

export async function resolveTargetRepository(cwd) {
  let workingDirectory;
  try { workingDirectory = await realpath(cwd); }
  catch { throw new Error(`cannot access target repository directory: ${cwd}`); }
  const rootValue = gitValue(workingDirectory, ['rev-parse', '--show-toplevel']);
  if (!rootValue) throw new Error('run leesh-loop init from inside a Git repository');
  const repositoryRoot = await realpath(rootValue);
  if (repositoryRoot !== workingDirectory) {
    throw new Error(`run leesh-loop init from the target repository root: ${repositoryRoot}`);
  }

  const branch = gitValue(repositoryRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (!branch) throw new Error('the current Git checkout is detached; check out a branch with a configured remote branch, then run init again');
  const remote = gitValue(repositoryRoot, ['config', '--get', `branch.${branch}.remote`]);
  const mergeRef = gitValue(repositoryRoot, ['config', '--get', `branch.${branch}.merge`]);
  if (!remote || !mergeRef || remote === '.') {
    throw new Error(`current branch '${branch}' has no configured remote branch; configure its Git upstream, then run init again`);
  }
  if (!mergeRef.startsWith('refs/heads/') || mergeRef.length === 'refs/heads/'.length) {
    throw new Error(`current branch '${branch}' does not track a normal remote branch (${mergeRef}); update its Git upstream, then run init again`);
  }
  if (!gitValue(repositoryRoot, ['rev-parse', '--verify', '--quiet', '@{upstream}'])) {
    throw new Error(`the remote branch tracked by '${branch}' cannot be read; fetch it or repair the Git upstream, then run init again`);
  }
  const remoteUrl = gitValue(repositoryRoot, ['remote', 'get-url', remote]);
  if (!remoteUrl) throw new Error(`the Git remote '${remote}' tracked by '${branch}' has no repository URL; configure it, then run init again`);
  return {
    repositoryRoot,
    repositoryName: basename(repositoryRoot),
    branch,
    remoteName: remote,
    remoteUrl: validateTargetUrl(remoteUrl),
    upstreamBranch: mergeRef.slice('refs/heads/'.length)
  };
}

function generatedProject(target) {
  return {
    workflow_path: 'WORKFLOW.md',
    symphony_workspace_root: '.runtime/workspaces',
    state_directory: '.runtime/state',
    allow_workspace_root_inside_repository: true,
    github_repository_url: target.remoteUrl,
    github_base_branch: target.upstreamBranch,
    codex_model: 'gpt-6-luna',
    codex_reasoning_effort: 'xhigh'
  };
}

function generatedProjectToml(project) {
  const guidance = [
    '# Project settings for this Loop. Relative paths start at this file.',
    '# Absolute paths and ~/ paths are also supported.',
    '',
    '# Operator UI port. Default: 4310. Change it if another local app uses this port.',
    '# ui_port = 4311',
    '',
    '# Symphony runtime port. Default: 4100. Change it if another local app uses this port.',
    '# symphony_port = 4101',
    '',
    '# Extra regular files copied into every newly created worker workspace.',
    '# Relative paths use this project.toml directory; absolute paths and ~/ paths also work.',
    '# Git tracking does not matter: a sibling target repository Git-ignored file can be listed.',
    '# Each source is copied unchanged into the workspace root under its basename.',
    '# Directories and globs are not supported. Sources with the same basename are rejected.',
    '# Do not use this setting to pass credentials to workers.',
    '# Example: workspace_files = ["../your-repository/local-settings.json"]',
    'workspace_files = []',
    '',
    '# Optional Codex worker overrides. Change or remove these to use your Codex defaults.',
    '',
    '# Open the Operator page automatically on start. Default: true.',
    '# open_project_surfaces = false',
    '',
    '# Skip external review readiness checks. Default: false; core startup checks still run.',
    '# skip_external_readiness = true',
    '',
    '# Startup timeout in milliseconds. Default: 1800000 (30 minutes).',
    '# startup_timeout_ms = 1800000',
    '',
    '# Browser acknowledgement timeout in milliseconds. Default: 1000.',
    '# browser_acknowledgement_timeout_ms = 1000',
    ''
  ].join('\n');
  return `${guidance}${stringifyProjectConfiguration(project)}`;
}

function generatedPackage(repositoryName) {
  const slug = repositoryName.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 180);
  const packageName = slug ? `${slug}-loop` : 'leesh-loop-instance';
  return {
    name: packageName,
    version: '0.1.0',
    private: true,
    scripts: {
      start: 'node operator/app/prepare-runtime.mjs && node operator/app/leesh-loop.mjs start project.toml',
      stop: 'node operator/app/leesh-loop.mjs stop project.toml'
    }
  };
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function generatedWorkflow(template) {
  const configuration = [
    '---',
    'tracker:',
    '  kind: notion',
    '  provider:',
    '    database_url: $LEESH_LOOP_NOTION_DATABASE_URL',
    '  active_states:',
    '    - Ready',
    '    - In Progress',
    '    - Rework',
    '    - Merging',
    '  terminal_states:',
    '    - Done',
    '    - Cancelled',
    'polling:',
    '  interval_ms: 30000',
    'workspace:',
    '  root: $SYMPHONY_WORKSPACE_ROOT',
    'hooks:',
    '  after_create: |',
    '    : "${SYMPHONY_GITHUB_REPOSITORY_URL:?SYMPHONY_GITHUB_REPOSITORY_URL is required}"',
    '    : "${SYMPHONY_GITHUB_BASE_BRANCH:?SYMPHONY_GITHUB_BASE_BRANCH is required}"',
    '    git clone --branch "$SYMPHONY_GITHUB_BASE_BRANCH" "$SYMPHONY_GITHUB_REPOSITORY_URL" .',
    'agent:',
    '  max_turns: 20',
    'codex:',
    '  command: |',
    '    env PATH="$CHATGPT_SHOT_WORKER_INTERFACE_ROOT:$PATH" bash -c \'',
    '      codex_args=()',
    '      if [ -n "${SYMPHONY_CODEX_MODEL:-}" ]; then',
    '        codex_args+=(--config "model=${SYMPHONY_CODEX_MODEL}")',
    '      fi',
    '      if [ -n "${SYMPHONY_CODEX_REASONING_EFFORT:-}" ]; then',
    '        codex_args+=(--config "model_reasoning_effort=${SYMPHONY_CODEX_REASONING_EFFORT}")',
    '      fi',
    '      exec codex "${codex_args[@]}" app-server',
    '    \'',
    '---'
  ].join('\n');
  return `${configuration}\n\n${template.trim()}\n`;
}

const envExample = `# Configure in this Loop's process environment or copy this file to .env.
# The Operator reads both values from the Loop process environment or its root .env.
LEESH_LOOP_NOTION_DATABASE_URL=
NOTION_TOKEN=
`;

function completionOutput({ destination, project, workflowPath, notionBinding }) {
  const notionStatus = notionBinding === 'not configured'
    ? 'not configured'
    : notionBinding.startsWith('configured in the init process')
      ? 'available to init only; make it available to npm start too'
      : 'found in this Loop’s root .env';
  const lines = [
    'Leesh Loop is ready.',
    `Loop directory: ${destination}`,
    `Target repository: ${project.github_repository_url}`,
    `Target base branch: ${project.github_base_branch}`,
    `Agent workflow: ${workflowPath}`,
    'Init built the root WORKFLOW.md from docs/WORKFLOW_TEMPLATE.md; the worker reads this contract for each task.',
    `Notion database URL: ${notionStatus}`,
    'Before npm start, make LEESH_LOOP_NOTION_DATABASE_URL and NOTION_TOKEN available in this Loop’s environment or root .env.',
    'Host prerequisites:'
  ];
  for (const prerequisite of HOST_PREREQUISITES) lines.push(`  - ${prerequisite}`);
  if (notionBinding === 'not configured') {
    lines.push('The Notion database URL was not found. Add it before starting the Loop.');
  }
  lines.push(
    'Loop settings are in the root project.toml; relative paths are resolved from that file.',
    'npm start prepares this Loop’s dependencies, checks its connections, and opens the Operator page.',
    'Sign in to GitHub CLI and configure Codex CLI and chatgpt-shot on the machine that runs this Loop.',
    'Next:',
    `  cd ${shellQuote(destination)}`,
    '  npm start'
  );
  return lines.join('\n');
}

async function readNotionBinding(destination, environment) {
  if (typeof environment.LEESH_LOOP_NOTION_DATABASE_URL === 'string' && environment.LEESH_LOOP_NOTION_DATABASE_URL.trim()) {
    return 'configured in the init process environment; ensure npm start receives it too';
  }
  const envFileValue = await readRepositoryEnvironmentValue('LEESH_LOOP_NOTION_DATABASE_URL', {
    environment: {},
    envFile: join(destination, '.env')
  });
  return envFileValue ? 'configured in this Loop root .env' : 'not configured';
}

async function pathExists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

export async function initLoop({ cwd = process.cwd(), sourceRoot, environment = process.env } = {}) {
  if (!sourceRoot) throw new Error('Leesh Loop could not find its installed files; reinstall or relink it, then retry');
  const target = await resolveTargetRepository(cwd);
  const destination = resolve(dirname(target.repositoryRoot), `${target.repositoryName}-loop`);
  if (await pathExists(destination)) throw new Error(`the Loop folder already exists, so init left it unchanged: ${destination}`);

  const runtimeFiles = listRuntimeSnapshotFiles(sourceRoot);
  if (!runtimeFiles.length) throw new Error('runtime snapshot manifest selected no tracked runtime files');
  const template = await readFile(join(sourceRoot, 'docs/WORKFLOW_TEMPLATE.md'), 'utf8');
  try {
    await mkdir(destination);
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error(`destination already exists; refusing to change it: ${destination}`);
    throw error;
  }

  try {
    await materializeRuntimeSnapshot(sourceRoot, destination);
    const project = generatedProject(target);
    await writeFile(join(destination, 'project.toml'), generatedProjectToml(project), { mode: 0o600 });
    await writeFile(join(destination, 'package.json'), `${JSON.stringify(generatedPackage(target.repositoryName), null, 2)}\n`, { mode: 0o644 });
    await writeFile(join(destination, 'WORKFLOW.md'), generatedWorkflow(template), { mode: 0o644 });
    await writeFile(join(destination, '.env.example'), envExample, { mode: 0o600 });

    const projectPath = join(destination, 'project.toml');
    const generatedOperator = await import(pathToFileURL(join(destination, 'operator/app/leesh-loop.mjs')).href);
    const projectReadback = await generatedOperator.loadConfig(projectPath, {
      validateWorkspaceFileSources: true,
      requireNotionDatabase: false,
      environment,
      envFile: join(destination, '.env')
    });
    const workflowPath = projectReadback.workflow_path;
    const notionBinding = await readNotionBinding(destination, environment);
    const output = completionOutput({ destination, project: projectReadback, workflowPath, notionBinding });
    return { destination, target, project: projectReadback, workflowPath, notionBinding, completionOutput: output };
  } catch (error) {
    try {
      await rm(destination, { recursive: true, force: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `init failed and could not remove its partial destination ${destination}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
      );
    }
    throw error;
  }
}
