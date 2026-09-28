import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertBranch } from './git-ref-validation.mjs';
import { command } from '../command-runner.mjs';
import { removePath } from '../filesystem/file-safety.mjs';

function parseLsRemote(output) {
  return new Map(output.split(/\r?\n/).filter(Boolean).map(line => {
    const [commit, ref] = line.trim().split(/\s+/, 2);
    return [ref, commit];
  }));
}

export class GitClient {
  constructor({ repositoryUrl, gitCommand = command } = {}) {
    this.repositoryUrl = repositoryUrl;
    this.gitCommand = gitCommand;
  }

  async resolveSeedCommit(sourceRef) {
    const { stdout } = await this.gitCommand('git', ['ls-remote', '--heads', this.repositoryUrl, sourceRef], { timeout: 30_000 });
    const refs = parseLsRemote(stdout);
    const commit = refs.get(sourceRef);
    if (!/^[0-9a-f]{40}$/i.test(commit || '')) throw new Error(`configured seed source ref ${sourceRef} could not be resolved to an immutable commit`);
    return commit;
  }

  async createRunScopedBaseBranch(branch, seedCommit, sourceRef = null) {
    assertBranch(branch);
    if (!/^[0-9a-f]{40}$/i.test(seedCommit)) throw new Error('seed commit must be a full immutable Git commit');
    if (await this.readRemoteBranchCommit(branch)) throw new Error(`run-scoped base branch already exists: ${branch}`);
    const temporary = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-seed-'));
    try {
      await this.gitCommand('git', ['init', '--bare', temporary], { timeout: 30_000 });
      await this.gitCommand('git', ['--git-dir', temporary, 'fetch', '--no-tags', this.repositoryUrl, `${sourceRef || seedCommit}:refs/seed`], { timeout: 60_000 });
      const { stdout } = await this.gitCommand('git', ['--git-dir', temporary, 'rev-parse', 'refs/seed'], { timeout: 30_000 });
      if (stdout.trim() !== seedCommit) throw new Error(`seed ref changed during fetch (${seedCommit} -> ${stdout.trim()})`);
      await this.gitCommand('git', ['--git-dir', temporary, 'push', this.repositoryUrl, `refs/seed:refs/heads/${branch}`], { timeout: 60_000 });
    } finally {
      await removePath(temporary);
    }
    const resolved = await this.readRemoteBranchCommit(branch);
    if (resolved !== seedCommit) throw new Error(`run-scoped base readback mismatch: expected ${seedCommit}, got ${resolved || 'missing'}`);
    return resolved;
  }

  async deleteRemoteBranch(branch, { expectedCommit, timeout = 60_000, signal } = {}) {
    assertBranch(branch);
    const ref = `refs/heads/${branch}`;
    const existing = await this.readRemoteBranchCommit(branch, { timeout, signal });
    if (!existing) return { branch, already_absent: true };
    if (!/^[0-9a-f]{40}$/i.test(expectedCommit || '')) throw new Error(`cannot confirm run-owned branch identity for ${branch}; expected commit is missing`);
    if (existing.toLowerCase() !== expectedCommit.toLowerCase()) throw new Error(`run-owned branch ${branch} changed before deletion (expected ${expectedCommit}, found ${existing})`);
    await this.gitCommand('git', ['push', `--force-with-lease=${ref}:${expectedCommit}`, this.repositoryUrl, '--delete', ref], { timeout, signal });
    const remaining = await this.readRemoteBranchCommit(branch, { timeout, signal });
    if (remaining === expectedCommit) throw new Error(`run-owned branch ${branch} remained after deletion at ${remaining}`);
    if (remaining) return { branch, deleted: true, replaced_commit: remaining };
    return { branch, deleted: true, expected_commit: expectedCommit };
  }

  async readRemoteBranchCommit(branch, { timeout = 30_000, signal } = {}) {
    assertBranch(branch);
    const ref = `refs/heads/${branch}`;
    const { stdout } = await this.gitCommand('git', ['ls-remote', '--heads', this.repositoryUrl, ref], { timeout, signal });
    return parseLsRemote(stdout).get(ref) || null;
  }

  async verifyCommitOnRemoteBranch(branch, commit) {
    if (!/^[0-9a-f]{40}$/i.test(commit || '')) return false;
    const temporary = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-verify-'));
    try {
      await this.gitCommand('git', ['init', '--bare', temporary], { timeout: 30_000 });
      await this.gitCommand('git', ['--git-dir', temporary, 'fetch', '--no-tags', this.repositoryUrl, `refs/heads/${branch}:refs/base`], { timeout: 60_000 });
      try {
        await this.gitCommand('git', ['--git-dir', temporary, 'merge-base', '--is-ancestor', commit, 'refs/base'], { timeout: 30_000 });
        return true;
      } catch {
        return false;
      }
    } finally {
      await removePath(temporary);
    }
  }
}
