import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { command } from '../command-runner.mjs';

const LEGACY_REF_ROOT = 'refs/heads/e2e-internal';
const CURRENT_REF_ROOT = LEGACY_REF_ROOT + '/current';

function parseRemoteRefs(output) {
  return output.split(/\r?\n/).filter(Boolean).flatMap(line => {
    const parts = line.trim().split(/\s+/, 2);
    const sha = parts[0];
    const ref = parts[1];
    return ref && /^[0-9a-f]{40}$/i.test(sha) ? [{ sha, ref }] : [];
  });
}

function validateStream(stream) {
  if (typeof stream !== 'string' || !/^[a-z0-9-]+(?:\/[a-z0-9-]+)+$/i.test(stream)) {
    throw new Error('invalid E2E coordination stream identity');
  }
  return stream;
}

function currentRefFor(stream) {
  return CURRENT_REF_ROOT + '/' + validateStream(stream);
}

function legacyRefsFor(refs, stream) {
  const prefix = LEGACY_REF_ROOT + '/' + validateStream(stream) + '/';
  return refs.flatMap(item => {
    if (!item.ref.startsWith(prefix)) return [];
    const suffix = item.ref.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) return [];
    const sequence = Number(suffix);
    return Number.isSafeInteger(sequence) && sequence > 0 ? [{ ...item, sequence }] : [];
  }).sort((left, right) => right.sequence - left.sequence);
}

function parseEvent(stdout, ref) {
  let event;
  try { event = JSON.parse(stdout); }
  catch { throw new Error('coordination ref contains invalid state data: ' + ref); }
  if (!event || typeof event !== 'object' || Array.isArray(event)
    || !Number.isSafeInteger(event.event_sequence) || event.event_sequence < 1) {
    throw new Error('coordination ref contains invalid state data: ' + ref);
  }
  return event;
}

export class GitEventStore {
  constructor({ repositoryUrl, workspaceRoot, gitCommand = command } = {}) {
    this.repositoryUrl = repositoryUrl;
    this.workspaceRoot = workspaceRoot;
    this.gitCommand = gitCommand;
  }

  async remoteRefs() {
    const { stdout } = await this.gitCommand('git', ['ls-remote', '--heads', this.repositoryUrl], { timeout: 30_000 });
    return parseRemoteRefs(stdout);
  }

