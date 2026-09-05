#!/usr/bin/env node
import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readConfig, readPlan } from "./domain.js";
import { createPublisher, PublicationError } from "./notion.js";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });

function arg(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`usage: plan-publish --plan PATH --config PATH (missing ${name})`);
  return value;
}

async function main() {
  const plan = await readPlan(arg("--plan"));
  const config = await readConfig(arg("--config"));
  const result = await createPublisher(process.env.NOTION_TOKEN ?? "", config.policy).publish(config, plan);
  console.log(JSON.stringify({ published: true, id: result.id, identifier: result.identifier, title: result.title, url: result.url }));
}

main().catch((error: unknown) => {
  const message = error instanceof PublicationError || error instanceof Error ? error.message : "publication failed";
  console.error(`plan-publish: ${message}`);
  process.exitCode = 1;
});
