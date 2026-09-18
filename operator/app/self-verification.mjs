#!/usr/bin/env node

import { appendFile, copyFile, mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFile as execute } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { readRemoteBranch } from './git-target.mjs';
import { acquireFileLock } from './file-lock.mjs';

const execFile = promisify(execute);
const gitEnvironment = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
const DEFAULT_EVIDENCE_QUEUE_LIMIT = 256;

const isoNow = () => new Date().toISOString();

function compactDatabaseId(databaseUrl) {
  if (typeof databaseUrl !== 'string' || databaseUrl.trim() === '') throw new Error('verification tracker database URL is required');
  const parsed = new URL(databaseUrl);
  if (!['http:', 'https:'].includes(parsed.protocol) || !(parsed.hostname === 'notion.so' || parsed.hostname.endsWith('.notion.so') || parsed.hostname === 'app.notion.com' || parsed.hostname.endsWith('.notion.site'))) {
    throw new Error('verification tracker database URL must be a Notion URL');
  }
  const match = parsed.pathname.match(/([\da-f]{32})(?:$|[-/])/i) || parsed.pathname.match(/([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})(?:$|[-/])/i);
  if (!match) throw new Error('verification tracker database URL must contain a Notion database id');
  return match[1].replaceAll('-', '').toLowerCase();
}

export function admissionNamespace(databaseUrl) {
  return `notion:${compactDatabaseId(databaseUrl)}`;
}

export function namespaceDirectoryName(namespace) {
  return createHash('sha256').update(namespace).digest('hex').slice(0, 32);
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}

