import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function readRepositoryEnvironmentValue(name, { environment = process.env, envFile = join(repositoryRoot, '.env') } = {}) {
  const value = environment[name];
  if (typeof value === 'string' && value.trim()) return value.trim();
  try {
    const contents = await readFile(envFile, 'utf8');
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (match?.[1] === name) return match[2].trim().replace(/^['"]|['"]$/g, '');
    }
  } catch { /* environment-only deployments do not need a local .env */ }
  return undefined;
}
