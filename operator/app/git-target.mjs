#!/usr/bin/env node

import { execFile as execute } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execute);
const gitEnvironment = { ...process.env, GIT_TERMINAL_PROMPT: '0' };

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
  try {
    await execFile('git', ['check-ref-format', '--branch', baseBranch], { env: gitEnvironment, maxBuffer: 1024 * 1024 });
  } catch {
    throw new Error(`configured base branch is not a valid Git branch name: ${baseBranch}`);
  }
  return baseBranch;
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

if (process.argv[1] && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname) {
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
