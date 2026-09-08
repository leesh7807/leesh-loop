import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { fail } from './errors.js';

export type Config = { root: string; envPath: string; notionToken: string; databaseUrl: string };
export function repositoryRoot(start = process.cwd()): string {
  let at = resolve(start);
  while (true) {
    if (existsSync(resolve(at, '.git')) && existsSync(resolve(at, 'AGENTS.md'))) return at;
    const parent = dirname(at); if (parent === at) fail('CONFIG_INVALID', 'Could not resolve repository root.'); at = parent;
  }
}
export function loadConfig(start?: string): Config {
  const root = repositoryRoot(start); const envPath = resolve(root, '.env');
  if (!existsSync(envPath)) fail('CONFIG_INVALID', `Missing root .env at ${envPath}.`);
  const env = dotenv.parse(readFileSync(envPath));
  if (!env.NOTION_TOKEN?.trim()) fail('CONFIG_INVALID', 'NOTION_TOKEN is required in the repository-root .env.');
  if (!env.NOTION_INVOCATION_DATABASE_URL?.trim()) fail('CONFIG_INVALID', 'NOTION_INVOCATION_DATABASE_URL is required in the repository-root .env.');
  return { root, envPath, notionToken: env.NOTION_TOKEN, databaseUrl: env.NOTION_INVOCATION_DATABASE_URL };
}
export const moduleDirectory = dirname(fileURLToPath(import.meta.url));
