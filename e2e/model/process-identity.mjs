import { readFile, readlink } from 'node:fs/promises';
import { hostname } from 'node:os';

async function readStat(pid) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/);
    return { process_start_ticks: fields[19] || null };
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ESRCH') return { dead: true };
    if (error?.code === 'EACCES' || error?.code === 'EPERM') return { unknown: true };
    return { unknown: true, error: String(error?.message || error) };
  }
}

export async function currentProcessIdentity(pid = process.pid) {
  const [stat, bootId, pidNamespace] = await Promise.all([
    readStat(pid),
    readFile('/proc/sys/kernel/random/boot_id', 'utf8').catch(() => ''),
    readlink(`/proc/${pid}/ns/pid`).catch(() => '')
  ]);
  if (!stat.process_start_ticks || !bootId.trim() || !pidNamespace) throw new Error(`could not establish Linux process identity for PID ${pid}`);
  return { pid, process_start_ticks: stat.process_start_ticks, boot_id: bootId.trim(), pid_namespace: pidNamespace, host: hostname() };
}

export async function inspectProcessIdentity(identity) {
  if (!identity || !Number.isSafeInteger(identity.pid) || typeof identity.process_start_ticks !== 'string' || typeof identity.boot_id !== 'string' || typeof identity.pid_namespace !== 'string') return 'unknown';
  const pidNamespace = await readlink('/proc/self/ns/pid').catch(() => '');
  if (!pidNamespace || pidNamespace !== identity.pid_namespace) return 'unknown';
  const bootId = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8').catch(() => '')).trim();
  if (!bootId || bootId !== identity.boot_id) return 'unknown';
  const stat = await readStat(identity.pid);
  if (stat.dead) return 'dead';
  if (stat.unknown) return 'unknown';
  return stat.process_start_ticks === identity.process_start_ticks ? 'active' : 'dead';
}
