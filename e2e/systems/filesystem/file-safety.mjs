import { rm } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

export function pathWithin(child, parent) {
  const childPath = resolve(child);
  const parentPath = resolve(parent);
  const suffix = relative(parentPath, childPath);
  return suffix === '' || (suffix && !suffix.startsWith('..') && !isAbsolute(suffix));
}

export async function removePath(path) {
  await rm(path, { recursive: true, force: true });
}
