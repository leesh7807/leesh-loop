import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { command } from '../command-runner.mjs';

const REF_ROOT = 'refs/heads/e2e-internal';

function parseRefs(output, prefix) {
  return output.split(/\r?\n/).filter(Boolean).flatMap(line => {
    const [sha, ref] = line.trim().split(/\s+/, 2);
    return ref?.startsWith(`${prefix}/`) ? [{ sha, ref, sequence: Number(ref.slice(prefix.length + 1)) }] : [];
  }).filter(ref => /^[0-9a-f]{40}$/i.test(ref.sha) && Number.isSafeInteger(ref.sequence) && ref.sequence > 0)
    .sort((left, right) => right.sequence - left.sequence);
}

function validateStream(stream) {
  if (typeof stream !== 'string' || !/^[a-z0-9-]+(?:\/[a-z0-9-]+)+$/i.test(stream)) throw new Error('invalid E2E event stream identity');
  return stream;
}

export class GitEventStore {
  constructor({ repositoryUrl, workspaceRoot, gitCommand = command } = {}) {
    this.repositoryUrl = repositoryUrl;
    this.workspaceRoot = workspaceRoot;
    this.gitCommand = gitCommand;
  }

  async refs(stream) {
    const prefix = `${REF_ROOT}/${validateStream(stream)}`;
    const { stdout } = await this.gitCommand('git', ['ls-remote', '--heads', this.repositoryUrl], { timeout: 30_000 });
    return parseRefs(stdout, prefix);
  }

  async read(stream) {
    const [current] = await this.refs(stream);
    if (!current) return { sequence: 0, sha: null, ref: null, event: null };
    await mkdir(this.workspaceRoot, { recursive: true, mode: 0o700 });
    const temporary = await mkdtemp(join(this.workspaceRoot, '.event-read-'));
    try {
      await this.gitCommand('git', ['init', '--bare', temporary], { timeout: 30_000 });
      await this.gitCommand('git', ['--git-dir', temporary, 'fetch', '--no-tags', this.repositoryUrl, `${current.ref}:refs/event`], { timeout: 60_000 });
      const { stdout } = await this.gitCommand('git', ['--git-dir', temporary, 'show', 'refs/event:event.json'], { timeout: 30_000 });
      return { sequence: current.sequence, sha: current.sha, ref: current.ref, event: JSON.parse(stdout) };
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  async history(stream) {
    const [latest] = await this.refs(stream);
    if (!latest) return [];
    await mkdir(this.workspaceRoot, { recursive: true, mode: 0o700 });
    const temporary = await mkdtemp(join(this.workspaceRoot, '.event-history-'));
    try {
      await this.gitCommand('git', ['init', '--bare', temporary], { timeout: 30_000 });
      await this.gitCommand('git', ['--git-dir', temporary, 'fetch', '--no-tags', this.repositoryUrl, `${latest.ref}:refs/event`], { timeout: 60_000 });
      const { stdout } = await this.gitCommand('git', ['--git-dir', temporary, 'rev-list', '--reverse', 'refs/event'], { timeout: 30_000 });
      const events = [];
      for (const sha of stdout.split(/\r?\n/).filter(Boolean)) {
        const { stdout: body } = await this.gitCommand('git', ['--git-dir', temporary, 'show', `${sha}:event.json`], { timeout: 30_000 });
        events.push(JSON.parse(body));
      }
      return events;
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  async compareAndAppend(stream, expected, event) {
    const current = await this.read(stream);
    if (current.sequence !== expected.sequence || current.sha !== expected.sha) return { committed: false, current };
    const nextSequence = current.sequence + 1;
    const nextRef = `${REF_ROOT}/${validateStream(stream)}/${String(nextSequence).padStart(16, '0')}`;
    await mkdir(this.workspaceRoot, { recursive: true, mode: 0o700 });
    const temporary = await mkdtemp(join(this.workspaceRoot, '.event-write-'));
    try {
      await this.gitCommand('git', ['init', temporary], { timeout: 30_000 });
      if (current.ref) {
        await this.gitCommand('git', ['-C', temporary, 'fetch', '--no-tags', this.repositoryUrl, `${current.ref}:refs/remotes/e2e/current`], { timeout: 60_000 });
        await this.gitCommand('git', ['-C', temporary, 'checkout', '-b', 'event', 'refs/remotes/e2e/current'], { timeout: 30_000 });
      } else {
        await this.gitCommand('git', ['-C', temporary, 'checkout', '--orphan', 'event'], { timeout: 30_000 });
      }
      const envelope = { ...event, event_sequence: nextSequence, previous_event_sha: current.sha, recorded_at: new Date().toISOString() };
      await writeFile(join(temporary, 'event.json'), `${JSON.stringify(envelope, null, 2)}\n`, { mode: 0o600 });
      await this.gitCommand('git', ['-C', temporary, 'add', '--', 'event.json'], { timeout: 30_000 });
      await this.gitCommand('git', ['-C', temporary, '-c', 'user.name=Leesh Loop E2E', '-c', 'user.email=e2e@users.noreply.github.com', 'commit', '-m', 'Record E2E lifecycle event'], { timeout: 30_000 });
      const { stdout: head } = await this.gitCommand('git', ['-C', temporary, 'rev-parse', 'HEAD'], { timeout: 30_000 });
      try {
        await this.gitCommand('git', ['-C', temporary, 'push', this.repositoryUrl, `HEAD:${nextRef}`], { timeout: 60_000 });
      } catch (error) {
        const latest = await this.read(stream);
        if (latest.sequence >= nextSequence) return { committed: false, current: latest };
        throw error;
      }
      const readback = await this.read(stream);
      if (readback.sequence !== nextSequence || readback.sha !== head.trim() || JSON.stringify(readback.event) !== JSON.stringify(envelope)) {
        return { committed: false, current: readback };
      }
      return { committed: true, current: readback };
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
