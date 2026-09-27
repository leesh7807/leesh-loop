import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

export function expandHomePath(value, home = homedir()) {
  if (value === '~') return home;
  if (value.startsWith('~/')) return resolve(home, value.slice(2));
  return value;
}

export function resolveProjectPath(value, projectDirectory, home = homedir()) {
  const expanded = expandHomePath(value, home);
  return isAbsolute(expanded) ? resolve(expanded) : resolve(projectDirectory, expanded);
}
