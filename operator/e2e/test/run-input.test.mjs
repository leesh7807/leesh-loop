import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PROVIDED_HARD_CAP_MS, resolveE2ERunInput, resolveWorkloadForRun } from '../model/run-input.mjs';
import { validateWorkloadCatalog } from '../model/workload-catalog.mjs';
import { derivePlanIdentifier, sha256 } from '../model/plan-identity.mjs';

const databaseUrl = 'https://app.notion.com/p/studyleesh/3e08a2658625805cad23fe1137be4a1e?v=3e08a26586258042a8e4000c945e56e7';

async function fixtureFiles(t) {
  const directory = await mkdtemp(join(tmpdir(), 'leesh-loop-e2e-run-input-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const workflowPath = join(directory, 'default-workflow.md');
  await writeFile(workflowPath, '---\ntracker:\n  kind: notion\n---\nworkflow body\n', 'utf8');
  return { directory, workflowPath, config: { workflow_path: workflowPath, notion_database_url: databaseUrl } };
}

test('provided Accepted Plan is raw non-H1 input with a 30 minute default cap', async t => {
  const files = await fixtureFiles(t);
  const planPath = join(files.directory, 'provided-plan.md');
  const plan = 'Plain UTF-8 plan without a Markdown heading.\n검증 작업.\n';
  await writeFile(planPath, plan, 'utf8');

  const input = await resolveE2ERunInput({ config: files.config, planPath });
  assert.equal(input.workload.accepted_plan, plan);
  assert.equal(input.workload.plan_identifier, derivePlanIdentifier(plan));
  assert.equal(input.workload.hard_cap_ms, DEFAULT_PROVIDED_HARD_CAP_MS);
  assert.equal(input.workload.hard_cap_provenance, 'provided_default');

  const resolved = resolveWorkloadForRun({ runInput: input, catalog: [], tasks: [] });
  assert.equal(resolved.workload.source, 'provided');
  assert.equal(resolved.workload.accepted_plan, plan);
  assert.equal(resolved.evidence.catalog_entry, null);
  assert.equal(resolved.evidence.publisher.accepted_plan, plan);
  assert.equal(resolved.evidence.publisher.accepted_plan_sha256, sha256(plan));
  assert.equal(resolved.evidence.materialization, null);
});

test('provided hard-cap override replaces the default without catalog authority', async t => {
  const files = await fixtureFiles(t);
  const planPath = join(files.directory, 'provided-plan.md');
  await writeFile(planPath, 'No heading is required here.\n', 'utf8');
  const input = await resolveE2ERunInput({ config: files.config, planPath, hardCapMs: 42_000 });
  assert.equal(input.workload.hard_cap_ms, 42_000);
  assert.equal(input.workload.hard_cap_provenance, 'provided_override');
  assert.equal(resolveWorkloadForRun({ runInput: input, catalog: [{ id: 'not-authority' }] }).workload.hard_cap_ms, 42_000);
});

test('catalog random input retains before/after materialization evidence', async t => {
  const files = await fixtureFiles(t);
  const catalogEntry = validateWorkloadCatalog([{ id: 'catalog-entry', hard_cap_ms: 91, accepted_plan: '# Catalog task\n\nInspect it.\n' }])[0];
  const input = await resolveE2ERunInput({ config: files.config });
  const resolved = resolveWorkloadForRun({ runInput: input, catalog: [catalogEntry], tasks: [{ title: 'Catalog task', state: 'Done' }], random: () => 0 });
  assert.equal(resolved.workload.source, 'catalog_random');
  assert.equal(resolved.workload.accepted_plan, '# Catalog task-2\n\nInspect it.\n');
  assert.equal(resolved.evidence.catalog_entry.id, 'catalog-entry');
  assert.equal(resolved.evidence.before_materialization.accepted_plan, catalogEntry.accepted_plan);
  assert.equal(resolved.evidence.materialization.execution_number, 2);
  assert.equal(resolved.evidence.publisher.accepted_plan, resolved.workload.accepted_plan);
  assert.equal(resolved.evidence.hard_cap.provenance, 'catalog_entry.hard_cap_ms');
});

test('invalid UTF-8 and empty provided plans are rejected before production input is resolved', async t => {
  const files = await fixtureFiles(t);
  const invalidPath = join(files.directory, 'invalid.md');
  await writeFile(invalidPath, Buffer.from([0xc3, 0x28]));
  await assert.rejects(() => resolveE2ERunInput({ config: files.config, planPath: invalidPath }), /valid UTF-8/);
  const emptyPath = join(files.directory, 'empty.md');
  await writeFile(emptyPath, ' \n', 'utf8');
  await assert.rejects(() => resolveE2ERunInput({ config: files.config, planPath: emptyPath }), /non-empty/);
  await assert.rejects(() => resolveE2ERunInput({ config: files.config, hardCapMs: 10 }), /requires --plan/);
});

test('provided workflow is resolved as an exact document without E2E policy rewriting', async t => {
  const files = await fixtureFiles(t);
  const workflowPath = join(files.directory, 'provided-workflow.md');
  const workflow = '---\ncodex:\n  turn_sandbox_policy: "provided"\n---\nbody without default merge\n';
  await writeFile(workflowPath, workflow, 'utf8');
  const input = await resolveE2ERunInput({ config: files.config, workflowPath });
  assert.equal(input.workflow.source, 'provided');
  assert.equal(input.workflow.source_path, workflowPath);
  assert.equal(input.workflow.resolved_workflow, workflow);
  assert.equal(input.workflow.resolved_workflow_sha256, sha256(workflow));
});
