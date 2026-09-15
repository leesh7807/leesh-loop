import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { loadConfig } from "./config.js";
import { PublicationError } from "./core.js";
import { NotionClient } from "./notion.js";
import { publish, type PublishResult } from "./publisher.js";

export async function publishPlanFile(planPath: string, configPath: string, databaseUrl: string, client: NotionClient): Promise<PublishResult> {
  const plan = await readFile(planPath, "utf8");
  const { policy } = await loadConfig(configPath);
  return publish({ plan, databaseUrl, fallbackTitle: basename(planPath), client, config: { policy } });
}

async function localEnvironment(): Promise<Record<string, string>> {
  try {
    const env = await readFile(resolve(process.cwd(), ".env"), "utf8");
    return Object.fromEntries(env.split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      return match ? [[match[1], match[2].trim().replace(/^['"]|['"]$/g, "")]] : [];
    }));
  } catch { return {}; }
}

function environmentValue(name: string, local: Record<string, string>): string | undefined {
  return Object.prototype.hasOwnProperty.call(process.env, name) ? process.env[name] : local[name];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const get = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
  const planArg = get("--plan"), configArg = get("--config"), databaseUrl = get("--database-url");
  if (!planArg || !configArg || !databaseUrl) throw new PublicationError("usage: notion-plan-publisher --plan PATH --config PATH --database-url URL");
  const local = await localEnvironment();
  const token = environmentValue("NOTION_TOKEN", local);
  if (!token) throw new PublicationError("missing NOTION_TOKEN");
  console.log(JSON.stringify(await publishPlanFile(resolve(planArg), resolve(configArg), databaseUrl, new NotionClient(token))));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(`publisher error: ${error instanceof Error ? error.message : error}`); process.exitCode = 2; });
}
