import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { deriveIdentifier, newRunId, nowIso, sha256, sleep, bounded } from './common.mjs';
import { runPaths, runBranch, runtimeProject } from './config.mjs';
import { selectWorkload } from './catalog.mjs';
import { ACTIVE_STATES, LifecycleInterpreter, mechanicalReviewAllowed } from './lifecycle.mjs';
import { newRunRecord, addFailure, RunStore } from './record.mjs';
import { Finalizer } from './finalize.mjs';

export class E2EOrchestrator {
  constructor({ config, catalog, capabilities, random = Math.random, clock = () => Date.now(), sleepFn = sleep } = {}) {
    this.config = config;
    this.catalog = catalog;
    this.notion = capabilities.notion;
    this.publisher = capabilities.publisher;
    this.git = capabilities.git;
    this.github = capabilities.github;
    this.runtime = capabilities.runtime;
    this.review = capabilities.review;
    this.random = random;
    this.clock = clock;
    this.sleep = sleepFn;
    this.interpreter = capabilities.lifecycle || new LifecycleInterpreter();
    this.store = capabilities.store || new RunStore(config);
    this.evidence = capabilities.evidence;
    this.finalizer = capabilities.finalizer || new Finalizer({ config, store: this.store, notion: this.notion, runtime: this.runtime, git: this.git, github: this.github, evidence: this.evidence });
  }

  async admit() {
    const records = await this.store.list();
    const needsReconciliation = record => record.status !== 'finished'
      || record.finalization?.complete !== true
      || (record.cleanup?.unresolved?.length ?? 0) > 0
      || (record.timing?.symphony?.start_requested_at && record.cleanup?.runtime_stopped !== true)
      || (record.timing?.symphony?.started_at && record.cleanup?.runtime_stopped !== true)
      || (record.evidence?.branch_isolation?.remaining_run_owned_refs?.length ?? 0) > 0
      || (record.evidence?.branch_isolation?.unresolved_new_refs?.length ?? 0) > 0;
    for (const previous of records.filter(needsReconciliation)) {
      await this.reconcile(previous);
      if (previous.finalization?.complete !== true || previous.evidence?.branch_isolation?.remaining_run_owned_refs?.length || previous.evidence?.branch_isolation?.unresolved_new_refs?.length) throw new Error(`previous E2E run ${previous.run_id} remains unresolved; refusing a new dispatch`);
    }
    for (const previous of records) {
      const workspace = previous.paths?.workspace_root;
      if (workspace && this.runtime.workspaceExists && await this.runtime.workspaceExists(workspace)) throw new Error(`previous E2E workspace remains: ${workspace}`);
    }
    const tasks = await this.notion.listTasks(this.config.notion_database_url);
    const conflicting = tasks.filter(task => ACTIVE_STATES.has(task.state) || task.state === 'Publisher Pending');
    if (conflicting.length) throw new Error(`fixed E2E Notion database has active or dispatchable residue: ${conflicting.map(task => `${task.identifier}:${task.state}`).join(', ')}`);
    const refs = await this.git.remoteRefs();
    for (const previous of records) {
      const branch = previous.binding?.base_branch;
      if (branch && refs[`refs/heads/${branch}`]) throw new Error(`previous run-scoped base branch remains: ${branch}`);
    }
    const unavailable = new Set(tasks.map(task => task.identifier).filter(Boolean));
    return { workload: this.catalog.filter(candidate => !unavailable.has(candidate.identifier)), refs, tasks };
  }

  async reconcile(record) {
    let task = null;
    try { task = await this.readOwnedTask(record); } catch (error) { addFailure(record, error, 'admission_reconciliation'); }
    let normalDone = false;
    let reason = 'admission_reconciliation';
    if (task?.state === 'Done') {
      const verification = await this.verifyReconciledDone(record, task);
      normalDone = verification.ok;
      if (!verification.ok) {
        addFailure(record, new Error(verification.reason), 'done_verification');
        reason = 'done_unverified_reconciliation';
      }
    }
    try {
      await this.finalizer.finalize({ record, reason, task, dashboard: record.runtime?.dashboard, baseBranch: record.binding?.base_branch, workspaceRoot: record.paths?.workspace_root, normalDone });
    } catch (error) {
      addFailure(record, error, 'admission_reconciliation');
      await this.store.save(record);
    }
    return record;
  }

