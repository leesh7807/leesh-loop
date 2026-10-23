import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const helperPath = fileURLToPath(import.meta.url);
const stateDirectoryName = 'dependency-preparation';

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

function installDependencies(loopRoot, componentName) {
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
    env: process.env
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

function prepareWhileLocked(loopRoot, componentName, environment) {
  const component = componentFor(componentName);
  try {
    const root = resolve(loopRoot);
    const stateDirectory = ensureStateDirectory(root);
    const lockPath = join(stateDirectory, `${componentName}.lock`);
    ensureLockFile(lockPath);
    const result = spawnSync('flock', ['-x', lockPath, process.execPath, helperPath, '--prepare-locked', root, componentName], {
      cwd: root,
      stdio: 'inherit',
      env: environment
    });
    if (result.error) throw new Error(`could not start flock: ${result.error.message}`);
    if (result.status !== 0) {
      throw new Error(`flock did not complete successfully${result.signal ? ` (${result.signal})` : ` (exit code ${result.status ?? 1})`}`);
    }
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
    const label = COMPONENTS[workerComponent]?.label || workerComponent;
    console.error(`${label} dependency preparation failed: ${String(error?.message || error)}`);
    process.exitCode = 1;
  }
}
