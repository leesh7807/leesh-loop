import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { deriveIdentifier } from '../model/plan-identity.mjs';
import { createRunPaths, createRunScopedBaseBranchName, createOperatorProjectConfig } from '../model/e2e-project-config.mjs';
import { selectAvailableWorkload } from '../model/workload-catalog.mjs';
import { createRunRecord, addFailure, RunRecordStore } from '../model/run-record-store.mjs';
import { RunFinalizer } from './finalization/run-finalizer.mjs';
import { RunTimingRecorder, createRunId, currentTimeIso, waitForNextPoll } from './run-timing.mjs';
import { RunAdmission } from './admission/run-admission.mjs';
import { RunCompletionVerifier } from './lifecycle/run-completion-verifier.mjs';
import { RunDoneVerifier } from './lifecycle/run-done-verifier.mjs';
import { RunLifecycleObserver } from './lifecycle/run-lifecycle-observer.mjs';

export class E2ERunner {
  constructor({ config, catalog, notionClient, notionPublisherClient, gitClient, githubClient, operatorClient, runEvidenceCollector, runRecordStore, lifecycleInterpreter, runFinalizer, runAdmission, runCompletionVerifier, runDoneVerifier, runTimingRecorder, runLifecycleObserver, random = Math.random, clock = () => Date.now(), waitForPoll = waitForNextPoll } = {}) {
    this.config = config;
    this.catalog = catalog;
    this.notionClient = notionClient;
    this.notionPublisherClient = notionPublisherClient;
    this.gitClient = gitClient;
    this.githubClient = githubClient;
    this.operatorClient = operatorClient;
    this.random = random;
    this.runRecordStore = runRecordStore || new RunRecordStore(config);
    this.runTimingRecorder = runTimingRecorder || new RunTimingRecorder();
    this.runEvidenceCollector = runEvidenceCollector;
    this.completionVerifier = runCompletionVerifier || new RunCompletionVerifier({ gitClient: this.gitClient, githubClient: this.githubClient });
    this.doneVerifier = runDoneVerifier || new RunDoneVerifier({ runCompletionVerifier: this.completionVerifier });
    this.runFinalizer = runFinalizer || new RunFinalizer({ config, runRecordStore: this.runRecordStore, notionClient: this.notionClient, operatorClient: this.operatorClient, gitClient: this.gitClient, githubClient: this.githubClient, runEvidenceCollector: this.runEvidenceCollector, runTimingRecorder: this.runTimingRecorder });
    this.admission = runAdmission || new RunAdmission({ config, catalog, runRecordStore: this.runRecordStore, notionClient: this.notionClient, gitClient: this.gitClient, operatorClient: this.operatorClient, runFinalizer: this.runFinalizer, runEvidenceCollector: this.runEvidenceCollector, runCompletionVerifier: this.completionVerifier, runDoneVerifier: this.doneVerifier, runTimingRecorder: this.runTimingRecorder });
    this.lifecycleObserver = runLifecycleObserver || new RunLifecycleObserver({ config, notionClient: this.notionClient, githubClient: this.githubClient, runEvidenceCollector: this.runEvidenceCollector, runRecordStore: this.runRecordStore, lifecycleInterpreter, runCompletionVerifier: this.completionVerifier, runDoneVerifier: this.doneVerifier, runFinalizer: this.runFinalizer, runTimingRecorder: this.runTimingRecorder, clock, waitForPoll });
  }

  async runProductionE2E() {
    let admission;
    try { admission = await this.admission.checkRunAdmission(); }
    catch (error) {
      await this.runRecordStore.saveAdmissionFailure(error);
      throw error;
    }
    const candidates = admission.workload;
    if (!candidates.length) throw new Error('all E2E workload candidates already have a task in the fixed E2E database');
    const workload = selectAvailableWorkload(candidates, { random: this.random });
    const runId = createRunId();
    const paths = createRunPaths(this.config, runId);
    const branch = createRunScopedBaseBranchName(runId);
    const seedCommit = await this.gitClient.resolveSeedCommit(this.config.seed_source_ref);
    const record = createRunRecord({ config: this.config, runId, workload, paths });
    record.binding.base_branch = branch;
    record.binding.seed_commit = seedCommit;
    record.evidence.branch_refs_before = admission.refs;
    record.status = 'preparing';
    await this.runRecordStore.save(record);

    let task = null;
    let dashboard = null;
    try {
      const baseCommit = await this.gitClient.createRunScopedBaseBranch(branch, seedCommit, this.config.seed_source_ref);
      record.binding.base_commit = baseCommit;
      await this.runRecordStore.save(record);

      const project = createOperatorProjectConfig(this.config, paths, branch);
      await mkdir(dirname(paths.runtimeProject), { recursive: true, mode: 0o700 });
      await writeFile(paths.runtimeProject, `${JSON.stringify(project, null, 2)}\n`, { mode: 0o600 });
      record.runtime = { project: project, dashboard: `http://127.0.0.1:${project.symphony_port}` };
      await this.runRecordStore.save(record);

      this.runTimingRecorder.recordSymphonyStartRequested(record, currentTimeIso());
      record.status = 'runtime_starting';
      await this.runRecordStore.save(record);
      const runtimeResult = await this.operatorClient.startConfiguredOperatorProject(paths.runtimeProject, this.config.runtime_start_timeout_ms);
      this.runTimingRecorder.recordSymphonyStarted(record, currentTimeIso());
      dashboard = runtimeResult.dashboard || record.runtime.dashboard;
      record.runtime.dashboard = dashboard;
      record.status = 'runtime_ready';
      await this.runRecordStore.save(record);

      const publication = await this.notionPublisherClient.publishAcceptedPlan({ plan: workload.accepted_plan, databaseUrl: this.config.notion_database_url, directory: paths.directory });
      record.artifacts.publisher_result = publication;
      record.artifacts.task_id = publication.page_id;
      record.artifacts.task_url = publication.url || null;
      task = { id: publication.page_id, state: null };
      record.status = 'published';
      await this.runRecordStore.save(record);
      const publishedTask = await this.notionClient.readTask(this.config.notion_database_url, publication.page_id);
      if (!publishedTask || publishedTask.identifier !== deriveIdentifier(workload.accepted_plan) || publishedTask.accepted_plan !== workload.accepted_plan) throw new Error('Publisher authoritative readback does not match the selected Accepted Plan');
      task = publishedTask;
      record.artifacts.task_identifier = task.identifier;
      this.doneVerifier.ensurePlanBinding(record, task);
      this.lifecycleObserver.recordLifecycleObservation(record, task.state, currentTimeIso());
      record.status = 'observing';
      await this.runRecordStore.save(record);
      return await this.lifecycleObserver.observeRunUntilTerminalDecision(record, task, dashboard, branch);
    } catch (error) {
      addFailure(record, error, 'orchestration');
      record.status = 'finalizing';
      await this.runRecordStore.save(record);
      return await this.runFinalizer.finalizeRun({ record, reason: 'harness_or_production_failure', task, dashboard, baseBranch: branch, workspaceRoot: paths.workspaceRoot, normalDone: false });
    }
  }

}
