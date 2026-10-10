import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { readProjectConfiguration } from '../project-config.mjs';

const expectedStart = 'node operator/app/prepare-runtime.mjs && node operator/app/leesh-loop.mjs start project.toml';
const expectedStop = 'node operator/app/leesh-loop.mjs stop project.toml';

function isMissing(error) { return error?.code === 'ENOENT'; }

export function instanceRegistryDirectory({ environment = process.env, homeDirectory = homedir() } = {}) {
  const stateHome = environment.XDG_STATE_HOME
    ? environment.XDG_STATE_HOME
    : join(homeDirectory, '.local', 'state');
  if (!isAbsolute(stateHome)) throw new Error('XDG_STATE_HOME must be an absolute path');
  return join(stateHome, 'leesh-loop', 'instances');
}

async function ensurePlainFile(path, label) {
  let details;
  try { details = await lstat(path); }
  catch (error) { if (isMissing(error)) return false; throw error; }
  if (details.isSymbolicLink() || !details.isFile()) throw new Error(`${label} must be a regular file: ${path}`);
  return true;
}

async function ensureMetadataDirectory(loopRoot, { create = false } = {}) {
  const path = join(loopRoot, '.leesh-loop');
  let details;
  try { details = await lstat(path); }
  catch (error) {
    if (!isMissing(error)) throw error;
    if (!create) return null;
    await mkdir(path, { mode: 0o700 });
    return path;
  }
  if (details.isSymbolicLink() || !details.isDirectory()) throw new Error('.leesh-loop must be a real directory');
  return path;
}

async function writeAtomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const directory = await lstat(dirname(path));
  if (directory.isSymbolicLink() || !directory.isDirectory()) throw new Error(`registry directory must be a real directory: ${dirname(path)}`);
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await file.sync();
  } finally { await file.close(); }
  try { await rename(temporary, path); }
  catch (error) { await rm(temporary, { force: true }); throw error; }
}

async function readIdentity(loopRoot) {
  const metadataDirectory = await ensureMetadataDirectory(loopRoot);
  if (!metadataDirectory) return null;
  const path = join(metadataDirectory, 'instance.json');
  if (!await ensurePlainFile(path, 'Loop instance identity')) return null;
  let value;
  try { value = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { throw new Error(`cannot read Loop instance identity: ${error.message}`); }
  if (value?.schema_version !== 1 || typeof value.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.id)) {
    throw new Error('Loop instance identity is invalid');
  }
  return value;
}

