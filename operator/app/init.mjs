import { execFileSync } from 'node:child_process';
import { lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { HOST_PREREQUISITES, listRuntimeSnapshotFiles, materializeRuntimeSnapshot } from './runtime-manifest.mjs';
import { githubRepositoryTransport } from './github-repository-url.mjs';
import { readRepositoryEnvironmentValue } from '../local-environment.mjs';
import { resolveProjectPath } from '../local-path.mjs';

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
  catch { throw new Error(`cannot resolve target repository directory: ${cwd}`); }
  const rootValue = gitValue(workingDirectory, ['rev-parse', '--show-toplevel']);
  if (!rootValue) throw new Error('leesh-loop init must be run inside a Git repository');
  const repositoryRoot = await realpath(rootValue);
  if (repositoryRoot !== workingDirectory) {
    throw new Error(`run leesh-loop init from the target repository root: ${repositoryRoot}`);
  }

  const branch = gitValue(repositoryRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (!branch) throw new Error('cannot resolve a Git upstream while HEAD is detached; check out a branch with a configured upstream');
  const remote = gitValue(repositoryRoot, ['config', '--get', `branch.${branch}.remote`]);
  const mergeRef = gitValue(repositoryRoot, ['config', '--get', `branch.${branch}.merge`]);
  if (!remote || !mergeRef || remote === '.') {
    throw new Error(`current branch '${branch}' has no configured Git upstream; configure its upstream remote and branch, then run init again`);
  }
  if (!mergeRef.startsWith('refs/heads/') || mergeRef.length === 'refs/heads/'.length) {
    throw new Error(`current branch '${branch}' has an unsupported upstream branch configuration: ${mergeRef}`);
  }
  if (!gitValue(repositoryRoot, ['rev-parse', '--verify', '--quiet', '@{upstream}'])) {
    throw new Error(`current branch '${branch}' has no resolvable configured Git upstream; fetch or repair that upstream, then run init again`);
  }
  const remoteUrl = gitValue(repositoryRoot, ['remote', 'get-url', remote]);
  if (!remoteUrl) throw new Error(`configured upstream remote '${remote}' has no repository URL`);
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
    workflow_path: '../WORKFLOW.md',
    symphony_workspace_root: '../.runtime/workspaces',
    state_directory: '../.runtime/state',
    allow_workspace_root_inside_repository: true,
    workspace_files: [],
    github_repository_url: target.remoteUrl,
    github_base_branch: target.upstreamBranch,
    codex_model: 'gpt-6-luna',
    codex_reasoning_effort: 'xhigh'
  };
}

function generatedPackage(repositoryName) {
  const slug = repositoryName.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 180);
  const packageName = slug ? `${slug}-loop` : 'leesh-loop-instance';
  return {
    name: packageName,
    version: '0.1.0',
    private: true,
    scripts: {
      start: 'node operator/app/prepare-runtime.mjs && node operator/app/leesh-loop.mjs start operator/project.json',
      stop: 'node operator/app/leesh-loop.mjs stop operator/project.json'
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
  const lines = [
    'Leesh Loop initialized.',
    `Output directory: ${destination}`,
    `Target remote URL: ${project.github_repository_url}`,
    `Target branch: ${project.github_base_branch}`,
    `Workflow: ${workflowPath}`,
    `Codex model: ${project.codex_model}`,
    `Reasoning effort: ${project.codex_reasoning_effort}`,
    `Notion database binding: ${notionBinding}`,
    'Host prerequisites:'
  ];
  for (const prerequisite of HOST_PREREQUISITES) lines.push(`  - ${prerequisite}`);
  if (notionBinding === 'not configured') {
    lines.push('Notion setup required before npm start: set LEESH_LOOP_NOTION_DATABASE_URL in this Loop process environment or root .env.');
  } else if (notionBinding.startsWith('configured in the init process')) {
    lines.push('Ensure the npm start process also receives LEESH_LOOP_NOTION_DATABASE_URL; init does not persist credentials.');
  }
  lines.push(
    'Project settings can be changed in operator/project.json; the workflow can be moved by updating workflow_path.',
    'npm start prepares this Loop’s Symphony, Publisher, and Operator UI package dependencies from its included manifests and lockfiles.',
    "Before npm start, set NOTION_TOKEN in this Loop's environment or root .env. Configure GitHub CLI authentication, upstream Git credentials or SSH access, and the existing chatgpt-shot credentials as well.",
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
  if (!sourceRoot) throw new Error('cannot locate the Leesh Loop source checkout');
  const target = await resolveTargetRepository(cwd);
  const destination = resolve(dirname(target.repositoryRoot), `${target.repositoryName}-loop`);
  if (await pathExists(destination)) throw new Error(`destination already exists; refusing to change it: ${destination}`);

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
    await mkdir(join(destination, 'operator'), { recursive: true });
    await writeFile(join(destination, 'operator/project.json'), `${JSON.stringify(project, null, 2)}\n`, { mode: 0o600 });
    await writeFile(join(destination, 'package.json'), `${JSON.stringify(generatedPackage(target.repositoryName), null, 2)}\n`, { mode: 0o644 });
    await writeFile(join(destination, 'WORKFLOW.md'), generatedWorkflow(template), { mode: 0o644 });
    await writeFile(join(destination, '.env.example'), envExample, { mode: 0o600 });

    const projectReadback = JSON.parse(await readFile(join(destination, 'operator/project.json'), 'utf8'));
    const workflowPath = resolveProjectPath(projectReadback.workflow_path, join(destination, 'operator'));
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
