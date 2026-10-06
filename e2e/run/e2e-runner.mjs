import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { sha256 } from '../model/plan-identity.mjs';
import { createRunPaths, createRunScopedBaseBranchName, createOperatorProjectConfig } from '../model/e2e-runtime-config.mjs';
import { resolveWorkloadForRun, resolvedRuntimeOptions } from '../model/run-input.mjs';
import { createRunRecord, addFailure, RunRecordStore } from '../model/run-record-store.mjs';
import { RunFinalizer } from './finalization/run-finalizer.mjs';
import { RunTimingRecorder, createRunId, currentTimeIso, waitForNextPoll } from './run-timing.mjs';
import { RunAdmission } from './admission/run-admission.mjs';
import { RunCompletionVerifier } from './lifecycle/run-completion-verifier.mjs';
import { RunDoneVerifier } from './lifecycle/run-done-verifier.mjs';
import { RunLifecycleObserver } from './lifecycle/run-lifecycle-observer.mjs';
import { currentProcessIdentity } from '../model/process-identity.mjs';
import { materializeRunScopedDefaultWorkflow } from '../model/run-scoped-delivery-branch.mjs';
import { identifyE2ERunOrigin } from '../model/run-origin.mjs';
import { isRuntimePortConflict } from '../systems/operator/operator-client.mjs';
import { writeProjectConfiguration } from '../../operator/project-config.mjs';

async function writeRunInputSnapshots(paths, workload, workflow) {
  await Promise.all([
    writeFile(paths.workloadInputSnapshot, workload.source === 'catalog_random' ? workload.catalog_entry.accepted_plan : workload.supplied.accepted_plan, { mode: 0o600 }),
    writeFile(paths.workloadPublisherSnapshot, workload.publisher.accepted_plan, { mode: 0o600 }),
    writeFile(paths.workflowSnapshot, workflow.resolved_workflow, { mode: 0o600 })
  ]);
}

function matchesPublisherReadback(input, readback) {
  if (input === readback) return true;
  return input.replace(/\r\n?/g, '\n') === readback;
}

function codexRuntimeEvidence(workflow) {
  if (workflow.source === 'provided') {
    return {
      policy_source: 'provided workflow snapshot passed through unchanged; effective policy is runtime-owned',
      system_temporary_directory: 'determined by the provided workflow and Symphony runtime; E2E adds no override',
      workflow_snapshot_path: workflow.snapshot_path || null,
      e2e_specific_temp_relocation: false,
      e2e_specific_sandbox_policy: false
    };
  }
  return {
    policy_source: 'resolved workflow and Symphony default Codex sandbox policy',
    system_temporary_directory: 'system temporary directory permitted by the Symphony default policy',
    workflow_snapshot_path: workflow.snapshot_path || null,
    e2e_specific_temp_relocation: false,
    e2e_specific_sandbox_policy: false
  };
}

export class E2ERunner {
  constructor({ config, catalog, runInput, notionClient, notionPublisherClient, gitClient, githubClient, operatorClient, runEvidenceCollector, runRecordStore, lifecycleInterpreter, runFinalizer, runAdmission, runCompletionVerifier, runDoneVerifier, runTimingRecorder, runLifecycleObserver, reservationAuthority, random = Math.random, clock = () => Date.now(), waitForPoll = waitForNextPoll } = {}) {
    this.config = config;
    this.catalog = catalog;
    this.runInput = runInput || { workload: null, workflow: { source: 'default', source_path: config.workflow_path, resolved_workflow: '', resolved_workflow_sha256: sha256('') } };
    this.notionClient = notionClient;
    this.notionPublisherClient = notionPublisherClient;
    this.gitClient = gitClient;
    this.githubClient = githubClient;
    this.operatorClient = operatorClient;
    this.reservationAuthority = reservationAuthority || runAdmission?.reservationAuthority;
    this.random = random;
    this.runRecordStore = runRecordStore || new RunRecordStore(config);
    this.runTimingRecorder = runTimingRecorder || new RunTimingRecorder();
    this.runEvidenceCollector = runEvidenceCollector;
    this.completionVerifier = runCompletionVerifier || new RunCompletionVerifier({ gitClient: this.gitClient, githubClient: this.githubClient });
    this.doneVerifier = runDoneVerifier || new RunDoneVerifier({ runCompletionVerifier: this.completionVerifier });
    this.runFinalizer = runFinalizer || new RunFinalizer({ config, runRecordStore: this.runRecordStore, notionClient: this.notionClient, operatorClient: this.operatorClient, gitClient: this.gitClient, githubClient: this.githubClient, runEvidenceCollector: this.runEvidenceCollector, runTimingRecorder: this.runTimingRecorder, reservationAuthority: this.reservationAuthority });
    this.admission = runAdmission || new RunAdmission({ config, catalog, runRecordStore: this.runRecordStore, notionClient: this.notionClient, gitClient: this.gitClient, operatorClient: this.operatorClient, reservationAuthority: this.reservationAuthority });
    this.lifecycleObserver = runLifecycleObserver || new RunLifecycleObserver({ config, notionClient: this.notionClient, githubClient: this.githubClient, runEvidenceCollector: this.runEvidenceCollector, runRecordStore: this.runRecordStore, lifecycleInterpreter, runCompletionVerifier: this.completionVerifier, runDoneVerifier: this.doneVerifier, runFinalizer: this.runFinalizer, runTimingRecorder: this.runTimingRecorder, clock, waitForPoll });
  }

