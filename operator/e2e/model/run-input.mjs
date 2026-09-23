import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { derivePlanIdentifier, sha256 } from './plan-identity.mjs';
import { materializeWorkloadForRun, selectAvailableWorkload } from './workload-catalog.mjs';

export const DEFAULT_PROVIDED_HARD_CAP_MS = 1_800_000;

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

export async function readUtf8Document(path, label) {
  const absolutePath = resolve(path);
  let bytes;
  try {
    bytes = await readFile(absolutePath);
  } catch (error) {
    throw new Error(`${label} cannot be read: ${absolutePath}: ${error.message}`);
  }
  try {
    return { path: absolutePath, content: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) };
  } catch {
    throw new Error(`${label} must be valid UTF-8: ${absolutePath}`);
  }
}

export async function resolveE2ERunInput({ config, planPath, workflowPath, hardCapMs } = {}) {
  const hasProvidedPlan = planPath !== undefined;
  if (hasProvidedPlan && (typeof planPath !== 'string' || !planPath.trim())) throw new Error('--plan requires a readable path');
  if (!hasProvidedPlan && hardCapMs !== undefined) throw new Error('--hard-cap-ms requires --plan');

  const workflow = await readUtf8Document(workflowPath || config.workflow_path, 'E2E workflow');
  const providedDocument = hasProvidedPlan ? await readUtf8Document(planPath, 'Accepted Plan') : null;
  if (providedDocument && providedDocument.content.trim().length === 0) throw new Error(`Accepted Plan must be non-empty: ${providedDocument.path}`);

  let providedWorkload = null;
  if (providedDocument) {
    const resolvedHardCap = hardCapMs === undefined ? DEFAULT_PROVIDED_HARD_CAP_MS : positiveInteger(hardCapMs, 'hard_cap_ms');
    providedWorkload = {
      source: 'provided',
      id: null,
      source_path: providedDocument.path,
      accepted_plan: providedDocument.content,
      accepted_plan_sha256: sha256(providedDocument.content),
      plan_identifier: derivePlanIdentifier(providedDocument.content),
      hard_cap_ms: resolvedHardCap,
      hard_cap_provenance: hardCapMs === undefined ? 'provided_default' : 'provided_override'
    };
  }

  return {
    workload: providedWorkload,
    workflow: {
      source: workflowPath === undefined ? 'default' : 'provided',
      source_path: workflow.path,
      resolved_workflow: workflow.content,
      resolved_workflow_sha256: sha256(workflow.content)
    }
  };
}
export function resolveWorkloadForRun({ runInput, catalog = [], tasks = [], random = Math.random } = {}) {
  if (runInput?.workload) {
    const provided = runInput.workload;
    return {
      workload: Object.freeze({ ...provided }),
      evidence: {
        source: 'provided',
        catalog_entry: null,
        supplied: {
          path: provided.source_path,
          accepted_plan: provided.accepted_plan,
          accepted_plan_sha256: provided.accepted_plan_sha256,
          plan_identifier: provided.plan_identifier
        },
        before_materialization: null,
        materialization: null,
        publisher: {
          accepted_plan: provided.accepted_plan,
          accepted_plan_sha256: provided.accepted_plan_sha256,
          plan_identifier: provided.plan_identifier
        },
        hard_cap: { resolved_ms: provided.hard_cap_ms, provenance: provided.hard_cap_provenance }
      }
    };
  }

  const selected = selectAvailableWorkload(catalog, { random });
  const materialized = materializeWorkloadForRun(selected, { tasks });
  return {
    workload: Object.freeze({ ...materialized, source: 'catalog_random', catalog_entry_id: selected.id, hard_cap_provenance: 'catalog_entry.hard_cap_ms' }),
    evidence: {
      source: 'catalog_random',
      catalog_entry: {
        id: selected.id,
        accepted_plan: selected.accepted_plan,
        accepted_plan_sha256: selected.accepted_plan_sha256,
        plan_identifier: selected.plan_identifier,
        hard_cap_ms: selected.hard_cap_ms
      },
      supplied: null,
      before_materialization: {
        accepted_plan: selected.accepted_plan,
        accepted_plan_sha256: selected.accepted_plan_sha256,
        plan_identifier: selected.plan_identifier
      },
      materialization: {
        execution_number: materialized.execution_number,
        accepted_plan: materialized.accepted_plan,
        accepted_plan_sha256: materialized.accepted_plan_sha256,
        plan_identifier: materialized.plan_identifier,
        rule: 'catalog-only H1 execution suffix materialization'
      },
      publisher: {
        accepted_plan: materialized.accepted_plan,
        accepted_plan_sha256: materialized.accepted_plan_sha256,
        plan_identifier: materialized.plan_identifier
      },
      hard_cap: { resolved_ms: materialized.hard_cap_ms, provenance: 'catalog_entry.hard_cap_ms' }
    }
  };
}

export function resolvedRuntimeOptions(config) {
  return {
    skip_external_readiness: true,
    poll_interval_ms: config.poll_interval_ms,
    finalization_timeout_ms: config.finalization_timeout_ms,
    runtime_start_timeout_ms: config.runtime_start_timeout_ms,
    runtime_stop_timeout_ms: config.runtime_stop_timeout_ms,
    symphony_port: config.symphony_port,
    ui_port: config.ui_port,
    workspace_root: config.workspace_root,
    workspace_root_scope: 'current_repository'
  };
}
