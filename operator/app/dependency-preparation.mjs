import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const helperPath = fileURLToPath(import.meta.url);
const stateDirectoryName = 'dependency-preparation';
const workerFailurePrefix = 'LEESH_LOOP_DEPENDENCY_PREPARATION_ERROR:';
const LOCK_RETRY_MS = 50;
const EMPTY_LOCK_STALE_MS = 10_000;
const NON_LINUX_IDENTITY_CHECK_MS = 1_000;
const nonLinuxProcessIdentityCache = new Map();

const COMPONENTS = Object.freeze({
  'generated-loop': {
    label: 'generated Loop root',
    packageDirectory: '.',
    requiredFiles: []
  },
  'operator-ui': {
    label: 'Operator UI',
    packageDirectory: 'operator/ui',
    requiredFiles: [
      'node_modules/.bin/vite',
      'node_modules/react/package.json',
      'node_modules/react-dom/package.json'
    ]
  },
  'local-task-store': {
    label: 'Local Task Store',
    packageDirectory: 'operator/local_task_store',
    requiredFiles: ['node_modules/better-sqlite3/build/Release/better_sqlite3.node']
  }
});

function componentFor(name) {
  const component = COMPONENTS[name];
  if (!component) throw new Error(`unsupported npm runtime component: ${String(name)}`);
  return component;
}