async function establishIdentity(loopRoot) {
  const metadataDirectory = await ensureMetadataDirectory(loopRoot, { create: true });
  const path = join(metadataDirectory, 'instance.json');
  const current = await readIdentity(loopRoot);
  if (current) return current;
  const candidate = { schema_version: 1, id: randomUUID(), created_at: new Date().toISOString() };
  try {
    await writeFile(path, `${JSON.stringify(candidate, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    return candidate;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const winner = await readIdentity(loopRoot);
    if (!winner) throw new Error('Loop instance identity could not be established');
    return winner;
  }
}

async function inspectLoopRoot(path) {
  let loopRoot;
  try { loopRoot = await realpath(path); }
  catch { throw new Error(`cannot access Loop directory: ${path}`); }
  const rootDetails = await lstat(loopRoot);
  if (rootDetails.isSymbolicLink() || !rootDetails.isDirectory()) throw new Error(`Loop root must be a real directory: ${loopRoot}`);
  for (const file of ['project.toml', 'package.json']) {
    if (!await ensurePlainFile(join(loopRoot, file), file)) throw new Error(`generated Loop is missing ${file}: ${loopRoot}`);
  }
  let packageManifest;
  try { packageManifest = JSON.parse(await readFile(join(loopRoot, 'package.json'), 'utf8')); }
  catch { throw new Error('generated Loop package.json is missing or invalid'); }
  if (packageManifest?.private !== true || typeof packageManifest.name !== 'string'
    || !/^[a-z0-9][a-z0-9-]{0,190}$/.test(packageManifest.name)
    || packageManifest.scripts?.start !== expectedStart
    || packageManifest.scripts?.stop !== expectedStop
    || Object.keys(packageManifest.scripts ?? {}).sort().join(',') !== 'start,stop') {
    throw new Error('directory is not an independent generated Loop with the expected npm start/stop contract');
  }

  const git = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: loopRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (git.status === 0) throw new Error('Loop directory is inside a Git working tree; register an independent generated Loop');
  if (git.error || git.status !== 128) throw new Error(`could not verify that the Loop is independent of a Git working tree${git.error ? `: ${git.error.message}` : ''}`);

  const project = await readProjectConfiguration(join(loopRoot, 'project.toml'));
  return { loopRoot, packageManifest, project };
}

function validRecord(value, fileId) {
  return value?.schema_version === 1
    && value.id === fileId
    && /^[0-9a-f-]{36}$/i.test(value.id)
    && typeof value.name === 'string'
    && isAbsolute(value.path)
    && value.name === basename(value.path)
    && typeof value.registered_at === 'string';
}

async function ensureRegistryDirectory(options) {
  const path = instanceRegistryDirectory(options);
  await mkdir(path, { recursive: true, mode: 0o700 });
  const details = await lstat(path);
  if (details.isSymbolicLink() || !details.isDirectory()) throw new Error(`global Loop registry must be a real directory: ${path}`);
  await chmod(path, 0o700);
  return path;
}

async function registryRecordPath(id, options, { create = false } = {}) {
  const directory = create ? await ensureRegistryDirectory(options) : instanceRegistryDirectory(options);
  return join(directory, `${id}.json`);
}

async function readRecordPath(path, id) {
  if (!await ensurePlainFile(path, 'global Loop registry record')) return null;
  let value;
  try { value = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { throw new Error(`cannot read global Loop registry record ${id}: ${error.message}`); }
  if (!validRecord(value, id)) throw new Error(`global Loop registry record ${id} is invalid`);
  return value;
}

export async function registerLoop({ cwd = process.cwd(), environment = process.env, homeDirectory = homedir() } = {}) {
  const options = { environment, homeDirectory };
  const { loopRoot } = await inspectLoopRoot(cwd);
  const currentIdentity = await readIdentity(loopRoot);
  if (!currentIdentity) {
    const existingPath = (await readRegistryEntries(options)).find(value => value.valid && value.path === loopRoot);
    if (existingPath) throw new Error(`registered Loop at ${loopRoot} is missing its instance identity; refusing to create a duplicate`);
  }
  const identity = currentIdentity || await establishIdentity(loopRoot);
  const path = await registryRecordPath(identity.id, options, { create: true });
  const existing = await readRecordPath(path, identity.id);
  if (existing && existing.path !== loopRoot) {
    throw new Error(`Loop identity ${identity.id} is already registered at ${existing.path}; refusing to register a moved or copied path`);
  }
  const record = existing
    ? { ...existing, name: basename(loopRoot), path: loopRoot }
    : { schema_version: 1, id: identity.id, name: basename(loopRoot), path: loopRoot, registered_at: new Date().toISOString() };
  if (existing && existing.name === record.name) return record;
  await writeAtomicJson(path, record);
  return record;
}

export async function registerLoopAfterStart(options = {}) {
  const cwd = options.cwd || process.cwd();
  let packageManifest;
  try { packageManifest = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')); }
  catch { return { registered: false, skipped: true }; }
  if (packageManifest?.scripts?.start !== expectedStart || packageManifest?.scripts?.stop !== expectedStop) {
    return { registered: false, skipped: true };
  }
  return { registered: true, instance: await registerLoop(options) };
}

async function runtimeStatus(loopRoot, project) {
  const stateDirectory = project.state_directory || join(loopRoot, 'operator', '.runtime');
  const statePath = join(stateDirectory, 'runtime.json');
  let source;
  try { source = await readFile(statePath, 'utf8'); }
  catch (error) {
    if (!isMissing(error)) return { status: 'Unconfirmed', detail: `cannot read runtime state: ${error.message}` };
    for (const leftover of ['ownership.json', 'dispatch-acknowledgement.json']) {
      try {
        await lstat(join(stateDirectory, leftover));
        return { status: 'Unconfirmed', detail: `runtime state is missing but ${leftover} remains` };
      } catch (leftoverError) {
        if (!isMissing(leftoverError)) return { status: 'Unconfirmed', detail: `cannot inspect runtime ${leftover}: ${leftoverError.message}` };
      }
    }
    return { status: 'Stopped' };
  }
  let state;
  try { state = JSON.parse(source); }
  catch (error) { return { status: 'Unconfirmed', detail: `runtime state is invalid: ${error.message}` }; }
  if (!state || typeof state !== 'object' || Array.isArray(state)) return { status: 'Unconfirmed', detail: 'runtime state is invalid' };
  if (state.status !== 'running') return { status: 'Unconfirmed', detail: `runtime state is ${String(state.status || 'unknown')}` };

  const { pid, process_start_ticks: startTicks, runtime_id: runtimeId } = state;
  if (!Number.isSafeInteger(pid) || pid <= 0 || typeof startTicks !== 'string' || !startTicks || typeof runtimeId !== 'string' || !runtimeId) {
    return { status: 'Unconfirmed', detail: 'runtime process identity is incomplete' };
  }
  const ownershipPath = join(stateDirectory, 'ownership.json');
  const acknowledgementPath = join(stateDirectory, 'dispatch-acknowledgement.json');
  let ownership;
  let acknowledgement;
  try {
    ownership = JSON.parse(await readFile(ownershipPath, 'utf8'));
    acknowledgement = JSON.parse(await readFile(acknowledgementPath, 'utf8'));
  } catch { return { status: 'Unconfirmed', detail: 'runtime ownership or readiness acknowledgement is unavailable' }; }
  if (ownership?.project_root !== loopRoot || ownership.runtime_id !== runtimeId || ownership.pid !== pid || ownership.process_start_ticks !== startTicks
    || acknowledgement?.runtime_id !== runtimeId || acknowledgement.pid !== pid || acknowledgement.dispatch_capable !== true) {
    return { status: 'Unconfirmed', detail: 'runtime ownership or readiness identity does not match' };
  }

  let processState = 'unknown';
  try { process.kill(pid, 0); processState = 'alive'; }
  catch (error) { processState = error?.code === 'ESRCH' ? 'dead' : 'unknown'; }
  let observedStartTicks = null;
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    observedStartTicks = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/)[19] || null;
  } catch { /* A missing /proc identity cannot prove ownership. */ }
  if (processState === 'unknown') return { status: 'Unconfirmed', detail: `cannot confirm runtime process ${pid}` };

  const dashboard = state.effective?.dashboard;
  const expectedDashboard = `http://127.0.0.1:${project.symphony_port}`;
  if (dashboard !== expectedDashboard) return { status: 'Unconfirmed', detail: 'runtime dashboard does not match the Loop configuration' };
  const endpoint = `${expectedDashboard}/api/v1/runtime`;
  let observed;
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return { status: 'Unconfirmed', detail: `runtime status returned HTTP ${response.status}` };
    observed = await response.json();
  } catch (error) {
    const causeCode = error?.cause?.code;
    if (processState === 'dead' && causeCode === 'ECONNREFUSED') return { status: 'Stopped' };
    return { status: 'Unconfirmed', detail: `runtime status could not be read: ${error.message}` };
  }

  const processIdentityMismatch = observedStartTicks !== null && observedStartTicks !== startTicks;
  if (observed?.runtime_id === runtimeId && observed?.pid === pid && observed?.dispatch_capable === true) {
    if (processState === 'alive' && observedStartTicks === startTicks) return { status: 'Running' };
    return { status: 'Unconfirmed', detail: 'runtime responds but its recorded process identity does not match' };
  }
  if (processState === 'dead' || processIdentityMismatch) return { status: 'Stopped' };
  return { status: 'Unconfirmed', detail: 'runtime API identity does not match the registered Loop runtime' };
}

async function inspectRecord(value) {
  const verified = await verifyRecordIdentity(value);
  if (!verified.identity_verified) return { ...verified, status: verified.status || 'Unconfirmed' };
  return { ...verified, ...(await runtimeStatus(verified.path, verified.project)) };
}

async function verifyRecordIdentity(value) {
  if (!value.valid) return { ...value, status: 'Unconfirmed' };
  let details;
  try { details = await lstat(value.path); }
  catch (error) {
    if (isMissing(error)) return { ...value, status: 'Missing' };
    return { ...value, status: 'Unconfirmed', detail: `cannot access registered path: ${error.message}` };
  }
  if (details.isSymbolicLink() || !details.isDirectory()) return { ...value, status: 'Unconfirmed', detail: 'registered path is not a real directory' };
  let inspected;
  try { inspected = await inspectLoopRoot(value.path); }
  catch (error) { return { ...value, status: 'Unconfirmed', detail: error.message }; }
  if (inspected.loopRoot !== value.path) return { ...value, status: 'Unconfirmed', detail: 'registered path is not canonical' };
  try {
    const identity = await readIdentity(inspected.loopRoot);
    if (!identity || identity.id !== value.id) return { ...value, status: 'Unconfirmed', detail: 'Loop identity does not match its registry record' };
  } catch (error) { return { ...value, status: 'Unconfirmed', detail: error.message }; }
  return { ...value, identity_verified: true, project: inspected.project };
}

async function readRegistryEntries(options) {
  const directory = instanceRegistryDirectory(options);
  let names;
  try {
    const details = await lstat(directory);
    if (details.isSymbolicLink() || !details.isDirectory()) throw new Error(`global Loop registry must be a real directory: ${directory}`);
    names = await readdir(directory);
  } catch (error) { if (isMissing(error)) return []; throw error; }
  const ids = names.filter(name => /^[0-9a-f-]{36}\.json$/i.test(name)).sort();
  return Promise.all(ids.map(async filename => {
    const id = filename.slice(0, -5);
    try {
      const record = await readRecordPath(join(directory, filename), id);
      if (!record) throw new Error('registry record disappeared during lookup');
      return { ...record, valid: true };
    } catch (error) {
      return { id, name: '<invalid registry record>', path: '<unavailable>', detail: error.message, valid: false };
    }
  }));
}

export async function listLoopInstances({ environment = process.env, homeDirectory = homedir() } = {}) {
  const options = { environment, homeDirectory };
  const entries = await readRegistryEntries(options);
  return Promise.all(entries.map(entry => inspectRecord(entry)));
}

export async function resolveLoopInstance(instance, options = {}) {
  if (typeof instance !== 'string' || !instance.trim()) throw new Error('provide an instance ID or name');
  const entries = await readRegistryEntries(options);
  const byId = entries.find(value => value.id === instance);
  let selected = byId;
  if (!selected) {
    const matches = entries.filter(value => value.valid && value.name === instance);
    if (matches.length > 1) {
      const optionsText = matches.map(value => `  ${value.id}  ${value.path}`).join('\n');
      throw new Error(`instance name '${instance}' is ambiguous; choose an ID:\n${optionsText}`);
    }
    selected = matches[0];
  }
  if (!selected) throw new Error(`no registered Loop matches '${instance}'`);
  const verified = await verifyRecordIdentity(selected);
  if (verified.status === 'Missing') throw new Error(`registered Loop '${verified.id}' is missing at ${verified.path}`);
  if (!verified.identity_verified) throw new Error(`cannot verify registered Loop '${verified.id}' at ${verified.path}: ${verified.detail || 'identity is unconfirmed'}`);
  return verified;
}
