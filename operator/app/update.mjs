import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmod, lstat, mkdir, readFile, readdir, realpath, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { generatedPackage, generatedWorkflow } from './init.mjs';
import { INSTALLATION_METADATA_PATH, UPDATE_JOURNAL_PATH, createInstallationMetadata, hashDistribution, readDistributionFiles, readInstallationMetadata, writeInstallationMetadata } from './installation-metadata.mjs';
import { listRuntimeSnapshotFiles, RUNTIME_SNAPSHOT_PATHS } from './runtime-manifest.mjs';
import { stringifyPackageLock } from './package-lock.mjs';
import { readProjectConfiguration } from '../project-config.mjs';

const protectedPaths = new Set(['project.toml', '.env', '.env.example', 'WORKFLOW.md', INSTALLATION_METADATA_PATH, UPDATE_JOURNAL_PATH]);
const protectedRoots = new Set(['.git', '.leesh-loop', '.runtime', 'node_modules']);
const generatedStart = 'node operator/app/prepare-runtime.mjs && node operator/app/leesh-loop.mjs start project.toml';
const generatedStop = 'node operator/app/leesh-loop.mjs stop project.toml';

async function exists(path) {
  try { return await lstat(path); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

function checkedRelativePath(value) {
  if (typeof value !== 'string' || !value || isAbsolute(value) || value.includes('\\') || value.includes('\0')) throw new Error(`invalid managed path: ${String(value)}`);
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) throw new Error(`invalid managed path: ${value}`);
  return parts.join('/');
}

function checkedManagedList(files, area) {
  if (!Array.isArray(files)) throw new Error(`invalid ${area} managed file list`);
  const normalized = files.map(checkedRelativePath);
  if (new Set(normalized).size !== normalized.length) throw new Error(`duplicate ${area} managed path`);
  if (normalized.some(file => (protectedPaths.has(file) && !(area.startsWith('workflow') && file === 'WORKFLOW.md')) || protectedRoots.has(file.split('/')[0]))) throw new Error(`${area} managed list crosses an instance-owned path`);
  return normalized.sort();
}

function configuredProtectedRoots(loopRoot, project) {
  const roots = ['project.toml', '.env', '.env.example', '.leesh-loop', '.runtime', 'node_modules'];
  for (const value of [project.workflow_path, project.symphony_workspace_root, project.state_directory]) {
    if (!value) continue;
    const relativePath = relative(loopRoot, resolve(value)).split(sep).join('/');
    if (relativePath === '' || (!relativePath.startsWith('../') && relativePath !== '..')) roots.push(relativePath);
  }
  return [...new Set(roots)];
}

function validateAgainstProject(loopRoot, project, files, area) {
  const roots = configuredProtectedRoots(loopRoot, project);
  for (const file of files) {
    if (roots.includes('')) throw new Error(`${area} update is unsafe because an instance path owns the Loop root`);
    if (area.startsWith('workflow') && file === 'WORKFLOW.md') continue;
    if (roots.some(root => root && (file === root || file.startsWith(`${root}/`)))) {
      throw new Error(`${area} managed path overlaps Loop configuration or persistent data: ${file}`);
    }
  }
}

async function ensureNoSymlink(root, relativePath, { allowMissingTarget = true } = {}) {
  const parts = checkedRelativePath(relativePath).split('/');
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    current = join(current, parts[index]);
    const details = await exists(current);
    if (!details) {
      if (!allowMissingTarget) throw new Error(`managed file is missing: ${relativePath}`);
      return null;
    }
    if (details.isSymbolicLink()) throw new Error(`managed path contains a symlink: ${relativePath}`);
    if (index < parts.length - 1 && !details.isDirectory()) throw new Error(`managed path parent is not a directory: ${relativePath}`);
    if (index === parts.length - 1 && !details.isFile()) throw new Error(`managed path is not a regular file: ${relativePath}`);
  }
  return current;
}

async function ensureMetaDirectory(root, { create = false } = {}) {
  const metaPath = join(root, '.leesh-loop');
  const details = await exists(metaPath);
  if (!details) {
    if (!create) return null;
    await mkdir(metaPath, { mode: 0o700 });
    return metaPath;
  }
  if (details.isSymbolicLink() || !details.isDirectory()) throw new Error('.leesh-loop must be a real directory');
  return metaPath;
}

