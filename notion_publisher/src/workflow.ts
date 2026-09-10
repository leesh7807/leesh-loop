import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { notionId, PublicationError } from "./core.js";

export type NotionTrackerSurface = { databaseId: string; databaseUrl: string; token?: string };

/** Resolves the single Notion execution surface selected by WORKFLOW.md. */
export async function resolveNotionTrackerSurface(workflowPath: string): Promise<NotionTrackerSurface> {
  let raw: string;
  try { raw = await readFile(workflowPath, "utf8"); }
  catch { throw new PublicationError(`missing WORKFLOW.md: ${workflowPath}`); }
  const match = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\s*\r?\n|$)/);
  if (!match) throw new PublicationError("WORKFLOW.md must begin with YAML front matter");
  let config: unknown;
  try { config = parse(match[1]); }
  catch { throw new PublicationError("WORKFLOW.md has invalid YAML front matter"); }
  const provider = config && typeof config === "object" && !Array.isArray(config)
    ? (config as { tracker?: { kind?: unknown; provider?: unknown } }).tracker : undefined;
  if (!provider || provider.kind !== "notion" || !provider.provider || typeof provider.provider !== "object" || Array.isArray(provider.provider)) {
    throw new PublicationError("WORKFLOW.md must select tracker.kind: notion with tracker.provider");
  }
  const values = provider.provider as Record<string, unknown>;
  const databaseUrl = resolveEnvironment(values.database_url);
  if (typeof databaseUrl !== "string" || !databaseUrl.trim()) throw new PublicationError("missing tracker.provider.database_url in WORKFLOW.md");
  const token = resolveEnvironment(values.token);
  if (token !== undefined && typeof token !== "string") throw new PublicationError("tracker.provider.token must be a string");
  return { databaseId: notionId(databaseUrl), databaseUrl, token };
}

function resolveEnvironment(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const reference = value.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/);
  return reference ? process.env[reference[1]] : value;
}
