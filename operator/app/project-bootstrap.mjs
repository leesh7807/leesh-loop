#!/usr/bin/env node
import { execFile as execute } from 'node:child_process';
import { access, lstat, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { PROJECT_DEFAULTS } from '../project-defaults.mjs';
import { validateBaseBranch } from './git-target.mjs';

const execFile = promisify(execute);
const gitEnvironment = { ...process.env, GIT_TERMINAL_PROMPT: '0' };

async function command(program, args, { cwd, allowFailure = false, stdio = 'pipe' } = {}) {
  try {
    const { stdout } = await execFile(program, args, { cwd, env: gitEnvironment, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, stdio });
    return String(stdout || '').trim();
  } catch (error) {
    if (allowFailure && [1, 127].includes(error.code)) return null;
    const detail = String(error.stderr || error.message || error).trim().replace(/https?:\/\/[^\s]+/g, '<repository-url>');
    throw new Error(`${program} ${args[0] || ''} failed${detail ? `: ${detail}` : ''}`);
  }
}

async function git(args, cwd, options = {}) {
  return command('git', args, { cwd, ...options });
}

function githubHttpsUrl(remoteUrl, description) {
  let host;
  let path;
  const scp = remoteUrl.match(/^(?:[^@/:]+@)?github\.com:(.+)$/i);
  if (scp) {
    host = 'github.com';
    path = scp[1];
  } else {
    let parsed;
    try { parsed = new URL(remoteUrl); }
    catch { throw new Error(`${description} is not a GitHub repository URL that the Operator can use.`); }
    host = parsed.hostname.toLowerCase();
    path = parsed.pathname.replace(/^\//, '');
    if (!['https:', 'ssh:', 'git:'].includes(parsed.protocol)) throw new Error(`${description} must use a Git-supported GitHub URL.`);
  }
  if (host !== 'github.com') throw new Error(`${description} must point to github.com because the Operator uses GitHub readiness.`);
  path = path.replace(/\.git$/i, '').replace(/\/$/, '');
  const parts = path.split('/');
  if (parts.length !== 2 || parts.some(part => !part || part === '.' || part === '..')) throw new Error(`${description} does not identify a GitHub owner/repository.`);
  return `https://github.com/${parts[0]}/${parts[1]}.git`;
}

async function optionalGit(args, cwd) {
  try { return await git(args, cwd); }
  catch { return null; }
}

async function remoteUrl(remote, cwd, description) {
  if (!remote || remote === '.') return null;
  const value = await optionalGit(['remote', 'get-url', remote], cwd);
  return value ? githubHttpsUrl(value, description) : null;
}

function branchFromMergeRef(value) {
  return typeof value === 'string' && value.startsWith('refs/heads/') ? value.slice('refs/heads/'.length) : null;
}

async function targetBaseFromRemoteHead(remote, cwd) {
  const symbolic = await optionalGit(['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`], cwd);
  const prefix = `${remote}/`;
  return symbolic?.startsWith(prefix) ? symbolic.slice(prefix.length) : null;
}

export async function discoverTargetProject(targetDirectory = process.cwd()) {
  const targetRoot = resolve(targetDirectory);
  const gitRoot = await optionalGit(['rev-parse', '--show-toplevel'], targetRoot);
  if (!gitRoot) throw new Error('current directory is not inside a Git repository. Run leesh-loop boot from the target repository root.');
  if (resolve(gitRoot) !== targetRoot) throw new Error('leesh-loop boot must run from the Git repository root.');

  const workflowPath = resolve(targetRoot, 'WORKFLOW.md');
  try {
    if (!(await stat(workflowPath)).isFile()) throw new Error('not a regular file');
    await access(workflowPath, constants.R_OK);
  } catch {
    throw new Error(`required project-owned WORKFLOW.md is missing or unreadable: ${workflowPath}`);
  }

  const localBranch = await optionalGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], targetRoot);
  const upstream = await optionalGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], targetRoot);
  const remotes = (await git(['remote'], targetRoot)).split(/\r?\n/).filter(Boolean);
  let remote = null;
  let baseBranch = null;

  if (upstream) {
    remote = remotes.filter(name => upstream.startsWith(`${name}/`)).sort((a, b) => b.length - a.length)[0] || null;
    if (remote) baseBranch = upstream.slice(remote.length + 1);
  }

  if (!remote && localBranch) {
    remote = await optionalGit(['config', '--get', `branch.${localBranch}.remote`], targetRoot);
    const mergeRef = await optionalGit(['config', '--get', `branch.${localBranch}.merge`], targetRoot);
    baseBranch = branchFromMergeRef(mergeRef);
  }

  if (!remote && remotes.length === 1) remote = remotes[0];
  if (!baseBranch && remote) baseBranch = await targetBaseFromRemoteHead(remote, targetRoot);
  if (!remote || !baseBranch) {
    throw new Error('cannot determine the target repository URL and base branch from this checkout\'s upstream, branch, or remote HEAD configuration.');
  }

  const repositoryUrl = await remoteUrl(remote, targetRoot, `target remote ${remote}`);
  if (!repositoryUrl) throw new Error(`cannot determine a GitHub repository URL from target remote ${remote}.`);
  await validateBaseBranch(baseBranch);
  return { targetRoot, targetName: basename(targetRoot), workflowPath, repositoryUrl, baseBranch };
}

