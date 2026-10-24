import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { resolveTargetRepository } from './git-target.mjs';
import { generatedWorkflow } from './workflow-template.mjs';
import { stringifyProjectConfiguration } from '../project-config.mjs';
import { openLoopTaskStore } from './local-task-store-runtime.mjs';

const missing = error => error?.code === 'ENOENT';
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function xdgPath(environment, key, fallback, homeDirectory) {
  const value = environment[key] || join(homeDirectory, fallback);
  if (!isAbsolute(value)) throw new Error(`${key} must be an absolute path`);
  return resolve(value);
}

export function managerPaths({ environment = process.env, homeDirectory = homedir() } = {}) {
  const dataHome = xdgPath(environment, 'XDG_DATA_HOME', '.local/share', homeDirectory);
  const stateHome = xdgPath(environment, 'XDG_STATE_HOME', '.local/state', homeDirectory);
  const configHome = xdgPath(environment, 'XDG_CONFIG_HOME', '.config', homeDirectory);
  const dataRoot = join(dataHome, 'leesh-loop');
  const stateRoot = join(stateHome, 'leesh-loop');
  const configRoot = join(configHome, 'leesh-loop');
  return {
    dataRoot,
    instancesRoot: join(dataRoot, 'instances'),
    instanceRegistry: join(dataRoot, 'instances.json'),
    runtimeRoot: join(dataRoot, 'runtimes'),
    stateRoot,
    executionRoot: join(stateRoot, 'executions'),
    loopExecutionRoot: join(stateRoot, 'loops'),
    managerStateRoot: join(stateRoot, 'manager'),
    managerServiceRecord: join(stateRoot, 'manager', 'service.json'),
    managerToken: join(stateRoot, 'manager', 'token'),
    managerApiMaster: join(stateRoot, 'manager', 'api-master'),
    managerBrowserBootstrap: join(stateRoot, 'manager', 'browser-bootstrap.html'),
    managerLog: join(stateRoot, 'manager', 'manager.log'),
    configRoot,
    activeRuntime: join(configRoot, 'active-runtime.json'),
    runtimeSource: join(configRoot, 'runtime-source.json'),
    managerConfiguration: join(configRoot, 'manager.json')
  };
}

export async function ensurePrivateDirectory(path) {
  const absolute = resolve(path);
  const parts = absolute.split(sep).filter(Boolean);
  let current = sep;
  for (let index = 0; index < parts.length; index += 1) {
    current = join(current, parts[index]);
    let details;
    try { details = await lstat(current); }
    catch (error) {
      if (!missing(error)) throw error;
      try { await mkdir(current, { mode: 0o700 }); }
      catch (createError) { if (createError?.code !== 'EEXIST') throw createError; }
      details = await lstat(current);
    }
    if (details.isSymbolicLink() || !details.isDirectory()) throw new Error(`managed directory must be a real directory: ${current}`);
    if (index === parts.length - 1) await chmod(current, 0o700);
  }
  return absolute;
}