async function assertNoGitWorkingTree(loopRoot) {
  try {
    execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: loopRoot, stdio: 'ignore' });
    throw new Error('run leesh-loop update from an independent generated Loop outside a Git working tree');
  } catch (error) {
    if (error?.message?.startsWith('run leesh-loop update')) throw error;
    if (error?.status !== 128 && error?.code !== 'ENOENT') throw error;
  }
}

async function validateGeneratedLoop(cwd) {
  let loopRoot;
  try { loopRoot = await realpath(cwd); }
  catch { throw new Error(`cannot access generated Loop directory: ${cwd}`); }
  if (resolve(cwd) !== loopRoot) throw new Error('run leesh-loop update from the generated Loop root');
  const rootDetails = await lstat(loopRoot);
  if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) throw new Error('generated Loop root must be a real directory');
  await assertNoGitWorkingTree(loopRoot);
  await ensureNoSymlink(loopRoot, 'project.toml', { allowMissingTarget: false });
  await ensureNoSymlink(loopRoot, 'package.json', { allowMissingTarget: false });
  await ensureMetaDirectory(loopRoot);
  const project = await readProjectConfiguration(join(loopRoot, 'project.toml'));
  let packageManifest;
  try { packageManifest = JSON.parse(await readFile(join(loopRoot, 'package.json'), 'utf8')); }
  catch { throw new Error('generated Loop package.json is missing or invalid'); }
  if (!packageManifest || packageManifest.private !== true || typeof packageManifest.name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,190}$/.test(packageManifest.name)) {
    throw new Error('directory is not a generated Loop: invalid package identity');
  }
  if (!packageManifest.scripts || packageManifest.scripts.start !== generatedStart || packageManifest.scripts.stop !== generatedStop || Object.keys(packageManifest.scripts).sort().join(',') !== 'start,stop') {
    throw new Error('directory is not a generated Loop: package start/stop contract does not match init');
  }
  const metadata = await readInstallationMetadata(loopRoot);
  if (metadata) {
    if (metadata.runtime) {
      const managedFiles = checkedManagedList(metadata.runtime.managedFiles, 'runtime');
      validateAgainstProject(loopRoot, project, managedFiles, 'runtime');
      if (!managedFiles.includes('package.json') || !managedFiles.includes('package-lock.json')) throw new Error('installation metadata does not identify the generated root package and lockfile');
      metadata.runtime.managedFiles = managedFiles;
    }
    if (metadata.workflow) {
      const managedFiles = checkedManagedList(metadata.workflow.managedFiles, 'workflow');
      validateAgainstProject(loopRoot, project, managedFiles, 'workflow');
      if (managedFiles.length !== 1 || managedFiles[0] !== 'WORKFLOW.md') throw new Error('installation metadata has an invalid workflow managed path');
      metadata.workflow.managedFiles = managedFiles;
    }
  }
  return { loopRoot, project, packageManifest, metadata };
}

async function collectLegacyManagedFiles(loopRoot, currentFiles) {
  const manifest = RUNTIME_SNAPSHOT_PATHS;
  const current = new Set(currentFiles);
  const owned = new Set(['package.json']);
  const walk = async (absolute, prefix) => {
    const entries = await readdir(absolute, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = `${prefix}/${entry.name}`;
      const childPath = join(absolute, entry.name);
      const details = await lstat(childPath);
      if (details.isSymbolicLink()) throw new Error(`legacy Loop runtime contains a symlink: ${relativePath}`);
      if (details.isDirectory()) await walk(childPath, relativePath);
      else if (details.isFile()) {
        if (!current.has(relativePath)) throw new Error(`cannot safely identify legacy runtime ownership for ${relativePath}; leaving the Loop unchanged`);
        owned.add(relativePath);
      }
      else throw new Error(`legacy Loop runtime contains an unsupported path: ${relativePath}`);
    }
  };
  for (const entry of manifest) {
    const normalized = entry.endsWith('/') ? entry.slice(0, -1) : entry;
    if (entry.endsWith('/')) {
      const details = await exists(join(loopRoot, normalized));
      if (details) {
        if (details.isSymbolicLink() || !details.isDirectory()) throw new Error(`legacy Loop runtime path is not a directory: ${normalized}`);
        await walk(join(loopRoot, normalized), normalized);
      }
    } else if (normalized !== 'package-lock.json') {
      const details = await exists(join(loopRoot, normalized));
      if (details) {
        if (details.isSymbolicLink() || !details.isFile()) throw new Error(`legacy Loop runtime path is not a regular file: ${normalized}`);
        owned.add(normalized);
      }
    }
  }
  for (const file of currentFiles) {
    const details = await exists(join(loopRoot, file));
    if (details && !owned.has(file)) {
      if (details.isSymbolicLink() || !details.isFile()) throw new Error(`legacy Loop path conflicts with runtime file: ${file}`);
    }
  }
  return checkedManagedList([...owned], 'legacy runtime');
}