async function inspectSourceCheckout(sourceDirectory) {
  const sourceRoot = resolve(sourceDirectory);
  const gitRoot = await optionalGit(['rev-parse', '--show-toplevel'], sourceRoot);
  if (!gitRoot || resolve(gitRoot) !== sourceRoot) throw new Error('linked Leesh Loop CLI is not running from a Git checkout.');
  const changes = await git(['status', '--porcelain', '--untracked-files=all'], sourceRoot);
  if (changes) throw new Error('linked Leesh Loop CLI checkout is dirty; commit or remove tracked and untracked changes before bootstrapping.');
  const revision = await git(['rev-parse', 'HEAD'], sourceRoot);
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(revision)) throw new Error('linked Leesh Loop CLI checkout has no valid Git revision.');
  const sourceRemoteValue = await optionalGit(['remote', 'get-url', 'origin'], sourceRoot);
  if (!sourceRemoteValue) throw new Error('linked Leesh Loop CLI checkout has no origin repository URL.');
  const sourceRepositoryUrl = githubHttpsUrl(sourceRemoteValue, 'linked Leesh Loop origin');
  return { sourceRoot, revision, sourceRepositoryUrl };
}

function relativeProjectPath(from, to) {
  const value = relative(from, to).split(sep).join('/');
  return value || '.';
}

function projectConfiguration(target, runtimeRoot, noExternal) {
  const projectDirectory = resolve(runtimeRoot, 'operator');
  return {
    workflow_path: relativeProjectPath(projectDirectory, target.workflowPath),
    symphony_workspace_root: '../workspaces',
    workspace_files: ['../.env'],
    github_repository_url: target.repositoryUrl,
    github_base_branch: target.baseBranch,
    ...PROJECT_DEFAULTS,
    skip_external_readiness: noExternal
  };
}

async function prepareRuntimeDependencies(runtimeRoot) {
  const symphonyRoot = resolve(runtimeRoot, 'operator/symphony');
  const hasMiseConfig = await stat(resolve(symphonyRoot, 'mise.toml')).then(result => result.isFile()).catch(() => false);
  if (!hasMiseConfig) throw new Error('generated runtime is missing operator/symphony/mise.toml.');
  const hasMise = await command('sh', ['-c', 'command -v mise'], { cwd: runtimeRoot, allowFailure: true });
  if (hasMise) {
    await command('mise', ['trust', '--yes'], { cwd: symphonyRoot, stdio: 'inherit' });
    await command('mise', ['exec', '--', 'mix', 'deps.get'], { cwd: symphonyRoot, stdio: 'inherit' });
    return;
  }
  await command('mix', ['deps.get'], { cwd: symphonyRoot, stdio: 'inherit' });
}

async function ensureRuntimeAbsent(runtimeRoot) {
  try {
    await lstat(runtimeRoot);
    throw new Error(`runtime root already exists: ${runtimeRoot}`);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
}

export async function bootstrapProject({ targetDirectory = process.cwd(), sourceDirectory, noExternal = false, prepareDependencies = true } = {}) {
  const target = await discoverTargetProject(targetDirectory);
  const source = await inspectSourceCheckout(sourceDirectory);
  const runtimeRoot = resolve(dirname(target.targetRoot), `${target.targetName}-loop`);
  await ensureRuntimeAbsent(runtimeRoot);

  // mkdir is an exclusive reservation. It rejects files, symlinks, and
  // concurrent boots without touching anything already at the sibling path.
  try {
    await mkdir(runtimeRoot, { recursive: false, mode: 0o755 });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`runtime root already exists: ${runtimeRoot}`);
    throw error;
  }

  try {
    await git(['clone', '--no-hardlinks', source.sourceRoot, runtimeRoot], target.targetRoot);
    await git(['switch', '--detach', source.revision], runtimeRoot);
    await git(['remote', 'set-url', 'origin', source.sourceRepositoryUrl], runtimeRoot);
    const runtimeRevision = await git(['rev-parse', 'HEAD'], runtimeRoot);
    if (runtimeRevision !== source.revision) throw new Error(`runtime checkout revision mismatch: expected ${source.revision}, got ${runtimeRevision}.`);

    const project = projectConfiguration(target, runtimeRoot, noExternal);
    const operatorDirectory = resolve(runtimeRoot, 'operator');
    await writeFile(resolve(operatorDirectory, 'project.json'), `${JSON.stringify(project, null, 2)}\n`, { mode: 0o644, flag: 'wx' });
    await writeFile(resolve(runtimeRoot, '.env'), 'NOTION_TOKEN=\nLEESH_LOOP_NOTION_DATABASE_URL=\n', { mode: 0o600, flag: 'wx' });
    await mkdir(resolve(runtimeRoot, 'workspaces'), { recursive: true, mode: 0o755 });
    if (prepareDependencies) await prepareRuntimeDependencies(runtimeRoot);

    return {
      ...target,
      runtimeRoot,
      runtimeRevision,
      relativeRuntimeRoot: relativeProjectPath(target.targetRoot, runtimeRoot),
      project,
      noExternal
    };
  } catch (error) {
    await rm(runtimeRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export function bootSuccessMessage(result) {
  const external = result.noExternal ? 'disabled' : 'enabled';
  return [
    `Leesh Loop created: ${result.relativeRuntimeRoot}`,
    `Project: ${result.targetName}`,
    `Repository: ${result.repositoryUrl}`,
    `Base: ${result.baseBranch}`,
    `Workflow: WORKFLOW.md`,
    `External readiness: ${external}`,
    '',
    'Review operator/project.json if the selected repository or base is not intended.',
    '',
    'Complete .env, then:',
    `  cd ${result.relativeRuntimeRoot}`,
    '  npm start'
  ].join('\n');
}
