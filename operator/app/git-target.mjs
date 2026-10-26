#!/usr/bin/env node

import { execFile as execute, execFileSync } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { validateGitBranchName } from '../project-config.mjs';
import { githubRepositoryTransport } from './github-repository-url.mjs';

const execFile = promisify(execute);
const gitEnvironment = { ...process.env, GIT_TERMINAL_PROMPT: '0' };

const runGitSync = (cwd, args) => execFileSync('git', args, {
  cwd,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  env: gitEnvironment
}).trim();

function gitValueSync(cwd, args) {
  try { return runGitSync(cwd, args); }
  catch { return null; }
}

export async function resolveTargetRepository(cwd) {
  let workingDirectory;
  try { workingDirectory = await realpath(cwd); }
  catch { throw new Error(`cannot access target repository directory: ${cwd}`); }
  const rootValue = gitValueSync(workingDirectory, ['rev-parse', '--show-toplevel']);
  if (!rootValue) throw new Error('run leesh-loop init from inside a Git repository');
  const repositoryRoot = await realpath(rootValue);
  if (repositoryRoot !== workingDirectory) throw new Error(`run leesh-loop init from the target repository root: ${repositoryRoot}`);

  const branch = gitValueSync(repositoryRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (!branch) throw new Error('the current Git checkout is detached; check out a branch with a configured remote branch, then run init again');
  const remote = gitValueSync(repositoryRoot, ['config', '--get', `branch.${branch}.remote`]);
  const mergeRef = gitValueSync(repositoryRoot, ['config', '--get', `branch.${branch}.merge`]);
  if (!remote || !mergeRef || remote === '.') throw new Error(`current branch '${branch}' has no configured remote branch; configure its Git upstream, then run init again`);
  if (!mergeRef.startsWith('refs/heads/') || mergeRef.length === 'refs/heads/'.length) {
    throw new Error(`current branch '${branch}' does not track a normal remote branch (${mergeRef}); update its Git upstream, then run init again`);
  }
  if (!gitValueSync(repositoryRoot, ['rev-parse', '--verify', '--quiet', '@{upstream}'])) {
    throw new Error(`the remote branch tracked by '${branch}' cannot be read; fetch it or repair the Git upstream, then run init again`);
  }
  const remoteUrl = gitValueSync(repositoryRoot, ['remote', 'get-url', remote]);
  if (!remoteUrl) throw new Error(`the Git remote '${remote}' tracked by '${branch}' has no repository URL; configure it, then run init again`);
  githubRepositoryTransport(remoteUrl);
  return {
    repositoryRoot,
    repositoryName: basename(repositoryRoot),
    branch,
    remoteName: remote,
    remoteUrl,
    upstreamBranch: mergeRef.slice('refs/heads/'.length)
  };
}

function commandError(error) {
  const detail = String(error?.stderr || error?.stdout || error?.message || error).trim();
  return detail.replace(/\s+/g, ' ').slice(0, 500);
}

async function git(args) {
  try {
    const { stdout } = await execFile('git', args, { env: gitEnvironment, maxBuffer: 1024 * 1024 });
    return stdout;
  } catch (error) {
    throw new Error(`git ${args.join(' ')} failed${commandError(error) ? `: ${commandError(error)}` : ''}`);
  }
}

export async function validateBaseBranch(baseBranch) {
  if (typeof baseBranch !== 'string' || baseBranch.length === 0) {
    throw new Error('SYMPHONY_GITHUB_BASE_BRANCH must be a non-empty Git branch name.');
  }
  return validateGitBranchName(baseBranch);
}

function parseRemoteBranch(stdout, baseBranch) {
  const expectedRef = `refs/heads/${baseBranch}`;
  const entries = stdout.split(/\r?\n/).filter(Boolean).map(line => {
    const [commit, ref] = line.split(/\s+/, 2);
    return { commit, ref };
  });
  const entry = entries.find(candidate => candidate.ref === expectedRef);
  if (!entry) return null;
  if (!/^[0-9a-f]{40}$/.test(entry.commit)) throw new Error(`remote configured base returned an invalid commit: ${entry.commit}`);
  return entry.commit;
}

export async function readRemoteBranch(repositoryUrl, baseBranch) {
  const stdout = await git(['ls-remote', '--heads', repositoryUrl, `refs/heads/${baseBranch}`]);
  return parseRemoteBranch(stdout, baseBranch);
}

async function resolveDefaultBranch(repositoryUrl) {
  const stdout = await git(['ls-remote', '--symref', repositoryUrl, 'HEAD']);
  const lines = stdout.split(/\r?\n/).filter(Boolean);
  const symref = lines.find(line => line.startsWith('ref: ') && /\s+HEAD$/.test(line));
  const match = symref?.match(/^ref: (refs\/heads\/.+)\s+HEAD$/);
  const head = lines.find(line => /\s+HEAD$/.test(line) && !line.startsWith('ref: '));
  const commit = head?.split(/\s+/, 2)[0];
  if (!match || !commit || !/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error('repository default branch HEAD could not be resolved; refusing to create an initial commit.');
  }
  return { branch: match[1].slice('refs/heads/'.length), commit };
}

export async function bootstrapGitTarget(repositoryUrl, baseBranch) {
  if (typeof repositoryUrl !== 'string' || repositoryUrl.length === 0) {
    throw new Error('SYMPHONY_GITHUB_REPOSITORY_URL must be configured.');
  }
  await validateBaseBranch(baseBranch);

  const existingCommit = await readRemoteBranch(repositoryUrl, baseBranch);
  if (existingCommit) return existingCommit;

  const defaultBranch = await resolveDefaultBranch(repositoryUrl);
  let creationError;
  const temporaryRepository = await mkdtemp(join(tmpdir(), 'leesh-loop-git-target-'));
  try {
    await git(['init', '--bare', temporaryRepository]);
    await git(['--git-dir', temporaryRepository, 'remote', 'add', 'origin', repositoryUrl]);
    await git(['--git-dir', temporaryRepository, 'fetch', '--no-tags', 'origin', `refs/heads/${defaultBranch.branch}:refs/remotes/origin/${defaultBranch.branch}`]);
    const fetchedCommit = (await git(['--git-dir', temporaryRepository, 'rev-parse', `refs/remotes/origin/${defaultBranch.branch}`])).trim();
    if (fetchedCommit !== defaultBranch.commit) throw new Error(`repository default branch advanced during bootstrap (${defaultBranch.commit} -> ${fetchedCommit}); retry readiness`);
    await git(['--git-dir', temporaryRepository, 'push', 'origin', `refs/remotes/origin/${defaultBranch.branch}:refs/heads/${baseBranch}`]);
  } catch (error) {
    // Another Operator may have created the branch concurrently. The
    // authoritative readback below decides whether that race is harmless.
    creationError = error;
  }

  await rm(temporaryRepository, { recursive: true, force: true });
  const bootstrappedCommit = await readRemoteBranch(repositoryUrl, baseBranch);
  if (bootstrappedCommit) return bootstrappedCommit;
  if (creationError) throw new Error(`configured base branch could not be created or read back: ${creationError.message}`);
  throw new Error('configured base branch creation completed without an authoritative remote readback.');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [, , commandOrRepository, commandArgument, commandBranch] = process.argv;
  const readOnly = commandOrRepository === 'read';
  const repositoryUrl = readOnly ? commandArgument : commandOrRepository;
  const baseBranch = readOnly ? commandBranch : commandArgument;
  (readOnly ? readRemoteBranch(repositoryUrl, baseBranch).then(commit => {
    if (!commit) throw new Error('configured base branch disappeared before readiness evidence was recorded.');
    return commit;
  }) : bootstrapGitTarget(repositoryUrl, baseBranch))
    .then(commit => process.stdout.write(`${commit}\n`))
    .catch(error => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