export async function writeAtomic(path, contents, mode = 0o600) {
  await ensurePrivateDirectory(join(path, '..'));
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, mode);
  try {
    await file.writeFile(contents);
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(temporary, path);
    const directory = await open(join(path, '..'), constants.O_RDONLY);
    try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export async function writeAtomicJson(path, value) {
  await writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJsonFile(path, label = 'managed record') {
  let details;
  try { details = await lstat(path); }
  catch (error) { if (missing(error)) return null; throw error; }
  if (details.isSymbolicLink() || !details.isFile()) throw new Error(`${label} must be a regular file: ${path}`);
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { throw new Error(`cannot read ${label}: ${error.message}`); }
}

function validInstance(value, id, instancesRoot) {
  if (!value || value.schema_version !== 1 || value.id !== id || !idPattern.test(id)) return false;
  if (typeof value.repository_root !== 'string' || !isAbsolute(value.repository_root)) return false;
  if (typeof value.data_directory !== 'string' || !isAbsolute(value.data_directory)) return false;
  if (resolve(value.data_directory) !== join(instancesRoot, id)) return false;
  if (typeof value.repository_name !== 'string' || value.repository_name !== basename(value.repository_root)) return false;
  return typeof value.repository_url === 'string' && typeof value.base_branch === 'string';
}

async function readRegistry(paths) {
  const registry = await readJsonFile(paths.instanceRegistry, 'Loop instance registry');
  if (!registry) return { schema_version: 1, instances: [] };
  if (registry.schema_version !== 1 || !Array.isArray(registry.instances)) throw new Error('Loop instance registry is invalid');
  const seen = new Set();
  for (const instance of registry.instances) {
    if (!validInstance(instance, instance.id, paths.instancesRoot) || seen.has(instance.id)) throw new Error('Loop instance registry contains an invalid or duplicate record');
    seen.add(instance.id);
  }
  return registry;
}

export async function listLoopInstances(options = {}) {
  const paths = managerPaths(options);
  const registry = await readRegistry(paths);
  return registry.instances.map(instance => ({ ...instance }));
}

export async function getLoopInstance(id, options = {}) {
  if (typeof id !== 'string' || !idPattern.test(id)) throw Object.assign(new Error('Instance ID is invalid.'), { status: 400 });
  const paths = managerPaths(options);
  const registry = await readRegistry(paths);
  const instance = registry.instances.find(value => value.id === id);
  if (!instance) throw Object.assign(new Error('Loop instance was not found.'), { status: 404 });
  const details = await lstat(instance.data_directory);
  if (details.isSymbolicLink() || !details.isDirectory()) throw new Error(`instance data directory is unsafe: ${instance.data_directory}`);
  return { ...instance, project_file: join(instance.data_directory, 'project.toml'), workflow_file: join(instance.data_directory, 'WORKFLOW.md'), state_directory: join(instance.data_directory, 'state'), workspace_root: join(instance.data_directory, 'workspaces') };
}

export async function createLoopInstance(repositoryPath, { sourceRoot, environment = process.env, homeDirectory = homedir() } = {}) {
  if (typeof repositoryPath !== 'string' || !repositoryPath.trim()) throw Object.assign(new Error('Repository path is required.'), { status: 400 });
  if (!sourceRoot) throw new Error('Leesh Loop Runtime source is unavailable.');
  const paths = managerPaths({ environment, homeDirectory });
  await Promise.all([ensurePrivateDirectory(paths.dataRoot), ensurePrivateDirectory(paths.instancesRoot), ensurePrivateDirectory(paths.configRoot)]);
  const target = await resolveTargetRepository(repositoryPath);
  const registry = await readRegistry(paths);
  if (registry.instances.some(value => value.repository_root === target.repositoryRoot)) {
    throw Object.assign(new Error(`This Git repository is already managed as ${registry.instances.find(value => value.repository_root === target.repositoryRoot).id}.`), { status: 409 });
  }
  const id = randomUUID();
  const dataDirectory = join(paths.instancesRoot, id);
  await mkdir(dataDirectory, { mode: 0o700 });
  let committed = false;
  try {
    const project = {
      workflow_path: 'WORKFLOW.md',
      symphony_workspace_root: join(dataDirectory, 'workspaces'),
      state_directory: join(dataDirectory, 'state'),
      github_repository_url: target.remoteUrl,
      github_base_branch: target.upstreamBranch,
      codex_model: 'gpt-6-luna',
      codex_reasoning_effort: 'xhigh',
      workspace_files: []
    };
    const workflowTemplate = await readFile(join(sourceRoot, 'docs/WORKFLOW_TEMPLATE.md'), 'utf8');
    const workflow = generatedWorkflow(workflowTemplate);
    const projectFile = join(dataDirectory, 'project.toml');
    const workflowFile = join(dataDirectory, 'WORKFLOW.md');
    await writeFile(projectFile, stringifyProjectConfiguration(project), { mode: 0o600, flag: 'wx' });
    await writeFile(workflowFile, workflow, { mode: 0o600, flag: 'wx' });
    await ensurePrivateDirectory(project.state_directory);
    await ensurePrivateDirectory(project.symphony_workspace_root);
    const instance = {
      schema_version: 1,
      id,
      repository_root: target.repositoryRoot,
      repository_name: target.repositoryName,
      repository_url: target.remoteUrl,
      base_branch: target.upstreamBranch,
      data_directory: dataDirectory,
      created_at: new Date().toISOString()
    };
    const store = await openLoopTaskStore(project.state_directory);
    store.close();
    registry.instances.push(instance);
    await writeAtomicJson(paths.instanceRegistry, registry);
    committed = true;
    return { ...instance, status: 'Stopped' };
  } finally {
    if (!committed) await rm(dataDirectory, { recursive: true, force: true });
  }
}

export async function readInstanceWorkflow(id, { sourceRoot, ...options } = {}) {
  const paths = managerPaths(options);
  const instance = await getLoopInstance(id, options);
  const current = await readFile(instance.workflow_file, 'utf8');
  const candidate = generatedWorkflow(await readFile(join(sourceRoot, 'docs/WORKFLOW_TEMPLATE.md'), 'utf8'));
  const candidateDigest = createHash('sha256').update(candidate, 'utf8').digest('hex');
  return { current, candidate, candidate_digest: candidateDigest, changed: current !== candidate };
}

export async function applyInstanceWorkflow(id, { expectedCurrent, expectedCandidateDigest, sourceRoot, isRunning, ...options } = {}) {
  const instance = await getLoopInstance(id, options);
  if (await isRunning(id)) throw Object.assign(new Error('Stop this Loop before updating its Workflow.'), { status: 409 });
  const current = await readFile(instance.workflow_file, 'utf8');
  if (typeof expectedCurrent !== 'string' || current !== expectedCurrent) throw Object.assign(new Error('Workflow changed since it was reviewed. Refresh the comparison before applying.'), { status: 409 });
  const candidate = generatedWorkflow(await readFile(join(sourceRoot, 'docs/WORKFLOW_TEMPLATE.md'), 'utf8'));
  if (typeof expectedCandidateDigest !== 'string' || !/^[0-9a-f]{64}$/.test(expectedCandidateDigest)) {
    throw Object.assign(new Error('Workflow comparison digest is missing or invalid. Refresh the comparison before applying.'), { status: 400 });
  }
  const candidateDigest = createHash('sha256').update(candidate, 'utf8').digest('hex');
  if (candidateDigest !== expectedCandidateDigest) {
    throw Object.assign(new Error('Workflow template changed since it was reviewed. Refresh the comparison before applying.'), { status: 409 });
  }
  if (current === candidate) return { updated: false, changed: false };
  const backupDirectory = join(instance.data_directory, 'workflow-backups');
  await ensurePrivateDirectory(backupDirectory);
  const backupPath = join(backupDirectory, `${new Date().toISOString().replaceAll(':', '-')}.md`);
  await writeFile(backupPath, current, { mode: 0o600, flag: 'wx' });
  await writeAtomic(instance.workflow_file, candidate, 0o600);
  return { updated: true, changed: true, backup: backupPath };
}