async function readPendingJournal(loopRoot) {
  const path = join(loopRoot, UPDATE_JOURNAL_PATH);
  const details = await exists(path);
  if (!details) return null;
  if (details.isSymbolicLink() || !details.isFile()) throw new Error('pending update journal is not a regular file');
  let journal;
  try { journal = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { throw new Error(`cannot read pending update journal: ${error.message}`); }
  if (!journal || journal.schemaVersion !== 1 || !['runtime', 'workflow'].includes(journal.area) || typeof journal.distributionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(journal.transactionId ?? '')) {
    throw new Error('pending update journal is invalid; preserve it for diagnosis');
  }
  journal.priorManagedFiles = checkedManagedList(journal.priorManagedFiles ?? [], `${journal.area} prior`);
  journal.nextManagedFiles = checkedManagedList(journal.nextManagedFiles ?? [], `${journal.area} next`);
  return journal;
}

async function writePendingJournal(loopRoot, journal) {
  const metadataRoot = await ensureMetaDirectory(loopRoot, { create: true });
  const path = join(metadataRoot, 'update.json');
  const temporary = `${path}.tmp-${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  try { await rename(temporary, path); }
  catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function readRegularSourceFile(sourceRoot, relativePath) {
  let path = sourceRoot;
  const parts = checkedRelativePath(relativePath).split('/');
  for (let index = 0; index < parts.length; index += 1) {
    path = join(path, parts[index]);
    const details = await lstat(path);
    if (details.isSymbolicLink()) throw new Error(`distribution source contains a symlink: ${relativePath}`);
    if (index < parts.length - 1 && !details.isDirectory()) throw new Error(`distribution source parent is not a directory: ${relativePath}`);
    if (index === parts.length - 1 && !details.isFile()) throw new Error(`distribution source is not a regular file: ${relativePath}`);
  }
  return readFile(path);
}

async function validateSource(sourceRoot, { workflowOnly }) {
  let distributionRoot;
  try { distributionRoot = await realpath(sourceRoot); }
  catch { throw new Error(`cannot access installed leesh-loop distribution: ${sourceRoot}`); }
  let sourcePackage;
  try { sourcePackage = JSON.parse((await readRegularSourceFile(distributionRoot, 'package.json')).toString('utf8')); }
  catch { throw new Error('installed leesh-loop distribution has no valid package.json'); }
  if (typeof sourcePackage.version !== 'string' || !sourcePackage.version) throw new Error('installed leesh-loop distribution has no package version');
  if (workflowOnly) {
    const template = (await readRegularSourceFile(distributionRoot, 'docs/WORKFLOW_TEMPLATE.md')).toString('utf8');
    return { distributionRoot, sourcePackage, files: [], entries: [], workflow: generatedWorkflow(template) };
  }
  const files = listRuntimeSnapshotFiles(distributionRoot);
  if (!files.length) throw new Error('runtime snapshot manifest selected no files');
  const entries = await readDistributionFiles(distributionRoot, files);
  return { distributionRoot, sourcePackage, files, entries, workflow: null };
}

function makeGeneratedPackage(existingManifest, sourceVersion) {
  const generated = generatedPackage('loop-update');
  return {
    name: existingManifest.name,
    version: sourceVersion,
    private: true,
    scripts: generated.scripts
  };
}

function currentDistributionId(sourcePackage, entries) {
  return hashDistribution(sourcePackage.version, entries);
}

async function verifyPreflight(loopRoot, { priorFiles, nextFiles, pending }) {
  const prior = new Set(priorFiles);
  const next = new Set(nextFiles);
  const allowedMissing = new Set(pending ? [...prior, ...next] : []);
  for (const file of prior) {
    await ensureNoSymlink(loopRoot, file, { allowMissingTarget: allowedMissing.has(file) || next.has(file) });
  }
  for (const file of next) {
    const details = await ensureNoSymlink(loopRoot, file, { allowMissingTarget: true });
    if (details && !prior.has(file) && !pending) throw new Error(`runtime path collides with an unmanaged file: ${file}`);
  }
}

async function preflightWorkflow(loopRoot, { priorFiles, pending }) {
  const current = await ensureNoSymlink(loopRoot, 'WORKFLOW.md', { allowMissingTarget: true });
  if (!current && !pending) throw new Error('generated Loop WORKFLOW.md is missing');
  if (priorFiles.length && !priorFiles.includes('WORKFLOW.md')) throw new Error('installation metadata does not own WORKFLOW.md');
}

async function createStage(loopRoot, journal, files, outputEntries) {
  const metadataRoot = await ensureMetaDirectory(loopRoot, { create: true });
  const stageRoot = join(metadataRoot, `stage-${journal.transactionId}`);
  const existing = await exists(stageRoot);
  if (existing) {
    if (existing.isSymbolicLink() || !existing.isDirectory()) throw new Error('pending update staging path is unsafe');
    await rm(stageRoot, { recursive: true, force: true });
  }
  await mkdir(stageRoot, { mode: 0o700 });
  const contentByPath = new Map(outputEntries.map(([path, content, mode]) => [path, { content, mode }]));
  for (const file of files) {
    const staged = join(stageRoot, file);
    await mkdir(dirname(staged), { recursive: true });
    const entry = contentByPath.get(file);
    if (!entry) throw new Error(`verified runtime source omitted managed file: ${file}`);
    await writeFile(staged, entry.content, { mode: entry.mode ?? 0o644, flag: 'wx' });
    await chmod(staged, entry.mode ?? 0o644);
  }
  return stageRoot;
}

async function pruneEmptyParents(loopRoot, relativePath) {
  let directory = dirname(join(loopRoot, relativePath));
  while (directory !== loopRoot && directory.startsWith(`${loopRoot}${sep}`)) {
    try {
      const details = await lstat(directory);
      if (details.isSymbolicLink() || !details.isDirectory()) return;
      if ((await readdir(directory)).length) return;
      await rmdir(directory);
      directory = dirname(directory);
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTEMPTY' || error?.code === 'EEXIST') return;
      throw error;
    }
  }
}

async function ensureSafeParents(loopRoot, relativePath) {
  const parts = checkedRelativePath(relativePath).split('/').slice(0, -1);
  let current = loopRoot;
  for (const part of parts) {
    current = join(current, part);
    let details = await exists(current);
    if (!details) {
      try { await mkdir(current); }
      catch (error) { if (error?.code !== 'EEXIST') throw error; }
      details = await lstat(current);
    }
    if (details.isSymbolicLink() || !details.isDirectory()) throw new Error(`managed path parent is unsafe: ${relative(loopRoot, current).split(sep).join('/')}`);
  }
}

async function applyFiles(loopRoot, journal, files, outputEntries) {
  const stageRoot = await createStage(loopRoot, journal, files, outputEntries);
  for (const file of files) {
    const destination = join(loopRoot, file);
    await ensureSafeParents(loopRoot, file);
    await ensureNoSymlink(loopRoot, file, { allowMissingTarget: true });
    const staged = join(stageRoot, file);
    await rename(staged, destination);
  }
  const next = new Set(files);
  for (const oldFile of journal.priorManagedFiles) {
    if (next.has(oldFile)) continue;
    const destination = await ensureNoSymlink(loopRoot, oldFile, { allowMissingTarget: true });
    if (destination) {
      await rm(destination);
      await pruneEmptyParents(loopRoot, oldFile);
    }
  }
  await rm(stageRoot, { recursive: true, force: true });
}

function updateMetadataFor(metadata, area, distributionId, managedFiles) {
  return createInstallationMetadata({
    installationId: metadata?.installationId,
    runtime: area === 'runtime' ? { distributionId, managedFiles } : metadata?.runtime,
    workflow: area === 'workflow' ? { distributionId, managedFiles } : metadata?.workflow
  });
}

async function applyArea(loopRoot, metadata, area, distributionId, priorManagedFiles, nextManagedFiles, apply) {
  const pending = await readPendingJournal(loopRoot);
  let journal;
  if (pending) {
    if (pending.area !== area || pending.distributionId !== distributionId || pending.nextManagedFiles.join('\0') !== nextManagedFiles.join('\0')) {
      throw new Error(`an incomplete ${pending.area} update must be retried with its original installed distribution`);
    }
    const currentRecord = metadata?.[area];
    if (currentRecord && currentRecord.distributionId !== pending.distributionId && currentRecord.distributionId !== pending.previousDistributionId) {
      throw new Error('installation metadata changed during an incomplete update; preserve it for diagnosis');
    }
    journal = pending;
  } else {
    journal = {
      schemaVersion: 1,
      area,
      distributionId,
      previousDistributionId: metadata?.[area]?.distributionId ?? null,
      priorManagedFiles: checkedManagedList(priorManagedFiles, `${area} prior`),
      nextManagedFiles: checkedManagedList(nextManagedFiles, `${area} next`),
      transactionId: randomUUID()
    };
    await writePendingJournal(loopRoot, journal);
  }
  if (area === 'runtime') {
    await applyFiles(loopRoot, journal, nextManagedFiles, apply.outputEntries);
  } else {
    const stageRoot = await createStage(loopRoot, journal, ['WORKFLOW.md'], [['WORKFLOW.md', apply.workflow, 0o644]]);
    await ensureNoSymlink(loopRoot, 'WORKFLOW.md', { allowMissingTarget: true });
    await rename(join(stageRoot, 'WORKFLOW.md'), join(loopRoot, 'WORKFLOW.md'));
    await rm(stageRoot, { recursive: true, force: true });
  }
  const nextMetadata = updateMetadataFor(metadata, area, distributionId, nextManagedFiles);
  await writeInstallationMetadata(loopRoot, nextMetadata);
  await rm(join(loopRoot, UPDATE_JOURNAL_PATH), { force: true });
  return { metadata: nextMetadata, journal };
}

export async function updateLoop({ cwd = process.cwd(), sourceRoot, workflowOnly = false } = {}) {
  if (!sourceRoot) throw new Error('Leesh Loop could not find its installed files; reinstall or relink it, then retry');
  const target = await validateGeneratedLoop(cwd);
  const source = await validateSource(sourceRoot, { workflowOnly });
  const pending = await readPendingJournal(target.loopRoot);
  if (pending) {
    validateAgainstProject(target.loopRoot, target.project, pending.priorManagedFiles, pending.area);
    validateAgainstProject(target.loopRoot, target.project, pending.nextManagedFiles, pending.area);
  }
  const area = workflowOnly ? 'workflow' : 'runtime';

  if (workflowOnly) {
    const workflowDistributionId = hashDistribution(source.sourcePackage.version, [['WORKFLOW.md', source.workflow]]);
    const priorFiles = pending?.area === 'workflow' ? pending.priorManagedFiles : target.metadata?.workflow?.managedFiles ?? [];
    if (!pending) await preflightWorkflow(target.loopRoot, { priorFiles, pending: false });
    else if (pending.area !== 'workflow' || pending.distributionId !== workflowDistributionId) {
      throw new Error('an incomplete update must be retried in the same mode from the same distribution');
    }
    const result = await applyArea(target.loopRoot, target.metadata, 'workflow', workflowDistributionId, priorFiles, ['WORKFLOW.md'], {
      workflow: source.workflow
    });
    return { area, distributionId: workflowDistributionId, metadata: result.metadata };
  }

  const distributionEntries = source.entries.map(([file, content, mode]) => [file, content, mode]);
  const currentPackage = makeGeneratedPackage(target.packageManifest, source.sourcePackage.version);
  const packageContent = `${JSON.stringify(currentPackage, null, 2)}\n`;
  const lockContent = stringifyPackageLock(currentPackage);
  const entryMap = new Map(distributionEntries.map(([file, content, mode]) => [file, [file, content, mode]]));
  entryMap.set('package.json', ['package.json', Buffer.from(packageContent), 0o644]);
  entryMap.set('package-lock.json', ['package-lock.json', Buffer.from(lockContent), 0o644]);
  const outputEntries = [...entryMap.values()].sort(([left], [right]) => left.localeCompare(right));
  const distributionId = currentDistributionId(source.sourcePackage, outputEntries);
  const currentFiles = checkedManagedList(source.files, 'runtime');
  const priorFiles = pending?.area === 'runtime'
    ? pending.priorManagedFiles
    : target.metadata?.runtime?.managedFiles ?? await collectLegacyManagedFiles(target.loopRoot, currentFiles);
  if (pending && (pending.area !== 'runtime' || pending.distributionId !== distributionId)) throw new Error('an incomplete update must be retried in the same mode from the same distribution');
  await verifyPreflight(target.loopRoot, { priorFiles, nextFiles: currentFiles, pending: Boolean(pending) });
  const result = await applyArea(target.loopRoot, target.metadata, 'runtime', distributionId, priorFiles, currentFiles, {
    outputEntries
  });
  return { area, distributionId, metadata: result.metadata };
}
