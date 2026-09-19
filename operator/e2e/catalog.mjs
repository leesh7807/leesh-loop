import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deriveIdentifier, sha256 } from './common.mjs';

export function validateCatalog(catalog) {
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
    return Object.freeze({ id, accepted_plan: acceptedPlan, accepted_plan_sha256: sha256(acceptedPlan), hard_cap_ms: hardCapMs, identifier: deriveIdentifier(acceptedPlan) });
  });
}

export async function loadCatalog(path) {
  let contents;
  try { contents = JSON.parse(await readFile(resolve(path), 'utf8')); }
  catch { throw new Error(`missing or invalid E2E workload catalog: ${path}`); }
  return validateCatalog(contents);
}

export function selectWorkload(catalog, { random = Math.random, unavailableIdentifiers = new Set() } = {}) {
  const candidates = catalog.filter(candidate => !unavailableIdentifiers.has(candidate.identifier));
  if (candidates.length === 0) throw new Error('all E2E workload candidates already have a task in the fixed E2E database');
  const value = Number(random());
  const index = Number.isFinite(value) && value >= 0 && value < 1 ? Math.floor(value * candidates.length) : 0;
  return candidates[index];
}