function ensureRealDirectory(path, mode) {
  try {
    const details = lstatSync(path);
    if (details.isSymbolicLink() || !details.isDirectory()) throw new Error(`dependency preparation state path is not a real directory: ${path}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    try { mkdirSync(path, { mode }); }
    catch (createError) {
      if (createError?.code !== 'EEXIST') throw createError;
    }
    const details = lstatSync(path);
    if (details.isSymbolicLink() || !details.isDirectory()) throw new Error(`dependency preparation state path is not a real directory: ${path}`);
  }
}

function ensureStateDirectory(loopRoot) {
  const metadataDirectory = join(loopRoot, '.leesh-loop');
  ensureRealDirectory(metadataDirectory, 0o700);
  const stateDirectory = join(metadataDirectory, stateDirectoryName);
  ensureRealDirectory(stateDirectory, 0o700);
  return stateDirectory;
}

function regularFileBytes(path, description) {
  let details;
  try { details = lstatSync(path); }
  catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`required ${description} is missing: ${path}`);
    throw error;
  }
  if (details.isSymbolicLink() || !details.isFile()) throw new Error(`required ${description} is not a regular file: ${path}`);
  return readFileSync(path);
}

function dependencyFingerprint(packageDirectory) {
  const manifest = regularFileBytes(join(packageDirectory, 'package.json'), 'package.json');
  const lockfile = regularFileBytes(join(packageDirectory, 'package-lock.json'), 'package-lock.json');
  let parsedManifest;
  try {
    const parsed = JSON.parse(manifest.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('expected a JSON object');
    parsedManifest = parsed;
  } catch (error) {
    throw new Error(`package.json is invalid: ${error.message}`);
  }
  try {
    const parsed = JSON.parse(lockfile.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('expected a JSON object');
  } catch (error) {
    throw new Error(`package-lock.json is invalid: ${error.message}`);
  }
  const environment = {
    platform: process.platform,
    architecture: process.arch,
    nodeModulesAbi: process.versions.modules ?? null,
    nodeApiVersion: process.versions.napi ?? null
  };
  const digest = createHash('sha256')
    .update('package.json\0').update(manifest)
    .update('\0package-lock.json\0').update(lockfile)
    .update('\0installation-environment\0').update(JSON.stringify(environment))
    .digest('hex');
  return { digest, environment, manifest: parsedManifest };
}

function requiredDependencyFiles(manifest, component) {
  const directDependencies = [
    ...Object.keys(manifest.dependencies || {}),
    ...Object.keys(manifest.devDependencies || {})
  ];
  for (const name of directDependencies) {
    const segments = name.split('/');
    const validScopedName = name.startsWith('@') && segments.length === 2 && segments[0].length > 1;
    const validUnscopedName = !name.startsWith('@') && segments.length === 1;
    if ((!validScopedName && !validUnscopedName) || segments.some(segment => !segment || segment === '.' || segment === '..' || segment.includes('\\'))) {
      throw new Error(`package.json contains an invalid dependency name: ${name}`);
    }
  }
  const files = [
    ...component.requiredFiles,
    ...directDependencies.map(name => `node_modules/${name}/package.json`)
  ];
  return [...new Set(files)];
}

function requiredFilesExist(packageDirectory, files) {
  return files.every(file => {
    try { return statSync(join(packageDirectory, file)).isFile(); }
    catch { return false; }
  });
}

function readInstallationRecord(recordPath) {
  try {
    const details = lstatSync(recordPath);
    if (details.isSymbolicLink() || !details.isFile()) return null;
    return JSON.parse(readFileSync(recordPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

function invalidateInstallationRecord(recordPath) {
  try {
    const details = lstatSync(recordPath);
    if (details.isDirectory()) throw new Error(`dependency installation record is a directory: ${recordPath}`);
    rmSync(recordPath, { force: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function writeInstallationRecord(recordPath, componentName, fingerprint, environment) {
  const temporaryPath = `${recordPath}.${process.pid}.${randomUUID()}.tmp`;
  const descriptor = openSync(temporaryPath, 'wx', 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify({
      schemaVersion: 1,
      component: componentName,
      definitionFingerprint: fingerprint,
      environment,
      preparedAt: new Date().toISOString()
    }, null, 2)}\n`);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try { renameSync(temporaryPath, recordPath); }
  catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function ensureLockFile(lockPath) {
  try {
    const details = lstatSync(lockPath);
    if (details.isSymbolicLink() || !details.isFile()) throw new Error(`dependency preparation lock is not a regular file: ${lockPath}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    try {
      const descriptor = openSync(lockPath, 'wx', 0o600);
      closeSync(descriptor);
    } catch (createError) {
      if (createError?.code !== 'EEXIST') throw createError;
    }
    const details = lstatSync(lockPath);
    if (details.isSymbolicLink() || !details.isFile()) throw new Error(`dependency preparation lock is not a regular file: ${lockPath}`);
  }
}

function processStartIdentity(pid) {
  if (process.platform === 'linux') {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/);
      return fields[19] ? `proc:${fields[19]}` : null;
    } catch { return null; }
  }

  const candidates = ['ps', '/bin/ps', '/usr/bin/ps'];
  for (const command of candidates) {
    const result = spawnSync(command, ['-p', String(pid), '-o', 'lstart='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    if (!result.error && result.status === 0) {
      const startTime = result.stdout.trim();
      if (startTime) return `ps:${startTime}`;
    }
    if (result.error?.code !== 'ENOENT') return null;
  }
  return null;
}

function currentProcessStartIdentity(pid) {
  if (process.platform === 'linux') return processStartIdentity(pid);
  const cached = nonLinuxProcessIdentityCache.get(pid);
  if (cached && Date.now() - cached.checkedAt < NON_LINUX_IDENTITY_CHECK_MS) return cached.identity;
  const identity = processStartIdentity(pid);
  nonLinuxProcessIdentityCache.set(pid, { identity, checkedAt: Date.now() });
  if (nonLinuxProcessIdentityCache.size > 32) {
    const oldestPid = nonLinuxProcessIdentityCache.keys().next().value;
    nonLinuxProcessIdentityCache.delete(oldestPid);
  }
  return identity;
}

function lockOwner(pid = process.pid) {
  return {
    pid,
    processStartIdentity: processStartIdentity(pid),
    token: randomUUID(),
    createdAt: Date.now()
  };
}

function writeLockOwner(directory, owner) {
  const path = join(directory, 'owner.json');
  const descriptor = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(owner)}\n`);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function lockSnapshot(path) {
  let details;
  try { details = lstatSync(path); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
  if (details.isSymbolicLink() || !details.isDirectory()) throw new Error(`dependency preparation lock is not a real directory: ${path}`);
  let owner = null;
  try {
    const ownerDetails = lstatSync(join(path, 'owner.json'));
    if (!ownerDetails.isSymbolicLink() && ownerDetails.isFile()) owner = JSON.parse(readFileSync(join(path, 'owner.json'), 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  return { details, owner };
}

function lockOwnerAlive(owner) {
  if (!Number.isInteger(owner?.pid) || owner.pid < 1) return false;
  try { process.kill(owner.pid, 0); }
  catch (error) {
    if (error?.code === 'EPERM') return true;
    if (error?.code === 'ESRCH') return false;
    return true;
  }
  if (owner.processStartIdentity) {
    const currentIdentity = currentProcessStartIdentity(owner.pid);
    if (currentIdentity && currentIdentity !== owner.processStartIdentity) return false;
  }
  return true;
}

function waitForLockRetry() {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_RETRY_MS);
}

function waitForRecoveryLock(lockPath) {
  const recoveryPath = `${lockPath}.recovery`;
  const recovery = lockSnapshot(recoveryPath);
  if (!recovery) return false;
  if (lockOwnerAlive(recovery.owner)
      || (!recovery.owner && Date.now() - recovery.details.mtimeMs < EMPTY_LOCK_STALE_MS)) {
    waitForLockRetry();
    return true;
  }
  rmSync(recoveryPath, { recursive: true, force: true });
  return true;
}

function removeStaleLock(lockPath, observed) {
  const recoveryPath = `${lockPath}.recovery`;
  const recoveryOwner = lockOwner();
  try {
    mkdirSync(recoveryPath, { mode: 0o700 });
    writeLockOwner(recoveryPath, recoveryOwner);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const recovery = lockSnapshot(recoveryPath);
    if (recovery && !lockOwnerAlive(recovery.owner)
        && Date.now() - recovery.details.mtimeMs >= EMPTY_LOCK_STALE_MS) {
      rmSync(recoveryPath, { recursive: true, force: true });
    }
    return false;
  }

  const quarantinePath = `${lockPath}.stale-${randomUUID()}`;
  try {
    const current = lockSnapshot(lockPath);
    const expectedToken = observed.owner?.token;
    if (!current
        || (expectedToken ? current.owner?.token !== expectedToken : current.owner)
        || lockOwnerAlive(current.owner)
        || (!current.owner && Date.now() - current.details.mtimeMs < EMPTY_LOCK_STALE_MS)) {
      return false;
    }
    renameSync(lockPath, quarantinePath);
    const moved = lockSnapshot(quarantinePath);
    const ownerChanged = expectedToken ? moved?.owner?.token !== expectedToken : Boolean(moved?.owner);
    const movedOwnerAlive = lockOwnerAlive(moved?.owner);
    const movedEmptyButFresh = Boolean(moved && !moved.owner && Date.now() - moved.details.mtimeMs < EMPTY_LOCK_STALE_MS);
    if (!moved || ownerChanged || movedOwnerAlive || movedEmptyButFresh) {
      try { renameSync(quarantinePath, lockPath); } catch { /* keep the moved directory for diagnosis */ }
      return false;
    }
    rmSync(quarantinePath, { recursive: true, force: true });
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  } finally {
    rmSync(recoveryPath, { recursive: true, force: true });
  }
}

function withPortableLock(lockPath, action) {
  const owner = lockOwner();
  while (true) {
    if (waitForRecoveryLock(lockPath)) continue;
    try {
      mkdirSync(lockPath, { mode: 0o700 });
      writeLockOwner(lockPath, owner);
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        if (error?.code !== 'ENOENT') throw error;
        mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
        continue;
      }
      const current = lockSnapshot(lockPath);
      if (!current) continue;
      if (lockOwnerAlive(current.owner)) {
        waitForLockRetry();
        continue;
      }
      if (!current.owner && Date.now() - current.details.mtimeMs < EMPTY_LOCK_STALE_MS) {
        waitForLockRetry();
        continue;
      }
      removeStaleLock(lockPath, current);
    }
  }

  try { return action(); }
  finally {
    const current = lockSnapshot(lockPath);
    if (current?.owner?.token === owner.token) rmSync(lockPath, { recursive: true, force: true });
  }
}

function installDependencies(loopRoot, componentName, runtimeEnvironment = process.env) {
  const component = componentFor(componentName);
  const packageDirectory = join(loopRoot, component.packageDirectory);
  const stateDirectory = ensureStateDirectory(loopRoot);
  const recordPath = join(stateDirectory, `${componentName}.json`);
  const { digest, environment, manifest } = dependencyFingerprint(packageDirectory);
  const requiredFiles = requiredDependencyFiles(manifest, component);
  const previous = readInstallationRecord(recordPath);
  if (previous?.schemaVersion === 1
      && previous.component === componentName
      && previous.definitionFingerprint === digest
      && JSON.stringify(previous.environment) === JSON.stringify(environment)
      && requiredFilesExist(packageDirectory, requiredFiles)) {
    return;
  }

  // npm ci may remove or partially replace node_modules. A record from before
  // this attempt must not authorize any later reuse if preparation fails.
  invalidateInstallationRecord(recordPath);
  const install = spawnSync('npm', ['ci', '--include=dev'], {
    cwd: packageDirectory,
    stdio: ['ignore', process.stderr.fd, 'inherit'],
    env: runtimeEnvironment
  });
  if (install.error) throw new Error(`npm ci could not start: ${install.error.message}`);
  if (install.status !== 0) {
    throw new Error(`npm ci failed${install.signal ? ` (${install.signal})` : ` (exit code ${install.status ?? 1})`}`);
  }

  const current = dependencyFingerprint(packageDirectory);
  if (current.digest !== digest) throw new Error('dependency definition changed while npm ci was running; retry preparation');
  const missing = requiredDependencyFiles(current.manifest, component).filter(file => !requiredFilesExist(packageDirectory, [file]));
  if (missing.length) throw new Error(`npm ci completed but required installation files are missing: ${missing.join(', ')}`);
  writeInstallationRecord(recordPath, componentName, digest, environment);
}

function workerFailureFromOutput(stdout) {
  const lines = Buffer.isBuffer(stdout) ? stdout.toString('utf8').split(/\r?\n/) : String(stdout || '').split(/\r?\n/);
  let failure = null;
  const output = [];
  for (const line of lines) {
    if (!line.startsWith(workerFailurePrefix)) {
      output.push(line);
      continue;
    }
    try {
      const parsed = JSON.parse(line.slice(workerFailurePrefix.length));
      if (typeof parsed?.message === 'string') failure = parsed.message;
      else output.push(line);
    } catch {
      output.push(line);
    }
  }
  const passthrough = output.join('\n').trimEnd();
  if (passthrough) process.stderr.write(`${passthrough}\n`);
  return failure;
}

function checkWorkerResult(result, component, runner) {
  const workerFailure = workerFailureFromOutput(result.stdout);
  if (result.error) throw new Error(`could not start ${runner}: ${result.error.message}`);
  if (result.status !== 0) {
    if (workerFailure) throw new Error(`${component.label} dependency preparation failed: ${workerFailure}`);
    throw new Error(`${runner} did not complete successfully${result.signal ? ` (${result.signal})` : ` (exit code ${result.status ?? 1})`}`);
  }
}

function reportWorkerFailure(error) {
  const message = String(error?.message || error);
  process.stdout.write(`${workerFailurePrefix}${JSON.stringify({ message })}\n`);
  process.exitCode = 1;
}

function prepareWhileLocked(loopRoot, componentName, environment) {
  const component = componentFor(componentName);
  try {
    const root = resolve(loopRoot);
    const stateDirectory = ensureStateDirectory(root);
    const lockPath = join(stateDirectory, `${componentName}.lock`);
    ensureLockFile(lockPath);
    const result = spawnSync('flock', ['-x', lockPath, process.execPath, helperPath, '--prepare-locked', root, componentName], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'inherit'],
      env: environment
    });
    if (result.error?.code === 'ENOENT') {
      const portableLockPath = join(stateDirectory, `${componentName}.portable-lock`);
      const portable = spawnSync(process.execPath, [helperPath, '--prepare-portable-locked', root, componentName], {
        cwd: root,
        stdio: ['ignore', 'pipe', 'inherit'],
        env: environment
      });
      checkWorkerResult(portable, component, 'portable dependency preparation');
      return { component: componentName, prepared: true, lockPath: portableLockPath };
    }
    checkWorkerResult(result, component, 'flock');
    return { component: componentName, prepared: true };
  } catch (error) {
    const message = String(error?.message || error);
    if (message.startsWith(`${component.label} dependency preparation failed`)) throw error;
    throw new Error(`${component.label} dependency preparation failed: ${message}`);
  }
}

export function prepareNpmDependencies({ loopRoot, component, environment = process.env } = {}) {
  if (typeof loopRoot !== 'string' || !loopRoot.trim()) throw new TypeError('loopRoot must be a non-empty path');
  componentFor(component);
  return prepareWhileLocked(loopRoot, component, environment);
}

const [mode, workerRoot, workerComponent] = process.argv.slice(2);
if (mode === '--prepare-locked' && process.argv[1] && resolve(process.argv[1]) === helperPath) {
  try {
    installDependencies(resolve(workerRoot), workerComponent);
  } catch (error) {
    reportWorkerFailure(error);
  }
}
if (mode === '--prepare-portable-locked' && process.argv[1] && resolve(process.argv[1]) === helperPath) {
  try {
    const root = resolve(workerRoot);
    const stateDirectory = ensureStateDirectory(root);
    const portableLockPath = join(stateDirectory, `${workerComponent}.portable-lock`);
    withPortableLock(portableLockPath, () => installDependencies(root, workerComponent));
  } catch (error) {
    reportWorkerFailure(error);
  }
}
