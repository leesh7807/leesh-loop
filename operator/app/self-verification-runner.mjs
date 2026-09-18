#!/usr/bin/env node

import { execFile as execute } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { NotionProductionOperator } from './production-operator.mjs';
import { admissionNamespace, EvidenceWriter, SelfVerificationStore, createRunBinding, deleteRunBinding, runWithDeadline, writeRunProjectConfig } from './self-verification.mjs';

const execFile = promisify(execute);
const root = resolve(dirname(new URL(import.meta.url).pathname), '../..');
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
const sleepWithSignal = (ms, signal) => new Promise(resolveSleep => {
  if (signal?.aborted) return resolveSleep();
  const timer = setTimeout(() => { signal?.removeEventListener('abort', wake); resolveSleep(); }, ms);
  const wake = () => { clearTimeout(timer); signal?.removeEventListener('abort', wake); resolveSleep(); };
  signal?.addEventListener('abort', wake, { once: true });
});

function localEnvironmentToken() {
  try {
    const line = readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/).find(value => /^\s*NOTION_TOKEN=/.test(value));
    return line?.split('=').slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
  } catch { return undefined; }
}

async function command(command, args, options = {}) {
  const { stdout } = await execFile(command, args, { cwd: options.cwd || root, env: { ...process.env, ...options.env }, maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim();
}

function workspaceKey(identifier) {
  const safe = String(identifier).replace(/[^a-zA-Z0-9._-]/g, '_');
  if (safe === identifier) return safe;
  return `${safe}--${createHash('sha256').update(identifier).digest('hex').slice(0, 16)}`;
}

export class SelfVerificationRunner {
  constructor({ projectConfigPath, databaseUrl, stateRoot, repository, configuredBase, token = process.env.NOTION_TOKEN || localEnvironmentToken(), pollMs = 1_000, lifecycleEvidencePath, readPullRequest, readReviewJob } = {}) {
    if (!projectConfigPath || !databaseUrl || !stateRoot || !repository || !configuredBase) throw new Error('projectConfigPath, databaseUrl, stateRoot, repository, and configuredBase are required');
    this.projectConfigPath = resolve(projectConfigPath);
    this.databaseUrl = databaseUrl;
    this.stateRoot = resolve(stateRoot);
    this.repository = repository;
    this.configuredBase = configuredBase;
    this.pollMs = pollMs;
    this.lifecycleEvidencePath = lifecycleEvidencePath;
    this.store = new SelfVerificationStore(this.stateRoot, databaseUrl);
    this.writer = new EvidenceWriter(this.store);
    this.operator = new NotionProductionOperator({ token, databaseUrl, readPullRequest, readReviewJob, operatorLockRoot: join(this.stateRoot, 'operator-locks'), dispatchCoordinationRoot: join(this.store.directory, 'operator-state', 'dispatch-coordination') });
    this.run = null;
    this.configPath = null;
    this.lifecyclePath = null;
  }

  async admit() {
    const projectConfig = JSON.parse(await readFile(this.projectConfigPath, 'utf8'));
    if (projectConfig.github_repository_url !== this.repository) throw new Error('self-verification repository does not match the persistent Project binding');
    if (projectConfig.github_base_branch !== this.configuredBase) throw new Error('self-verification configured base does not match the persistent Project binding');
    if (projectConfig.notion_database_url && admissionNamespace(projectConfig.notion_database_url) !== this.store.namespace) throw new Error('self-verification tracker database does not match the persistent Project binding');
    const admitted = await this.store.admit({
      bindingFactory: runId => createRunBinding({ repository: this.repository, configuredBase: this.configuredBase, trackerDatabase: this.databaseUrl, runId })
    });
    this.run = admitted.run;
    this.operator.configuredBase = this.run.binding.effectiveConfiguredBase;
    this.lifecyclePath = this.lifecycleEvidencePath || join(dirname(this.store.paths.runRecord), 'symphony-lifecycle.ndjson');
    await this.store.update(run => {
      run.observation = { ...(run.observation || {}), resumed: admitted.resumed, lifecycle_evidence_path: this.lifecyclePath };
      return run;
    });
    this.writer.record({ kind: admitted.resumed ? 'run_resumed' : 'admission_committed', binding: this.run.binding });
    return admitted;
  }

  async ensureRuntimeConfig() {
    this.run = await this.store.read();
    this.configPath = join(this.store.directory, 'run-project.json');
    await mkdir(dirname(this.configPath), { recursive: true, mode: 0o700 });
    await writeRunProjectConfig(this.projectConfigPath, this.run, this.configPath, { self_verification_run_id: this.run.run_id, lifecycle_evidence_path: this.lifecyclePath });
    this.run = await this.store.update(run => { run.observation.runtime_config_path = this.configPath; return run; });
    return this.configPath;
  }

  async publish(planPath, logicalTask = {}) {
    if (!this.run?.run_id) await this.admit();
    const run = await this.store.read();
    const sourcePlan = await readFile(resolve(planPath), 'utf8');
    const scopedPlanPath = join(dirname(this.store.paths.runRecord), 'run-plan.md');
    const runMarker = `<!-- leesh-loop self-verification run: ${run.run_id} -->`;
    const expectedPlanSha = run.logical_task?.scoped_plan_sha256;
    let scopedPlan;
    try {
      scopedPlan = await readFile(scopedPlanPath, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      scopedPlan = `${runMarker}\n${sourcePlan}`;
      try { await writeFile(scopedPlanPath, scopedPlan, { flag: 'wx', mode: 0o600 }); } catch (writeError) {
        if (writeError?.code !== 'EEXIST') throw writeError;
        scopedPlan = await readFile(scopedPlanPath, 'utf8');
      }
    }
    const scopedPlanSha = createHash('sha256').update(scopedPlan, 'utf8').digest('hex');
    if (expectedPlanSha && expectedPlanSha !== scopedPlanSha) throw new Error('durable self-verification Plan changed during resume');
    const canonicalIdentifier = `PLAN-${scopedPlanSha.slice(0, 12).toUpperCase()}`;
    if (logicalTask.identifier && logicalTask.identifier !== canonicalIdentifier) throw new Error(`logical task identifier must match publisher identity ${canonicalIdentifier}`);
    const identifier = canonicalIdentifier;
    const title = logicalTask.title || 'Bounded production workflow investigation';
    const result = await this.store.bindLogicalTask({ identifier, title, scoped_plan_path: scopedPlanPath, scoped_plan_sha256: scopedPlanSha }, async task => {
      const publisher = join(root, 'operator/notion_publisher/dist/src/cli.js');
      if (!existsSync(publisher)) {
        await command('npm', ['ci'], { cwd: join(root, 'operator/notion_publisher') });
        await command('npm', ['run', 'build'], { cwd: join(root, 'operator/notion_publisher') });
      }
      const output = await command(process.execPath, [publisher, '--plan', scopedPlanPath, '--config', join(root, 'operator/notion_publisher/examples/publisher-config.json'), '--database-url', this.databaseUrl, '--resume-existing']);
      const lines = output.split(/\r?\n/).filter(Boolean);
      const published = JSON.parse(lines.at(-1));
      return { id: published.page_id, identifier: published.identifier, url: published.url };
    });
    this.run = result;
    return result;
  }

  async startProduction() {
    if (!this.configPath) await this.ensureRuntimeConfig();
    try {
      const output = await command(process.execPath, [join(root, 'operator/app/leesh-loop.mjs'), 'start', this.configPath]);
      const result = JSON.parse(output.split(/\r?\n/).filter(Boolean).at(-1));
      const runtimeStatePath = join(dirname(this.configPath), 'operator-state', 'runtime.json');
      const runtime = JSON.parse(await readFile(runtimeStatePath, 'utf8'));
      await this.store.attachRuntime(runtime.runtime_id);
      this.writer.record({ kind: 'runtime_started', runtime_id: runtime.runtime_id, operator_result: result });
      return { result, runtime };
    } catch (error) {
      this.writer.record({ kind: 'operator_readiness_failed', error: String(error?.message || error), phase: 'before_runtime_attach' });
      await this.writer.flush();
      throw error;
    }
  }

  async readState() {
    const task = await this.operator.readTask(this.run.authoritative_task.id);
    return { page: task.page, state: task.page.properties?.State?.select?.name || null };
  }

  async observeDashboard() {
    const config = JSON.parse(await readFile(this.configPath, 'utf8'));
    const port = Number(config.symphony_port || 4100);
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/state`);
    if (!response.ok) throw new Error(`Symphony state read failed: HTTP ${response.status}`);
    return response.json();
  }

  async observeRuntime() {
    const config = JSON.parse(await readFile(this.configPath, 'utf8'));
    const port = Number(config.symphony_port || 4100);
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/runtime`);
    if (!response.ok) throw new Error(`Symphony runtime read failed: HTTP ${response.status}`);
    return response.json();
  }

  async waitForState(states, { deadlineMs = 3_600_000, onHumanReview } = {}) {
    const wanted = new Set(states);
    let previous = null;
    const operation = async signal => {
      while (!signal?.aborted) {
        const observation = await this.readState();
        if (signal?.aborted) break;
        if (observation.state !== previous) {
          this.writer.record({ kind: 'tracker_state_observed', state: observation.state });
          previous = observation.state;
        }
        if (observation.state === 'Human Review' && onHumanReview && !signal?.aborted) {
          const approval = await onHumanReview({ run: await this.store.read(), task: observation.page, operator: this.operator });
          if (approval && !signal?.aborted) {
            const result = await this.operator.approveHumanReview(approval);
            this.writer.record({ kind: 'operator_approval', result });
          }
        }
        if (wanted.has(observation.state)) return observation;
        await sleepWithSignal(this.pollMs, signal);
      }
      return { timed_out: true };
    };
    return runWithDeadline(operation, deadlineMs, async () => {
      this.writer.record({ kind: 'observer_deadline', states: [...wanted] });
      const current = await this.store.read();
      await this.store.setCollectionDisposition(current.evidence?.gaps?.length ? 'incomplete' : 'complete', { observer_deadline: true });
    });
  }

  async approvalFromWorkpad() {
    const taskId = this.run.authoritative_task.id;
    const workpad = (await this.operator.readWorkpad(taskId)).join('\n');
    const deliveredPr = workpad.match(/delivered_pr:\s*(https?:\/\/\S+)/i)?.[1];
    const deliveredHead = workpad.match(/delivered_head:\s*([0-9a-f]{40})/i)?.[1];
    const reviewJobId = workpad.match(/(?:review_job|job[_ ]id|Review Job ID):\s*([0-9a-f-]{36})/i)?.[1];
    if (!deliveredPr || !deliveredHead || !reviewJobId) return null;
    return { taskId, deliveredPr, deliveredHead, reviewTargetHead: deliveredHead, reviewJobId };
  }

  async ingestLifecycleEvidence() {
    try {
      const runtime = await this.observeRuntime();
      const status = runtime.lifecycle_evidence || {};
      if (Number(status.dropped || 0) > 0 || status.error) {
        const current = await this.store.read();
        const duplicate = (current.evidence?.gaps || []).some(gap => gap.kind === 'lifecycle_evidence_writer_failure' && gap.runtime_id === runtime.runtime_id);
        if (!duplicate) await this.store.noteEvidenceGap({ kind: 'lifecycle_evidence_writer_failure', runtime_id: runtime.runtime_id, dropped: status.dropped || 0, error: status.error || null, irrecoverable: false });
      }
    } catch (error) {
      await this.store.noteEvidenceGap({ kind: 'lifecycle_evidence_status_unavailable', error: String(error?.message || error), irrecoverable: false });
    }
    try {
      const contents = await readFile(this.lifecyclePath, 'utf8');
      for (const line of contents.split(/\r?\n/).filter(Boolean)) {
        try {
          const event = JSON.parse(line);
          if (event.run_id !== this.run.run_id) continue;
          this.writer.record({ kind: 'symphony_lifecycle', event });
        } catch { await this.store.noteEvidenceGap({ kind: 'malformed_lifecycle_evidence', irrecoverable: true }); }
      }
      await this.writer.flush();
    } catch (error) {
      await this.store.noteEvidenceGap({ kind: 'lifecycle_evidence_unavailable', error: String(error?.message || error), irrecoverable: true });
    }
  }

  async preserveArtifact() {
    const state = await this.readState();
    if (state.state !== 'Done') return { skipped: true, state: state.state };
    const workpad = (await this.operator.readWorkpad(this.run.authoritative_task.id)).join('\n');
    const deliveredPr = workpad.match(/delivered_pr:\s*(https?:\/\/\S+)/i)?.[1];
    const deliveredHead = workpad.match(/delivered_head:\s*([0-9a-f]{40})/i)?.[1];
    if (!deliveredPr || !deliveredHead) {
      await this.store.noteEvidenceGap({ kind: 'investigation_artifact_identity_missing', irrecoverable: false });
      return { preserved: false, reason: 'delivery_identity_missing' };
    }
    try {
      const content = await command('gh', ['pr', 'diff', deliveredPr, '--patch']);
      const run = await this.store.preserveArtifact({ content, source: 'GitHub PR patch', deliveredPr, deliveredHead });
      this.writer.record({ kind: 'artifact_preserved', path: run.artifact.path, sha256: run.artifact.sha256, delivered_pr: deliveredPr, delivered_head: deliveredHead });
      return { preserved: true, artifact: run.artifact };
    } catch (error) {
      await this.store.noteEvidenceGap({ kind: 'investigation_artifact_capture_failed', error: String(error?.message || error), irrecoverable: false });
      return { preserved: false, reason: String(error?.message || error) };
    }
  }

  async stopProductionRuntime() {
    const runtimeDirectory = join(dirname(this.configPath), 'operator-state');
    const runtimeStatePath = join(runtimeDirectory, 'runtime.json');
    if (!existsSync(runtimeStatePath)) return { ok: true, skipped: true, reason: 'runtime_not_present' };
    let dashboard;
    try { dashboard = await this.observeDashboard(); } catch (error) {
      return { ok: false, reason: 'runtime_dashboard_unavailable', error: String(error?.message || error) };
    }
    const activeOwners = ['running', 'retrying', 'blocked'].flatMap(kind => dashboard[kind] || []);
    if (activeOwners.length) return { ok: false, reason: 'runtime_has_active_owners', owners: activeOwners };
    let output;
    try {
      output = await command(process.execPath, [join(root, 'operator/app/leesh-loop.mjs'), 'stop', this.configPath]);
    } catch (error) {
      return { ok: false, reason: 'runtime_stop_failed', error: String(error?.message || error) };
    }
    const remaining = ['runtime.json', 'ownership.json', 'dispatch-authorization.json', 'dispatch-acknowledgement.json']
      .filter(name => existsSync(join(runtimeDirectory, name)));
    if (remaining.length) throw new Error(`production runtime stop readback left owned state: ${remaining.join(', ')}`);
    const result = output ? JSON.parse(output.split(/\r?\n/).filter(Boolean).at(-1)) : null;
    this.writer.record({ kind: 'runtime_teardown', operator_result: result, authoritative_readback: { owned_runtime_state_absent: true } });
    await this.writer.flush();
    return { ok: true, result };
  }

  async finalize() {
    this.run = await this.store.read();
    await this.writer.flush();
    await this.ingestLifecycleEvidence();
    await this.preserveArtifact();
    const config = JSON.parse(await readFile(this.configPath, 'utf8'));
    const workspace = join(config.symphony_workspace_root, workspaceKey(this.run.authoritative_task.identifier));
    const state = await this.readState();
    let dashboard;
    let dashboardError = null;
    try { dashboard = await this.observeDashboard(); } catch (error) {
      dashboard = { error: 'unavailable' };
      dashboardError = String(error?.message || error);
      await this.store.noteEvidenceGap({ kind: 'symphony_dashboard_unavailable', error: dashboardError, irrecoverable: false });
    }
    const owners = (dashboard.running || []).filter(item => item.issue_identifier === this.run.authoritative_task.identifier)
      .concat((dashboard.retrying || []).filter(item => item.issue_identifier === this.run.authoritative_task.identifier))
      .concat((dashboard.blocked || []).filter(item => item.issue_identifier === this.run.authoritative_task.identifier));
    const result = await this.store.finalize({
      authoritativeReadback: async () => ({
        admission_safe: !dashboardError && ['Done', 'Cancelled'].includes(state.state) && owners.length === 0 && !existsSync(workspace),
        task_dispatchable: !['Done', 'Cancelled'].includes(state.state),
        execution_owners: owners,
        conflicting_ownership: dashboardError ? [{ source: 'symphony_dashboard', error: dashboardError }] : [],
        workspace_absent: !existsSync(workspace),
        final_state: state.state
      }),
      cleanupHarness: async run => {
        const runtimeCleanup = await this.stopProductionRuntime();
        if (!runtimeCleanup.ok) return runtimeCleanup;
        const bindingCleanup = await deleteRunBinding(run.binding);
        if (!bindingCleanup.ok) return bindingCleanup;
        await rm(this.configPath, { force: true });
        return { ok: true, temporary_base: run.binding.temporaryBase };
      },
      irrecoverableCollection: Boolean((await this.store.read()).evidence?.gaps?.some(gap => gap.irrecoverable === true))
    });
    return result;
  }
}

export function runnerUsage() {
  return 'Usage: self-verification-runner --project-config PATH --database-url URL --state-root PATH --repository URL --configured-base BRANCH --plan PATH';
}

async function main() {
  const args = process.argv.slice(2);
  const get = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
  const runner = new SelfVerificationRunner({
    projectConfigPath: get('--project-config'), databaseUrl: get('--database-url'), stateRoot: get('--state-root'), repository: get('--repository'), configuredBase: get('--configured-base'),
    readReviewJob: async jobId => JSON.parse(await command('chatgpt-shot', ['jobs', jobId]))
  });
  await runner.admit();
  await runner.ensureRuntimeConfig();
  await runner.publish(get('--plan'));
  await runner.startProduction();
  const result = await runner.waitForState(['Done', 'Cancelled'], {
    deadlineMs: Number(get('--deadline-ms') || 3_600_000),
    onHumanReview: args.includes('--auto-approve') ? () => runner.approvalFromWorkpad() : undefined
  });
  if (result?.timed_out) process.exitCode = 2;
  else process.stdout.write(`${JSON.stringify(await runner.finalize())}\n`);
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname) {
  main().catch(error => { process.stderr.write(`Self-verification failed: ${error.message}\n`); process.exitCode = 1; });
}
