import { link, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readOwner(lockPath) {
  try {
    const metadata = await stat(lockPath);
    const ownerPath = metadata.isDirectory() ? join(lockPath, 'owner.json') : lockPath;
    return JSON.parse(await readFile(ownerPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'EISDIR' || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeCandidate(candidate, owner) {
  const handle = await open(candidate, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(owner)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function reclaim(lockPath) {
  const reclaimPath = `${lockPath}.reclaim-${process.pid}-${randomUUID()}`;
  try {
    await rename(lockPath, reclaimPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  await rm(reclaimPath, { recursive: true, force: true });
}

export async function acquireFileLock(lockPath, { waitMs = 30_000, pollMs = 25, staleAfterMs = pollMs * 4, label = lockPath } = {}) {
  const started = Date.now();
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
  while (true) {
    const candidate = `${lockPath}.candidate-${process.pid}-${randomUUID()}`;
    try {
      await writeCandidate(candidate, { pid: process.pid, started_at: new Date().toISOString() });
      try {
        // Publish only after the owner record is complete. Hard-link creation
        // is the no-replace atomic claim shared with the Elixir coordinator.
        await link(candidate, lockPath);
        await rm(candidate, { force: true });
        return async () => rm(lockPath, { recursive: true, force: true });
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
      }
    } finally {
      await rm(candidate, { force: true });
    }

    const owner = await readOwner(lockPath);
    if (owner && !processAlive(owner.pid)) {
      await reclaim(lockPath);
      continue;
    }
    if (!owner) {
      try {
        const metadata = await stat(lockPath);
        if (Date.now() - metadata.mtimeMs > staleAfterMs) {
          await reclaim(lockPath);
          continue;
        }
      } catch (statError) {
        if (statError?.code !== 'ENOENT') throw statError;
        continue;
      }
    }
    if (Date.now() - started >= waitMs) throw new Error(`timed out waiting for ${label}: ${lockPath}`);
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}
