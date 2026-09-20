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

  async listRemoteBranchRefs({ timeout = 30_000, signal } = {}) {
    const { stdout } = await this.gitCommand('git', ['ls-remote', '--heads', this.repositoryUrl], { timeout, signal });
    const refs = {};
    for (const [ref, commit] of parseLsRemote(stdout)) if (/^refs\/heads\//.test(ref)) refs[ref] = commit;
    return refs;
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
    const refs = await this.listRemoteBranchRefs();
    if (refs[`refs/heads/${branch}`]) throw new Error(`run-scoped base branch already exists: ${branch}`);
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
    const resolved = (await this.listRemoteBranchRefs())[`refs/heads/${branch}`];
    if (resolved !== seedCommit) throw new Error(`run-scoped base readback mismatch: expected ${seedCommit}, got ${resolved || 'missing'}`);
    return resolved;
  }

  async deleteRemoteBranch(branch, { timeout = 60_000, signal } = {}) {
    assertBranch(branch);
    const before = await this.listRemoteBranchRefs({ timeout, signal });
    if (!before[`refs/heads/${branch}`]) return { branch, already_absent: true };
    await this.gitCommand('git', ['push', this.repositoryUrl, '--delete', `refs/heads/${branch}`], { timeout, signal });
    const refs = await this.listRemoteBranchRefs({ timeout, signal });
    if (refs[`refs/heads/${branch}`]) throw new Error(`run-scoped branch ${branch} remained after deletion`);
    return { branch, deleted: true };
  }

  async readRemoteBranchCommit(branch) {
    return (await this.listRemoteBranchRefs())[`refs/heads/${branch}`] || null;
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
