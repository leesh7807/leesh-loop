import { execFileSync } from 'node:child_process';
import { chmod, copyFile, lstat, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';

// This is the only source-tree selection authority for a generated Loop.
// Trailing slashes select tracked files beneath a runtime directory; exact
// paths select individual runtime files. Tests, docs, E2E output, and source
// development files stay outside this list.
export const RUNTIME_SNAPSHOT_PATHS = Object.freeze([
  'package.json',
  'package-lock.json',
  'operator/app/leesh-loop.mjs',
  'operator/app/operator-bootstrap',
  'operator/app/operator-ui-server.mjs',
  'operator/app/owned-symphony',
  'operator/app/run-symphony',
  'operator/app/workspace-files.mjs',
  'operator/app/git-target.mjs',
  'operator/app/github-repository-url.mjs',
  'operator/app/prepare-runtime.mjs',
  'operator/external/chatgpt-shot/chatgpt-shot',
  'operator/local-environment.mjs',
  'operator/local-path.mjs',
  'operator/project-config.mjs',
  'operator/project-defaults.mjs',
  'operator/app/vendor/smol-toml/LICENSE',
  'operator/app/vendor/smol-toml/index.cjs',
  'operator/notion_publisher/package.json',
  'operator/notion_publisher/package-lock.json',
  'operator/notion_publisher/tsconfig.json',
  'operator/notion_publisher/examples/publisher-config.json',
  'operator/notion_publisher/src/',
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

export function listRuntimeSnapshotFiles(sourceRoot) {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: sourceRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean)
    .map(file => file.replaceAll('\\', '/'));
  const manifest = RUNTIME_SNAPSHOT_PATHS.map(checkedRelativePath);
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
