import { execFileSync } from 'node:child_process';
import { chmod, copyFile, lstat, mkdir } from 'node:fs/promises';
import { lstatSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve, sep } from 'node:path';

// This is the only source-tree selection authority for a versioned central Runtime.
// Trailing slashes select tracked files beneath a runtime directory; exact
// paths select individual runtime files. Tests, E2E output, and development
// artifacts stay outside this list.
export const RUNTIME_SNAPSHOT_PATHS = Object.freeze([
  'package.json',
  'package-lock.json',
  'bin/leesh-loop.mjs',
  'docs/WORKFLOW_TEMPLATE.md',
  'operator/app/leesh-loop.mjs',
  'operator/app/workflow-template.mjs',
  'operator/app/installation-metadata.mjs',
  'operator/app/runtime-manifest.mjs',
  'operator/app/manager-storage.mjs',
  'operator/app/manager-lifecycle.mjs',
  'operator/app/runtime-distribution.mjs',
  'operator/app/manager-service.mjs',
  'operator/app/manager.mjs',
  'operator/app/operator-bootstrap',
  'operator/app/operator-ui-server.mjs',
  'operator/app/owned-symphony',
  'operator/app/run-symphony',
  'operator/app/workspace-files.mjs',
  'operator/app/git-target.mjs',
  'operator/app/github-repository-url.mjs',
  'operator/app/dependency-preparation.mjs',
  'operator/app/local-task-store-runtime.mjs',
  'operator/external/chatgpt-shot/chatgpt-shot',
  'operator/local-environment.mjs',
  'operator/local-path.mjs',
  'operator/project-config.mjs',
  'operator/project-defaults.mjs',
  'operator/app/vendor/smol-toml/LICENSE',
  'operator/app/vendor/smol-toml/index.cjs',
  'operator/local_task_store/package.json',
  'operator/local_task_store/package-lock.json',
  'operator/local_task_store/src/',
  'operator/ui/package.json',
  'operator/ui/package-lock.json',
  'operator/ui/index.html',
  'operator/ui/vite.config.js',
  'operator/ui/src/',
  'operator/symphony/mix.exs',
  'operator/symphony/mix.lock',
  'operator/symphony/mise.toml',
  'operator/symphony/config/',
  'operator/symphony/lib/',
  'operator/symphony/priv/'
]);

export const HOST_PREREQUISITES = Object.freeze([
  'Linux or Unix (use WSL2 on Windows)',
  'Node.js 20.19+ or 22.12+, plus npm',
  'Git, GitHub CLI, curl, and access to the target repository',
  'mise, so the Loop can prepare its runtime dependencies',
  'Codex CLI and the configured chatgpt-shot review command'
]);

function matchesManifestPath(file, entry) {
  return entry.endsWith('/') ? file.startsWith(entry) : file === entry;
}

function checkedRelativePath(value) {
  if (typeof value !== 'string' || !value || isAbsolute(value) || value.includes('\0')) {
    throw new Error(`invalid runtime manifest path: ${String(value)}`);
  }
  const normalized = value.replaceAll('\\', '/');
  const segments = (normalized.endsWith('/') ? normalized.slice(0, -1) : normalized).split('/');
  if (segments.some(part => part === '..' || part === '.' || !part)) {
    throw new Error(`invalid runtime manifest path: ${value}`);
  }
  return normalized;
}

function listSourceTreeFiles(sourceRoot, relativePath = '') {
  const path = relativePath ? resolve(sourceRoot, relativePath) : resolve(sourceRoot);
  const details = lstatSync(path);
  if (details.isSymbolicLink()) throw new Error(`Runtime source contains a symlink: ${relativePath || '.'}`);
  if (details.isFile()) return relativePath ? [relativePath.replaceAll('\\', '/')] : [];
  if (!details.isDirectory()) throw new Error(`Runtime source contains a non-file entry: ${relativePath || '.'}`);
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    const child = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Runtime source contains a symlink: ${child}`);
    if (entry.isDirectory()) return listSourceTreeFiles(sourceRoot, child);
    if (entry.isFile()) return [child.replaceAll('\\', '/')];
    throw new Error(`Runtime source contains a non-file entry: ${child}`);
  });
}

function listInstalledPackageFiles(sourceRoot, manifest) {
  const files = [];
  for (const entry of manifest) {
    const relativePath = entry.endsWith('/') ? entry.slice(0, -1) : entry;
    const details = lstatSync(resolve(sourceRoot, relativePath));
    if (details.isSymbolicLink()) throw new Error(`Runtime source contains a symlink: ${relativePath}`);
    if (entry.endsWith('/')) {
      if (!details.isDirectory()) throw new Error(`Runtime source manifest directory is missing: ${relativePath}`);
      files.push(...listSourceTreeFiles(sourceRoot, relativePath));
    } else {
      if (!details.isFile()) throw new Error(`Runtime source manifest file is missing: ${relativePath}`);
      files.push(relativePath);
    }
  }
  return [...new Set(files)].sort();
}

export function listRuntimeSnapshotFiles(sourceRoot) {
  const manifest = RUNTIME_SNAPSHOT_PATHS.map(checkedRelativePath);
  let tracked;
  try {
    tracked = execFileSync('git', ['ls-files', '-z'], { cwd: sourceRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\0')
      .filter(Boolean)
      .map(file => file.replaceAll('\\', '/'));
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.status !== 128) throw error;
    return listInstalledPackageFiles(sourceRoot, manifest);
  }
  if (tracked.length === 0) return listInstalledPackageFiles(sourceRoot, manifest);
  const selected = tracked.filter(file => manifest.some(entry => matchesManifestPath(file, entry))).sort();
  const missing = manifest.filter(entry => !tracked.some(file => matchesManifestPath(file, entry)));
  if (missing.length) throw new Error(`runtime snapshot manifest entries are not tracked: ${missing.join(', ')}`);
  return selected;
}

export async function materializeRuntimeSnapshot(sourceRoot, destinationRoot) {
  const files = listRuntimeSnapshotFiles(sourceRoot);
  const sourceBase = resolve(sourceRoot);
  const destinationBase = resolve(destinationRoot);
  for (const relativePath of files) {
    const source = resolve(sourceBase, relativePath);
    const destination = resolve(destinationBase, relativePath);
    if (!source.startsWith(`${sourceBase}${sep}`) || !destination.startsWith(`${destinationBase}${sep}`)) {
      throw new Error(`runtime snapshot path escapes its root: ${relativePath}`);
    }
    const details = await lstat(source);
    if (!details.isFile()) throw new Error(`runtime snapshot source is not a regular file: ${relativePath}`);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    await chmod(destination, details.mode & 0o777);
  }
  return files;
}
