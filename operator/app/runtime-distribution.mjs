import { execFileSync, spawnSync } from 'node:child_process';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { isMainThread, Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { managerPaths, ensurePrivateDirectory, readJsonFile, writeAtomicJson } from './manager-storage.mjs';
import { listRuntimeSnapshotFiles, materializeRuntimeSnapshot } from './runtime-manifest.mjs';
import { hashDistribution, readDistributionFiles } from './installation-metadata.mjs';
import { prepareNpmDependencies } from './dependency-preparation.mjs';
import { withRuntimeInstallLock } from './runtime-install-lock.mjs';

const thisDirectory = new URL('.', import.meta.url);
const defaultSourceRoot = resolve(fileURLToPath(new URL('../..', thisDirectory)));
const digestPattern = /^[a-f0-9]{64}$/;
const runtimeInstallWorkerSource = `
const { parentPort, workerData } = require('node:worker_threads');
import(workerData.moduleUrl)
  .then(module => {
    if (typeof module.installRuntimeDistribution !== 'function') throw new Error('Runtime installation worker module has no installer');
    return module.installRuntimeDistribution(workerData.sourceRoot, {
      environment: workerData.environment,
      homeDirectory: workerData.homeDirectory
    }, { skipRuntimeInstallLock: true });
  })
  .then(result => parentPort.postMessage({ ok: true, result }), error => parentPort.postMessage({
    ok: false,
    error: { message: error?.message || String(error), stack: error?.stack }
  }));
`;

async function sourceIdentity(sourceRoot) {
  let root;
  try { root = await realpath(sourceRoot); }
  catch { throw new Error(`cannot access Runtime source: ${sourceRoot}`); }
  const details = await lstat(root);
  if (details.isSymbolicLink() || !details.isDirectory()) throw new Error('Runtime source must be a real directory');
  let manifest;
  try { manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')); }
  catch { throw new Error('Runtime source package.json is missing or invalid'); }
  if (typeof manifest.version !== 'string' || !manifest.version) throw new Error('Runtime source has no version');
  const files = listRuntimeSnapshotFiles(root);
  if (!files.includes('docs/WORKFLOW_TEMPLATE.md') || !files.includes('operator/app/manager.mjs')) {
    throw new Error('Runtime snapshot is missing central Manager files');
  }
  const entries = await readDistributionFiles(root, files);
  return { root, version: manifest.version, files, entries, id: hashDistribution(manifest.version, entries) };
}

export async function inspectRuntimeSource(sourceRoot = defaultSourceRoot) {
  const source = await sourceIdentity(sourceRoot);
  return { path: source.root, id: source.id, version: source.version };
}

function runRuntimeBuild(command, args, cwd, environment, label) {
  const result = spawnSync(command, args, { cwd, env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error) throw new Error(`${label} failed: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = `${result.stdout || ''}\n${result.stderr || ''}`.trim().slice(-4000);
    throw new Error(`${label} failed${result.signal ? ` (${result.signal})` : ` (exit ${result.status ?? 1})`}${detail ? `: ${detail}` : ''}`);
  }
}

async function buildRuntimeDependencies(runtimeRoot, environment = process.env, homeDirectory = homedir()) {
  prepareNpmDependencies({ loopRoot: runtimeRoot, component: 'operator-ui', environment });
  prepareNpmDependencies({ loopRoot: runtimeRoot, component: 'local-task-store', environment });
  const cacheHome = environment.XDG_CACHE_HOME || join(homeDirectory, '.cache');
  const dataHome = environment.XDG_DATA_HOME || join(homeDirectory, '.local/share');
  if (!isAbsolute(cacheHome) || !isAbsolute(dataHome)) throw new Error('XDG cache and data directories must be absolute paths');
  const hexHome = join(cacheHome, 'leesh-loop/hex');
  const mixHome = join(dataHome, 'leesh-loop/mix');
  await Promise.all([ensurePrivateDirectory(hexHome), ensurePrivateDirectory(mixHome)]);
  const symphonyDirectory = join(runtimeRoot, 'operator/symphony');
  const mixCommand = (...args) => ['exec', '--', 'env', `HEX_HOME=${hexHome}`, `MIX_HOME=${mixHome}`, 'MIX_ENV=dev', 'mix', ...args];
  runRuntimeBuild('mise', mixCommand('deps.get'), symphonyDirectory, environment, 'Symphony dependency installation');
  runRuntimeBuild('mise', mixCommand('compile'), symphonyDirectory, environment, 'Symphony Runtime compilation');
  runRuntimeBuild('npm', ['run', 'build'], join(runtimeRoot, 'operator/ui'), environment, 'Operator UI build');
}

async function validateInstalledDistribution(path, expectedId) {
  const details = await lstat(path);
  if (details.isSymbolicLink() || !details.isDirectory()) throw new Error(`Runtime distribution path is unsafe: ${path}`);
  const distribution = await readJsonFile(join(path, '.distribution.json'), 'Runtime distribution metadata');
  if (distribution?.schema_version !== 1 || distribution.id !== expectedId || !digestPattern.test(distribution.id)) {
    throw new Error(`Runtime distribution metadata is invalid: ${path}`);
  }
  if (typeof distribution.version !== 'string' || !Array.isArray(distribution.files) || distribution.files.length === 0 || distribution.path !== path) {
    throw new Error(`Runtime distribution metadata does not match its path: ${path}`);
  }
  const uniqueFiles = new Set();
  for (const file of distribution.files) {
    if (typeof file !== 'string' || !file || file.includes('\\') || file.startsWith('/') || file.includes('\0') || file.split('/').some(part => !part || part === '.' || part === '..') || uniqueFiles.has(file)) {
      throw new Error(`Runtime distribution metadata has an unsafe file list: ${path}`);
    }
    uniqueFiles.add(file);
  }
  const files = [...distribution.files].sort();
  if (JSON.stringify(files) !== JSON.stringify(distribution.files)) throw new Error(`Runtime distribution file list is not canonical: ${path}`);
  const entries = await readDistributionFiles(path, files);
  if (hashDistribution(distribution.version, entries) !== expectedId) throw new Error(`Runtime distribution contents do not match their immutable identity: ${path}`);
  return distribution;
}

export async function activeRuntime(options = {}) {
  const paths = managerPaths(options);
  const pointer = await readJsonFile(paths.activeRuntime, 'active Runtime pointer');
  if (!pointer) return null;
  if (pointer.schema_version !== 1 || typeof pointer.id !== 'string' || !digestPattern.test(pointer.id)) throw new Error('active Runtime pointer is invalid');
  const runtimePath = join(paths.runtimeRoot, pointer.id);
  const details = await validateInstalledDistribution(runtimePath, pointer.id);
  return { id: pointer.id, version: details.version, path: runtimePath, installed_at: details.installed_at };
}

export function runtimeDiagnostic(error) {
  const detail = error?.message || String(error);
  return detail.length <= 400 ? detail : `${detail.slice(0, 397)}…`;
}

export async function markManagerRestartRequiredForRuntimeRepair(runtimeId, options = {}) {
  const paths = managerPaths(options);
  const service = await readJsonFile(paths.managerServiceRecord, 'Manager service record');
  if (service?.runtime_version !== runtimeId) return false;
  if (service.manager_restart_required === true) return true;
  await writeAtomicJson(paths.managerServiceRecord, { ...service, manager_restart_required: true });
  return true;
}

function validPreservedRuntimePath(path, runtimeId, paths) {
  return path == null || (
    typeof path === 'string'
    && isAbsolute(path)
    && resolve(path) === path
    && dirname(path) === paths.runtimeRoot
    && basename(path).startsWith(`.damaged-${runtimeId}-`)
  );
}

export async function writeRuntimeRecoveryRecord(record, options = {}) {
  if (!record || !digestPattern.test(record.runtime_id) || !['activation-pending', 'active'].includes(record.status)) {
    throw new Error('Runtime recovery record is invalid');
  }
  const paths = managerPaths(options);
  if (!validPreservedRuntimePath(record.preserved_runtime_path, record.runtime_id, paths)) {
    throw new Error('Runtime recovery record path is invalid');
  }
  if (record.recovered_at != null && (typeof record.recovered_at !== 'string' || !Number.isFinite(Date.parse(record.recovered_at)))) {
    throw new Error('Runtime recovery record timestamp is invalid');
  }
  const existing = await readRuntimeRecoveryRecord(options);
  const preservedRuntimePath = record.preserved_runtime_path || (
    existing.record?.runtime_id === record.runtime_id
      ? await preservedRuntimePathIfPresent(existing.record, options)
      : null
  );
  const value = {
    schema_version: 1,
    runtime_id: record.runtime_id,
    status: record.status,
    validation_error: record.validation_error ? runtimeDiagnostic(record.validation_error) : null,
    preserved_runtime_path: preservedRuntimePath,
    recovered_at: record.recovered_at ?? new Date().toISOString()
  };
  await writeAtomicJson(paths.runtimeRecovery, value);
  return value;
}

export async function readRuntimeRecoveryRecord(options = {}) {
  const paths = managerPaths(options);
  let value;
  try { value = await readJsonFile(paths.runtimeRecovery, 'Runtime recovery record'); }
  catch (error) { return { record: null, error: runtimeDiagnostic(error) }; }
  if (!value) return { record: null, error: null };
  const validError = value.validation_error === null || (typeof value.validation_error === 'string' && value.validation_error.length <= 400);
  const validPath = validPreservedRuntimePath(value.preserved_runtime_path, value.runtime_id, paths);
  const validTimestamp = typeof value.recovered_at === 'string' && Number.isFinite(Date.parse(value.recovered_at));
  if (value.schema_version !== 1 || !digestPattern.test(value.runtime_id) || !['activation-pending', 'active'].includes(value.status) || !validError || !validPath || !validTimestamp) {
    return { record: null, error: 'Runtime recovery record is invalid.' };
  }
  return { record: value, error: null };
}

async function preservedRuntimePathIfPresent(record, options = {}) {
  if (!record?.preserved_runtime_path) return null;
  const details = await lstat(record.preserved_runtime_path).catch(error => error?.code === 'ENOENT' ? null : Promise.reject(error));
  return details && !details.isSymbolicLink() && details.isDirectory() ? record.preserved_runtime_path : null;
}

export async function reconcileRuntimeRecoveryRecord(options = {}) {
  const current = await readRuntimeRecoveryRecord(options);
  if (current.error || current.record?.status !== 'activation-pending') return current;
  try {
    let record = current.record;
    let active;
    try { active = await activeRuntime(options); }
    catch { return { record, error: null }; }
    if (active?.id !== record.runtime_id) return { record, error: null };
    const preservedPath = await preservedRuntimePathIfPresent(record, options);
    if (preservedPath !== record.preserved_runtime_path) {
      record = await writeRuntimeRecoveryRecord({ ...record, preserved_runtime_path: preservedPath }, options);
    }
    record = await writeRuntimeRecoveryRecord({ ...record, status: 'active', recovered_at: new Date().toISOString() }, options);
    return { record, error: null };
  } catch (error) {
    return { record: current.record, error: runtimeDiagnostic(error) };
  }
}

export async function publishRuntimeStage(stage, destination, expectedId, { beforePreserve, beforeInstall } = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let current;
    try { current = await lstat(destination); }
    catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      try {
        await beforeInstall?.();
        await rename(stage, destination);
        return { repaired: false, preservedPath: null };
      } catch (renameError) {
        if (['EEXIST', 'ENOTEMPTY'].includes(renameError?.code)) continue;
        throw renameError;
      }
    }
    if (current.isSymbolicLink() || !current.isDirectory()) throw new Error(`Runtime distribution path is unsafe: ${destination}`);

    let currentIsValid = false;
    try {
      await validateInstalledDistribution(destination, expectedId);
      currentIsValid = true;
    } catch { /* Replace only a real directory whose content fails validation. */ }
    if (currentIsValid) {
      await rm(stage, { recursive: true, force: true });
      return { repaired: false, preservedPath: null };
    }

    const preservedPath = join(dirname(destination), `.damaged-${expectedId}-${randomUUID()}`);
    await beforePreserve?.(preservedPath);
    try { await rename(destination, preservedPath); }
    catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }

    try {
      await rename(stage, destination);
      return { repaired: true, preservedPath };
    } catch (error) {
      if (['EEXIST', 'ENOTEMPTY'].includes(error?.code)) {
        try {
          await validateInstalledDistribution(destination, expectedId);
          await rm(stage, { recursive: true, force: true });
          return { repaired: true, preservedPath };
        } catch { /* A concurrent invalid destination remains a hard failure. */ }
      }
      try { await rename(preservedPath, destination); }
      catch (restoreError) {
        throw new Error(`Runtime replacement failed and the prior distribution remains preserved at ${preservedPath}; it could not be restored to ${destination}: ${restoreError.message}`, { cause: error });
      }
      throw error;
    }
  }
  throw new Error(`Runtime distribution changed repeatedly during installation: ${destination}`);
}

export function managerMustRestartForRuntime(managerRuntimeVersion, updatedRuntime) {
  return managerRuntimeVersion !== updatedRuntime.id || updatedRuntime.repaired_distribution === true;
}

export async function recordRuntimeSource(sourceRoot, options = {}) {
  const paths = managerPaths(options);
  const source = await sourceIdentity(sourceRoot);
  await ensurePrivateDirectory(paths.configRoot);
  await writeAtomicJson(paths.runtimeSource, {
    schema_version: 1,
    path: source.root,
    id: source.id,
    version: source.version,
    recorded_at: new Date().toISOString()
  });
  return { path: source.root, id: source.id, version: source.version };
}

export async function currentRuntimeSource(fallbackSource = defaultSourceRoot, options = {}) {
  const paths = managerPaths(options);
  const recorded = await readJsonFile(paths.runtimeSource, 'Runtime source record');
  if (!recorded) return fallbackSource;
  if (recorded.schema_version !== 1 || typeof recorded.path !== 'string' || !isAbsolute(recorded.path) || !digestPattern.test(recorded.id)) {
    throw new Error('Runtime source record is invalid');
  }
  let sourcePath;
  try { sourcePath = await realpath(recorded.path); }
  catch { throw new Error(`recorded Runtime source is unavailable: ${recorded.path}`); }
  if (sourcePath !== recorded.path) throw new Error('recorded Runtime source path is not canonical');
  return sourcePath;
}

async function installRuntimeDistributionUnlocked(sourceRoot = defaultSourceRoot, options = {}, testHooks = {}) {
  const paths = managerPaths(options);
  const source = await sourceIdentity(sourceRoot);
  const existingRecovery = await readRuntimeRecoveryRecord(options);
  let recoveryRecord = existingRecovery.record?.runtime_id === source.id && existingRecovery.record.status === 'activation-pending'
    ? existingRecovery.record
    : null;
  let previousActive = null;
  let recoveredFromInvalidActive = false;
  let previousActiveError = null;
  try { previousActive = await activeRuntime(options); }
  catch (error) {
    recoveredFromInvalidActive = true;
    previousActiveError = runtimeDiagnostic(error);
  }
  await testHooks.afterRecoverySnapshot?.({ recoveryRecord, previousActive, previousActiveError });
  await Promise.all([ensurePrivateDirectory(paths.runtimeRoot), ensurePrivateDirectory(paths.configRoot)]);
  const destination = join(paths.runtimeRoot, source.id);
  let destinationIsValid = false;
  let destinationIsDamagedDirectory = false;
  let restoredMissingDistribution = false;
  try {
    await validateInstalledDistribution(destination, source.id);
    destinationIsValid = true;
  } catch {
    const details = await lstat(destination).catch(error => error?.code === 'ENOENT' ? null : Promise.reject(error));
    if (details && (details.isSymbolicLink() || !details.isDirectory())) throw new Error(`Runtime distribution path is unsafe: ${destination}`);
    destinationIsDamagedDirectory = Boolean(details);
  }
  let repair = { repaired: false, preservedPath: null };
  if (!destinationIsValid) {
    const stage = join(paths.runtimeRoot, `.stage-${process.pid}-${randomUUID()}`);
    await mkdir(stage, { mode: 0o700 });
    try {
      const materialized = await materializeRuntimeSnapshot(source.root, stage);
      if (materialized.length !== source.files.length || materialized.some((file, index) => file !== source.files[index])) {
        throw new Error('Runtime source changed while its versioned snapshot was being installed');
      }
      const stagedEntries = await readDistributionFiles(stage, source.files);
      if (hashDistribution(source.version, stagedEntries) !== source.id) throw new Error('Runtime snapshot did not match its immutable distribution identity');
      await buildRuntimeDependencies(stage, options.environment ?? process.env, options.homeDirectory ?? homedir());
      const metadata = { schema_version: 1, id: source.id, version: source.version, path: destination, source_root: source.root, files: source.files, installed_at: new Date().toISOString() };
      await writeFile(join(stage, '.distribution.json'), `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      if (recoveredFromInvalidActive && !destinationIsDamagedDirectory) {
        restoredMissingDistribution = true;
        const priorPreservedPath = await preservedRuntimePathIfPresent(recoveryRecord, options);
        recoveryRecord = {
          runtime_id: source.id,
          status: 'activation-pending',
          validation_error: recoveryRecord?.validation_error || previousActiveError,
          preserved_runtime_path: priorPreservedPath,
          recovered_at: new Date().toISOString()
        };
        await writeRuntimeRecoveryRecord(recoveryRecord, options);
        await markManagerRestartRequiredForRuntimeRepair(source.id, options);
      }
      repair = await publishRuntimeStage(stage, destination, source.id, {
        beforeInstall: async () => {
          const managerRestartRequired = await markManagerRestartRequiredForRuntimeRepair(source.id, options);
          if (managerRestartRequired) restoredMissingDistribution = true;
          if (!recoveryRecord && (destinationIsDamagedDirectory || managerRestartRequired)) {
            recoveryRecord = {
              runtime_id: source.id,
              status: 'activation-pending',
              validation_error: previousActiveError,
              preserved_runtime_path: null,
              recovered_at: new Date().toISOString()
            };
            await writeRuntimeRecoveryRecord(recoveryRecord, options);
          }
        },
        beforePreserve: async preservedRuntimePath => {
          recoveryRecord = {
            runtime_id: source.id,
            status: 'activation-pending',
            validation_error: previousActiveError,
            preserved_runtime_path: preservedRuntimePath,
            recovered_at: new Date().toISOString()
          };
          await writeRuntimeRecoveryRecord(recoveryRecord, options);
          if (destinationIsDamagedDirectory) await markManagerRestartRequiredForRuntimeRepair(source.id, options);
        }
      });
    } catch (error) {
      await rm(stage, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }
  if (!recoveryRecord && (recoveredFromInvalidActive || repair.repaired)) {
    recoveryRecord = {
        runtime_id: source.id,
        status: 'activation-pending',
        validation_error: previousActiveError,
        preserved_runtime_path: repair.preservedPath,
        recovered_at: new Date().toISOString()
    };
    await writeRuntimeRecoveryRecord(recoveryRecord, options);
  }
  await writeAtomicJson(paths.activeRuntime, { schema_version: 1, id: source.id, activated_at: new Date().toISOString() });
  if (recoveryRecord) {
    await writeRuntimeRecoveryRecord({
      ...recoveryRecord,
      status: 'active',
      preserved_runtime_path: await preservedRuntimePathIfPresent(recoveryRecord, options),
      recovered_at: new Date().toISOString()
    }, options);
  }
  return {
    ...(await activeRuntime(options)),
    changed: recoveredFromInvalidActive || repair.repaired || previousActive?.id !== source.id,
    recovered_from_invalid_active: recoveredFromInvalidActive,
    previous_active_error: previousActiveError,
    repaired_distribution: repair.repaired || restoredMissingDistribution,
    preserved_runtime_path: repair.preservedPath,
    recovery_status: recoveryRecord ? 'active' : null
  };
}

export async function installRuntimeDistribution(sourceRoot = defaultSourceRoot, options = {}, testHooks = {}) {
  if (!isMainThread && testHooks.skipRuntimeInstallLock === true) return installRuntimeDistributionUnlocked(sourceRoot, options, testHooks);
  const paths = managerPaths(options);
  await ensurePrivateDirectory(paths.runtimeRoot);
  return withRuntimeInstallLock(paths.runtimeRoot, () => installRuntimeDistributionUnlocked(sourceRoot, options, testHooks), {
    onWait: testHooks.onInstallLockWait
  });
}

export function installRuntimeDistributionInWorker(sourceRoot = defaultSourceRoot, options = {}, { moduleUrl = import.meta.url, onInstallLockWait } = {}) {
  const paths = managerPaths(options);
  return ensurePrivateDirectory(paths.runtimeRoot).then(() => withRuntimeInstallLock(paths.runtimeRoot, () => {
    const worker = new Worker(runtimeInstallWorkerSource, {
      eval: true,
      workerData: {
        moduleUrl,
        sourceRoot,
        environment: { ...(options.environment ?? process.env) },
        homeDirectory: options.homeDirectory ?? homedir()
      }
    });

    return new Promise((resolveInstall, rejectInstall) => {
      let settled = false;
      worker.once('message', message => {
        settled = true;
        if (message?.ok) {
          resolveInstall(message.result);
          return;
        }
        const error = new Error(message?.error?.message || 'Runtime installation worker failed without a message.');
        if (message?.error?.stack) error.stack = message.error.stack;
        rejectInstall(error);
      });
      worker.once('error', error => {
        if (settled) return;
        settled = true;
        rejectInstall(error);
      });
      worker.once('exit', code => {
        if (settled) return;
        settled = true;
        rejectInstall(new Error(`Runtime installation worker exited with status ${code} before returning a result.`));
      });
    });
  }, { onWait: onInstallLockWait }));
}

export async function resolveRuntimePath(runtimePath, options = {}) {
  const paths = managerPaths(options);
  const active = runtimePath ? null : await activeRuntime(options);
  const candidate = runtimePath ? resolve(runtimePath) : active?.path;
  if (!candidate) throw new Error('No central Runtime is installed. Run leesh-loop update or initialize an instance first.');
  const canonical = await realpath(candidate);
  const relativePath = relative(paths.runtimeRoot, canonical);
  if (!relativePath || relativePath.startsWith(`..${sep}`) || relativePath === '..' || relativePath.startsWith(sep)) throw new Error('Runtime path is outside the managed distribution directory');
  const id = basename(canonical);
  if (!digestPattern.test(id)) throw new Error('Runtime directory identity is invalid');
  const metadata = await validateInstalledDistribution(canonical, id);
  return { id, version: metadata.version, path: canonical };
}

export async function listRuntimeDistributions(options = {}) {
  const paths = managerPaths(options);
  await ensurePrivateDirectory(paths.runtimeRoot);
  const entries = await import('node:fs/promises').then(module => module.readdir(paths.runtimeRoot, { withFileTypes: true }));
  const runtimes = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !digestPattern.test(entry.name)) continue;
    const path = join(paths.runtimeRoot, entry.name);
    try {
      const record = await validateInstalledDistribution(path, entry.name);
      runtimes.push({ id: record.id, version: record.version, installed_at: record.installed_at });
    } catch { /* Invalid version folders are preserved for diagnosis and never activated. */ }
  }
  let active = null;
  try { active = await activeRuntime(options); }
  catch { /* Invalid active selection must not hide other valid Runtime facts. */ }
  return runtimes.sort((a, b) => a.installed_at.localeCompare(b.installed_at)).map(runtime => ({ ...runtime, active: runtime.id === active?.id }));
}

export function runtimeSourceRoot() {
  return process.env.LEESH_LOOP_RUNTIME_SOURCE || defaultSourceRoot;
}
