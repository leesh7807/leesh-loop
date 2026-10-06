import { randomUUID } from 'node:crypto';
import { chmod, link, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SUMMARY_DIRECTORY = 'e2e/history/runs';
const RUN_ID = /^[a-z0-9-]{1,80}$/i;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/ig;
const COMPACT_ID = /\b[0-9a-f]{32}\b/ig;

function oneLine(value, maxLength = 240) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, maxLength);
}

function conciseCause(value) {
  let cause = String(value ?? '');
  const failures = [...cause.matchAll(/\bfailed(?:\s*\([^)]*\))?:\s*/ig)];
  if (failures.length) cause = cause.slice(failures.at(-1).index + failures.at(-1)[0].length);
  const setupAttention = [...cause.matchAll(/Loop setup needs attention:\s*/ig)];
  if (setupAttention.length) cause = cause.slice(setupAttention.at(-1).index + setupAttention.at(-1)[0].length);
  else {
    const startupFailure = [...cause.matchAll(/Leesh Loop could not start:\s*/ig)];
    if (startupFailure.length) cause = cause.slice(startupFailure.at(-1).index + startupFailure.at(-1)[0].length);
  }
  const payloadStart = cause.indexOf('{');
  if (payloadStart >= 0) {
    const prefix = cause.slice(0, payloadStart).trim();
    try {
      const payload = JSON.parse(cause.slice(payloadStart));
      const code = typeof payload.code === 'string' ? payload.code : null;
      const message = typeof payload.message === 'string' ? payload.message : null;
      cause = [prefix, code, message].filter(Boolean).join(': ');
    } catch {
      cause = prefix;
    }
  }
  return cause || 'Failure details unavailable';
}

function safeCause(value) {
  return oneLine(conciseCause(value))
    .replace(/Bearer\s+[^\s,;]+/ig, 'Bearer [redacted]')
    .replace(/(?:token|secret|password|authorization|api[-_ ]?key|access[-_ ]?key|private[-_ ]?key|credential|cookie)[\s_-]*(?:=|:)\s*[^\s,;]+/ig, '[redacted credential]')
    .replace(/https?:\/\/[^\s,;]+/ig, '[URL]')
    .replace(UUID, '[ID]')
    .replace(COMPACT_ID, '[ID]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{12,}|ntn_[A-Za-z0-9_-]{12,})\b/g, '[redacted credential]')
    .replace(/(?:^|\s)(\/(?:[^\s,;]+\/)+[^\s,;]*)/g, ' [path]')
    .replace(/(?:^|[\s=])(?:\.{1,2}\/)?e2e\/(?:runs|workspaces)\/[^\s,;]+/ig, ' [path]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted opaque value]')
    .replace(/\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d{2,5}\b/g, '[local endpoint]');
}

function md(value, maxLength = 240) {
  return oneLine(value, maxLength).replace(/\|/g, '\\|');
}

function pullRequestIdentity(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return 'none';
    return url.origin + url.pathname.replace(/\/+$/, '');
  } catch {
    return 'none';
  }
}

function duration(record) {
  const recorded = record.timing?.run?.observed_duration_ms;
  const measured = Number.isFinite(recorded) ? recorded : Date.parse(record.ended_at) - Date.parse(record.started_at);
  return Number.isFinite(measured) && measured >= 0 ? Math.round(measured / 1000) + 's' : 'unknown';
}

function recoveryOutcomes(record) {
  const recovery = record.recovery || record.admission?.recovery || [];
  const counts = new Map();
  for (const item of recovery) {
    const result = oneLine(item.result || item.status);
    if (!result || result === 'available') continue;

    const outcome = result === 'recovered'
      ? 'recovered'
      : result.startsWith('recovered;')
        ? 'recovered with cleanup pending'
        : item.status === 'unavailable' || result === 'still unavailable'
          ? 'unavailable'
          : item.status === 'in use'
            ? 'active'
            : item.status === 'unknown' || result.includes('could not verify')
              ? 'unverified'
              : 'follow-up';
    counts.set(outcome, (counts.get(outcome) || 0) + 1);
  }
  return [...counts].map(([outcome, count]) => {
    const reservations = `${count} pool reservation${count === 1 ? '' : 's'}`;
    if (outcome === 'recovered') return `${reservations} recovered`;
    if (outcome === 'recovered with cleanup pending') return `${reservations} recovered with cleanup pending`;
    if (outcome === 'unavailable') return `${reservations} remain unavailable`;
    if (outcome === 'active') return `${count} active pool reservation${count === 1 ? '' : 's'} preserved`;
    if (outcome === 'unverified') return `${count} pool reservation state${count === 1 ? '' : 's'} unverified`;
    return `${count} pool recovery outcome${count === 1 ? '' : 's'} need follow-up`;
  });
}

function failureSummary(record) {
  const failures = Array.isArray(record.failures) ? record.failures : [];
  const failure = failures.find(item => item.phase !== 'finalization' && item.phase !== 'database_reservation_finalization')
    || failures[0];
  if (failure) return { stage: md(failure.phase || 'unknown'), cause: safeCause(failure.error || 'Failure details unavailable') };
  if (record.error) {
    const stage = record.kind === 'e2e_run_admission' ? 'database_admission' : 'run';
    return { stage, cause: safeCause(record.error) };
  }
  return null;
}

