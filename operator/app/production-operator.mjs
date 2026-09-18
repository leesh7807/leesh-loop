#!/usr/bin/env node

import { execFile as execute } from 'node:child_process';
import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execute);
const notionVersion = '2025-09-03';
const requiredTaskProperties = ['Identifier', 'Title', 'State', 'Priority', 'Labels', 'Blocked By', 'Plan'];
const propertyNames = { approvedHead: 'Approved HEAD', approvedReviewJob: 'Approved Review Job', approvedPr: 'Approved PR', dispatchFence: 'Dispatch Fence', closureReason: 'Closure Reason' };
const localLocks = new Map();

function notionDatabaseId(url) {
  const match = String(url || '').match(/([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}|[\da-f]{32})(?:[?#/]|$)/i);
  if (!match) throw new Error('invalid Notion database URL');
  return match[1].replaceAll('-', '').toLowerCase();
}

function richText(value) {
  const values = value?.type === 'rich_text' ? value.rich_text : value?.rich_text;
  return Array.isArray(values) ? values.map(item => item?.plain_text ?? item?.text?.content ?? '').join('') : '';
}

function propertyText(properties, name) {
  const property = properties?.[name];
  if (property?.type === 'rich_text' || Array.isArray(property?.rich_text)) return richText(property);
  if (property?.type === 'title') return Array.isArray(property.title) ? property.title.map(item => item?.plain_text ?? item?.text?.content ?? '').join('') : '';
  return '';
}

function stateOf(page) {
  return page?.properties?.State?.select?.name || null;
}

function validSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value);
}

function normalizeSha(value) {
  if (!validSha(value)) throw new Error(`expected full commit SHA, got ${value || 'empty'}`);
  return value.toLowerCase();
}

async function withTaskLock(key, operation, root = process.env.LEESH_LOOP_OPERATOR_LOCK_ROOT) {
  const previous = localLocks.get(key);
  let release;
  const current = new Promise(resolve => { release = resolve; });
  localLocks.set(key, current);
  if (previous) await previous;
  try {
    if (!root) return await operation();
    await mkdir(root, { recursive: true, mode: 0o700 });
    const lockPath = join(root, `${createHash('sha256').update(key).digest('hex')}.lock`);
    // The in-process queue protects normal Operator calls. The filesystem
    // marker makes the identity visible to diagnostics without pretending it
    // is a second tracker authority.
    const started = Date.now();
    while (true) {
      try {
        await mkdir(lockPath, { mode: 0o700 });
        const owner = await open(join(lockPath, 'owner.json'), 'wx', 0o600);
        await owner.writeFile(JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
        await owner.close();
        break;
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        if (Date.now() - started > 30_000) throw new Error(`timed out waiting for production Operator lock: ${key}`);
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
    try { return await operation(); } finally { await rm(lockPath, { recursive: true, force: true }); }
  } finally {
    release();
    if (localLocks.get(key) === current) localLocks.delete(key);
  }
}

export class NotionProductionOperator {
  constructor({ token, databaseUrl, configuredBase, fetcher = globalThis.fetch, readPullRequest, readReviewJob, appendWorkpad, operatorLockRoot } = {}) {
    if (!token) throw new Error('NOTION_TOKEN is required for production Operator actions');
    this.token = token;
    this.databaseUrl = databaseUrl;
    this.databaseId = notionDatabaseId(databaseUrl);
    this.configuredBase = configuredBase || null;
    this.fetcher = fetcher;
    this.readPullRequest = readPullRequest || defaultPullRequestReader;
    this.readReviewJob = readReviewJob || (async () => null);
    this.appendWorkpadOverride = appendWorkpad;
    this.operatorLockRoot = operatorLockRoot;
  }

  async request(method, path, body) {
    let response;
    try {
      response = await this.fetcher(`https://api.notion.com/v1${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, 'Notion-Version': notionVersion, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (error) {
      throw new Error(`Notion transport failure: ${error?.message || error}`);
    }
    if (!response.ok) throw new Error(`Notion provider failure (${response.status}): ${(await response.text()).slice(0, 500)}`);
    return response.json();
  }

  async resolveTaskDataSource() {
    const database = await this.request('GET', `/databases/${this.databaseId}`);
    const sources = [];
    for (const entry of database?.data_sources || []) {
      const id = entry?.id;
      if (!id) throw new Error('Notion database returned malformed data-source metadata');
      sources.push({ id, schema: await this.request('GET', `/data_sources/${id}`) });
    }
    const candidates = sources.filter(source => {
      const props = source.schema?.properties || {};
      return requiredTaskProperties.every(name => props[name]) && props.State.type === 'select' && props['Blocked By'].type === 'relation' && props.Plan.type === 'relation';
    });
    if (candidates.length !== 1) throw new Error(`expected exactly one canonical task data source, found ${candidates.length}`);
    return candidates[0].id;
  }

  async ensureOperatorProperties(sourceId) {
    const schema = await this.request('GET', `/data_sources/${sourceId}`);
    const missing = {};
    for (const name of Object.values(propertyNames)) if (!schema.properties?.[name]) missing[name] = { rich_text: {} };
    if (Object.keys(missing).length) await this.request('PATCH', `/data_sources/${sourceId}`, { properties: missing });
  }

  async readTask(taskId, sourceId = null) {
    const source = sourceId || await this.resolveTaskDataSource();
    const page = await this.request('GET', `/pages/${taskId}`);
    if (page?.parent?.type !== 'data_source_id' || page.parent.data_source_id !== source) throw new Error('task identity is outside the configured tracker data source');
    return { sourceId: source, page };
  }

  async patchTask(taskId, properties, sourceId, expectedState = null) {
    const current = await this.readTask(taskId, sourceId);
    if (expectedState && stateOf(current.page) !== expectedState) throw new Error(`task state changed before production mutation: expected ${expectedState}, got ${stateOf(current.page) || 'missing'}`);
    return this.request('PATCH', `/pages/${taskId}`, { properties });
  }

  async appendWorkpad(taskId, text) {
    if (this.appendWorkpadOverride) return this.appendWorkpadOverride(taskId, text);
    return this.request('PATCH', `/blocks/${taskId}/children`, { children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: text } }] } }] });
  }

  async readWorkpad(taskId) {
    const blocks = [];
    let cursor;
    do {
      const suffix = cursor ? `?page_size=100&start_cursor=${encodeURIComponent(cursor)}` : '?page_size=100';
      const page = await this.request('GET', `/blocks/${taskId}/children${suffix}`);
      for (const block of page?.results || []) {
        if (block?.type === 'paragraph') blocks.push((block.paragraph?.rich_text || []).map(item => item?.plain_text ?? item?.text?.content ?? '').join(''));
      }
      cursor = page?.has_more ? page.next_cursor : undefined;
      if (page?.has_more && !cursor) throw new Error('Notion Workpad pagination omitted next_cursor');
    } while (cursor);
    return blocks;
  }

  async approvalInput({ deliveredPr, deliveredHead, reviewTargetHead, reviewJobId, review } = {}) {
    const head = normalizeSha(deliveredHead);
    if (head !== normalizeSha(reviewTargetHead)) throw new Error('delivered PR HEAD and independent review target HEAD differ');
    const pullRequest = await this.readPullRequest(deliveredPr);
    const pullRequestHead = pullRequest?.headOid || pullRequest?.headRefOid;
    if (!pullRequest || String(pullRequest.state || '').toUpperCase() === 'CLOSED' || normalizeSha(pullRequestHead) !== head) throw new Error('delivered PR source HEAD is not the reviewed HEAD');
    if (this.configuredBase && pullRequest.baseRefName !== this.configuredBase) throw new Error(`delivered PR targets ${pullRequest.baseRefName || 'unknown'} instead of configured base ${this.configuredBase}`);
    const job = review || await this.readReviewJob(reviewJobId);
    if (!job || job.state !== 'completed' || !/\bPASS\b/.test(String(job.result || ''))) throw new Error('independent review Job is not a completed PASS for the delivered HEAD');
    if (normalizeSha(job.targetHead || reviewTargetHead) !== head) throw new Error('independent review Job target HEAD does not match the delivered HEAD');
    return { head, pullRequest, job, reviewJobId: reviewJobId || job.id };
  }

  async approveHumanReview({ taskId, deliveredPr, deliveredHead, reviewTargetHead, reviewJobId, review } = {}) {
    if (!taskId) throw new Error('immutable task identity is required');
    return withTaskLock(`approval:${this.databaseId}:${taskId}`, async () => {
      const source = await this.resolveTaskDataSource();
      await this.ensureOperatorProperties(source);
      const first = await this.readTask(taskId, source);
      const currentState = stateOf(first.page);
      const existingHead = propertyText(first.page.properties, propertyNames.approvedHead).toLowerCase();
      if (currentState === 'Merging' && existingHead) {
        const input = await this.approvalInput({ deliveredPr, deliveredHead, reviewTargetHead, reviewJobId, review });
        if (existingHead !== input.head) throw new Error('Merging task has a different approved HEAD');
        return { outcome: 'already_approved', taskId, approvedHead: input.head, state: currentState };
      }
      if (currentState !== 'Human Review') throw new Error(`Human Review approval requires Human Review state, got ${currentState || 'missing'}`);
      const input = await this.approvalInput({ deliveredPr, deliveredHead, reviewTargetHead, reviewJobId, review });
      await this.appendWorkpad(taskId, `Human Review Approval\napproved_head: ${input.head}\napproved_pr: ${deliveredPr}\nreview_job: ${input.reviewJobId}`);
      await this.patchTask(taskId, {
        [propertyNames.approvedHead]: { rich_text: [{ type: 'text', text: { content: input.head } }] },
        [propertyNames.approvedReviewJob]: { rich_text: [{ type: 'text', text: { content: String(input.reviewJobId || '') } }] },
        [propertyNames.approvedPr]: { rich_text: [{ type: 'text', text: { content: String(deliveredPr) } }] },
        State: { select: { name: 'Merging' } }
      }, source, 'Human Review');
      const readback = await this.readTask(taskId, source);
      if (stateOf(readback.page) !== 'Merging' || propertyText(readback.page.properties, propertyNames.approvedHead).toLowerCase() !== input.head) throw new Error('authoritative Merging approval readback did not match the approved HEAD');
      const postMutationPr = await this.readPullRequest(deliveredPr);
      const postMutationHead = normalizeSha(postMutationPr?.headOid || postMutationPr?.headRefOid);
      if (postMutationHead !== input.head) {
        const mismatch = `Human Review approval HEAD changed during mutation\napproved_head: ${input.head}\ncurrent_pr_head: ${postMutationHead}\ntransition: Rework`;
        await this.appendWorkpad(taskId, mismatch);
        await this.patchTask(taskId, {
          State: { select: { name: 'Rework' } },
          [propertyNames.approvedHead]: { rich_text: [] },
          [propertyNames.approvedReviewJob]: { rich_text: [] },
          [propertyNames.approvedPr]: { rich_text: [] }
        }, source, 'Merging');
        const staleReadback = await this.readTask(taskId, source);
        return { outcome: 'stale_approval', taskId, approvedHead: input.head, currentHead: postMutationHead, state: stateOf(staleReadback.page) };
      }
      return { outcome: 'approved', taskId, approvedHead: input.head, state: 'Merging', reviewJobId: input.reviewJobId };
    }, this.operatorLockRoot);
  }

  async verifyMergingApproval({ taskId, deliveredPr, readPullRequest = this.readPullRequest } = {}) {
    const source = await this.resolveTaskDataSource();
    const current = await this.readTask(taskId, source);
    const approvedHead = propertyText(current.page.properties, propertyNames.approvedHead).toLowerCase();
    if (stateOf(current.page) !== 'Merging' || !validSha(approvedHead)) throw new Error('Merging task has no valid approved HEAD');
    const pullRequest = await readPullRequest(deliveredPr);
    const currentHead = normalizeSha(pullRequest.headOid || pullRequest.headRefOid);
    if (this.configuredBase && pullRequest.baseRefName !== this.configuredBase) throw new Error(`Merging PR targets ${pullRequest.baseRefName || 'unknown'} instead of configured base ${this.configuredBase}`);
    if (currentHead !== approvedHead) {
      await this.appendWorkpad(taskId, `Merging HEAD mismatch\napproved_head: ${approvedHead}\ncurrent_pr_head: ${currentHead}\ntransition: Rework`);
      await this.patchTask(taskId, {
        State: { select: { name: 'Rework' } },
        [propertyNames.approvedHead]: { rich_text: [] },
        [propertyNames.approvedReviewJob]: { rich_text: [] },
        [propertyNames.approvedPr]: { rich_text: [] }
      }, source, 'Merging');
      const readback = await this.readTask(taskId, source);
      if (stateOf(readback.page) !== 'Rework') throw new Error('authoritative Rework readback did not match stale approval transition');
      return { ok: false, reason: 'stale_approval', state: stateOf(readback.page), approvedHead, currentHead };
    }
    return { ok: true, state: 'Merging', approvedHead, currentHead };
  }

  async closeStrandedTask({ taskId, terminalState = 'Cancelled', readExecutionOwnership, reason = 'self-verification stranded task closure' } = {}) {
    if (typeof readExecutionOwnership !== 'function') throw new Error('stranded closure requires an authoritative execution ownership reader');
    return withTaskLock(`closure:${this.databaseId}:${taskId}`, async () => {
      const source = await this.resolveTaskDataSource();
      await this.ensureOperatorProperties(source);
      const first = await this.readTask(taskId, source);
      const state = stateOf(first.page);
      if (!['Ready', 'In Progress', 'Rework'].includes(state)) throw new Error(`stranded closure requires an active dispatch state, got ${state || 'missing'}`);
      const before = await readExecutionOwnership(taskId);
      if (before?.length) return { closed: false, reason: 'execution_ownership_exists', ownership: before };
      const existingFence = propertyText(first.page.properties, propertyNames.dispatchFence);
      const fence = existingFence || randomUUID();
      await this.patchTask(taskId, { [propertyNames.dispatchFence]: { rich_text: [{ type: 'text', text: { content: fence } }] } }, source, state);
      const fenced = await this.readTask(taskId, source);
      if (propertyText(fenced.page.properties, propertyNames.dispatchFence) !== fence) return { closed: false, reason: 'dispatch_fence_readback_failed' };
      const after = await readExecutionOwnership(taskId);
      if (after?.length) return { closed: false, reason: 'scheduler_claim_won_race', ownership: after };
      await this.appendWorkpad(taskId, `Production Operator stranded closure\nfence: ${fence}\nterminal_state: ${terminalState}\nreason: ${reason}`);
      await this.patchTask(taskId, { State: { select: { name: terminalState } }, [propertyNames.closureReason]: { rich_text: [{ type: 'text', text: { content: reason } }] } }, source, state);
      const readback = await this.readTask(taskId, source);
      return { closed: stateOf(readback.page) === terminalState, state: stateOf(readback.page), fence, taskId };
    }, this.operatorLockRoot);
  }
}

async function defaultPullRequestReader(pr) {
  const { stdout } = await execFile('gh', ['pr', 'view', String(pr), '--json', 'url,state,baseRefName,headRefOid'], { env: process.env, maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout);
}

export { notionDatabaseId, propertyNames, propertyText, stateOf, validSha };

async function localEnvironmentValue(name) {
  try {
    const contents = await readFile(join(process.cwd(), '.env'), 'utf8');
    const line = contents.split(/\r?\n/).find(candidate => candidate.match(new RegExp(`^\\s*${name}=`)));
    return line?.split('=').slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
  } catch { return undefined; }
}

function argument(args, name, required = true) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (required && !value) throw new Error(`${name} is required`);
  return value;
}

async function dashboardOwnership(dashboard, identifier) {
  const response = await fetch(`${dashboard.replace(/\/$/, '')}/api/v1/${encodeURIComponent(identifier)}`);
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`Symphony ownership read failed: HTTP ${response.status}`);
  const payload = await response.json();
  return payload.status === 'running' || payload.status === 'retrying' || payload.status === 'blocked' ? [payload] : [];
}

async function main() {
  const args = process.argv.slice(2);
  const command = args.shift();
  const databaseUrl = argument(args, '--database-url');
  const token = process.env.NOTION_TOKEN || await localEnvironmentValue('NOTION_TOKEN');
  if (!token) throw new Error('NOTION_TOKEN is required');
  const operator = new NotionProductionOperator({ token, databaseUrl, configuredBase: argument(args, '--configured-base', false) || null, operatorLockRoot: process.env.LEESH_LOOP_OPERATOR_LOCK_ROOT });
  if (command === 'approve') {
    return operator.approveHumanReview({
      taskId: argument(args, '--task-id'), deliveredPr: argument(args, '--delivered-pr'), deliveredHead: argument(args, '--delivered-head'),
      reviewTargetHead: argument(args, '--review-target-head'), reviewJobId: argument(args, '--review-job-id')
    });
  }
  if (command === 'verify-merging') return operator.verifyMergingApproval({ taskId: argument(args, '--task-id'), deliveredPr: argument(args, '--delivered-pr') });
  if (command === 'close-stranded') {
    const dashboard = argument(args, '--dashboard');
    const identifier = argument(args, '--issue-identifier');
    return operator.closeStrandedTask({ taskId: argument(args, '--task-id'), terminalState: argument(args, '--terminal-state', false) || 'Cancelled', readExecutionOwnership: () => dashboardOwnership(dashboard, identifier) });
  }
  throw new Error('Usage: production-operator <approve|verify-merging|close-stranded> --database-url URL ...');
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname) {
  main().then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => { process.stderr.write(`Production Operator failed: ${error.message}\n`); process.exitCode = 1; });
}
