export const STATE_OPTIONS = ['Todo', 'In Progress', 'Human Review', 'Rework', 'Merging', 'Done', 'Cancelled', 'Duplicate'] as const;

export type PropertyNames = {
  title: string; identifier: string; state: string; priority: string; labels: string;
  blockedBy: string; planSource: string; created: string; updated: string;
};

export type Policy = {
  dataSourceName: string;
  properties: PropertyNames;
  stateOptions: readonly string[];
  defaultState: string;
  defaultPriority: number | null;
  defaultLabels: string[];
  pageHeadings: { plan: string; workpad: string };
};

export const defaultPolicy: Policy = {
  dataSourceName: 'Tasks',
  properties: {
    title: 'Title', identifier: 'Identifier', state: 'State', priority: 'Priority', labels: 'Labels',
    blockedBy: 'Blocked By', planSource: 'Plan Source', created: 'Created', updated: 'Updated'
  },
  stateOptions: STATE_OPTIONS,
  defaultState: 'Todo', defaultPriority: null, defaultLabels: [],
  pageHeadings: { plan: 'Plan', workpad: 'Workpad' }
};

export function schemaProperties(policy: Policy): Record<string, unknown> {
  const p = policy.properties;
  return {
    [p.title]: { title: {} }, [p.identifier]: { rich_text: {} },
    [p.state]: { select: { options: policy.stateOptions.map(name => ({ name })) } },
    [p.priority]: { number: {} }, [p.labels]: { multi_select: { options: [] } },
    [p.planSource]: { url: {} }, [p.created]: { created_time: {} }, [p.updated]: { last_edited_time: {} }
  };
}

export function normalizeLabels(labels: unknown): string[] {
  if (!Array.isArray(labels)) return [];
  return [...new Set(labels.map(value => String(value).trim().toLowerCase()).filter(Boolean))];
}

export function resolvePolicy(input: Partial<Pick<Policy, 'defaultState' | 'defaultPriority' | 'defaultLabels'>> = {}, base = defaultPolicy): Policy {
  const state = input.defaultState ?? base.defaultState;
  if (!base.stateOptions.includes(state)) throw new Error(`Unsupported initial state: ${state}`);
  if (input.defaultPriority !== undefined && input.defaultPriority !== null && ![1, 2, 3, 4].includes(input.defaultPriority)) {
    throw new Error('Priority must be one of 1, 2, 3, 4, or null');
  }
  return { ...base, defaultState: state, defaultPriority: input.defaultPriority ?? base.defaultPriority, defaultLabels: normalizeLabels(input.defaultLabels ?? base.defaultLabels) };
}
