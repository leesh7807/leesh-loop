#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { readConfig, pageIdFromUrl } from './config.js';
import { identifierFromPlan, titleFromPlan } from './metadata.js';
import { bootstrap, getParent, notionClient, publishTask, queryByIdentifier } from './notion.js';

function arg(name: string) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }
async function main() {
  dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env') });
  const planPath = arg('--plan'); const configPath = arg('--config');
  if (!planPath || !configPath) throw new Error('Usage: plan-publish --plan <path> --config <path>');
  const plan = await fs.readFile(path.resolve(planPath), 'utf8');
  const { config, policy } = await readConfig(configPath);
  const identifier = identifierFromPlan(planPath); const title = titleFromPlan(plan);
  const token = process.env.NOTION_TOKEN ?? '';
  const api = notionClient(token); const parentId = pageIdFromUrl(config.parentUrl);
  await getParent(api, parentId);
  const dataSource = await bootstrap(api, parentId, policy);
  const duplicates = await queryByIdentifier(api, dataSource.id, policy.properties.identifier, identifier);
  if (duplicates.length) throw new Error(`duplicate publication: ${identifier}`);
  const page = await publishTask(api, dataSource.id, policy, { title, identifier, state: policy.defaultState, priority: policy.defaultPriority, labels: policy.defaultLabels, planSource: config.planSource ?? null }, plan);
  console.log(JSON.stringify({ id: page.id, identifier, title, url: page.url }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
