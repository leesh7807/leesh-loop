import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { currentTimeIso } from '../run/run-timing.mjs';
import { createRunPaths } from './e2e-project-config.mjs';
import { sha256 } from './plan-identity.mjs';

async function writeJsonAtomically(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { return null; }
}

export function createRunRecord({ config, runId, workload, paths, runInput, startedAt = currentTimeIso() }) {
  const start = Date.parse(startedAt);
  const workloadEvidence = runInput?.workload_evidence || {
    source: workload.source || 'catalog_random',
    catalog_entry: workload.source === 'provided' ? null : { id: workload.id, accepted_plan: workload.accepted_plan, accepted_plan_sha256: workload.accepted_plan_sha256, plan_identifier: workload.plan_identifier, hard_cap_ms: workload.hard_cap_ms },
    supplied: workload.source === 'provided' ? { path: workload.source_path || null, accepted_plan: workload.accepted_plan, accepted_plan_sha256: workload.accepted_plan_sha256, plan_identifier: workload.plan_identifier } : null,
    before_materialization: workload.source === 'provided' ? null : { accepted_plan: workload.accepted_plan, accepted_plan_sha256: workload.accepted_plan_sha256, plan_identifier: workload.plan_identifier },
    materialization: workload.source === 'provided' ? null : null,
    publisher: { accepted_plan: workload.accepted_plan, accepted_plan_sha256: workload.accepted_plan_sha256, plan_identifier: workload.plan_identifier },
    hard_cap: { resolved_ms: workload.hard_cap_ms, provenance: workload.hard_cap_provenance || 'catalog_entry.hard_cap_ms' }
  };
  const workflow = runInput?.workflow || { source: 'default', source_path: config.workflow_path, resolved_workflow: '', resolved_workflow_sha256: sha256('') };
  return {
    schema_version: 2,
    run_id: runId,
    status: 'admitted',
    started_at: startedAt,
    deadline_at: new Date(start + workload.hard_cap_ms).toISOString(),
    ended_at: null,
    workload: { source: workload.source || 'catalog_random', id: workload.id || null, catalog_entry_id: workload.catalog_entry_id || null, execution_number: workload.execution_number || null, plan_identifier: workload.plan_identifier || workload.identifier || null, hard_cap_ms: workload.hard_cap_ms, hard_cap_provenance: workload.hard_cap_provenance || 'catalog_entry.hard_cap_ms', accepted_plan_sha256: workload.accepted_plan_sha256, accepted_plan: workload.accepted_plan },
    run_input: {
      workload: workloadEvidence,
      workflow: { ...workflow, snapshot_path: workflow.snapshot_path || paths.workflowSnapshot },
      runtime_options: runInput?.runtime_options || {
        skip_external_readiness: true,
        poll_interval_ms: config.poll_interval_ms,
        finalization_timeout_ms: config.finalization_timeout_ms,
        runtime_start_timeout_ms: config.runtime_start_timeout_ms,
        runtime_stop_timeout_ms: config.runtime_stop_timeout_ms,
        symphony_port: config.symphony_port,
        ui_port: config.ui_port,
        workspace_root: config.workspace_root,
        workspace_root_scope: 'current_repository'
      },
      snapshot_paths: {
        workload_input: paths.workloadInputSnapshot,
        workload_publisher: paths.workloadPublisherSnapshot,
        workflow: paths.workflowSnapshot
      }
    },
    binding: { notion_database_url: config.notion_database_url, repository_url: config.repository_url, seed_source_ref: config.seed_source_ref, seed_commit: null, base_branch: null, base_commit: null },
    artifacts: { task_id: null, task_url: null, task_identifier: null, publisher_result: null, publisher_failure: null, plan_binding: null, delivery_prs: [], delivered_head: null, delivered_head_locked: false, merged_head: null, remote_base_commit: null },
    lifecycle: { observations: [], verified_through: null, verification_gaps: [], terminal_state: null, mechanical_human_review_transition: { performed: false, observed_at: null } },
    timing: { run: { started_at: startedAt, ended_at: null, observed_duration_ms: null }, lifecycle: {}, symphony: { start_requested_at: null, started_at: null, worker_started_at: null, stopped_at: null, observed_duration_ms: null }, chatgpt_shot: { job_id: null, first_observed_at: null, last_observed_at: null, observations: [], terminal_state: null, observed_duration_ms: null } },
    evidence: { snapshots: [], errors: [], branch_refs_before: null, branch_refs_after: null, branch_isolation: null, workspace_paths: [] },
    failures: [],
    finalization: { reason: null, actor: 'e2e-harness', actions: [], complete: false, incomplete: false, unresolved: [] },
    cleanup: { task_terminalized: false, runtime_stopped: false, branches_deleted: [], workspaces_deleted: [], unresolved: [] },
    paths: { directory: paths.directory, record: paths.record, runtime_project: paths.runtimeProject, runtime_state: paths.runtimeState, workload_input_snapshot: paths.workloadInputSnapshot, workload_publisher_snapshot: paths.workloadPublisherSnapshot, workflow_snapshot: paths.workflowSnapshot, workspace_root: paths.workspaceRoot }
  };
}

export class RunRecordStore {
  constructor(config) { this.config = config; }

  recordPath(runId) { return createRunPaths(this.config, runId).record; }

  async save(record) {
    await writeJsonAtomically(record.paths.record, record);
    return record;
  }

  async read(runId) { return readJson(this.recordPath(runId)); }

  async listRecords() {
    let entries = [];
    try { entries = await readdir(this.config.run_record_directory, { withFileTypes: true }); } catch { return []; }
    const records = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const record = await this.read(entry.name);
      if (record) records.push(record);
    }
    return records.sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)));
  }

  async saveAdmissionFailure(error) {
    const at = currentTimeIso();
    const path = join(this.config.run_record_directory, `admission-${randomUUID()}.json`);
    await writeJsonAtomically(path, { schema_version: 1, kind: 'admission', started_at: at, ended_at: currentTimeIso(), status: 'blocked', error: String(error?.message || error), fixed_database_url: this.config.notion_database_url });
    return path;
  }
}

export function addFailure(record, error, phase, at = currentTimeIso()) {
  record.failures.push({ at, phase, error: String(error?.message || error) });
}

export function recordFinalizationAction(record, action, result, at = currentTimeIso()) {
  record.finalization.actions.push({ at, action, ...result });
}