async function atomicText(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(value, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function withLock(lockDirectory, operation, options) {
  const release = await acquireFileLock(lockDirectory, { ...options, label: 'self-verification admission lock' });
  try {
    return await operation();
  } finally {
    await release();
  }
}

function assertBinding(binding) {
  const required = ['repository', 'configuredBase', 'seedCommit', 'temporaryBase', 'trackerDatabase'];
  for (const key of required) if (typeof binding?.[key] !== 'string' || binding[key].trim() === '') throw new Error(`run binding requires ${key}`);
  if (!/^[0-9a-f]{40}$/i.test(binding.seedCommit)) throw new Error('run binding seedCommit must be a full commit SHA');
}

export class SelfVerificationStore {
  constructor(stateRoot, databaseUrl) {
    if (typeof stateRoot !== 'string' || stateRoot.trim() === '') throw new Error('self-verification state root is required');
    this.stateRoot = resolve(stateRoot);
    this.namespace = admissionNamespace(databaseUrl);
    this.directory = join(this.stateRoot, 'self-verification', namespaceDirectoryName(this.namespace));
    this.currentRunPath = join(this.directory, 'run.json');
    this.paths = {
      run: this.currentRunPath,
      evidence: join(this.directory, 'evidence.ndjson'),
      lock: join(this.directory, 'admission.lock'),
      bundle: join(this.directory, 'bundle.json'),
      runRecord: null
    };
  }

  async read() {
    const current = await readJson(this.currentRunPath);
    const records = new Map(current?.run_id ? [[current.run_id, current]] : []);
    try {
      for (const entry of await readdir(join(this.directory, 'runs'), { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const candidate = await readJson(join(this.directory, 'runs', entry.name, 'run.json'));
        if (candidate?.run_id) records.set(candidate.run_id, candidate);
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const resumable = [...records.values()].filter(run => run.finalization?.finalized !== true);
    if (resumable.length > 1) throw new Error(`multiple non-finalized self-verification runs found for namespace ${this.namespace}`);
    const run = resumable[0] || current;
    if (run?.run_id) this.setActiveRun(run.run_id);
    return run;
  }

  setActiveRun(runId) {
    const runDirectory = join(this.directory, 'runs', runId);
    this.paths.evidence = join(runDirectory, 'evidence.ndjson');
    this.paths.bundle = join(runDirectory, 'bundle.json');
    this.paths.runRecord = join(runDirectory, 'run.json');
    this.paths.artifact = join(runDirectory, 'investigation-artifact.patch');
  }

  async archiveFinalizedRun(run) {
    if (!run?.run_id) return;
    const archiveDirectory = join(this.directory, 'runs', run.run_id);
    await mkdir(archiveDirectory, { recursive: true, mode: 0o700 });
    await atomicJson(join(archiveDirectory, 'run.json'), run);
    const oldEvidence = this.paths.evidence;
    const oldBundle = this.paths.bundle;
    if (oldEvidence !== join(archiveDirectory, 'evidence.ndjson')) {
      try { await copyFile(oldEvidence, join(archiveDirectory, 'evidence.ndjson')); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    }
    if (oldBundle !== join(archiveDirectory, 'bundle.json')) {
      try { await copyFile(oldBundle, join(archiveDirectory, 'bundle.json')); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    }
    if (this.paths.artifact && this.paths.artifact !== join(archiveDirectory, 'investigation-artifact.patch')) {
      try { await copyFile(this.paths.artifact, join(archiveDirectory, 'investigation-artifact.patch')); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    }
  }

  async admit({ bindingFactory, logicalTask = null, runtimeId = null } = {}) {
    if (typeof bindingFactory !== 'function') throw new Error('admission requires a bindingFactory');
    return withLock(this.paths.lock, async () => {
      const existing = await this.read();
      if (existing && existing.finalization?.finalized !== true) return { run: existing, resumed: true };
      if (existing) await this.archiveFinalizedRun(existing);
      const runId = randomUUID();
      const binding = await bindingFactory(runId);
      assertBinding(binding);
      const run = {
        schema_version: 1,
        run_id: runId,
        admission_namespace: this.namespace,
        binding: { ...binding, effectiveConfiguredBase: binding.temporaryBase },
        logical_task: logicalTask,
        authoritative_task: null,
        runtime_id_history: runtimeId ? [runtimeId] : [],
        evidence: { event_count: 0, dropped_count: 0, gaps: [] },
        collection_disposition: null,
        binding_status: 'pending',
        finalization: { finalized: false, phase: 'admission_committed', finalized_at: null, cleanup: null },
        created_at: isoNow(),
        updated_at: isoNow()
      };
      this.setActiveRun(runId);
      await mkdir(dirname(this.paths.runRecord), { recursive: true, mode: 0o700 });
      await writeFile(this.paths.evidence, '', { flag: 'wx', mode: 0o600 });
      // The durable record is the admission commit. It is written while the
      // exclusive lock is held, so an interrupted pre-commit lock leaves no
      // ownership that a later invocation must guess how to resume.
      await atomicJson(this.paths.runRecord, run);
      await atomicJson(this.currentRunPath, run);
      return { run, resumed: false };
    });
  }

  async update(mutator) {
    if (typeof mutator !== 'function') throw new Error('run update requires a mutator');
    return withLock(this.paths.lock, async () => {
      const current = await this.read();
      if (!current) throw new Error('self-verification run has not been admitted');
      if (current.finalization?.finalized === true) throw new Error('self-verification run is finalized');
      const next = await mutator(structuredClone(current));
      if (!next || typeof next !== 'object') throw new Error('run update must return an object');
      next.updated_at = isoNow();
      await atomicJson(this.paths.runRecord || this.currentRunPath, next);
      await atomicJson(this.currentRunPath, next);
      return next;
    });
  }

  async attachRuntime(runtimeId) {
    if (typeof runtimeId !== 'string' || runtimeId.trim() === '') throw new Error('runtime ID is required');
    return this.update(run => {
      const history = Array.isArray(run.runtime_id_history) ? run.runtime_id_history : [];
      if (!history.includes(runtimeId)) history.push(runtimeId);
      run.runtime_id_history = history;
      return run;
    });
  }

  async bindLogicalTask(logicalTask, publisher) {
    if (!logicalTask || typeof logicalTask !== 'object' || typeof logicalTask.identifier !== 'string' || logicalTask.identifier.trim() === '') throw new Error('logical task identity is required');
    if (typeof publisher !== 'function') throw new Error('task publisher is required');
    const current = await this.read();
    if (!current) throw new Error('self-verification run has not been admitted');
    if (current.logical_task?.identifier && current.logical_task.identifier !== logicalTask.identifier) throw new Error('logical task identity cannot change during a run');
    if (current.authoritative_task?.id) return current;
    const prepared = await this.update(run => { run.logical_task = { ...run.logical_task, ...logicalTask, publish_attempted_at: run.logical_task?.publish_attempted_at || isoNow() }; return run; });
    let published;
    try {
      published = await publisher(prepared.logical_task);
    } catch (error) {
      await this.update(run => { run.logical_task.publish_error = String(error?.message || error); return run; });
      throw error;
    }
    if (!published || typeof published.id !== 'string') throw new Error('publisher did not return an authoritative task identity');
    if (published.identifier !== undefined && published.identifier !== logicalTask.identifier) throw new Error(`publisher identity mismatch: expected ${logicalTask.identifier}, got ${published.identifier}`);
    return this.update(run => {
      run.authoritative_task = { ...published, logical_identifier: logicalTask.identifier, bound_at: isoNow() };
      run.logical_task.publish_result = 'acknowledged';
      return run;
    });
  }

  async appendEvidence(event, { writer = appendFile, queueState = null } = {}) {
    if (!event || typeof event !== 'object') throw new Error('evidence event must be an object');
    const run = await this.read();
    if (!run) throw new Error('self-verification run has not been admitted');
    const record = { at: isoNow(), run_id: run.run_id, admission_namespace: run.admission_namespace, ...event };
    await writer(this.paths.evidence, `${JSON.stringify(record)}\n`, { encoding: 'utf8' });
    const updated = await this.update(current => {
      current.evidence = current.evidence || { event_count: 0, dropped_count: 0, gaps: [] };
      current.evidence.event_count += 1;
      return current;
    });
    if (queueState) queueState.last = record;
    return { accepted: true, record, run: updated };
  }

  async noteEvidenceGap(gap) {
    return this.update(run => {
      run.evidence = run.evidence || { event_count: 0, dropped_count: 0, gaps: [] };
      run.evidence.dropped_count = (run.evidence.dropped_count || 0) + 1;
      run.evidence.gaps = [...(run.evidence.gaps || []), { at: isoNow(), ...gap }];
      const disposition = run.collection_disposition?.value || run.collection_disposition;
      if (!disposition || disposition === 'complete') {
        if (run.collection_disposition && typeof run.collection_disposition === 'object') run.collection_disposition.value = 'incomplete';
        else run.collection_disposition = 'incomplete';
      }
      return run;
    });
  }

  async setCollectionDisposition(disposition, details = {}) {
    if (!['complete', 'incomplete', 'irrecoverable collection failure'].includes(disposition)) throw new Error(`invalid collection disposition: ${disposition}`);
    return this.update(run => { run.collection_disposition = { value: disposition, ...details, at: isoNow() }; return run; });
  }

  async preserveArtifact({ content, source, deliveredPr, deliveredHead } = {}) {
    if (typeof content !== 'string' || content.length === 0) throw new Error('durable investigation artifact content is required');
    const run = await this.read();
    if (!run) throw new Error('self-verification run has not been admitted');
    await atomicText(this.paths.artifact, content);
    const artifact = {
      path: this.paths.artifact,
      source,
      delivered_pr: deliveredPr,
      delivered_head: deliveredHead,
      sha256: createHash('sha256').update(content, 'utf8').digest('hex'),
      captured_at: isoNow()
    };
    return this.update(current => { current.artifact = artifact; return current; });
  }

  async finalize({ authoritativeReadback, cleanupHarness, irrecoverableCollection = false } = {}) {
    if (typeof authoritativeReadback !== 'function') throw new Error('finalization requires authoritativeReadback');
    if (typeof cleanupHarness !== 'function') throw new Error('finalization requires cleanupHarness');
    const run = await this.read();
    if (!run) throw new Error('self-verification run has not been admitted');
    if (run.finalization?.finalized === true) return { run, finalized: true, resumed: true };
    const safety = await authoritativeReadback(run);
    const safe = safety?.admission_safe === true && safety.task_dispatchable !== true && (!safety.execution_owners || safety.execution_owners.length === 0) && (!safety.conflicting_ownership || safety.conflicting_ownership.length === 0) && safety.workspace_absent === true;
    if (!safe) return { run: await this.read(), finalized: false, reason: 'admission_safe_closure_not_confirmed', authoritative: safety };
    const disposition = run.collection_disposition?.value || run.collection_disposition;
    if (disposition === 'incomplete' && !irrecoverableCollection) return { run, finalized: false, reason: 'collection_is_recoverable_incomplete' };
    if (!disposition) await this.setCollectionDisposition('complete');
    const cleanupRun = await withLock(this.paths.lock, async () => {
      const current = await this.read();
      if (!current || current.finalization?.finalized === true) return current;
      if (current.finalization?.phase !== 'cleanup_started') {
        current.finalization = { ...(current.finalization || {}), phase: 'cleanup_started', cleanup_started_at: isoNow(), cleanup: null };
        current.updated_at = isoNow();
        await atomicJson(this.paths.runRecord || this.currentRunPath, current);
        await atomicJson(this.currentRunPath, current);
      }
      return current;
    });
    if (!cleanupRun || cleanupRun.finalization?.finalized === true) return { run: cleanupRun, finalized: true, resumed: true };
    const cleanup = await cleanupHarness(cleanupRun);
    if (!cleanup || cleanup.ok !== true) return { run: await this.read(), finalized: false, reason: 'harness_cleanup_failed', cleanup };
    const afterCleanup = await this.read();
    const dispositionAfterCleanup = afterCleanup.collection_disposition?.value || afterCleanup.collection_disposition;
    const irrecoverableAfterCleanup = irrecoverableCollection || Boolean(afterCleanup.evidence?.gaps?.some(gap => gap.irrecoverable === true));
    if (dispositionAfterCleanup === 'incomplete' && !irrecoverableAfterCleanup) return { run: afterCleanup, finalized: false, reason: 'collection_is_recoverable_incomplete' };
    const finalDisposition = dispositionAfterCleanup === 'incomplete' && irrecoverableAfterCleanup ? 'irrecoverable collection failure' : dispositionAfterCleanup || 'complete';
    const finalized = await withLock(this.paths.lock, async () => {
      const current = await this.read();
      if (!current || current.finalization?.finalized === true) return current;
      current.collection_disposition = typeof current.collection_disposition === 'object' ? current.collection_disposition : { value: finalDisposition };
      current.collection_disposition.value = finalDisposition;
      current.finalization = { finalized: true, phase: 'finalized', finalized_at: isoNow(), cleanup };
      current.updated_at = isoNow();
      await atomicJson(this.paths.runRecord || this.currentRunPath, current);
      await atomicJson(this.currentRunPath, current);
      await atomicJson(this.paths.bundle, { run: current, authoritative: safety });
      return current;
    });
    return { run: finalized, finalized: true };
  }
}

export class EvidenceWriter {
  constructor(store, { maxQueue = DEFAULT_EVIDENCE_QUEUE_LIMIT, write = appendFile } = {}) {
    this.store = store;
    this.maxQueue = maxQueue;
    this.write = write;
    this.queue = [];
    this.running = false;
    this.waiters = [];
  }

  record(event) {
    if (this.queue.length >= this.maxQueue) {
      void this.store.noteEvidenceGap({ kind: 'evidence_queue_overflow', event: event?.kind || 'unknown' });
      return { accepted: false, reason: 'queue_full' };
    }
    this.queue.push(event);
    void this.drain();
    return { accepted: true };
  }

  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const event = this.queue.shift();
        try {
          await this.store.appendEvidence(event, { writer: this.write });
        } catch (error) {
          await this.store.noteEvidenceGap({ kind: 'evidence_writer_failure', event: event?.kind || 'unknown', error: String(error?.message || error) });
        }
      }
    } finally {
      this.running = false;
      for (const resolveWaiter of this.waiters.splice(0)) resolveWaiter();
    }
  }

  async flush() {
    if (!this.running && this.queue.length === 0) return;
    await new Promise(resolveWaiter => this.waiters.push(resolveWaiter));
    return this.flush();
  }
}

async function git(args, cwd) {
  try {
    const { stdout } = await execFile('git', args, { cwd, env: gitEnvironment, maxBuffer: 1024 * 1024 });
    return stdout.trim();
  } catch (error) {
    const detail = String(error?.stderr || error?.stdout || error?.message || error).trim().replace(/\s+/g, ' ').slice(0, 500);
    throw new Error(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
}

export async function planRunBinding({ repository, configuredBase, trackerDatabase, runId }) {
  if (typeof repository !== 'string' || repository.trim() === '') throw new Error('production repository is required');
  if (typeof configuredBase !== 'string' || configuredBase.trim() === '') throw new Error('configured base branch is required');
  const seedCommit = await readRemoteBranch(repository, configuredBase);
  if (!seedCommit) throw new Error(`configured base branch has no authoritative remote HEAD: ${configuredBase}`);
  const temporaryBase = `self-verification/${runId}`;
  return { repository, configuredBase, seedCommit, temporaryBase, trackerDatabase };
}

export async function materializeRunBinding(binding) {
  assertBinding(binding);
  const existing = await readRemoteBranch(binding.repository, binding.temporaryBase);
  if (existing && existing !== binding.seedCommit) throw new Error(`temporary base already exists at a different commit: ${binding.temporaryBase}`);
  if (!existing) await git(['push', binding.repository, `${binding.seedCommit}:refs/heads/${binding.temporaryBase}`]);
  const readback = await readRemoteBranch(binding.repository, binding.temporaryBase);
  if (readback !== binding.seedCommit) throw new Error(`temporary base readback mismatch: expected ${binding.seedCommit}, got ${readback || 'missing'}`);
  return binding;
}

export async function createRunBinding({ repository, configuredBase, trackerDatabase, runId }) {
  const binding = await planRunBinding({ repository, configuredBase, trackerDatabase, runId });
  await materializeRunBinding(binding);
  return binding;
}

export async function deleteRunBinding(binding) {
  if (!binding?.repository || !binding?.temporaryBase) return { ok: true, skipped: true };
  try {
    const existing = await readRemoteBranch(binding.repository, binding.temporaryBase);
    if (!existing) return { ok: true, skipped: true, readback: 'absent' };
    await git(['push', binding.repository, '--delete', binding.temporaryBase]);
    const readback = await readRemoteBranch(binding.repository, binding.temporaryBase);
    return readback ? { ok: false, error: `temporary base remained after deletion: ${binding.temporaryBase}` } : { ok: true };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

export async function writeRunProjectConfig(projectConfigPath, run, outputPath, extra = {}) {
  const config = JSON.parse(await readFile(resolve(projectConfigPath), 'utf8'));
  config.github_base_branch = run.binding.temporaryBase;
  config.notion_database_url = run.binding.trackerDatabase;
  config.state_directory = join(dirname(outputPath), 'operator-state');
  config.symphony_workspace_root = join(dirname(outputPath), 'workspaces');
  await atomicJson(outputPath, { ...config, ...extra });
  return outputPath;
}

export async function runWithDeadline(operation, deadlineMs, onTimeout = () => {}) {
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) return operation();
  const controller = new AbortController();
  let timeout;
  const deadline = new Promise(resolveDeadline => {
    timeout = setTimeout(() => {
      controller.abort();
      Promise.resolve().then(onTimeout).catch(() => {}).finally(() => resolveDeadline({ timed_out: true }));
    }, deadlineMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), deadline]);
  } finally {
    clearTimeout(timeout);
  }
}

export function selfVerificationUsage() {
  return 'Usage: self-verification <namespace|run> ...';
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  console.error(selfVerificationUsage());
  process.exitCode = 2;
}
