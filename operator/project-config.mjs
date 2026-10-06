import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import toml from './app/vendor/smol-toml/index.cjs';
import { normalizeWorkspaceFiles, validateWorkspaceFiles } from './app/workspace-files.mjs';
import { resolveProjectPath } from './local-path.mjs';
import { PROJECT_DEFAULTS } from './project-defaults.mjs';

const { parse, stringify } = toml;

const REQUIRED_STRING_SETTINGS = Object.freeze([
  'workflow_path',
  'symphony_workspace_root',
  'github_repository_url',
  'github_base_branch'
]);
const OPTIONAL_STRING_SETTINGS = Object.freeze([
  'codex_model',
  'codex_reasoning_effort',
  'state_directory',
  'symphony_command'
]);
const OPTIONAL_BOOLEAN_SETTINGS = Object.freeze([
  'skip_external_readiness',
  'open_project_surfaces',
  'allow_workspace_root_inside_repository'
]);
const OPTIONAL_POSITIVE_INTEGER_SETTINGS = Object.freeze([
  'startup_timeout_ms',
  'browser_acknowledgement_timeout_ms'
]);
const PORT_SETTINGS = Object.freeze(['symphony_port', 'ui_port']);

export function parseProjectToml(source, sourcePath = 'project.toml') {
  try {
    return parse(source, { integersAsBigInt: 'asNeeded' });
  } catch (error) {
    throw new Error(`invalid Project TOML at ${sourcePath}: ${error.message}`);
  }
}

export function validateProjectConfiguration(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Project TOML must contain a top-level table');
  }
  for (const key of REQUIRED_STRING_SETTINGS) {
    if (typeof config[key] !== 'string' || !config[key].trim()) throw new Error(`project configuration requires ${key}`);
  }
  for (const key of OPTIONAL_STRING_SETTINGS) {
    if (config[key] !== undefined && (typeof config[key] !== 'string' || !config[key].trim())) {
      throw new Error(`${key} must be a non-empty string`);
    }
  }
  for (const key of OPTIONAL_BOOLEAN_SETTINGS) {
    if (config[key] !== undefined && typeof config[key] !== 'boolean') throw new Error(`${key} must be a boolean`);
  }
  for (const key of OPTIONAL_POSITIVE_INTEGER_SETTINGS) {
    if (config[key] !== undefined && (!Number.isSafeInteger(config[key]) || config[key] <= 0)) {
      throw new Error(`${key} must be a positive integer`);
    }
  }
  for (const key of PORT_SETTINGS) {
    if (config[key] !== undefined && (!Number.isInteger(config[key]) || config[key] < 1 || config[key] > 65535)) {
      throw new Error(`${key} must be an integer between 1 and 65535`);
    }
  }
  const symphonyPort = config.symphony_port ?? PROJECT_DEFAULTS.symphony_port;
  const uiPort = config.ui_port ?? PROJECT_DEFAULTS.ui_port;
  if (symphonyPort === uiPort) throw new Error('symphony_port and ui_port must be different');
  if (config.workspace_files !== undefined && !Array.isArray(config.workspace_files)) {
    throw new Error('workspace_files must be an array of paths');
  }
  if (config.workspace_files?.some(source => typeof source !== 'string' || !source)) {
    const index = config.workspace_files.findIndex(source => typeof source !== 'string' || !source);
    throw new Error(`workspace_files[${index}] must be a non-empty path`);
  }
  return config;
}

export async function readProjectConfiguration(file, {
  validateWorkspaceFileSources = false,
  homeDirectory
} = {}) {
  const configurationPath = resolve(file);
  let source;
  try {
    source = await readFile(configurationPath, 'utf8');
  } catch {
    throw new Error(`missing or invalid project configuration: ${file}`);
  }
  const config = validateProjectConfiguration(parseProjectToml(source, configurationPath));
  const projectDirectory = dirname(configurationPath);
  const workspaceFiles = normalizeWorkspaceFiles(config.workspace_files, projectDirectory, homeDirectory);
  if (validateWorkspaceFileSources) await validateWorkspaceFiles(workspaceFiles);
  return {
    ...config,
    symphony_port: config.symphony_port ?? PROJECT_DEFAULTS.symphony_port,
    ui_port: config.ui_port ?? PROJECT_DEFAULTS.ui_port,
    startup_timeout_ms: config.startup_timeout_ms ?? PROJECT_DEFAULTS.startup_timeout_ms,
    browser_acknowledgement_timeout_ms: config.browser_acknowledgement_timeout_ms ?? PROJECT_DEFAULTS.browser_acknowledgement_timeout_ms,
    open_project_surfaces: config.open_project_surfaces ?? PROJECT_DEFAULTS.open_project_surfaces,
    skip_external_readiness: config.skip_external_readiness === true,
    workflow_path: resolveProjectPath(config.workflow_path, projectDirectory, homeDirectory),
    symphony_workspace_root: resolveProjectPath(config.symphony_workspace_root, projectDirectory, homeDirectory),
    workspace_files: workspaceFiles,
    ...(config.state_directory === undefined ? {} : { state_directory: resolveProjectPath(config.state_directory, projectDirectory, homeDirectory) }),
    ...(config.symphony_command === undefined ? {} : { symphony_command: resolveProjectPath(config.symphony_command, projectDirectory, homeDirectory) }),
    configuration_path: configurationPath
  };
}

export function stringifyProjectConfiguration(config) {
  return `${stringify(validateProjectConfiguration(config)).trimEnd()}\n`;
}

export async function writeProjectConfiguration(file, config, { mode = 0o600 } = {}) {
  const path = resolve(file);
  await writeFile(path, stringifyProjectConfiguration(config), { mode });
  return path;
}