  async fetchEvent(ref) {
    await mkdir(this.workspaceRoot, { recursive: true, mode: 0o700 });
    const temporary = await mkdtemp(join(this.workspaceRoot, '.coordination-read-'));
    try {
      await this.gitCommand('git', ['init', '--bare', temporary], { timeout: 30_000 });
      await this.gitCommand('git', ['--git-dir', temporary, 'fetch', '--no-tags', this.repositoryUrl, ref + ':refs/current'], { timeout: 60_000 });
      const { stdout } = await this.gitCommand('git', ['--git-dir', temporary, 'show', 'refs/current:event.json'], { timeout: 30_000 });
      return parseEvent(stdout, ref);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  async writeRef(ref, event, expectedSha) {
    await mkdir(this.workspaceRoot, { recursive: true, mode: 0o700 });
    const temporary = await mkdtemp(join(this.workspaceRoot, '.coordination-write-'));
    try {
      await this.gitCommand('git', ['init', temporary], { timeout: 30_000 });
      await this.gitCommand('git', ['-C', temporary, 'checkout', '--orphan', 'current'], { timeout: 30_000 });
      await writeFile(join(temporary, 'event.json'), JSON.stringify(event, null, 2) + '\n', { mode: 0o600 });
      await this.gitCommand('git', ['-C', temporary, 'add', '--', 'event.json'], { timeout: 30_000 });
      await this.gitCommand('git', ['-C', temporary, '-c', 'user.name=Leesh Loop Coordination', '-c', 'user.email=coordination@users.noreply.github.com', 'commit', '-m', 'Update current coordination state'], { timeout: 30_000 });
      const { stdout: head } = await this.gitCommand('git', ['-C', temporary, 'rev-parse', 'HEAD'], { timeout: 30_000 });
      const lease = '--force-with-lease=' + ref + ':' + (expectedSha || '');
      try {
        await this.gitCommand('git', ['-C', temporary, 'push', lease, this.repositoryUrl, 'HEAD:' + ref], { timeout: 60_000 });
      } catch (error) {
        return { committed: false, sha: null, error };
      }
      return { committed: true, sha: head.trim() };
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  async deleteRef(ref, expectedSha) {
    const { stdout } = await this.gitCommand('git', ['ls-remote', '--heads', this.repositoryUrl, ref], { timeout: 30_000 });
    const current = parseRemoteRefs(stdout).find(item => item.ref === ref);
    if (!current) return;
    if (current.sha !== expectedSha) throw new Error('coordination ref changed before cleanup: ' + ref);
    await this.gitCommand('git', ['push', '--force-with-lease=' + ref + ':' + expectedSha, this.repositoryUrl, ':' + ref], { timeout: 60_000 });
  }

  async removeLegacyRefs(stream, refs) {
    const legacy = legacyRefsFor(refs, stream);
    for (const item of legacy) await this.deleteRef(item.ref, item.sha);
  }

  async read(stream) {
    validateStream(stream);
    const fixedRef = currentRefFor(stream);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const refs = await this.remoteRefs();
      const fixed = refs.find(item => item.ref === fixedRef) || null;
      const legacy = legacyRefsFor(refs, stream);
      let current = null;

      if (fixed) {
        const event = await this.fetchEvent(fixedRef);
        current = { sequence: event.event_sequence, sha: fixed.sha, ref: fixedRef, event };
      }

      if (legacy.length) {
        const latest = legacy[0];
        const legacyEvent = await this.fetchEvent(latest.ref);
        if (legacyEvent.event_sequence !== latest.sequence) {
          throw new Error('legacy coordination sequence does not match its state data: ' + latest.ref);
        }
        if (!current) {
          const migrated = await this.writeRef(fixedRef, legacyEvent, null);
          if (!migrated.committed) continue;
          current = { sequence: latest.sequence, sha: migrated.sha, ref: fixedRef, event: legacyEvent };
        } else if (latest.sequence > current.event.event_sequence) {
          const migrated = await this.writeRef(fixedRef, legacyEvent, current.sha);
          if (!migrated.committed) continue;
          current = { sequence: latest.sequence, sha: migrated.sha, ref: fixedRef, event: legacyEvent };
        } else if (latest.sequence === current.event.event_sequence && JSON.stringify(legacyEvent) !== JSON.stringify(current.event)) {
          throw new Error('current and legacy coordination states conflict for stream: ' + stream);
        }
        await this.removeLegacyRefs(stream, refs);
        const remaining = legacyRefsFor(await this.remoteRefs(), stream);
        if (remaining.length) continue;
      }

      if (current) return current;
      return { sequence: 0, sha: null, ref: null, event: null };
    }
    throw new Error('coordination state changed repeatedly while reconciling stream: ' + stream);
  }

  async compareAndAppend(stream, expected, event) {
    const current = await this.read(stream);
    if (current.sequence !== expected.sequence || current.sha !== expected.sha) return { committed: false, current };
    const nextSequence = current.sequence + 1;
    const envelope = {
      ...event,
      event_sequence: nextSequence,
      previous_event_sha: current.sha,
      recorded_at: new Date().toISOString()
    };
    const ref = currentRefFor(stream);
    const written = await this.writeRef(ref, envelope, current.sha);
    if (!written.committed) {
      const latest = await this.read(stream);
      if (latest.sha === current.sha && latest.sequence === current.sequence) throw written.error;
      return { committed: false, current: latest };
    }
    const readback = await this.read(stream);
    if (readback.sequence !== nextSequence || readback.sha !== written.sha || JSON.stringify(readback.event) !== JSON.stringify(envelope)) {
      return { committed: false, current: readback };
    }
    return { committed: true, current: readback };
  }

  async delete(stream, expected) {
    const current = await this.read(stream);
    if (current.sequence === 0) return { committed: true, current };
    if (current.sequence !== expected.sequence || current.sha !== expected.sha) return { committed: false, current };
    await this.deleteRef(current.ref, current.sha);
    const readback = await this.read(stream);
    if (readback.sequence !== 0) return { committed: false, current: readback };
    return { committed: true, current: readback };
  }

  async listCurrentStreams(namespace) {
    if (typeof namespace !== 'string' || !/^[a-z0-9-]+$/i.test(namespace)) throw new Error('invalid coordination namespace');
    const prefix = CURRENT_REF_ROOT + '/' + namespace + '/';
    return (await this.remoteRefs())
      .filter(item => item.ref.startsWith(prefix))
      .map(item => item.ref.slice(prefix.length))
      .filter(stream => /^[a-z0-9-]+$/i.test(stream));
  }

  async migrateLegacyRefs() {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const refs = await this.remoteRefs();
      const streams = new Set();
      for (const item of refs) {
        if (!item.ref.startsWith(LEGACY_REF_ROOT + '/') || item.ref.startsWith(CURRENT_REF_ROOT + '/')) continue;
        const tail = item.ref.slice((LEGACY_REF_ROOT + '/').length);
        const parts = tail.split('/');
        const sequence = parts.pop();
        if (/^\d+$/.test(sequence) && parts.length >= 2) streams.add(parts.join('/'));
      }
      if (!streams.size) break;
      for (const stream of streams) await this.read(stream);
    }
    for (const streamId of await this.listCurrentStreams('reservations')) {
      const stream = 'reservations/' + streamId;
      const current = await this.read(stream);
      if (current.event?.kind === 'database_reservation' && current.event.state?.status === 'available') {
        await this.delete(stream, current);
      }
    }
    const remaining = (await this.remoteRefs()).filter(item => item.ref.startsWith(LEGACY_REF_ROOT + '/') && !item.ref.startsWith(CURRENT_REF_ROOT + '/'));
    if (remaining.length) throw new Error('legacy coordination refs remain after current-state migration');
    return { migrated_streams: [] };
  }
}
