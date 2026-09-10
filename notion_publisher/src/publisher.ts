import { buildPageBlocks, buildTaskProperties, deriveIdentifier, extractPlanTitle, type Policy, PublicationError, PUBLISHER_PENDING_STATE, resolvePublishDatabase, validatePlanTitle } from "./core.js";
import { type NotionClient, pendingPublicationBlock, PENDING_PUBLICATION_MARKER } from "./notion.js";

export type PublisherConfig = { policy: Policy; planSource?: string };
export type PublishInput = { plan: string; databaseUrl: string; fallbackTitle?: string; client: NotionClient; config: PublisherConfig };
export type PublishResult = { identifier: string; page_id: string; url?: string };
const publicationLocks = new Map<string, Promise<void>>();

async function withPublicationLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = publicationLocks.get(key);
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  publicationLocks.set(key, current);
  if (previous) await previous;
  try { return await operation(); }
  finally { release(); if (publicationLocks.get(key) === current) publicationLocks.delete(key); }
}

export async function publish({ plan, databaseUrl, fallbackTitle, client, config }: PublishInput): Promise<PublishResult> {
  const database = resolvePublishDatabase(databaseUrl);
  const title = extractPlanTitle(plan, fallbackTitle);
  validatePlanTitle(title);
  const identifier = deriveIdentifier(plan);
  return withPublicationLock(`${database.databaseId}:${identifier}`, async () => {
    const dataSource = await client.ensureDatabase(database.databaseId, config.policy);
    const blocks = buildPageBlocks(config.policy, plan);
    const existing = await client.findPublication(dataSource, config.policy, identifier);

    if (existing) {
      if (existing.complete) throw new PublicationError(`duplicate publication: ${identifier} already exists`);
      try { await client.repairIncomplete(existing.pageId, blocks, config.policy); }
      catch (error) { if (error instanceof PublicationError) throw error; throw new PublicationError("provider/API failure while repairing incomplete Plan publication; retry is safe"); }
      return { identifier, page_id: existing.pageId, url: existing.url };
    }

    const properties = buildTaskProperties(config.policy, identifier, title, config.planSource, PUBLISHER_PENDING_STATE);
    properties[config.policy.description] = { rich_text: [{ type: "text", text: { content: PENDING_PUBLICATION_MARKER } }] };
    const page = await client.createTask(dataSource, properties);
    try { await client.appendBlocks(page.id, [pendingPublicationBlock()]); await client.appendBlocks(page.id, blocks); await client.finalizePublication(page.id, config.policy); }
    catch (error) { if (error instanceof PublicationError) throw error; throw new PublicationError("provider/API failure while publishing Plan; pending task remains retryable"); }
    return { identifier, page_id: page.id, url: page.url };
  });
}
