import { createHash } from 'node:crypto';

export function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function deriveIdentifier(plan) {
  return `PLAN-${sha256(plan).slice(0, 12).toUpperCase()}`;
}
