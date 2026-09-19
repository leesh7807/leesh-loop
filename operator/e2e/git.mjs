import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertBranch, command, remove } from './common.mjs';

function parseLsRemote(output) {
  return new Map(output.split(/\r?\n/).filter(Boolean).map(line => {
    const [commit, ref] = line.trim().split(/\s+/, 2);
    return [ref, commit];
  }));
}

export class GitCapability {
  constructor({ repositoryUrl, gitCommand = command } = {}) {
    this.repositoryUrl = repositoryUrl;
    this.gitCommand = gitCommand;
  }

  async remoteRefs() {
    const { stdout } = await this.gitCommand('git', ['ls-remote', '--heads', this.repositoryUrl], { timeout: 30_000 });
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

  async createBaseBranch(branch, seedCommit, sourceRef = null) {
    assertBranch(branch);
    if (!/^[0-9a-f]{40}$/i.test(seedCommit)) throw new Error('seed commit must be a full immutable Git commit');
    const refs = await this.remoteRefs();
    if (refs[`refs/heads/${branch}`]) throw new Error(`run-scoped base branch already exists: ${branch}`);
    const temporary = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-seed-'));
    try {
      await this.gitCommand('git', ['init', '--bare', temporary], { timeout: 30_000 });
      await this.gitCommand('git', ['--git-dir', temporary, 'fetch', '--no-tags', this.repositoryUrl, `${sourceRef || seedCommit}:refs/seed`], { timeout: 60_000 });
      const { stdout } = await this.gitCommand('git', ['--git-dir', temporary, 'rev-parse', 'refs/seed'], { timeout: 30_000 });
      if (stdout.trim() !== seedCommit) throw new Error(`seed ref changed during fetch (${seedCommit} -> ${stdout.trim()})`);
      await this.gitCommand('git', ['--git-dir', temporary, 'push', this.repositoryUrl, `refs/seed:refs/heads/${branch}`], { timeout: 60_000 });
    } finally {
      await remove(temporary);
    }
    const resolved = (await this.remoteRefs())[`refs/heads/${branch}`];
    if (resolved !== seedCommit) throw new Error(`run-scoped base readback mismatch: expected ${seedCommit}, got ${resolved || 'missing'}`);
    return resolved;
  }

  async deleteBranch(branch) {
    assertBranch(branch);
    const before = await this.remoteRefs();
    if (!before[`refs/heads/${branch}`]) return { branch, already_absent: true };
    await this.gitCommand('git', ['push', this.repositoryUrl, '--delete', `refs/heads/${branch}`], { timeout: 60_000 });
    const refs = await this.remoteRefs();
    if (refs[`refs/heads/${branch}`]) throw new Error(`run-scoped branch ${branch} remained after deletion`);
    return { branch, deleted: true };
  }
}
