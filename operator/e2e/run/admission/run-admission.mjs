import { RunTimingRecorder, runWithTimeout } from '../run-timing.mjs';
import { ACTIVE_STATES } from '../lifecycle/lifecycle-interpreter.mjs';
import { addFailure, recordFinalizationAction } from '../../model/run-record-store.mjs';
import { RunDoneVerifier } from '../lifecycle/run-done-verifier.mjs';
import { readRunOwnedRuntime, recordedRunRuntimeId } from '../run-owned-runtime.mjs';

function hasVerifiedMergedBaseResidue(record) {
  const baseBranch = record.binding?.base_branch;
  const verifiedBaseCommit = record.artifacts?.remote_base_commit;
  if (!baseBranch || !/^[0-9a-f]{40}$/i.test(verifiedBaseCommit || '')) return false;
  return (record.evidence?.owned_branch_cleanup?.refs || []).some(ref => ref.branch === baseBranch
    && ref.status === 'identity_changed'
    && ref.commit?.toLowerCase() === verifiedBaseCommit.toLowerCase());
}

export class RunAdmission {
  constructor({ config, catalog, runRecordStore, notionClient, gitClient, operatorClient, runFinalizer, runEvidenceCollector, runCompletionVerifier, runDoneVerifier, runTimingRecorder }) {
    this.config = config;
    this.catalog = catalog;
    this.runRecordStore = runRecordStore;
    this.notionClient = notionClient;
    this.gitClient = gitClient;
    this.operatorClient = operatorClient;
    this.runFinalizer = runFinalizer;
    this.runEvidenceCollector = runEvidenceCollector;
    this.runDoneVerifier = runDoneVerifier || new RunDoneVerifier({ runCompletionVerifier });
    this.runTimingRecorder = runTimingRecorder || new RunTimingRecorder();
  }

