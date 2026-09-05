export const KNOWN_STATES = [
  "Todo", "In Progress", "Human Review", "Rework", "Merging", "Done", "Cancelled", "Duplicate"
] as const;

export type PropertyKey = "title" | "identifier" | "state" | "priority" | "labels" | "blockedBy" | "planSource" | "created" | "updated";

export type Policy = {
  surfaceName: string;
  initialState: string;
  defaultPriority: number | null;
  defaultLabels: string[];
  propertyNames: Record<PropertyKey, string>;
  sectionHeadings: { plan: string; workpad: string };
};

export const defaultPolicy: Policy = {
  surfaceName: "Tasks",
  initialState: "Todo",
  defaultPriority: null,
  defaultLabels: [],
  propertyNames: {
    title: "Title", identifier: "Identifier", state: "State", priority: "Priority",
    labels: "Labels", blockedBy: "Blocked By", planSource: "Plan Source", created: "Created", updated: "Updated"
  },
  sectionHeadings: { plan: "Plan", workpad: "Workpad" }
};

export function canonicalProperties(policy: Policy): Record<string, unknown> {
  const n = policy.propertyNames;
  return {
    [n.title]: { title: {} },
    [n.identifier]: { rich_text: {} },
    [n.state]: { select: { options: KNOWN_STATES.map(name => ({ name })) } },
    [n.priority]: { number: {} },
    [n.labels]: { multi_select: { options: [] } },
    [n.planSource]: { url: {} },
    [n.created]: { created_time: {} },
    [n.updated]: { last_edited_time: {} }
  };
}

export function resolvePolicy(overrides: {
  initialState?: string;
  defaultPriority?: number | null;
  defaultLabels?: string[];
  surfaceName?: string;
  propertyNames?: Partial<Policy["propertyNames"]>;
} = {}): Policy {
  const policy: Policy = {
    ...defaultPolicy,
    ...(overrides.initialState === undefined ? {} : { initialState: overrides.initialState }),
    ...(overrides.defaultPriority === undefined ? {} : { defaultPriority: overrides.defaultPriority }),
    ...(overrides.defaultLabels === undefined ? {} : { defaultLabels: overrides.defaultLabels }),
    ...(overrides.surfaceName === undefined ? {} : { surfaceName: overrides.surfaceName }),
    propertyNames: { ...defaultPolicy.propertyNames, ...(overrides.propertyNames ?? {}) }
  };
  if (!KNOWN_STATES.includes(policy.initialState as typeof KNOWN_STATES[number])) throw new Error(`configuration: unsupported initial_state '${policy.initialState}'`);
  if (policy.defaultPriority !== null && ![1, 2, 3, 4].includes(policy.defaultPriority)) throw new Error("configuration: default_priority must be 1, 2, 3, 4, or null");
  if (!policy.surfaceName.trim()) throw new Error("configuration: surface_name must not be blank");
  if (new Set(Object.values(policy.propertyNames)).size !== Object.values(policy.propertyNames).length) throw new Error("configuration: property_names values must be unique");
  return { ...policy, defaultLabels: normalizeLabels(policy.defaultLabels) };
}

export function normalizeLabels(labels: unknown): string[] {
  if (!Array.isArray(labels)) return [];
  return [...new Set(labels.map(String).map(value => value.trim().toLowerCase()).filter(Boolean))];
}
