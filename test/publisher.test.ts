import { describe, expect, it } from 'vitest';
import { identifierFromPlan, titleFromPlan } from '../src/metadata.js';
import { defaultPolicy, normalizeLabels, resolvePolicy, schemaProperties } from '../src/policy.js';
import { findDataSource, validateSchema } from '../src/notion.js';

describe('plan metadata', () => {
  it('derives deterministic identifier and title', () => {
    expect(identifierFromPlan('/tmp/2026-09-05-notion-plan-publisher.md')).toBe('2026-09-05-notion-plan-publisher');
    expect(titleFromPlan('# 2026-09-05-notion-plan-publisher\n')).toBe('Notion Plan Publisher');
  });
  it('rejects missing heading', () => { expect(() => titleFromPlan('## no')).toThrow(); });
});
describe('policy', () => {
  it('normalizes labels and validates overrides', () => {
    expect(normalizeLabels([' A ', 'a', '', 'B'])).toEqual(['a', 'b']);
    expect(resolvePolicy({ defaultState: 'In Progress', defaultPriority: 2 }).defaultState).toBe('In Progress');
    expect(() => resolvePolicy({ defaultPriority: 5 })).toThrow();
  });
  it('defines the canonical schema', () => { const state = schemaProperties(defaultPolicy).State as any; expect(state.select.options).toHaveLength(8); });
});
describe('schema validation', () => {
  it('accepts canonical properties', () => {
    const props = schemaProperties(defaultPolicy);
    props['Blocked By'] = { relation: { data_source_id: 'ds' } };
    const typed = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, { type: Object.keys(v as object)[0], ...(v as object) }]));
    validateSchema({ id: 'ds', properties: typed }, defaultPolicy);
  });
  it('rejects incompatible properties', () => { expect(() => validateSchema({ id: 'ds', properties: { Title: { type: 'rich_text' } } }, defaultPolicy)).toThrow(/incompatible schema/); });
  it('rejects a relation targeting another data source', () => {
    const props = schemaProperties(defaultPolicy);
    props['Blocked By'] = { relation: { data_source_id: 'projects' } };
    const typed = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, { type: Object.keys(v as object)[0], ...(v as object) }]));
    expect(() => validateSchema({ id: 'tasks', properties: typed }, defaultPolicy)).toThrow(/self-relation/);
  });
});
describe('surface discovery', () => {
  it('follows child block pagination before deciding to bootstrap', async () => {
    const calls: string[] = [];
    const api = { request: async ({ path, query }: { path: string; query?: Record<string, string> }) => {
      calls.push(path + (query?.start_cursor ?? ''));
      if (query?.start_cursor) return { results: [{ id: 'db', type: 'child_database', child_database: { title: 'Tasks' } }], has_more: false };
      return { results: [{ id: 'other', type: 'paragraph' }], has_more: true, next_cursor: 'next' };
    } };
    const found = await findDataSource(api, 'parent', defaultPolicy);
    expect(found?.id).toBe('db');
    expect(calls.slice(0, 2)).toEqual(['blocks/parent/children', 'blocks/parent/childrennext']);
  });
});
