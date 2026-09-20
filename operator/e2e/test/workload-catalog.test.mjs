import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWorkloadCatalog, selectAvailableWorkload } from '../model/workload-catalog.mjs';
import { deriveIdentifier } from '../model/plan-identity.mjs';

const planA = '# A\n\nInspect one surface.\n';
const planB = '# B\n\nInspect another surface.\n';

test('catalog requires a finite cap and keeps harness metadata outside the accepted plan', () => {
  const catalog = validateWorkloadCatalog([{ id: 'a', hard_cap_ms: 10, accepted_plan: planA }]);
  assert.equal(catalog[0].identifier, deriveIdentifier(planA));
  assert.equal(catalog[0].accepted_plan, planA);
  assert.throws(() => validateWorkloadCatalog([{ id: 'bad', hard_cap_ms: 0, accepted_plan: planA }]), /finite positive/);
});

test('selection is random among candidates that are not already published', () => {
  const catalog = validateWorkloadCatalog([
    { id: 'a', hard_cap_ms: 10, accepted_plan: planA },
    { id: 'b', hard_cap_ms: 10, accepted_plan: planB }
  ]);
  const selected = selectAvailableWorkload(catalog, { random: () => 0.99, unavailableIdentifiers: new Set([catalog[0].identifier]) });
  assert.equal(selected.id, 'b');
  assert.throws(() => selectAvailableWorkload(catalog, { unavailableIdentifiers: new Set(catalog.map(value => value.identifier)) }), /already have a task/);
});
