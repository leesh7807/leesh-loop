import { sha256 } from '../../model/plan-identity.mjs';
import { addFailure } from '../../model/run-record-store.mjs';
import { E2ELifecycleInterpreter, verifyMechanicalReviewApproval } from './lifecycle-interpreter.mjs';
import { runWithTimeout, currentTimeIso, waitForNextPoll } from '../run-timing.mjs';
import { RunCompletionVerifier } from './run-completion-verifier.mjs';
import { RunFinalizer } from '../finalization/run-finalizer.mjs';

export class RunLifecycleObserver {
  constructor({ config, notionClient, githubClient, runEvidenceCollector, runRecordStore, lifecycleInterpreter, runCompletionVerifier, runFinalizer, clock = () => Date.now(), waitForPoll = waitForNextPoll } = {}) {
    this.config = config;
    this.notionClient = notionClient;
    this.githubClient = githubClient;
    this.runEvidenceCollector = runEvidenceCollector;
    this.runRecordStore = runRecordStore;
    this.interpreter = lifecycleInterpreter || new E2ELifecycleInterpreter();
    this.completionVerifier = runCompletionVerifier || new RunCompletionVerifier({ gitClient: null, githubClient: this.githubClient });
    this.runFinalizer = runFinalizer || new RunFinalizer({ config, runRecordStore: this.runRecordStore, notionClient: this.notionClient, githubClient: this.githubClient, runEvidenceCollector: this.runEvidenceCollector });
    this.clock = clock;
    this.waitForPoll = waitForPoll;
  }

  recordLifecycleObservation(record, state, observedAt) {
    const previous = record.lifecycle.observations.at(-1);
    const same = previous?.state === state;
    if (!same) record.lifecycle.observations.push({ state, first_observed_at: observedAt, last_observed_at: observedAt, observed_duration_ms: null });
    else {
      previous.last_observed_at = observedAt;
      previous.observed_duration_ms = Date.parse(previous.last_observed_at) - Date.parse(previous.first_observed_at);
    }
    record.lifecycle.verified_through = this.interpreter.findVerifiedLifecycleThrough(record.lifecycle.observations);
    record.lifecycle.verification_gaps = this.interpreter.findMissingLifecyclePhases(record.lifecycle.verified_through);
    record.timing.lifecycle[state] ||= { first_observed_at: observedAt, last_observed_at: observedAt, observed_duration_ms: null };
    record.timing.lifecycle[state].last_observed_at = observedAt;
    record.timing.lifecycle[state].observed_duration_ms = Date.parse(observedAt) - Date.parse(record.timing.lifecycle[state].first_observed_at);
  }

