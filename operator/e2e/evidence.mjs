import { nowIso, sha256 } from './common.mjs';

async function observed(operation) {
  try { return { value: await operation(), error: null }; }
  catch (error) { return { value: null, error: String(error?.message || error) }; }
}

export class EvidenceCollector {
  constructor({ notion, runtime, github, git, review }) {
    this.notion = notion;
    this.runtime = runtime;
    this.github = github;
    this.git = git;
    this.review = review;
  }

  async snapshot({ record, databaseUrl, identifier, dashboard, baseBranch, workspaceRoot }) {
    const at = nowIso();
    const [task, runtime, state, issue, trackerInput, prs, refs] = await Promise.all([
      observed(() => this.notion.readTask(databaseUrl, identifier)),
      observed(() => dashboard ? this.runtime.runtime(dashboard) : null),
      observed(() => dashboard ? this.runtime.state(dashboard) : null),
      observed(() => dashboard ? this.runtime.issue(dashboard, identifier) : null),
      observed(() => dashboard ? this.runtime.trackerInput(dashboard, identifier) : null),
      observed(() => baseBranch ? this.github.pullRequestsForBase(baseBranch) : []),
      observed(() => this.git.remoteRefs())
    ]);
    const taskValue = task.value;
    const review = taskValue ? await observed(() => this.review.inspect(taskValue.workpad || '')) : { value: null, error: null };
    const snapshot = {
      observed_at: at,
      notion: taskValue ? { id: taskValue.id, url: taskValue.url, identifier: taskValue.identifier, state: taskValue.state, accepted_plan_sha256: sha256(taskValue.accepted_plan || ''), accepted_plan: taskValue.accepted_plan, workpad: taskValue.workpad } : null,
      symphony: { runtime: runtime.value, state: state.value, issue: issue.value, tracker_input: trackerInput.value },
      github: { delivery_prs: prs.value },
      git: { remote_refs: refs.value },
      chatgpt_shot: review.value,
      errors: [task, runtime, state, issue, trackerInput, prs, refs, review].map(value => value.error).filter(Boolean),
      workspace_root: workspaceRoot || null
    };
    if (review.value) {
      const timing = record.timing.chatgpt_shot;
      const jobId = review.value.job_id ?? null;
      if (jobId && timing.job_id !== jobId) {
        timing.job_id = jobId;
        timing.first_observed_at = at;
        timing.observed_duration_ms = review.value.observed_duration_ms ?? 0;
      } else if (jobId) {
        const authoritativeDuration = review.value.observed_duration_ms;
        timing.observed_duration_ms = Number.isFinite(authoritativeDuration)
          ? authoritativeDuration
          : Date.parse(at) - Date.parse(timing.first_observed_at);
      }
      timing.last_observed_at = jobId ? at : timing.last_observed_at;
      timing.terminal_state = review.value.terminal_state ?? null;
      timing.observations.push({ observed_at: at, job_id: jobId, state: review.value.terminal_state ?? null, result: review.value.result ?? null, error: review.value.error ?? null });
    }
    const workerStartedAt = issue.value?.running?.started_at || issue.value?.retry?.started_at || null;
    if (workerStartedAt) {
      record.timing.symphony.worker_started_at ||= workerStartedAt;
      record.timing.symphony.observed_duration_ms = Date.parse(at) - Date.parse(record.timing.symphony.worker_started_at);
    }
    return snapshot;
  }
}
