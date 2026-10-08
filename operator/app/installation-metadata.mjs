import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const INSTALLATION_METADATA_PATH = '.leesh-loop/installation.json';
export const UPDATE_JOURNAL_PATH = '.leesh-loop/update.json';

function checkedManagedFiles(value, field) {
  if (!Array.isArray(value) || value.some(file => typeof file !== 'string' || !file || file.includes('\\') || file.startsWith('/') || file.split('/').some(part => !part || part === '.' || part === '..'))) {
    throw new Error(`installation metadata has invalid ${field}`);
  }
  const unique = [...new Set(value)];
  if (unique.length !== value.length) throw new Error(`installation metadata has duplicate ${field}`);
  return unique.sort();
}

export function createInstallationMetadata({ runtime = null, workflow = null, installationId = randomUUID() } = {}) {
  return {
    schemaVersion: 1,
    installationId,
    ...(runtime ? { runtime: { distributionId: runtime.distributionId, managedFiles: checkedManagedFiles(runtime.managedFiles, 'runtime managed files') } } : {}),
    ...(workflow ? { workflow: { distributionId: workflow.distributionId, managedFiles: checkedManagedFiles(workflow.managedFiles, 'workflow managed files') } } : {})
  };
}

export async function readInstallationMetadata(loopRoot) {
  const directory = resolve(loopRoot, '.leesh-loop');
  let directoryDetails;
  try { directoryDetails = await lstat(directory); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (!directoryDetails.isDirectory() || directoryDetails.isSymbolicLink()) throw new Error('.leesh-loop must be a real directory');
  const path = resolve(loopRoot, INSTALLATION_METADATA_PATH);
  let details;
  try { details = await lstat(path); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (!details.isFile() || details.isSymbolicLink()) throw new Error(`installation metadata is not a regular file: ${INSTALLATION_METADATA_PATH}`);
  let metadata;
  try { metadata = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { throw new Error(`cannot read installation metadata: ${error.message}`); }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || metadata.schemaVersion !== 1 || typeof metadata.installationId !== 'string' || !metadata.installationId) {
    throw new Error('unsupported or invalid Loop installation metadata');
  }
  const result = { schemaVersion: 1, installationId: metadata.installationId };
  for (const area of ['runtime', 'workflow']) {
    if (metadata[area] === undefined) continue;
    const value = metadata[area];
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.distributionId !== 'string' || !value.distributionId) {
      throw new Error(`installation metadata has invalid ${area} record`);
    }
    const managedFiles = checkedManagedFiles(value.managedFiles, `${area} managed files`);
    result[area] = { distributionId: value.distributionId, managedFiles };
  }
  for (const key of Object.keys(metadata)) {
    if (!['schemaVersion', 'installationId', 'runtime', 'workflow'].includes(key)) throw new Error(`installation metadata has unknown field: ${key}`);
  }
  return result;
}

export async function writeInstallationMetadata(loopRoot, metadata) {
  const normalized = createInstallationMetadata({
    installationId: metadata.installationId,
    runtime: metadata.runtime,
    workflow: metadata.workflow
  });
  const path = resolve(loopRoot, INSTALLATION_METADATA_PATH);
  const directory = resolve(loopRoot, '.leesh-loop');
  const directoryDetails = await lstat(directory);
  if (!directoryDetails.isDirectory() || directoryDetails.isSymbolicLink()) throw new Error('.leesh-loop must be a real directory');
  const temporaryPath = `${path}.tmp-${randomUUID()}`;
  await writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  try {
    await rename(temporaryPath, path);
  } catch (error) {
    try { await rm(temporaryPath, { force: true }); } catch {}
    throw error;
  }
}

export function hashDistribution(version, entries) {
  const hash = createHash('sha256');
  hash.update(`leesh-loop:${version}\0`);
  for (const [name, content, mode] of [...entries].sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(`${name}\0${mode ?? ''}\0`);
    hash.update(content);
    hash.update('\0');
  }
  return hash.digest('hex');
}

export async function readDistributionFiles(sourceRoot, files) {
  const result = [];
  for (const relativePath of [...files].sort()) {
    const parts = relativePath.split('/');
    let path = resolve(sourceRoot);
    for (let index = 0; index < parts.length; index += 1) {
      path = resolve(path, parts[index]);
      const component = await lstat(path);
      if (component.isSymbolicLink()) throw new Error(`runtime snapshot source contains a symlink: ${relativePath}`);
      if (index < parts.length - 1 && !component.isDirectory()) throw new Error(`runtime snapshot source parent is not a directory: ${relativePath}`);
    }
    const details = await lstat(path);
    if (!details.isFile() || details.isSymbolicLink()) throw new Error(`runtime snapshot source is not a regular file: ${relativePath}`);
    result.push([relativePath, await readFile(path), details.mode & 0o777]);
  }
  return result;
}
