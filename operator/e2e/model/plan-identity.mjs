import { createHash } from 'node:crypto';

export function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function derivePlanIdentifier(plan) {
  return `PLAN-${sha256(plan).slice(0, 12).toUpperCase()}`;
}

// Kept as a compatibility alias for records and adapters created before the
// task identity/provenance split. New code must name the plan identity explicitly.
export const deriveIdentifier = derivePlanIdentifier;
