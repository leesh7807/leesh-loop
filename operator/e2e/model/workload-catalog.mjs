import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { derivePlanIdentifier, sha256 } from './plan-identity.mjs';

export function validateWorkloadCatalog(catalog) {
  if (!Array.isArray(catalog) || catalog.length === 0) throw new Error('E2E workload catalog must contain at least one candidate');
  const ids = new Set();
  return catalog.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') throw new Error(`catalog entry ${index} must be an object`);
    const { id, accepted_plan: acceptedPlan, hard_cap_ms: hardCapMs } = candidate;
    if (typeof id !== 'string' || !id.trim() || ids.has(id)) throw new Error(`catalog entry ${index} has a duplicate or invalid id`);
    if (typeof acceptedPlan !== 'string' || !acceptedPlan.trim()) throw new Error(`catalog entry ${id} must have a non-empty accepted_plan`);
    if (!Number.isSafeInteger(hardCapMs) || hardCapMs <= 0) throw new Error(`catalog entry ${id} must have a finite positive hard_cap_ms`);
    if (!/^# .+\n/.test(acceptedPlan)) throw new Error(`catalog entry ${id} must have a Markdown H1 plan title`);
    ids.add(id);
    return Object.freeze({ id, accepted_plan: acceptedPlan, accepted_plan_sha256: sha256(acceptedPlan), hard_cap_ms: hardCapMs, plan_identifier: derivePlanIdentifier(acceptedPlan) });
  });
}

export async function loadWorkloadCatalog(path) {
  let contents;
  try { contents = JSON.parse(await readFile(resolve(path), 'utf8')); }
  catch { throw new Error(`missing or invalid E2E workload catalog: ${path}`); }
  return validateWorkloadCatalog(contents);
}

function planTitle(plan) {
  return plan.split(/\r?\n/).find(line => line.startsWith('# '))?.slice(2).trim() || null;
}

export function materializeWorkloadForRun(candidate, { tasks = [] } = {}) {
  const title = planTitle(candidate.accepted_plan);
  const legacyRunCount = tasks.filter(task => task?.title === title).length;
  const highestSuffixedRun = tasks.reduce((highest, task) => {
    const taskTitle = task?.title;
    const prefix = `${title}-`;
    if (typeof taskTitle !== 'string' || !taskTitle.startsWith(prefix)) return highest;
    const suffix = Number(taskTitle.slice(prefix.length));
    return Number.isSafeInteger(suffix) && suffix > highest ? suffix : highest;
  }, 0);
  const executionNumber = Math.max(legacyRunCount, highestSuffixedRun) + 1;
  const normalizedPlan = candidate.accepted_plan.replace(/\r\n?/g, '\n');
  const hasTrailingNewline = normalizedPlan.endsWith('\n');
  const planLines = normalizedPlan.replace(/\n$/, '').split('\n');
  const titleLine = planLines.findIndex(line => line.startsWith('# '));
  planLines[titleLine] = `# ${title}-${executionNumber}`;
  const acceptedPlan = `${planLines.join('\n')}${hasTrailingNewline ? '\n' : ''}`;
  return Object.freeze({
    ...candidate,
    execution_number: executionNumber,
    accepted_plan: acceptedPlan,
    accepted_plan_sha256: sha256(acceptedPlan),
    plan_identifier: derivePlanIdentifier(acceptedPlan)
  });
}

export function selectAvailableWorkload(catalog, { random = Math.random } = {}) {
  const candidates = catalog;
  if (candidates.length === 0) throw new Error('E2E workload catalog has no candidates');
  const value = Number(random());
  const index = Number.isFinite(value) && value >= 0 && value < 1 ? Math.floor(value * candidates.length) : 0;
  return candidates[index];
}