function resultLines(record) {
  const observations = Array.isArray(record.lifecycle?.observations) ? record.lifecycle.observations : [];
  const lifecycle = [...new Set(observations.map(item => md(item.state, 80)).filter(Boolean))];
  if (record.lifecycle?.terminal_state && !lifecycle.includes(record.lifecycle.terminal_state)) lifecycle.push(md(record.lifecycle.terminal_state, 80));
  const failure = failureSummary(record);
  const substantiveFailure = (record.failures || []).some(item => !['finalization', 'database_reservation_finalization'].includes(item.phase));
  const result = record.kind === 'e2e_run_admission'
    ? record.status || 'unknown'
    : record.status === 'failed' || substantiveFailure || Boolean(failure)
      ? 'failed'
      : record.status || 'unknown';
  const cleanup = record.cleanup || {};
  const finalization = record.finalization || {};
  const reservation = record.database_reservation?.status || (record.kind === 'e2e_run_admission' ? 'not acquired' : 'unknown');
  const deletedBranches = Array.isArray(cleanup.branches_deleted) ? cleanup.branches_deleted.length : 0;
  const deletedWorkspaces = Array.isArray(cleanup.workspaces_deleted) ? cleanup.workspaces_deleted.length : 0;
  const unresolved = [...new Set([...(finalization.unresolved || []), ...(cleanup.unresolved || [])].map(item => {
    const action = String(item);
    if (action.startsWith('delete_run_scoped_base:')) return 'base branch cleanup';
    if (action.startsWith('delete_delivery_branch:')) return 'delivery branch cleanup';
    if (action.startsWith('delete_workspace_root:')) return 'workspace cleanup';
    if (action === 'run_lifecycle_coordination_cleanup') return 'run coordination cleanup';
    if (action === 'database_reservation_finalization') return 'database settlement';
    if (action === 'write_run_summary') return 'summary generation';
    return action;
  }))];
  const recovery = recoveryOutcomes(record);
  const lines = [
    '# Run summary',
    '',
    '- Run ID: ' + md(record.run_id, 100),
    '- Started: ' + md(record.started_at || 'unknown', 80),
    '- Ended: ' + md(record.ended_at || 'unknown', 80),
    '- Duration: ' + duration(record),
    '- Workload: ' + md(record.workload?.id || record.workload?.catalog_entry_id || 'unknown', 120),
    '- Task: ' + md(record.artifacts?.task_identifier || record.workload?.plan_identifier || 'unknown', 120),
    '- Lifecycle: ' + (lifecycle.length ? lifecycle.join(' → ') : 'not observed'),
    '- Verified through: ' + md(record.lifecycle?.verified_through || 'none', 80),
    '- Result: ' + md(result, 80) + (record.lifecycle?.terminal_state ? ' (task ' + md(record.lifecycle.terminal_state, 80) + ')' : ''),
    '- Delivery: ' + md(pullRequestIdentity(record.artifacts?.delivery_pr_url), 180),
    '- Delivered head: ' + md(record.artifacts?.delivered_head || 'none', 80),
    '- Merged head: ' + md(record.artifacts?.merged_head || 'none', 80),
    '- Finalization: ' + (finalization.complete === true ? 'complete' : finalization.complete === false ? 'incomplete' : 'not applicable'),
    '- Runtime stopped: ' + (cleanup.runtime_stopped === true ? 'yes' : cleanup.runtime_stopped === false ? 'no' : 'not started'),
    '- Run-owned branches deleted: ' + deletedBranches,
    '- Workspaces deleted: ' + deletedWorkspaces,
    '- Database reservation: ' + md(reservation, 80),
    '- Run coordination removed: ' + (cleanup.run_lifecycle_coordination_deleted === true ? 'yes' : unresolved.includes('run coordination cleanup') ? 'pending' : record.kind === 'e2e_run_admission' ? 'not applicable' : 'unknown'),
    '- Cleanup unresolved: ' + (unresolved.length ? unresolved.join(', ') : 'none'),
    '- Recovery: ' + (recovery.length ? recovery.join('; ') : 'none')
  ];
  if (failure) {
    lines.push('- Failure stage: ' + failure.stage);
    lines.push('- Failure summary: ' + md(failure.cause, 240));
  }
  return lines.join('\n') + '\n';
}

export class RunSummaryStore {
  constructor({ repositoryRoot } = {}) {
    this.repositoryRoot = repositoryRoot;
  }

  summaryPath(runId) {
    if (!RUN_ID.test(runId || '')) throw new Error('invalid run identity for summary path');
    return join(this.repositoryRoot, SUMMARY_DIRECTORY, runId + '.md');
  }

  async write(record) {
    if (!this.repositoryRoot) throw new Error('run summary requires the outer repository checkout');
    const path = this.summaryPath(record.run_id);
    await mkdir(join(this.repositoryRoot, SUMMARY_DIRECTORY), { recursive: true, mode: 0o755 });
    const content = resultLines(record);
    const temporary = join(this.repositoryRoot, SUMMARY_DIRECTORY, '.' + record.run_id + '.' + process.pid + '.' + randomUUID() + '.tmp');
    await writeFile(temporary, content, { flag: 'wx', mode: 0o644 });
    await chmod(temporary, 0o644);
    try {
      try {
        await link(temporary, path);
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        const existing = await readFile(path, 'utf8');
        if (!existing.includes('- Run ID: ' + record.run_id + '\n')) throw new Error('run summary path already belongs to a different run');
        return { path, created: false };
      }
      return { path, created: true };
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
