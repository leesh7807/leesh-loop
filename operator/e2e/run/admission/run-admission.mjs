import { runWithTimeout } from '../run-timing.mjs';
import { ACTIVE_STATES } from '../lifecycle/lifecycle-interpreter.mjs';
import { sha256 } from '../../model/plan-identity.mjs';
import { addFailure } from '../../model/run-record-store.mjs';

export class RunAdmission {
  constructor({ config, catalog, runRecordStore, notionClient, gitClient, operatorClient, runFinalizer, runEvidenceCollector, runCompletionVerifier }) {
    this.config = config;
    this.catalog = catalog;
    this.runRecordStore = runRecordStore;
    this.notionClient = notionClient;
    this.gitClient = gitClient;
    this.operatorClient = operatorClient;
    this.runFinalizer = runFinalizer;
    this.runEvidenceCollector = runEvidenceCollector;
    this.runCompletionVerifier = runCompletionVerifier;
  }

  async checkRunAdmission() {
    const records = await this.runRecordStore.listRecords();
    const needsReconciliation = record => record.status !== 'finished'
      || record.finalization?.complete !== true
      || (record.cleanup?.unresolved?.length ?? 0) > 0
      || (record.timing?.symphony?.start_requested_at && record.cleanup?.runtime_stopped !== true)
      || (record.timing?.symphony?.started_at && record.cleanup?.runtime_stopped !== true)
      || (record.evidence?.branch_isolation?.remaining_run_owned_refs?.length ?? 0) > 0
      || (record.evidence?.branch_isolation?.unresolved_new_refs?.length ?? 0) > 0;
    for (const previous of records.filter(needsReconciliation)) {
      await this.reconcileInterruptedRun(previous);
      if (previous.finalization?.complete !== true || previous.evidence?.branch_isolation?.remaining_run_owned_refs?.length || previous.evidence?.branch_isolation?.unresolved_new_refs?.length) throw new Error(`previous E2E run ${previous.run_id} remains unresolved; refusing a new dispatch`);
    }
    for (const previous of records) {
      const workspace = previous.paths?.workspace_root;
      if (workspace && this.operatorClient.workspaceExists && await this.operatorClient.workspaceExists(workspace)) throw new Error(`previous E2E workspace remains: ${workspace}`);
    }
    const tasks = await this.notionClient.listTasks(this.config.notion_database_url);
    const conflicting = tasks.filter(task => ACTIVE_STATES.has(task.state) || task.state === 'Publisher Pending');
    if (conflicting.length) throw new Error(`fixed E2E Notion database has active or dispatchable residue: ${conflicting.map(task => `${task.identifier}:${task.state}`).join(', ')}`);
    const refs = await this.gitClient.listRemoteBranchRefs();
    for (const previous of records) {
      const branch = previous.binding?.base_branch;
      if (branch && refs[`refs/heads/${branch}`]) throw new Error(`previous run-scoped base branch remains: ${branch}`);
    }
    const unavailable = new Set(tasks.map(task => task.identifier).filter(Boolean));
    return { workload: this.catalog.filter(candidate => !unavailable.has(candidate.identifier)), refs, tasks };
  }

  async reconcileInterruptedRun(record) {
    let task = null;
    try { task = await this.readRecordedTask(record); }
    catch (error) { addFailure(record, error, 'admission_reconciliation'); }
    let normalDone = false;
    let reason = 'admission_reconciliation';
    if (task?.state === 'Done') {
      const verification = await this.verifyRecoveredDoneDelivery(record, task);
      normalDone = verification.ok;
      if (!verification.ok) {
        addFailure(record, new Error(verification.reason), 'done_verification');
        reason = 'done_unverified_reconciliation';
      }
    }
    try {
      await this.runFinalizer.finalizeRun({ record, reason, task, dashboard: record.runtime?.dashboard, baseBranch: record.binding?.base_branch, workspaceRoot: record.paths?.workspace_root, normalDone });
    } catch (error) {
      addFailure(record, error, 'admission_reconciliation');
      await this.runRecordStore.save(record);
    }
    return record;
  }

  async verifyRecoveredDoneDelivery(record, task) {
    if (!this.runEvidenceCollector) return { ok: false, reason: 'Done recovery has no evidence collector' };
    try {
      const snapshot = await runWithTimeout(() => this.runEvidenceCollector.collectSnapshot({ record, databaseUrl: this.config.notion_database_url, identifier: record.artifacts.task_identifier, dashboard: record.runtime?.dashboard, baseBranch: record.binding?.base_branch, workspaceRoot: record.paths?.workspace_root }), 30_000, 'E2E Done recovery evidence snapshot');
      record.evidence.snapshots.push(snapshot);
      if (!record.artifacts.plan_binding) record.artifacts.plan_binding = { task_id: task.id, publisher_plan_sha256: sha256(record.workload.accepted_plan), tracker_description_sha256: sha256(task.accepted_plan), worker_input_sha256: null, status: 'published_and_tracker_readback' };
      const description = snapshot.symphony?.tracker_input?.description;
      if (description === undefined) return { ok: false, reason: 'Done recovery has no dispatch-bound production tracker input evidence' };
      record.artifacts.plan_binding.worker_input_sha256 = sha256(description || '');
      record.artifacts.plan_binding.status = description === task.accepted_plan ? 'verified_by_production_tracker_input' : 'mismatch';
      if (record.artifacts.plan_binding.status !== 'verified_by_production_tracker_input') return { ok: false, reason: 'Done recovery tracker input does not match the Publisher Accepted Plan' };
      if (Array.isArray(snapshot.github?.delivery_prs)) record.artifacts.delivery_prs = snapshot.github.delivery_prs;
      const verification = await this.runCompletionVerifier.verifyDoneDelivery(record, record.binding?.base_branch);
      if (!verification.ok) return verification;
      record.artifacts.merged_head = verification.delivered_head;
      record.artifacts.remote_base_commit = verification.remote_base_commit;
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: `Done recovery evidence failed: ${error.message}` };
    }
  }

  async readRecordedTask(record) {
    const expectedIdentifier = record.artifacts?.task_identifier || record.workload?.identifier;
    const lookup = record.artifacts?.task_id || expectedIdentifier;
    if (!lookup) return null;
    const task = await this.notionClient.readTask(this.config.notion_database_url, lookup);
    if (!task || task.identifier !== expectedIdentifier || task.accepted_plan !== record.workload?.accepted_plan) throw new Error('reconciliation found a task that is not bound to the recorded E2E workload');
    if (!record.artifacts.task_id) {
      record.artifacts.task_id = task.id;
      record.artifacts.task_url = task.url || null;
      record.artifacts.task_identifier = task.identifier;
      await this.runRecordStore.save(record);
    }
    return task;
  }
}
