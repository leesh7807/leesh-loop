import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { buildPageBlocks, buildTaskProperties, deriveIdentifier, extractPlanTitle, loadConfig, PublicationError, validatePlanTitle } from "./core.js";
import { NotionClient, pendingPublicationBlock, PENDING_PUBLICATION_MARKER } from "./notion.js";

export async function publishPlan(planPath: string, configPath: string, client: NotionClient): Promise<{ identifier: string; page_id: string; url?: string }> {
  const plan = await readFile(planPath, "utf8");
  const { config, policy } = await loadConfig(configPath);
  const title = extractPlanTitle(plan, planPath);
  validatePlanTitle(title);
  const dataSource = await client.ensureSurface(config.parentId, policy);
  const identifier = deriveIdentifier(plan, planPath);
  const blocks = buildPageBlocks(policy, plan);
  const existing = await client.findPublication(dataSource, policy, identifier);

  if (existing) {
    if (existing.complete) throw new PublicationError(`duplicate publication: ${identifier} already exists`);
    try { await client.repairIncomplete(existing.pageId, blocks, policy); }
    catch (error) { if (error instanceof PublicationError) throw error; throw new PublicationError("provider/API failure while repairing incomplete Plan publication; retry is safe"); }
    return { identifier, page_id: existing.pageId, url: existing.url };
  }

  const properties = buildTaskProperties(policy, identifier, title, config.planSource);
  properties[policy.description] = { rich_text: [{ type: "text", text: { content: PENDING_PUBLICATION_MARKER } }] };
  const page = await client.createTask(dataSource, properties);
  try { await client.appendBlocks(page.id, [pendingPublicationBlock()]); await client.appendBlocks(page.id, blocks); await client.finalizePublication(page.id, policy); }
  catch (error) { if (error instanceof PublicationError) throw error; throw new PublicationError("provider/API failure while publishing Plan; pending task remains retryable"); }
  return { identifier, page_id: page.id, url: page.url };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const get = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
  const planArg = get("--plan"), configArg = get("--config");
  if (!planArg || !configArg) throw new PublicationError("usage: notion-plan-publisher --plan PATH --config PATH");
  let token = process.env.NOTION_TOKEN;
  if (!token) { try { const env = await readFile(resolve(process.cwd(), ".env"), "utf8"); token = env.split(/\r?\n/).find((line) => line.startsWith("NOTION_TOKEN="))?.split("=").slice(1).join("=").trim().replace(/^['"]|['"]$/g, ""); } catch { /* environment variable is primary */ } }
  if (!token) throw new PublicationError("missing NOTION_TOKEN");
  console.log(JSON.stringify(await publishPlan(resolve(planArg), resolve(configArg), new NotionClient(token))));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(`publisher error: ${error instanceof Error ? error.message : error}`); process.exitCode = 2; });
}