  async checkRunAdmission() {
    const records = await this.runRecordStore.listRecords();
    const hasRecordedOwnedBranches = record => Boolean(record.binding?.base_branch
      || record.artifacts?.delivery_branch
      || record.artifacts?.delivery_branches?.length
      || record.evidence?.branch_isolation?.remaining_run_owned_refs?.length);
    const needsReconciliation = record => record.status !== 'finished'
      || record.finalization?.complete !== true
      || (record.finalization?.unresolved?.length ?? 0) > 0
      || (record.cleanup?.unresolved?.length ?? 0) > 0
      || (record.timing?.symphony?.start_requested_at && record.cleanup?.runtime_stopped !== true)
      || (record.timing?.symphony?.started_at && record.cleanup?.runtime_stopped !== true)
      || (hasRecordedOwnedBranches(record) && !record.evidence?.owned_branch_cleanup?.checked_at)
      || (record.evidence?.owned_branch_cleanup?.remaining_refs?.length ?? 0) > 0
      || hasVerifiedMergedBaseResidue(record);
    for (const previous of records) {
      const started = Boolean(previous.timing?.symphony?.started_at);
      if (!started && !recordedRunRuntimeId(previous)) continue;
      let runtimeReadback = await readRunOwnedRuntime(previous, this.operatorClient);
      if (runtimeReadback.status !== 'absent') {
        previous.cleanup.runtime_stopped = false;
        await this.runRecordStore.save(previous);
        await this.reconcileInterruptedRun(previous);
        runtimeReadback = await readRunOwnedRuntime(previous, this.operatorClient);
      }
      if (runtimeReadback.status !== 'absent') {
        const action = 'verify_run_owned_symphony_runtime';
        const reason = runtimeReadback.status === 'present'
          ? `run-owned Symphony runtime ${runtimeReadback.runtime_id} remains dispatch-capable`
          : `run-owned Symphony runtime status is unconfirmed: ${runtimeReadback.error}`;
        previous.evidence.owned_runtime_cleanup = { ...runtimeReadback, checked_at: new Date().toISOString() };
        previous.finalization.unresolved ||= [];
        previous.cleanup.unresolved ||= [];
        if (!previous.finalization.unresolved.includes(action)) previous.finalization.unresolved.push(action);
        if (!previous.cleanup.unresolved.includes(action)) previous.cleanup.unresolved.push(action);
        previous.finalization.complete = false;
        previous.finalization.incomplete = true;
        previous.cleanup.runtime_stopped = false;
        recordFinalizationAction(previous, action, { status: 'failed', error: reason });
        if (previous.failures.at(-1)?.error !== reason) addFailure(previous, new Error(reason), 'runtime_cleanup');
        await this.runRecordStore.save(previous);
        throw new Error(`previous E2E run ${previous.run_id} has unresolved owned runtime cleanup: ${reason}`);
      }
    }
    for (const previous of records.filter(needsReconciliation)) {
      await this.reconcileInterruptedRun(previous);
      if (previous.finalization?.complete !== true
        || previous.finalization?.unresolved?.length
        || previous.cleanup?.unresolved?.length
        || (hasRecordedOwnedBranches(previous) && !previous.evidence?.owned_branch_cleanup?.checked_at)
        || previous.evidence?.owned_branch_cleanup?.remaining_refs?.length
        || hasVerifiedMergedBaseResidue(previous)) throw new Error(`previous E2E run ${previous.run_id} remains unresolved; refusing a new dispatch`);
    }
    for (const previous of records) {
      const workspace = previous.paths?.workspace_root;
      if (workspace && this.operatorClient.workspaceExists && await this.operatorClient.workspaceExists(workspace)) throw new Error(`previous E2E workspace remains: ${workspace}`);
    }
    const tasks = await this.notionClient.listTasks(this.config.notion_database_url);
    const conflicting = tasks.filter(task => ACTIVE_STATES.has(task.state) || task.state === 'Publisher Pending');
    if (conflicting.length) throw new Error(`resolved E2E Notion database has active or dispatchable residue: ${conflicting.map(task => `${task.identifier}:${task.state}`).join(', ')}`);
    const completedCatalogEntryIds = [...new Set(records
      .filter(record => record.workload?.source === 'catalog_random')
      .filter(record => {
        const taskIdentifier = record.artifacts?.task_identifier || record.workload?.plan_identifier;
        return tasks.some(task => task.identifier === taskIdentifier && task.state === 'Done');
      })
      .map(record => record.workload?.catalog_entry_id || record.workload?.id)
      .filter(id => typeof id === 'string' && id.length > 0))];
    return { workload: this.catalog, tasks, completedCatalogEntryIds };
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
        addFailure(record, new Error(verification.reason), verification.phase || 'done_verification');
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
      const snapshot = await runWithTimeout(() => this.runEvidenceCollector.collectSnapshot({ databaseUrl: this.config.notion_database_url, identifier: record.artifacts.task_identifier, dashboard: record.runtime?.dashboard, baseBranch: record.binding?.base_branch, workspaceRoot: record.paths?.workspace_root }), 30_000, 'E2E Done recovery evidence snapshot');
      record.evidence.snapshots.push(snapshot);
      this.runTimingRecorder.recordEvidenceSnapshot(record, snapshot);
      return await this.runDoneVerifier.verifyDoneDelivery({ record, task, snapshot, baseBranch: record.binding?.base_branch });
    } catch (error) {
      return { ok: false, reason: `Done recovery evidence failed: ${error.message}` };
    }
  }

  async readRecordedTask(record) {
    const expectedIdentifier = record.artifacts?.task_identifier || null;
    const lookup = record.artifacts?.task_id || expectedIdentifier;
    let task;
    if (lookup) {
      task = await this.notionClient.readTask(this.config.notion_database_url, lookup);
    } else if (this.notionClient.listTasksForPlanIdentifier) {
      const planIdentifier = record.workload?.plan_identifier || record.workload?.identifier;
      const candidates = planIdentifier
        ? await this.notionClient.listTasksForPlanIdentifier(this.config.notion_database_url, planIdentifier)
        : [];
      const startedAt = Date.parse(record.started_at || '');
      const createdDuringRun = candidates.filter(candidate => {
        const createdAt = Date.parse(candidate.created_at || '');
        return Number.isFinite(startedAt) && Number.isFinite(createdAt) && createdAt >= startedAt;
      });
      if (createdDuringRun.length !== 1) throw new Error(`reconciliation could not uniquely identify the task instance for workload ${record.workload?.id || 'unknown'}`);
      task = await this.notionClient.readTask(this.config.notion_database_url, createdDuringRun[0].id);
    } else {
      const legacyIdentifier = record.workload?.identifier;
      if (!legacyIdentifier) return null;
      task = await this.notionClient.readTask(this.config.notion_database_url, legacyIdentifier);
    }
    if (!task || (expectedIdentifier && task.identifier !== expectedIdentifier) || task.accepted_plan !== record.workload?.accepted_plan) throw new Error('reconciliation found a task that is not bound to the recorded E2E workload');
    if (!record.artifacts.task_id) {
      record.artifacts.task_id = task.id;
      record.artifacts.task_url = task.url || null;
      record.artifacts.task_identifier = task.identifier;
      await this.runRecordStore.save(record);
    }
    return task;
  }
}
