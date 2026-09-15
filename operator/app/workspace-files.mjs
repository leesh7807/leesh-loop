import { copyFile, lstat, realpath } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';

const under = (path, root) => {
  const relation = relative(root, path);
  return relation && !relation.startsWith('..') && !isAbsolute(relation);
};

async function regularFile(path, label) {
  let details;
  try { details = await lstat(path); } catch { throw new Error(`${label} does not exist: ${path}`); }
  if (!details.isFile()) throw new Error(`${label} is not a regular file: ${path}`);
}

function normalizeWorkspaceFiles(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('workspace_files must be an array of absolute paths');
  const normalized = value.map((source, index) => {
    if (typeof source !== 'string' || !source) throw new Error(`workspace_files[${index}] must be an absolute path`);
    if (!isAbsolute(source)) throw new Error(`workspace_files[${index}] must be an absolute path: ${source}`);
    return resolve(source);
  });
  const destinations = new Set();
  for (const source of normalized) {
    const destination = basename(source);
    if (destinations.has(destination)) throw new Error(`workspace_files have conflicting destination basename: ${destination}`);
    destinations.add(destination);
  }
  return normalized;
}

async function validateWorkspaceFiles(value) {
  const sources = normalizeWorkspaceFiles(value);
  await Promise.all(sources.map(source => regularFile(source, 'workspace file source')));
  return sources;
}

async function materializeWorkspaceFiles(workspacePath, sources, workspaceRoot = process.env.SYMPHONY_WORKSPACE_ROOT) {
  if (typeof workspaceRoot !== 'string' || !workspaceRoot || !isAbsolute(workspaceRoot)) throw new Error('SYMPHONY_WORKSPACE_ROOT must be an absolute path');
  const normalized = normalizeWorkspaceFiles(sources);
  const [canonicalRoot, canonicalWorkspace] = await Promise.all([realpath(workspaceRoot), realpath(workspacePath)]);
  if (!under(canonicalWorkspace, canonicalRoot)) throw new Error(`workspace is outside SYMPHONY_WORKSPACE_ROOT: ${workspacePath}`);
  for (const source of normalized) {
    await regularFile(source, 'workspace file source');
    const destination = resolve(canonicalWorkspace, basename(source));
    if (!under(destination, canonicalWorkspace)) throw new Error(`workspace destination is unsafe: ${destination}`);
    try {
      await copyFile(source, destination, 1);
    } catch (error) {
      if (error?.code === 'EEXIST') throw new Error(`workspace destination already exists: ${destination}`);
      throw error;
    }
  }
}

async function main() {
  const [workspacePath] = process.argv.slice(2);
  if (!workspacePath) throw new Error('Usage: workspace-files.mjs <workspace-path>');
  let sources;
  try { sources = JSON.parse(process.env.LEESH_LOOP_WORKSPACE_FILES || '[]'); } catch { throw new Error('LEESH_LOOP_WORKSPACE_FILES must be JSON'); }
  await materializeWorkspaceFiles(workspacePath, sources);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => { console.error(`Workspace file materialization failed: ${error.message}`); process.exitCode = 1; });
}

export { materializeWorkspaceFiles, normalizeWorkspaceFiles, validateWorkspaceFiles };