  async runProductionE2E({ runId = createRunId() } = {}) {
    const runProcess = await currentProcessIdentity();
    const { origin, outer_execution_provenance: outerExecutionProvenance } = identifyE2ERunOrigin({ repositoryRoot: this.config.repository_root || process.cwd() });
    let admission;
    try { admission = await this.admission.checkRunAdmission({ runId, runProcess, origin, outerExecutionProvenance }); }
    catch (error) {
      await this.runRecordStore.saveAdmissionFailure(error, { runId, databasePool: this.config.database_pool });
      throw error;
    }
    if (!admission.admitted) {
      return {
        run_id: runId,
        status: admission.failure === 'RESOURCE_UNAVAILABLE_ADMISSION' ? 'resource_unavailable_admission' : 'failed',
        lifecycle: { terminal_state: null, verified_through: null },
        finalization: { complete: false },
        paths: { record: this.runRecordStore.recordPath(runId) },
        admission
      };
    }
    let record = null;
    const databaseUrl = admission.database.database_url;
    let paths = null;
    let branch = null;
    let portLease = null;
    let task = null;
    let dashboard = null;
    try {
      const resolvedWorkload = resolveWorkloadForRun({ runInput: this.runInput, catalog: admission.workload, tasks: admission.tasks, random: this.random });
      const workload = resolvedWorkload.workload;
      paths = createRunPaths(this.config, runId);
      branch = createRunScopedBaseBranchName(runId);
      const workflow = materializeRunScopedDefaultWorkflow(this.runInput.workflow, branch);
      const seedCommit = await this.gitClient.resolveSeedCommit(this.config.seed_source_ref);
      const resolvedRunInput = {
        workload_evidence: resolvedWorkload.evidence,
        workflow: { ...workflow, snapshot_path: paths.workflowSnapshot },
        runtime_options: { ...resolvedRuntimeOptions(this.config), database_id: admission.database.database_id, origin }
      };
      record = createRunRecord({ config: this.config, database: admission.database, runId, workload, paths, runInput: resolvedRunInput });
      record.binding.base_branch = branch;
      record.binding.seed_commit = seedCommit;
      record.run_origin = origin;
      record.outer_execution_provenance = outerExecutionProvenance;
      record.evidence.branch_refs_before = admission.refs;
      record.status = 'preparing';
      await this.runRecordStore.save(record);

      await writeRunInputSnapshots(paths, resolvedWorkload.evidence, workflow);
      await this.runRecordStore.save(record);
      const metadata = await this.reservationAuthority.updateReservationMetadata(admission.database.database_id, runId, {
        base_branch: branch,
        workspace_root: paths.workspaceRoot,
        run_record_path: paths.record,
        workflow_snapshot_path: paths.workflowSnapshot
      });
      if (!metadata.committed) throw new Error(`database reservation was no longer owned by E2E run ${runId}`);
      const baseCommit = await this.gitClient.createRunScopedBaseBranch(branch, seedCommit, this.config.seed_source_ref);
      record.binding.base_commit = baseCommit;
      await this.runRecordStore.save(record);

      portLease = await this.operatorClient.findAvailableRuntimePorts(this.config.runtime_port_attempts);
      let ports = { symphony_port: portLease.symphony_port, ui_port: portLease.ui_port };
      let project = createOperatorProjectConfig(this.config, paths, branch, paths.workflowSnapshot, ports);
      resolvedRunInput.runtime_options = { ...resolvedRunInput.runtime_options, ...ports };
      record.run_input.runtime_options = { ...record.run_input.runtime_options, ...ports };
      await mkdir(dirname(paths.runtimeProject), { recursive: true, mode: 0o700 });
      await writeProjectConfiguration(paths.runtimeProject, project, { mode: 0o600 });
      record.runtime = {
        project,
        dashboard: `http://127.0.0.1:${project.symphony_port}`,
        resolved_environment: {
          repository_root: this.config.repository_root || null,
          nested_symphony_workspace_root: project.symphony_workspace_root,
          workspace_root_scope: 'current_repository',
          workflow_path: project.workflow_path,
          skip_external_readiness: project.skip_external_readiness,
          open_project_surfaces: project.open_project_surfaces,
          codex_runtime: codexRuntimeEvidence(this.runInput.workflow)
        }
      };
      record.runtime.child_runtime = {
        runtime_id: null,
        status: 'starting',
        state_path: paths.runtimeState,
        process_identity: null,
        requested_at: currentTimeIso(),
        ports
      };
      await this.runRecordStore.save(record);

      this.runTimingRecorder.recordSymphonyStartRequested(record, currentTimeIso());
      record.status = 'runtime_starting';
      await this.runRecordStore.save(record);
      let runtimeResult;
      for (let attempt = 1; ; attempt += 1) {
        const portAttempt = { attempt, ports: { symphony_port: ports.symphony_port, ui_port: ports.ui_port }, started_at: currentTimeIso(), result: 'starting' };
        record.runtime.port_start_attempts ||= [];
        record.runtime.port_start_attempts.push(portAttempt);
        const startingRuntime = await this.reservationAuthority.updateRunLifecycleForReservation(admission.database.database_id, runId, {
          child_runtime_id: record.runtime.child_runtime.runtime_id || null,
          child_runtime: record.runtime.child_runtime
        });
        if (!startingRuntime.committed) throw new Error(`child runtime startup could not be bound to database reservation for E2E run ${runId}`);
        await this.runRecordStore.save(record);
        await portLease.release();
        try {
          runtimeResult = await this.operatorClient.startConfiguredOperatorProject(paths.runtimeProject, this.config.runtime_start_timeout_ms, databaseUrl);
          if (runtimeResult.window_error) throw new Error(`Operator UI startup failed: ${runtimeResult.window_error}`);
          portAttempt.result = 'started';
          portAttempt.finished_at = currentTimeIso();
          await this.runRecordStore.save(record);
          break;
        } catch (error) {
          portAttempt.result = isRuntimePortConflict(error) ? 'port_conflict' : 'failed';
          portAttempt.error = String(error?.message || error);
          portAttempt.finished_at = currentTimeIso();
          await this.runRecordStore.save(record);
          if (portAttempt.result !== 'port_conflict' || attempt >= this.config.runtime_port_attempts) throw error;

          await this.operatorClient.stopConfiguredOperatorProject(paths.runtimeProject, this.config.runtime_stop_timeout_ms);
          const stopped = await this.operatorClient.verifyRuntimeStopped(paths.runtimeState, record.runtime.child_runtime);
          if (!stopped.stopped) throw new Error(`port-conflict startup attempt ${attempt} did not leave its run-owned Operator stopped`);
          record.runtime.child_runtime = { ...record.runtime.child_runtime, status: 'stopped', stopped_at: currentTimeIso() };
          const stoppedRuntime = await this.reservationAuthority.updateRunLifecycleForReservation(admission.database.database_id, runId, {
            child_runtime_id: record.runtime.child_runtime.runtime_id || null,
            child_runtime: record.runtime.child_runtime
          });
          if (!stoppedRuntime.committed) throw new Error(`stopped child runtime could not be bound to database reservation for E2E run ${runId}`);

          portLease = await this.operatorClient.findAvailableRuntimePorts(this.config.runtime_port_attempts);
          ports = { symphony_port: portLease.symphony_port, ui_port: portLease.ui_port };
          project = { ...project, ...ports };
          record.runtime.project = project;
          record.runtime.dashboard = `http://127.0.0.1:${project.symphony_port}`;
          record.runtime.child_runtime = { ...record.runtime.child_runtime, runtime_id: null, status: 'starting', process_identity: null, requested_at: currentTimeIso(), ports };
          record.run_input.runtime_options = { ...record.run_input.runtime_options, ...ports };
          await writeProjectConfiguration(paths.runtimeProject, project, { mode: 0o600 });
        }
      }
      this.runTimingRecorder.recordSymphonyStarted(record, currentTimeIso());
      dashboard = runtimeResult.dashboard || record.runtime.dashboard;
      record.runtime.dashboard = dashboard;
      record.status = 'runtime_ready';
      const childRuntime = await this.operatorClient.readOwnedRuntimeIdentity(paths.runtimeState, runtimeResult);
      record.runtime.child_runtime = childRuntime;
      const runtimeSaved = await this.reservationAuthority.updateRunLifecycleForReservation(admission.database.database_id, runId, {
        child_runtime_id: childRuntime.runtime_id,
        child_runtime: childRuntime
      });
      if (!runtimeSaved.committed) throw new Error(`child runtime ${childRuntime.runtime_id} could not be bound to its database reservation`);
      await this.runRecordStore.save(record);

      await this.notionPublisherClient.prepareProductionPublisher();
      let publication;
      try {
        publication = await this.notionPublisherClient.publishAcceptedPlan({ plan: workload.accepted_plan, databaseUrl, directory: paths.directory });
      } catch (error) {
        record.artifacts.publisher_failure = { at: currentTimeIso(), error: String(error?.message || error) };
        throw error;
      }
      record.artifacts.publisher_result = publication;
      record.artifacts.task_id = publication.page_id;
      record.artifacts.task_url = publication.url || null;
      record.artifacts.task_identifier = publication.identifier || null;
      task = { id: publication.page_id, identifier: publication.identifier, state: null };
      record.status = 'published';
      await this.runRecordStore.save(record);
      const publishedTask = await this.notionClient.readTask(databaseUrl, publication.page_id);
      const publicationPlanIdentifier = publication.plan_identifier || publication.identifier;
      const taskPlanIdentifier = publishedTask?.plan_identifier || (publishedTask ? `PLAN-${sha256(publishedTask.accepted_plan).slice(0, 12).toUpperCase()}` : null);
      if (!publishedTask || publicationPlanIdentifier !== workload.plan_identifier || taskPlanIdentifier !== workload.plan_identifier || publishedTask.identifier !== publication.identifier || !matchesPublisherReadback(workload.accepted_plan, publishedTask.accepted_plan)) throw new Error('Publisher authoritative readback does not match the selected Accepted Plan, Plan provenance, and newly issued task identity');
      task = publishedTask;
      record.artifacts.task_identifier = task.identifier;
      this.doneVerifier.ensurePlanBinding(record, task);
      this.lifecycleObserver.recordLifecycleObservation(record, task.state, currentTimeIso());
      record.status = 'observing';
      await this.runRecordStore.save(record);
      return await this.lifecycleObserver.observeRunUntilTerminalDecision(record, task, dashboard, branch);
    } catch (error) {
      await portLease?.release().catch(() => {});
      if (!record) {
        await this.reservationAuthority.writeRunLifecycle(runId, { status: 'failed', ended_at: currentTimeIso(), selected_database_id: admission.database.database_id, failure: String(error?.message || error) }).catch(() => {});
        await this.reservationAuthority.release(admission.database.database_id, runId, { result: 'failed before production workload setup', error: String(error?.message || error) }).catch(() => ({ committed: false }));
        await this.runRecordStore.saveAdmissionFailure(error, { runId, databasePool: [admission.database] }).catch(() => {});
        throw error;
      }
      addFailure(record, error, 'orchestration');
      record.status = 'finalizing';
      await this.runRecordStore.save(record);
      return await this.runFinalizer.finalizeRun({ record, reason: 'harness_or_production_failure', task, dashboard, baseBranch: branch, workspaceRoot: paths.workspaceRoot, normalDone: false });
    }
  }

}
