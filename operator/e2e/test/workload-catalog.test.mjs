import test from 'node:test';
import assert from 'node:assert/strict';
import { materializeWorkloadForRun, validateWorkloadCatalog, selectAvailableWorkload } from '../model/workload-catalog.mjs';
import { derivePlanIdentifier } from '../model/plan-identity.mjs';

const planA = '# A\n\nInspect one surface.\n';
const planB = '# B\n\nInspect another surface.\n';

test('catalog requires a finite cap and keeps harness metadata outside the accepted plan', () => {
  const catalog = validateWorkloadCatalog([{ id: 'a', hard_cap_ms: 10, accepted_plan: planA }]);
  assert.equal(catalog[0].plan_identifier, derivePlanIdentifier(planA));
  assert.equal('identifier' in catalog[0], false);
  assert.equal(catalog[0].accepted_plan, planA);
  assert.throws(() => validateWorkloadCatalog([{ id: 'bad', hard_cap_ms: 0, accepted_plan: planA }]), /finite positive/);
});

test('selection remains eligible after prior task instances are published', () => {
  const catalog = validateWorkloadCatalog([
    { id: 'a', hard_cap_ms: 10, accepted_plan: planA },
    { id: 'b', hard_cap_ms: 10, accepted_plan: planB }
  ]);
  const selected = selectAvailableWorkload(catalog, { random: () => 0.99 });
  assert.equal(selected.id, 'b');
  assert.equal(selectAvailableWorkload(catalog, { random: () => 0 }).id, 'a');
  assert.equal(selectAvailableWorkload(catalog, { random: () => 0.99 }).id, 'b');
});

test('materialization suffixes the plan title and re-derives the plan identity', () => {
  const catalog = validateWorkloadCatalog([{ id: 'a', hard_cap_ms: 10, accepted_plan: planA }]);
  const first = materializeWorkloadForRun(catalog[0], { tasks: [] });
  const second = materializeWorkloadForRun(catalog[0], { tasks: [{ title: 'A', state: 'Done' }] });
  assert.equal(first.execution_number, 1);
  assert.equal(first.accepted_plan, '# A-1\n\nInspect one surface.\n');
  assert.equal(first.plan_identifier, derivePlanIdentifier(first.accepted_plan));
  assert.equal(second.execution_number, 2);
  assert.equal(second.accepted_plan, '# A-2\n\nInspect one surface.\n');
  assert.notEqual(first.plan_identifier, second.plan_identifier);
});

test('materialization continues after both legacy and suffixed task titles', () => {
  const catalog = validateWorkloadCatalog([{ id: 'a', hard_cap_ms: 10, accepted_plan: planA }]);
  const next = materializeWorkloadForRun(catalog[0], {
    tasks: [{ title: 'A' }, { title: 'A-2' }, { title: 'A-4' }]
  });
  assert.equal(next.execution_number, 5);
  assert.equal(next.accepted_plan, '# A-5\n\nInspect one surface.\n');
});
