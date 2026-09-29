import { buildTaskProperties, deriveIdentifier, extractPlanTitle, type Policy, PublicationError, resolvePublishDatabase, selectPublicationState, validatePlanTitle } from "./core.js";
import { type DatabaseBinding, type NotionClient } from "./notion.js";

export type PublisherConfig = { policy: Policy };
export type PublishInput = { plan: string; databaseUrl: string; fallbackTitle?: string; client: NotionClient; config: PublisherConfig; finalState?: string; blockedBy?: string[] };
export type PublishResult = { identifier: string; page_id: string; state: string; url?: string };
const publicationLocks = new Map<string, Promise<void>>();

function requestedBlockers(value: string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || !id.trim())) throw new PublicationError("Blocked By must be a list of task identities");
  return [...new Set(value)];
}

function assertBlockerRelation(actual: string[], expected: string[]): void {
  const normalize = (ids: string[]) => [...new Set(ids)].sort();
  if (JSON.stringify(normalize(actual)) !== JSON.stringify(normalize(expected))) throw new PublicationError("provider/API failure: canonical Blocked By relation did not match the requested tasks");
}

async function withPublicationLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = publicationLocks.get(key);
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  publicationLocks.set(key, current);
  if (previous) await previous;
  try { return await operation(); }
  finally { release(); if (publicationLocks.get(key) === current) publicationLocks.delete(key); }
}

export async function publish({ plan, databaseUrl, fallbackTitle, client, config, finalState, blockedBy: rawBlockers }: PublishInput): Promise<PublishResult> {
  const database = resolvePublishDatabase(databaseUrl);
  if (!plan.trim()) throw new PublicationError("Plan content must be non-empty");
  const title = extractPlanTitle(plan, fallbackTitle);
  validatePlanTitle(title);
  const selectedState = selectPublicationState(finalState);
  const requested = requestedBlockers(rawBlockers);
  const identifier = deriveIdentifier(plan);
  return withPublicationLock(`${database.databaseId}:${identifier}`, async () => {
    const binding: DatabaseBinding = await client.ensureDatabase(database.databaseId, config.policy);
    const existing = await client.findPublication(binding.taskDataSourceId, config.policy, identifier);

    if (existing) {
      if (existing.complete) throw new PublicationError(`duplicate publication: ${identifier} already exists`);
      const currentBlockerIds = await client.taskBlockerIds(existing.pageId, binding.taskDataSourceId, config.policy.blockedBy);
      const blockerIds = requested ?? currentBlockerIds;
      await client.validateTaskReferences(binding.taskDataSourceId, blockerIds);
      try {
        await client.repairIncomplete(existing.pageId, plan, binding, identifier, title, config.policy.identifier);
        if (blockerIds.length || JSON.stringify([...new Set(currentBlockerIds)].sort()) !== JSON.stringify([...new Set(blockerIds)].sort())) {
          await client.setTaskBlockers(existing.pageId, config.policy.blockedBy, blockerIds);
          assertBlockerRelation(await client.taskBlockerIds(existing.pageId, binding.taskDataSourceId, config.policy.blockedBy), blockerIds);
        }
        await client.finalizePublication(existing.pageId, config.policy, selectedState);
      }
      catch (error) { if (error instanceof PublicationError) throw error; throw new PublicationError(`provider/API failure while repairing incomplete Plan publication; retry is safe: ${error instanceof Error ? error.message : "unknown error"}`); }
      return { identifier, page_id: existing.pageId, state: selectedState, url: existing.url };
    }

    const blockerIds = requested ?? [];
    await client.validateTaskReferences(binding.taskDataSourceId, blockerIds);
    const properties = buildTaskProperties(config.policy, identifier, title, blockerIds);
    const page = await client.createTask(binding.taskDataSourceId, properties);
    if (typeof page?.id !== "string") throw new PublicationError("provider/API failure: creating the task returned no page id");
    try {
      await client.ensureCanonicalRepresentation(page.id, plan, binding, identifier, title, config.policy.identifier);
      if (blockerIds.length) {
        await client.setTaskBlockers(page.id, config.policy.blockedBy, blockerIds);
        assertBlockerRelation(await client.taskBlockerIds(page.id, binding.taskDataSourceId, config.policy.blockedBy), blockerIds);
      }
      await client.finalizePublication(page.id, config.policy, selectedState);
    }
    catch (error) { if (error instanceof PublicationError) throw error; throw new PublicationError(`provider/API failure while publishing Plan; pending task remains retryable: ${error instanceof Error ? error.message : "unknown error"}`); }
    return { identifier, page_id: page.id, state: selectedState, url: page.url };
  });
}
