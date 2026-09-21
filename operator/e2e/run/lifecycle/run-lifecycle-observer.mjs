import { addFailure } from '../../model/run-record-store.mjs';
import { E2ELifecycleInterpreter } from './lifecycle-interpreter.mjs';
import { RunTimingRecorder, runWithTimeout, currentTimeIso, waitForNextPoll } from '../run-timing.mjs';
import { RunCompletionVerifier } from './run-completion-verifier.mjs';
import { RunDoneVerifier } from './run-done-verifier.mjs';
import { RunFinalizer } from '../finalization/run-finalizer.mjs';

export class RunLifecycleObserver {
  constructor({ config, notionClient, githubClient, runEvidenceCollector, runRecordStore, lifecycleInterpreter, runCompletionVerifier, runDoneVerifier, runFinalizer, runTimingRecorder, clock = () => Date.now(), waitForPoll = waitForNextPoll } = {}) {
    this.config = config;
    this.notionClient = notionClient;
    this.githubClient = githubClient;
    this.runEvidenceCollector = runEvidenceCollector;
    this.runRecordStore = runRecordStore;
    this.interpreter = lifecycleInterpreter || new E2ELifecycleInterpreter();
    this.completionVerifier = runCompletionVerifier || new RunCompletionVerifier({ gitClient: null, githubClient: this.githubClient });
    this.doneVerifier = runDoneVerifier || new RunDoneVerifier({ runCompletionVerifier: this.completionVerifier });
    this.runTimingRecorder = runTimingRecorder || new RunTimingRecorder();
    this.runFinalizer = runFinalizer || new RunFinalizer({ config, runRecordStore: this.runRecordStore, notionClient: this.notionClient, githubClient: this.githubClient, runEvidenceCollector: this.runEvidenceCollector, runTimingRecorder: this.runTimingRecorder });
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
    this.runTimingRecorder.recordLifecycleTiming(record, state, observedAt);
  }

  async observeRunUntilTerminalDecision(record, task, dashboard, baseBranch) {
    while (true) {
      const snapshot = await runWithTimeout(() => this.runEvidenceCollector.collectSnapshot({ databaseUrl: this.config.notion_database_url, identifier: record.artifacts.task_identifier, dashboard, baseBranch, workspaceRoot: record.paths.workspace_root }), 30_000, 'E2E evidence snapshot');
      record.evidence.snapshots.push(snapshot);
      this.runTimingRecorder.recordEvidenceSnapshot(record, snapshot);
      const observedTask = snapshot.notion ? await this.notionClient.readTask(this.config.notion_database_url, record.artifacts.task_id) : task;
      if (observedTask) {
        task = observedTask;
        const state = task.state;
        this.recordLifecycleObservation(record, state, snapshot.observed_at);
        record.artifacts.delivery_prs = snapshot.github.delivery_prs || [];
        const observedDeliveryHead = record.artifacts.delivery_prs.find(pr => pr.headRefOid)?.headRefOid;
        if (observedDeliveryHead) record.artifacts.delivered_head = observedDeliveryHead;
        const planBinding = state === 'Done' ? null : this.doneVerifier.observeTrackerInput(record, task, snapshot);
        if (planBinding?.status === 'mismatch') {
          addFailure(record, new Error(planBinding.reason), 'plan_binding');
          await this.runRecordStore.save(record);
          return this.runFinalizer.finalizeRun({ record, reason: 'plan_binding_mismatch', task, dashboard, baseBranch, workspaceRoot: record.paths.workspace_root, normalDone: false });
        }
        if (snapshot.symphony?.issue?.running?.workspace_path) record.evidence.workspace_paths.push(snapshot.symphony.issue.running.workspace_path);
        const interpretation = this.interpreter.interpretTaskState(task);
        if (state === 'Done') {
          const verification = await this.doneVerifier.verifyDoneDelivery({ record, task, snapshot, baseBranch });
          if (!verification.ok) {
            addFailure(record, new Error(verification.reason), verification.phase || 'done_verification');
            const preDone = record.lifecycle.observations.filter(observation => observation.state !== 'Done');
            record.lifecycle.verified_through = this.interpreter.findVerifiedLifecycleThrough(preDone);
            record.lifecycle.verification_gaps = this.interpreter.findMissingLifecyclePhases(record.lifecycle.verified_through);
            await this.runRecordStore.save(record);
            return this.runFinalizer.finalizeRun({ record, reason: 'done_unverified', task, dashboard, baseBranch, workspaceRoot: record.paths.workspace_root, normalDone: true });
          }
          await this.runRecordStore.save(record);
          return this.runFinalizer.finalizeRun({ record, reason: 'production_done', task, dashboard, baseBranch, workspaceRoot: record.paths.workspace_root, normalDone: true });
        }
        if (state === 'Cancelled') return this.runFinalizer.finalizeRun({ record, reason: 'production_cancelled', task, dashboard, baseBranch, workspaceRoot: record.paths.workspace_root, normalDone: false });
        if (interpretation.handling === 'mechanical_human_review_transition') {
          const transition = record.lifecycle.mechanical_human_review_transition || { performed: false, observed_at: null };
          if (transition.performed) {
            await this.runRecordStore.save(record);
            return this.runFinalizer.finalizeRun({ record, reason: 'reentered_human_review', task, dashboard, baseBranch, workspaceRoot: record.paths.workspace_root, normalDone: false });
          }
          const merging = await this.notionClient.updateTaskState(this.config.notion_database_url, task.id, 'Merging');
          if (merging.state !== 'Merging') throw new Error(`Human Review mechanical transition readback was ${merging.state}`);
          record.lifecycle.mechanical_human_review_transition = { performed: true, observed_at: currentTimeIso() };
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
