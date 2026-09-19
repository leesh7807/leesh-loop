import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJson, nowIso, readJson } from './common.mjs';
import { runPaths } from './config.mjs';

export function newRunRecord({ config, runId, workload, paths, startedAt = nowIso() }) {
  const start = Date.parse(startedAt);
  return {
    schema_version: 1,
    run_id: runId,
    status: 'admitted',
    started_at: startedAt,
    deadline_at: new Date(start + workload.hard_cap_ms).toISOString(),
    ended_at: null,
    workload: { id: workload.id, identifier: workload.identifier, hard_cap_ms: workload.hard_cap_ms, accepted_plan_sha256: workload.accepted_plan_sha256, accepted_plan: workload.accepted_plan },
    binding: { notion_database_url: config.notion_database_url, repository_url: config.repository_url, seed_source_ref: config.seed_source_ref, seed_commit: null, base_branch: null, base_commit: null },
    artifacts: { task_id: null, task_url: null, task_identifier: workload.identifier, publisher_result: null, plan_binding: null, delivery_prs: [], approved_delivery: null, delivered_head: null, merged_head: null, remote_base_commit: null },
    lifecycle: { observations: [], verified_through: null, verification_gaps: [], terminal_state: null },
    timing: { run: { started_at: startedAt, ended_at: null, observed_duration_ms: null }, lifecycle: {}, symphony: { started_at: null, worker_started_at: null, stopped_at: null, observed_duration_ms: null }, chatgpt_shot: { job_id: null, observations: [], terminal_state: null, observed_duration_ms: null } },
    evidence: { snapshots: [], errors: [], branch_refs_before: null, branch_refs_after: null, branch_isolation: null, workspace_paths: [] },
    failures: [],
    finalization: { reason: null, actor: 'e2e-harness', actions: [], complete: false, incomplete: false, unresolved: [] },
    cleanup: { task_terminalized: false, runtime_stopped: false, branches_deleted: [], workspaces_deleted: [], unresolved: [] },
    paths: { directory: paths.directory, record: paths.record, runtime_project: paths.runtimeProject, runtime_state: paths.runtimeState, workspace_root: paths.workspaceRoot }
  };
}

export class RunStore {
  constructor(config) { this.config = config; }

  path(runId) { return runPaths(this.config, runId).record; }

  async save(record) {
    await atomicJson(record.paths.record, record);
    return record;
  }

  async get(runId) { return readJson(this.path(runId)); }

  async list() {
    let entries = [];
    try { entries = await readdir(this.config.run_record_directory, { withFileTypes: true }); } catch { return []; }
    const records = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const record = await this.get(entry.name);
      if (record) records.push(record);
    }
    return records.sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)));
  }

  async saveAdmissionFailure(error) {
    const at = nowIso();
    const path = join(this.config.run_record_directory, `admission-${randomUUID()}.json`);
    await atomicJson(path, { schema_version: 1, kind: 'admission', started_at: at, ended_at: nowIso(), status: 'blocked', error: String(error?.message || error), fixed_database_url: this.config.notion_database_url });
    return path;
  }
}

export function addFailure(record, error, phase, at = nowIso()) {
  record.failures.push({ at, phase, error: String(error?.message || error) });
}

export function recordAction(record, action, result, at = nowIso()) {
  record.finalization.actions.push({ at, action, ...result });
}