  async observeRunUntilTerminalDecision(record, task, dashboard, baseBranch) {
    while (true) {
      const snapshot = await runWithTimeout(() => this.runEvidenceCollector.collectSnapshot({ record, databaseUrl: this.config.notion_database_url, identifier: record.artifacts.task_identifier, dashboard, baseBranch, workspaceRoot: record.paths.workspace_root }), 30_000, 'E2E evidence snapshot');
      record.evidence.snapshots.push(snapshot);
      const observedTask = snapshot.notion ? await this.notionClient.readTask(this.config.notion_database_url, record.artifacts.task_id) : task;
      if (observedTask) {
        task = observedTask;
        const state = task.state;
        this.recordLifecycleObservation(record, state, snapshot.observed_at);
        record.artifacts.delivery_prs = snapshot.github.delivery_prs || [];
        record.artifacts.delivered_head = record.artifacts.delivery_prs.find(pr => pr.headRefOid)?.headRefOid || record.artifacts.delivered_head;
        if (snapshot.symphony?.tracker_input?.description !== undefined && record.artifacts.plan_binding) {
          const workerInput = snapshot.symphony.tracker_input;
          record.artifacts.plan_binding.worker_input_sha256 = sha256(workerInput.description || '');
          record.artifacts.plan_binding.status = workerInput.description === task.accepted_plan ? 'verified_by_production_tracker_input' : 'mismatch';
          if (record.artifacts.plan_binding.status === 'mismatch') {
            addFailure(record, new Error('production Tracker.Issue.description does not match the Publisher Accepted Plan'), 'plan_binding');
            await this.runRecordStore.save(record);
            return this.runFinalizer.finalizeRun({ record, reason: 'plan_binding_mismatch', task, dashboard, baseBranch, workspaceRoot: record.paths.workspace_root, normalDone: false });
          }
        }
        if (snapshot.symphony?.issue?.running?.workspace_path) record.evidence.workspace_paths.push(snapshot.symphony.issue.running.workspace_path);
        const interpretation = this.interpreter.interpretTaskState(task);
        if (state === 'Done') {
          if (record.artifacts.plan_binding?.status !== 'verified_by_production_tracker_input') {
            addFailure(record, new Error('Done was observed without dispatch-bound production tracker input evidence'), 'plan_binding');
            const preDone = record.lifecycle.observations.filter(observation => observation.state !== 'Done');
            record.lifecycle.verified_through = this.interpreter.findVerifiedLifecycleThrough(preDone);
            record.lifecycle.verification_gaps = this.interpreter.findMissingLifecyclePhases(record.lifecycle.verified_through);
            await this.runRecordStore.save(record);
            return this.runFinalizer.finalizeRun({ record, reason: 'done_unverified', task, dashboard, baseBranch, workspaceRoot: record.paths.workspace_root, normalDone: true });
          }
          const verification = await this.completionVerifier.verifyDoneDelivery(record, baseBranch);
          if (!verification.ok) {
            addFailure(record, new Error(verification.reason), 'done_verification');
            const preDone = record.lifecycle.observations.filter(observation => observation.state !== 'Done');
            record.lifecycle.verified_through = this.interpreter.findVerifiedLifecycleThrough(preDone);
            record.lifecycle.verification_gaps = this.interpreter.findMissingLifecyclePhases(record.lifecycle.verified_through);
            await this.runRecordStore.save(record);
            return this.runFinalizer.finalizeRun({ record, reason: 'done_unverified', task, dashboard, baseBranch, workspaceRoot: record.paths.workspace_root, normalDone: true });
          }
          record.artifacts.merged_head = verification.delivered_head;
          record.artifacts.remote_base_commit = verification.remote_base_commit;
          await this.runRecordStore.save(record);
          return this.runFinalizer.finalizeRun({ record, reason: 'production_done', task, dashboard, baseBranch, workspaceRoot: record.paths.workspace_root, normalDone: true });
        }
        if (state === 'Cancelled') return this.runFinalizer.finalizeRun({ record, reason: 'production_cancelled', task, dashboard, baseBranch, workspaceRoot: record.paths.workspace_root, normalDone: false });
        if (interpretation.handling === 'approve_mechanical_review') {
          if (record.artifacts.plan_binding?.status !== 'verified_by_production_tracker_input') {
            addFailure(record, new Error('Human Review was reached before dispatch-bound production tracker input could be verified'), 'plan_binding');
            await this.runRecordStore.save(record);
            return this.runFinalizer.finalizeRun({ record, reason: 'plan_binding_unverified', task, dashboard, baseBranch, workspaceRoot: record.paths.workspace_root, normalDone: false });
          }
          const approval = verifyMechanicalReviewApproval(task, snapshot.chatgpt_shot);
          if (!approval.allowed) {
            if (approval.pending) {
              await this.runRecordStore.save(record);
              if (this.clock() >= Date.parse(record.deadline_at)) {
                record.status = 'finalizing';
                await this.runRecordStore.save(record);
                return this.runFinalizer.finalizeRun({ record, reason: 'hard_cap_reached', task, dashboard, baseBranch, workspaceRoot: record.paths.workspace_root, normalDone: false });
              }
              await this.waitForPoll(this.config.poll_interval_ms);
              continue;
            }
            addFailure(record, new Error(approval.reason), 'human_review');
            await this.runRecordStore.save(record);
            return this.runFinalizer.finalizeRun({ record, reason: 'human_review_cannot_be_approved', task, dashboard, baseBranch, workspaceRoot: record.paths.workspace_root, normalDone: false });
          }
          const delivery = this.githubClient.findDeliveryPullRequest(record.artifacts.delivery_prs, approval.delivered_pr);
          if (!delivery || delivery.baseRefName !== baseBranch || delivery.headRefOid?.toLowerCase() !== approval.delivered_head.toLowerCase()) {
            addFailure(record, new Error('Human Review delivery identity does not match the configured run-scoped base or delivered HEAD'), 'human_review');
            await this.runRecordStore.save(record);
            return this.runFinalizer.finalizeRun({ record, reason: 'human_review_delivery_mismatch', task, dashboard, baseBranch, workspaceRoot: record.paths.workspace_root, normalDone: false });
          }
          const merging = await this.notionClient.updateTaskState(this.config.notion_database_url, task.id, 'Merging');
          if (merging.state !== 'Merging') throw new Error(`Human Review mechanical approval readback was ${merging.state}`);
          record.artifacts.approved_delivery = { pr: approval.delivered_pr, head: approval.delivered_head, cycle: approval.cycle };
          this.recordLifecycleObservation(record, 'Merging', currentTimeIso());
          await this.runRecordStore.save(record);
          continue;
        }
        if (interpretation.handling === 'unsupported_state') {
          addFailure(record, new Error(`lifecycle state ${state || 'null'} is outside the configured E2E path`), 'lifecycle');
          await this.runRecordStore.save(record);
          return this.runFinalizer.finalizeRun({ record, reason: 'unsupported_lifecycle_state', task, dashboard, baseBranch, workspaceRoot: record.paths.workspace_root, normalDone: false });
        }
        if (snapshot.symphony?.issue?.status === 'blocked') {
          addFailure(record, new Error(snapshot.symphony.issue.last_error || 'Symphony reported a blocked worker'), 'symphony');
          await this.runRecordStore.save(record);
          return this.runFinalizer.finalizeRun({ record, reason: 'observed_symphony_failure', task, dashboard, baseBranch, workspaceRoot: record.paths.workspace_root, normalDone: false });
        }
      }
      await this.runRecordStore.save(record);
      if (this.clock() >= Date.parse(record.deadline_at)) {
        record.status = 'finalizing';
        await this.runRecordStore.save(record);
        return this.runFinalizer.finalizeRun({ record, reason: 'hard_cap_reached', task, dashboard, baseBranch, workspaceRoot: record.paths.workspace_root, normalDone: false });
      }
      await this.waitForPoll(this.config.poll_interval_ms);
    }
  }
}
