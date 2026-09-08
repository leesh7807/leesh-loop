import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { buildPageBlocks, buildTaskProperties, deriveIdentifier, extractPlanTitle, loadConfig, PublicationError, PUBLISHER_PENDING_STATE, resolvePublishTarget, validatePlanTitle } from "./core.js";
import { NotionClient, pendingPublicationBlock, PENDING_PUBLICATION_MARKER } from "./notion.js";

export async function publishPlan(planPath: string, configPath: string, targetUrl: string | undefined, client: NotionClient): Promise<{ identifier: string; page_id: string; url?: string }> {
  const plan = await readFile(planPath, "utf8");
  const { config, policy } = await loadConfig(configPath);
  const target = resolvePublishTarget(targetUrl);
  const title = extractPlanTitle(plan, planPath);
  validatePlanTitle(title);
  const dataSource = await client.ensureSurface(target.parentId, policy);
  const identifier = deriveIdentifier(plan, planPath);
  const blocks = buildPageBlocks(policy, plan);
  const existing = await client.findPublication(dataSource, policy, identifier);

  if (existing) {
    if (existing.complete) throw new PublicationError(`duplicate publication: ${identifier} already exists`);
    try { await client.repairIncomplete(existing.pageId, blocks, policy); }
    catch (error) { if (error instanceof PublicationError) throw error; throw new PublicationError("provider/API failure while repairing incomplete Plan publication; retry is safe"); }
    return { identifier, page_id: existing.pageId, url: existing.url };
  }

  const properties = buildTaskProperties(policy, identifier, title, config.planSource, PUBLISHER_PENDING_STATE);
  properties[policy.description] = { rich_text: [{ type: "text", text: { content: PENDING_PUBLICATION_MARKER } }] };
  const page = await client.createTask(dataSource, properties);
  try { await client.appendBlocks(page.id, [pendingPublicationBlock()]); await client.appendBlocks(page.id, blocks); await client.finalizePublication(page.id, policy); }
  catch (error) { if (error instanceof PublicationError) throw error; throw new PublicationError("provider/API failure while publishing Plan; pending task remains retryable"); }
  return { identifier, page_id: page.id, url: page.url };
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
  const planArg = get("--plan"), configArg = get("--config");
  if (!planArg || !configArg) throw new PublicationError("usage: notion-plan-publisher --plan PATH --config PATH");
  const local = await localEnvironment();
  const token = environmentValue("NOTION_TOKEN", local);
  const targetUrl = environmentValue("NOTION_PUBLISH_TARGET_URL", local);
  if (!token) throw new PublicationError("missing NOTION_TOKEN");
  console.log(JSON.stringify(await publishPlan(resolve(planArg), resolve(configArg), targetUrl, new NotionClient(token))));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(`publisher error: ${error instanceof Error ? error.message : error}`); process.exitCode = 2; });
}
