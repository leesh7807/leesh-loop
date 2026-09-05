import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { resolvePolicy, Policy } from './policy.js';

export type Config = { parentUrl: string; state?: string; priority?: number | null; labels?: string[]; planSource?: string | null };

export function pageIdFromUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Invalid target URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid target URL');
  const match = url.pathname.match(/([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f-]{27})/i);
  if (!match) throw new Error('Invalid target URL: no Notion page id found');
  return match[1];
}

export async function readConfig(file: string): Promise<{ config: Config; policy: Policy }> {
  const raw = await fs.readFile(path.resolve(file), 'utf8');
  const value = yaml.load(raw);
  if (!value || typeof value !== 'object') throw new Error('Missing configuration');
  const v = value as Record<string, unknown>;
  if (typeof v.parent_url !== 'string') throw new Error('Missing configuration: parent_url');
  pageIdFromUrl(v.parent_url);
  const priority = v.priority === null || v.priority === undefined ? null : Number(v.priority);
  const labels = Array.isArray(v.labels) ? v.labels.map(String) : [];
  const policy = resolvePolicy({ defaultState: v.state as string | undefined, defaultPriority: priority, defaultLabels: labels });
  return { config: { parentUrl: v.parent_url, state: policy.defaultState, priority, labels, planSource: v.plan_source == null ? null : String(v.plan_source) }, policy };
}
