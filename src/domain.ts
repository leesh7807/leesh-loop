import path from "node:path";
import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { Policy, resolvePolicy, normalizeLabels } from "./policy.js";

export type Config = { parentUrl: string; planSourceUrl: string | null; policy: Policy };
export type PlanArtifact = { path: string; content: string; identifier: string; title: string };

const CONFIG_KEYS = new Set(["parent_url", "surface_name", "initial_state", "default_priority", "default_labels", "plan_source_url", "property_names"]);
const PROPERTY_NAME_KEYS = new Set(["title", "identifier", "state", "priority", "labels", "blockedBy", "planSource", "created", "updated"]);

export function parseNotionPageId(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("configuration: parent_url must be a valid Notion URL"); }
  if (!/^(?:app\.)?notion\.com$/i.test(url.hostname) && !/notion\.so$/i.test(url.hostname) && !/notion\.site$/i.test(url.hostname)) throw new Error("configuration: parent_url must be a Notion URL");
  const candidate = url.pathname.split("/").filter(Boolean).pop()?.split("-").pop() ?? "";
  const id = candidate.replace(/[^a-f0-9]/gi, "");
  if (id.length !== 32) throw new Error("configuration: parent_url does not contain a valid Notion page id");
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`.toLowerCase();
}

export function identifierFromPath(filePath: string): string {
  const identifier = path.basename(filePath, path.extname(filePath));
  if (!identifier || identifier === ".") throw new Error("plan: filename must provide a non-empty identifier");
  return identifier;
}

export function titleFromMarkdown(content: string): string {
  const heading = content.match(/^#\s+([^\r\n]+)\s*$/m)?.[1]?.trim() ?? "";
  if (!heading) throw new Error("plan: a level-one heading is required to derive Title");
  const withoutDate = heading.replace(/^\d{4}-\d{2}-\d{2}[-_\s]+/, "");
  const words = withoutDate.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (!words) throw new Error("plan: heading must provide a non-empty Title");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export async function readPlan(filePath: string): Promise<PlanArtifact> {
  const resolved = path.resolve(filePath);
  const content = await readFile(resolved, "utf8");
  return { path: resolved, content, identifier: identifierFromPath(resolved), title: titleFromMarkdown(content) };
}

export async function readConfig(filePath: string): Promise<Config> {
  const raw = await readFile(path.resolve(filePath), "utf8");
  let value: unknown;
  try { value = YAML.parse(raw); } catch (error) { throw new Error(`configuration: invalid YAML (${error instanceof Error ? error.message : "parse failure"})`); }
  if (!value || typeof value !== "object") throw new Error("configuration: root must be a mapping");
  const data = value as Record<string, unknown>;
  for (const key of Object.keys(data)) if (!CONFIG_KEYS.has(key)) throw new Error(`configuration: unsupported key '${key}'`);
  if (typeof data.parent_url !== "string") throw new Error("configuration: parent_url is required");
  parseNotionPageId(data.parent_url);
  if (data.surface_name !== undefined && (typeof data.surface_name !== "string" || !data.surface_name.trim())) throw new Error("configuration: surface_name must be a non-empty string");
  if (data.initial_state !== undefined && typeof data.initial_state !== "string") throw new Error("configuration: initial_state must be a string");
  const names = data.property_names;
  if (names !== undefined && (!names || typeof names !== "object" || Array.isArray(names))) throw new Error("configuration: property_names must be a mapping");
  const priority = data.default_priority === undefined ? null : data.default_priority;
  if (priority !== null && (!Number.isInteger(priority) || ![1, 2, 3, 4].includes(priority as number))) throw new Error("configuration: default_priority must be 1, 2, 3, 4, or null");
  const labels = data.default_labels === undefined ? [] : data.default_labels;
  if (!Array.isArray(labels) || labels.some(label => typeof label !== "string")) throw new Error("configuration: default_labels must be a list of strings");
  if (data.plan_source_url !== undefined && data.plan_source_url !== null) {
    if (typeof data.plan_source_url !== "string") throw new Error("configuration: plan_source_url must be a URL or null");
    try {
      const sourceUrl = new URL(data.plan_source_url);
      if (!/^https?:$/i.test(sourceUrl.protocol)) throw new Error("unsupported protocol");
    } catch { throw new Error("configuration: plan_source_url must be an http(s) URL or null"); }
  }
  const overrideNames = (names ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(overrideNames)) if (!PROPERTY_NAME_KEYS.has(key) || typeof overrideNames[key] !== "string" || !(overrideNames[key] as string).trim()) throw new Error(`configuration: unsupported property_names key '${key}'`);
  const policy = resolvePolicy({
    surfaceName: typeof data.surface_name === "string" ? data.surface_name : undefined,
    initialState: typeof data.initial_state === "string" ? data.initial_state : undefined,
    defaultPriority: priority as number | null,
    defaultLabels: normalizeLabels(labels),
    propertyNames: overrideNames as Partial<Policy["propertyNames"]>
  });
  return { parentUrl: data.parent_url, planSourceUrl: data.plan_source_url === null || data.plan_source_url === undefined ? null : data.plan_source_url, policy };
}
