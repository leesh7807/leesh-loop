import { readFileSync } from 'node:fs';
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const retryMs = 50;
const emptyLockStaleMs = 10_000;

function processStartTicks(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/)[19] || null;
  } catch { return null; }
}

function lockOwner() {
  return {
    pid: process.pid,
    process_start_ticks: processStartTicks(process.pid),
    token: randomUUID(),
    created_at: Date.now()
  };
}

function lockOwnerAlive(owner) {
  if (!Number.isSafeInteger(owner?.pid) || owner.pid < 1) return false;
  try { process.kill(owner.pid, 0); }
  catch (error) {
    if (error?.code === 'EPERM') return true;
    if (error?.code === 'ESRCH') return false;
    return true;
  }
  if (owner.process_start_ticks) {
    const observedTicks = processStartTicks(owner.pid);
    if (observedTicks && observedTicks !== owner.process_start_ticks) return false;
  }
  return true;
}

async function lockSnapshot(path) {
  let details;
  try { details = await lstat(path); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
  if (details.isSymbolicLink() || !details.isDirectory()) throw new Error(`Runtime installation lock is not a real directory: ${path}`);
  let owner = null;
  try {
    const ownerDetails = await lstat(join(path, 'owner.json'));
    if (!ownerDetails.isSymbolicLink() && ownerDetails.isFile()) owner = JSON.parse(await readFile(join(path, 'owner.json'), 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  return { details, owner };
}

async function writeLockOwner(directory, owner) {
  await writeFile(join(directory, 'owner.json'), `${JSON.stringify(owner)}\n`, { mode: 0o600, flag: 'wx' });
}

async function waitForRetry(onWait) {
  onWait?.();
  await new Promise(resolveWait => setTimeout(resolveWait, retryMs));
}

function sameLockGeneration(left, right) {
  return Boolean(left && right
    && left.details.dev === right.details.dev
    && left.details.ino === right.details.ino
    && left.owner?.token === right.owner?.token);
}

async function recoveryClaimPaths(lockPath) {
  const parent = dirname(lockPath);
  const prefix = `${basename(lockPath)}.recovery-claim-`;
  let entries;
  try { entries = await readdir(parent); }
  catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
  return entries.filter(entry => entry.startsWith(prefix)).map(entry => join(parent, entry));
}

async function hasActiveRecoveryClaim(lockPath) {
  for (const claimPath of await recoveryClaimPaths(lockPath)) {
    const claim = await lockSnapshot(claimPath);
    if (!claim) continue;
    if (lockOwnerAlive(claim.owner)
        || (!claim.owner && Date.now() - claim.details.mtimeMs < emptyLockStaleMs)) return true;
    // Claim paths are unique and never reused, so stale generations can be removed
    // without touching a later recovery owner at the canonical path.
    await rm(claimPath, { recursive: true, force: true });
  }
  return false;
}

async function reclaimStaleRecoveryLock(recoveryPath, observed, afterRecoveryLockClaim) {
  const claimPath = `${recoveryPath.replace(/\.recovery$/, '')}.recovery-claim-${randomUUID()}`;
  try { await rename(recoveryPath, claimPath); }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
  await afterRecoveryLockClaim?.(claimPath);

  const claimed = await lockSnapshot(claimPath);
  const sameGeneration = sameLockGeneration(observed, claimed);
  const claimedOwnerAlive = lockOwnerAlive(claimed?.owner);
  const claimedEmptyButFresh = Boolean(claimed && !claimed.owner
    && Date.now() - claimed.details.mtimeMs < emptyLockStaleMs);
  if (!sameGeneration || claimedOwnerAlive || claimedEmptyButFresh) {
    // The canonical pathname changed after the stale snapshot. Restore that exact
    // generation, or leave it under its unique claim name so other installers can
    // still see and wait for its live owner.
    try { await rename(claimPath, recoveryPath); }
    catch (error) {
      // The prior owner may release this exact claim while the stale snapshot is
      // being reconciled; a missing source is then ordinary contention.
      if (error?.code !== 'ENOENT' && error?.code !== 'EEXIST' && error?.code !== 'ENOTEMPTY') throw error;
    }
    return false;
  }

  await rm(claimPath, { recursive: true, force: true });
  return true;
}

async function releaseRecoveryLock(lockPath, ownerToken) {
  const recoveryPaths = [`${lockPath}.recovery`, ...await recoveryClaimPaths(lockPath)];
  for (const recoveryPath of recoveryPaths) {
    const recovery = await lockSnapshot(recoveryPath).catch(() => null);
    if (recovery?.owner?.token === ownerToken) await rm(recoveryPath, { recursive: true, force: true });
  }
}

async function waitForRecoveryLock(lockPath, onWait, afterRecoveryLockSnapshot, afterRecoveryLockClaim) {
  if (await hasActiveRecoveryClaim(lockPath)) {
    await waitForRetry(onWait);
    return true;
  }
  const recoveryPath = `${lockPath}.recovery`;
  const recovery = await lockSnapshot(recoveryPath);
  if (!recovery) return false;
  await afterRecoveryLockSnapshot?.(recovery);
  if (lockOwnerAlive(recovery.owner)
      || (!recovery.owner && Date.now() - recovery.details.mtimeMs < emptyLockStaleMs)) {
    await waitForRetry(onWait);
    return true;
  }
  await reclaimStaleRecoveryLock(recoveryPath, recovery, afterRecoveryLockClaim);
  return true;
}

async function removeStaleLock(lockPath, observed) {
  const recoveryPath = `${lockPath}.recovery`;
  const recoveryOwner = lockOwner();
  try {
    await mkdir(recoveryPath, { mode: 0o700 });
    await writeLockOwner(recoveryPath, recoveryOwner);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const recovery = await lockSnapshot(recoveryPath);
    if (recovery && !lockOwnerAlive(recovery.owner)
        && Date.now() - recovery.details.mtimeMs >= emptyLockStaleMs) {
      await reclaimStaleRecoveryLock(recoveryPath, recovery);
    }
    return false;
  }

  const quarantinePath = `${lockPath}.stale-${randomUUID()}`;
  try {
    if (await hasActiveRecoveryClaim(lockPath)) return false;
    const current = await lockSnapshot(lockPath);
    const expectedToken = observed.owner?.token;
    if (!current
        || (expectedToken ? current.owner?.token !== expectedToken : current.owner)
        || lockOwnerAlive(current.owner)
        || (!current.owner && Date.now() - current.details.mtimeMs < emptyLockStaleMs)) {
      return false;
    }
    await rename(lockPath, quarantinePath);
    const moved = await lockSnapshot(quarantinePath);
    const ownerChanged = expectedToken ? moved?.owner?.token !== expectedToken : Boolean(moved?.owner);
    const movedOwnerAlive = lockOwnerAlive(moved?.owner);
    const movedEmptyButFresh = Boolean(moved && !moved.owner && Date.now() - moved.details.mtimeMs < emptyLockStaleMs);
    if (!moved || ownerChanged || movedOwnerAlive || movedEmptyButFresh) {
      try { await rename(quarantinePath, lockPath); } catch { /* preserve the moved lock for diagnosis */ }
      return false;
    }
    await rm(quarantinePath, { recursive: true, force: true });
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  } finally {
    await releaseRecoveryLock(lockPath, recoveryOwner.token);
  }
}

export async function withRuntimeInstallLock(runtimeRoot, action, { onWait, afterRecoveryLockSnapshot, afterRecoveryLockClaim } = {}) {
  const lockPath = join(runtimeRoot, '.runtime-install.lock');
  const owner = lockOwner();
  while (true) {
    if (await waitForRecoveryLock(lockPath, onWait, afterRecoveryLockSnapshot, afterRecoveryLockClaim)) continue;
    try {
      await mkdir(lockPath, { mode: 0o700 });
      await writeLockOwner(lockPath, owner);
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        if (error?.code !== 'ENOENT') throw error;
        await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
        continue;
      }
      const current = await lockSnapshot(lockPath);
      if (!current) continue;
      if (lockOwnerAlive(current.owner)
          || (!current.owner && Date.now() - current.details.mtimeMs < emptyLockStaleMs)) {
        await waitForRetry(onWait);
        continue;
      }
      await removeStaleLock(lockPath, current);
    }
  }

  try { return await action(); }
  finally {
    const current = await lockSnapshot(lockPath).catch(() => null);
    if (current?.owner?.token === owner.token) await rm(lockPath, { recursive: true, force: true });
  }
}