  async verifyReconciledDone(record, task) {
    if (!this.evidence) return { ok: false, reason: 'Done recovery has no evidence capability' };
    try {
      const snapshot = await bounded(() => this.evidence.snapshot({ record, databaseUrl: this.config.notion_database_url, identifier: record.artifacts.task_identifier, dashboard: record.runtime?.dashboard, baseBranch: record.binding?.base_branch, workspaceRoot: record.paths?.workspace_root }), 30_000, 'E2E Done recovery evidence snapshot');
      record.evidence.snapshots.push(snapshot);
      if (!record.artifacts.plan_binding) record.artifacts.plan_binding = { task_id: task.id, publisher_plan_sha256: sha256(record.workload.accepted_plan), tracker_description_sha256: sha256(task.accepted_plan), worker_input_sha256: null, status: 'published_and_tracker_readback' };
      const description = snapshot.symphony?.tracker_input?.description;
      if (description === undefined) return { ok: false, reason: 'Done recovery has no dispatch-bound production tracker input evidence' };
      record.artifacts.plan_binding.worker_input_sha256 = sha256(description || '');
      record.artifacts.plan_binding.status = description === task.accepted_plan ? 'verified_by_production_tracker_input' : 'mismatch';
      if (record.artifacts.plan_binding.status !== 'verified_by_production_tracker_input') return { ok: false, reason: 'Done recovery tracker input does not match the Publisher Accepted Plan' };
      if (Array.isArray(snapshot.github?.delivery_prs)) record.artifacts.delivery_prs = snapshot.github.delivery_prs;
      const verification = await this.verifyDoneDelivery(record, record.binding?.base_branch);
      if (!verification.ok) return verification;
      record.artifacts.merged_head = verification.delivered_head;
      record.artifacts.remote_base_commit = verification.remote_base_commit;
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: `Done recovery evidence failed: ${error.message}` };
    }
  }

  async readOwnedTask(record) {
    const expectedIdentifier = record.artifacts?.task_identifier || record.workload?.identifier;
    const lookup = record.artifacts?.task_id || expectedIdentifier;
    if (!lookup) return null;
    const task = await this.notion.readTask(this.config.notion_database_url, lookup);
    if (!task || task.identifier !== expectedIdentifier || task.accepted_plan !== record.workload?.accepted_plan) throw new Error('reconciliation found a task that is not bound to the recorded E2E workload');
    if (!record.artifacts.task_id) {
      record.artifacts.task_id = task.id;
      record.artifacts.task_url = task.url || null;
      record.artifacts.task_identifier = task.identifier;
      await this.store.save(record);
    }
    return task;
  }

  async run() {
    let admission;
    try { admission = await this.admit(); }
    catch (error) {
      await this.store.saveAdmissionFailure(error);
      throw error;
    }
    const candidates = admission.workload;
    if (!candidates.length) throw new Error('all E2E workload candidates already have a task in the fixed E2E database');
    const workload = selectWorkload(candidates, { random: this.random });
    const runId = newRunId();
    const paths = runPaths(this.config, runId);
    const branch = runBranch(runId);
    const seedCommit = await this.git.resolveSeedCommit(this.config.seed_source_ref);
    const record = newRunRecord({ config: this.config, runId, workload, paths });
    record.binding.base_branch = branch;
    record.binding.seed_commit = seedCommit;
    record.evidence.branch_refs_before = admission.refs;
    record.status = 'preparing';
    await this.store.save(record);

    let task = null;
    let dashboard = null;
    try {
      const baseCommit = await this.git.createBaseBranch(branch, seedCommit, this.config.seed_source_ref);
      record.binding.base_commit = baseCommit;
      await this.store.save(record);

      const project = runtimeProject(this.config, paths, branch);
      await mkdir(dirname(paths.runtimeProject), { recursive: true, mode: 0o700 });
      await writeFile(paths.runtimeProject, `${JSON.stringify(project, null, 2)}\n`, { mode: 0o600 });
      record.runtime = { project: project, dashboard: `http://127.0.0.1:${project.symphony_port}` };
      await this.store.save(record);

      record.timing.symphony.start_requested_at = nowIso();
      record.status = 'runtime_starting';
      await this.store.save(record);
      const runtimeResult = await this.runtime.start(paths.runtimeProject, this.config.runtime_start_timeout_ms);
      record.timing.symphony.started_at = nowIso();
      dashboard = runtimeResult.dashboard || record.runtime.dashboard;
      record.runtime.dashboard = dashboard;
      record.status = 'runtime_ready';
      await this.store.save(record);

      const publication = await this.publisher.publish({ plan: workload.accepted_plan, databaseUrl: this.config.notion_database_url, directory: paths.directory });
      record.artifacts.publisher_result = publication;
      record.artifacts.task_id = publication.page_id;
      record.artifacts.task_url = publication.url || null;
      task = { id: publication.page_id, state: null };
      record.status = 'published';
      await this.store.save(record);
      const publishedTask = await this.notion.readTask(this.config.notion_database_url, publication.page_id);
      if (!publishedTask || publishedTask.identifier !== deriveIdentifier(workload.accepted_plan) || publishedTask.accepted_plan !== workload.accepted_plan) throw new Error('Publisher authoritative readback does not match the selected Accepted Plan');
      task = publishedTask;
      record.artifacts.task_identifier = task.identifier;
      record.artifacts.plan_binding = { task_id: task.id, publisher_plan_sha256: sha256(workload.accepted_plan), tracker_description_sha256: sha256(task.accepted_plan), worker_input_sha256: null, status: 'published_and_tracker_readback' };
      this.observeLifecycle(record, task.state, nowIso());
      record.status = 'observing';
      await this.store.save(record);
      return await this.observeUntilTerminal(record, task, dashboard, branch);
    } catch (error) {
      addFailure(record, error, 'orchestration');
      record.status = 'finalizing';
      await this.store.save(record);
      return await this.finalizer.finalize({ record, reason: 'harness_or_production_failure', task, dashboard, baseBranch: branch, workspaceRoot: paths.workspaceRoot, normalDone: false });
    }
  }

  observeLifecycle(record, state, observedAt) {
    const previous = record.lifecycle.observations.at(-1);
    const same = previous?.state === state;
    if (!same) record.lifecycle.observations.push({ state, first_observed_at: observedAt, last_observed_at: observedAt, observed_duration_ms: null });
    else {
      previous.last_observed_at = observedAt;
      previous.observed_duration_ms = Date.parse(previous.last_observed_at) - Date.parse(previous.first_observed_at);
    }
    record.lifecycle.verified_through = this.interpreter.verifiedThrough(record.lifecycle.observations);
    record.lifecycle.verification_gaps = this.interpreter.gaps(record.lifecycle.verified_through);
    record.timing.lifecycle[state] ||= { first_observed_at: observedAt, last_observed_at: observedAt, observed_duration_ms: null };
    record.timing.lifecycle[state].last_observed_at = observedAt;
    record.timing.lifecycle[state].observed_duration_ms = Date.parse(observedAt) - Date.parse(record.timing.lifecycle[state].first_observed_at);
  }

  async observeUntilTerminal(record, task, dashboard, baseBranch) {
    while (true) {
      const snapshot = await bounded(() => this.evidence.snapshot({ record, databaseUrl: this.config.notion_database_url, identifier: record.artifacts.task_identifier, dashboard, baseBranch, workspaceRoot: record.paths.workspace_root }), 30_000, 'E2E evidence snapshot');
      record.evidence.snapshots.push(snapshot);
      const observedTask = snapshot.notion ? await this.notion.readTask(this.config.notion_database_url, record.artifacts.task_id) : task;
      if (observedTask) {
        task = observedTask;
        const state = task.state;
        this.observeLifecycle(record, state, snapshot.observed_at);
        record.artifacts.delivery_prs = snapshot.github.delivery_prs || [];
        record.artifacts.delivered_head = record.artifacts.delivery_prs.find(pr => pr.headRefOid)?.headRefOid || record.artifacts.delivered_head;
        if (snapshot.symphony?.tracker_input?.description !== undefined && record.artifacts.plan_binding) {
          const workerInput = snapshot.symphony.tracker_input;
          record.artifacts.plan_binding.worker_input_sha256 = sha256(workerInput.description || '');
          record.artifacts.plan_binding.status = workerInput.description === task.accepted_plan ? 'verified_by_production_tracker_input' : 'mismatch';
          if (record.artifacts.plan_binding.status === 'mismatch') {
            addFailure(record, new Error('production Tracker.Issue.description does not match the Publisher Accepted Plan'), 'plan_binding');
            await this.store.save(record);
            return this.finalizer.finalize({ record, reason: 'plan_binding_mismatch', task, dashboard, baseBranch, workspaceRoot: record.paths.workspace_root, normalDone: false });
          }
        }
        if (snapshot.symphony?.issue?.running?.workspace_path) record.evidence.workspace_paths.push(snapshot.symphony.issue.running.workspace_path);
        const interpretation = this.interpreter.interpret(task);
        if (state === 'Done') {
          if (record.artifacts.plan_binding?.status !== 'verified_by_production_tracker_input') {
            addFailure(record, new Error('Done was observed without dispatch-bound production tracker input evidence'), 'plan_binding');
            const preDone = record.lifecycle.observations.filter(observation => observation.state !== 'Done');
            record.lifecycle.verified_through = this.interpreter.verifiedThrough(preDone);
            record.lifecycle.verification_gaps = this.interpreter.gaps(record.lifecycle.verified_through);
            await this.store.save(record);
            return this.finalizer.finalize({ record, reason: 'done_unverified', task, dashboard, baseBranch, workspaceRoot: record.paths.workspace_root, normalDone: true });
          }
          const verification = await this.verifyDoneDelivery(record, baseBranch);
          if (!verification.ok) {
            addFailure(record, new Error(verification.reason), 'done_verification');
            const preDone = record.lifecycle.observations.filter(observation => observation.state !== 'Done');
            record.lifecycle.verified_through = this.interpreter.verifiedThrough(preDone);
            record.lifecycle.verification_gaps = this.interpreter.gaps(record.lifecycle.verified_through);
            await this.store.save(record);
            return this.finalizer.finalize({ record, reason: 'done_unverified', task, dashboard, baseBranch, workspaceRoot: record.paths.workspace_root, normalDone: true });
          }
          record.artifacts.merged_head = verification.delivered_head;
          record.artifacts.remote_base_commit = verification.remote_base_commit;
          await this.store.save(record);
          return this.finalizer.finalize({ record, reason: 'production_done', task, dashboard, baseBranch, workspaceRoot: record.paths.workspace_root, normalDone: true });
        }
        if (state === 'Cancelled') return this.finalizer.finalize({ record, reason: 'production_cancelled', task, dashboard, baseBranch, workspaceRoot: record.paths.workspace_root, normalDone: false });
        if (interpretation.capability === 'mechanical_review_approval') {
          if (record.artifacts.plan_binding?.status !== 'verified_by_production_tracker_input') {
            addFailure(record, new Error('Human Review was reached before dispatch-bound production tracker input could be verified'), 'plan_binding');
            await this.store.save(record);
            return this.finalizer.finalize({ record, reason: 'plan_binding_unverified', task, dashboard, baseBranch, workspaceRoot: record.paths.workspace_root, normalDone: false });
          }
          const approval = mechanicalReviewAllowed(task, snapshot.chatgpt_shot);
          if (!approval.allowed) {
            if (approval.pending) {
              await this.store.save(record);
              if (this.clock() >= Date.parse(record.deadline_at)) {
                record.status = 'finalizing';
                await this.store.save(record);
                return this.finalizer.finalize({ record, reason: 'hard_cap_reached', task, dashboard, baseBranch, workspaceRoot: record.paths.workspace_root, normalDone: false });
              }
              await this.sleep(this.config.poll_interval_ms);
              continue;
            }
            addFailure(record, new Error(approval.reason), 'human_review');
            await this.store.save(record);
            return this.finalizer.finalize({ record, reason: 'human_review_cannot_be_approved', task, dashboard, baseBranch, workspaceRoot: record.paths.workspace_root, normalDone: false });
          }
          const delivery = this.github.findDelivery(record.artifacts.delivery_prs, approval.delivered_pr);
          if (!delivery || delivery.baseRefName !== baseBranch || delivery.headRefOid?.toLowerCase() !== approval.delivered_head.toLowerCase()) {
            addFailure(record, new Error('Human Review delivery identity does not match the configured run-scoped base or delivered HEAD'), 'human_review');
            await this.store.save(record);
            return this.finalizer.finalize({ record, reason: 'human_review_delivery_mismatch', task, dashboard, baseBranch, workspaceRoot: record.paths.workspace_root, normalDone: false });
          }
          const merging = await this.notion.updateState(this.config.notion_database_url, task.id, 'Merging');
          if (merging.state !== 'Merging') throw new Error(`Human Review mechanical approval readback was ${merging.state}`);
          record.artifacts.approved_delivery = { pr: approval.delivered_pr, head: approval.delivered_head, cycle: approval.cycle };
          this.observeLifecycle(record, 'Merging', nowIso());
          await this.store.save(record);
          continue;
        }
        if (interpretation.capability === 'unsupported_state') {
          addFailure(record, new Error(`lifecycle state ${state || 'null'} is outside the configured E2E path`), 'lifecycle');
          await this.store.save(record);
          return this.finalizer.finalize({ record, reason: 'unsupported_lifecycle_state', task, dashboard, baseBranch, workspaceRoot: record.paths.workspace_root, normalDone: false });
        }
        if (snapshot.symphony?.issue?.status === 'blocked') {
          addFailure(record, new Error(snapshot.symphony.issue.last_error || 'Symphony reported a blocked worker'), 'symphony');
          await this.store.save(record);
          return this.finalizer.finalize({ record, reason: 'observed_symphony_failure', task, dashboard, baseBranch, workspaceRoot: record.paths.workspace_root, normalDone: false });
        }
      }
      await this.store.save(record);
      if (this.clock() >= Date.parse(record.deadline_at)) {
        record.status = 'finalizing';
        await this.store.save(record);
        return this.finalizer.finalize({ record, reason: 'hard_cap_reached', task, dashboard, baseBranch, workspaceRoot: record.paths.workspace_root, normalDone: false });
      }
      await this.sleep(this.config.poll_interval_ms);
    }
  }

  async verifyDoneDelivery(record, baseBranch) {
    const approved = record.artifacts.approved_delivery;
    if (!approved) return { ok: false, reason: 'Done was observed without an E2E mechanical approval identity' };
    let prs;
    try { prs = await this.github.pullRequestsForBase(baseBranch); }
    catch (error) { return { ok: false, reason: `GitHub delivery inspection failed: ${error.message}` }; }
    const pr = this.github.findDelivery(prs, approved.pr);
    if (!pr) return { ok: false, reason: 'approved delivery PR was not found for the configured run-scoped base' };
    if (pr.baseRefName !== baseBranch || pr.headRefOid?.toLowerCase() !== approved.head.toLowerCase()) return { ok: false, reason: 'approved delivery PR base or head does not match the Human Review identity' };
    if (!pr.mergedAt) return { ok: false, reason: 'approved delivery PR is not merged' };
    const runStartedAt = Date.parse(record.started_at || '');
    const unrelatedMerged = prs.filter(candidate => {
      if (candidate.url === pr.url || String(candidate.number) === String(pr.number)) return false;
      if (candidate.baseRefName !== baseBranch || !candidate.mergedAt) return false;
      const mergedAt = Date.parse(candidate.mergedAt);
      return Number.isFinite(mergedAt) && (!Number.isFinite(runStartedAt) || mergedAt >= runStartedAt);
    });
    if (unrelatedMerged.length > 0) return { ok: false, reason: 'an unrelated PR merged into the run-scoped base during this E2E run' };
    const mergeCommit = pr.mergeCommit?.oid;
    if (!/^[0-9a-f]{40}$/i.test(mergeCommit || '')) return { ok: false, reason: 'merged delivery PR has no authoritative merge commit' };
    let remoteBaseCommit;
    try { remoteBaseCommit = await this.git.remoteBranchCommit(baseBranch); }
    catch (error) { return { ok: false, reason: `configured base remote readback failed: ${error.message}` }; }
    if (!remoteBaseCommit) return { ok: false, reason: 'configured base remote ref is missing after Done' };
    let contained;
    try { contained = await this.git.containsCommit(baseBranch, mergeCommit); }
    catch (error) { return { ok: false, reason: `configured base merge readback failed: ${error.message}` }; }
    if (!contained) return { ok: false, reason: 'merged delivery commit is not present on fetched remote configured base' };
    return { ok: true, delivered_head: approved.head, merge_commit: mergeCommit, remote_base_commit: remoteBaseCommit };
  }
}
