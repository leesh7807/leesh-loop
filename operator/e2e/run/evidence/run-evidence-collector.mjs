import { sha256 } from '../../model/plan-identity.mjs';
import { currentTimeIso } from '../run-timing.mjs';

async function readExternalSystem(operation, signal) {
  try { return { value: await operation(signal), error: null }; }
  catch (error) { return { value: null, error: String(error?.message || error) }; }
}

export class RunEvidenceCollector {
  constructor({ notionClient, operatorClient, githubClient, gitClient, chatgptShotClient }) {
    this.notion = notionClient;
    this.operator = operatorClient;
    this.github = githubClient;
    this.git = gitClient;
    this.chatgptShot = chatgptShotClient;
  }

  async collectSnapshot({ record, databaseUrl, identifier, dashboard, baseBranch, workspaceRoot, signal }) {
    const at = currentTimeIso();
    const [task, runtimeStatus, runtimeState, symphonyIssue, trackerInput, prs, refs] = await Promise.all([
      readExternalSystem(activeSignal => this.notion.readTask(databaseUrl, identifier, activeSignal), signal),
      readExternalSystem(activeSignal => dashboard ? this.operator.readSymphonyRuntimeStatus(dashboard, activeSignal) : null, signal),
      readExternalSystem(activeSignal => dashboard ? this.operator.readSymphonyRuntimeState(dashboard, activeSignal) : null, signal),
      readExternalSystem(activeSignal => dashboard ? this.operator.readSymphonyIssue(dashboard, identifier, activeSignal) : null, signal),
      readExternalSystem(activeSignal => dashboard ? this.operator.readDispatchedTrackerInput(dashboard, identifier, activeSignal) : null, signal),
      readExternalSystem(activeSignal => baseBranch ? this.github.pullRequestsForBase(baseBranch, activeSignal) : [], signal),
      readExternalSystem(activeSignal => this.git.listRemoteBranchRefs({ signal: activeSignal }), signal)
    ]);
    const taskValue = task.value;
    const chatgptShot = taskValue ? await readExternalSystem(activeSignal => this.chatgptShot.inspectReviewJobs(taskValue.workpad || '', activeSignal), signal) : { value: null, error: null };
    const snapshot = {
      observed_at: at,
      notion: taskValue ? { id: taskValue.id, url: taskValue.url, identifier: taskValue.identifier, state: taskValue.state, accepted_plan_sha256: sha256(taskValue.accepted_plan || ''), accepted_plan: taskValue.accepted_plan, workpad: taskValue.workpad } : null,
      symphony: { runtime: runtimeStatus.value, state: runtimeState.value, issue: symphonyIssue.value, tracker_input: trackerInput.value },
      github: { delivery_prs: prs.value },
      git: { remote_refs: refs.value },
      chatgpt_shot: chatgptShot.value,
      errors: [task, runtimeStatus, runtimeState, symphonyIssue, trackerInput, prs, refs, chatgptShot].map(value => value.error).filter(Boolean),
      workspace_root: workspaceRoot || null
    };
    if (chatgptShot.value) {
      const timing = record.timing.chatgpt_shot;
      const jobId = chatgptShot.value.job_id ?? null;
      if (jobId && timing.job_id !== jobId) {
        timing.job_id = jobId;
        timing.first_observed_at = at;
        timing.observed_duration_ms = chatgptShot.value.observed_duration_ms ?? 0;
      } else if (jobId) {
        const authoritativeDuration = chatgptShot.value.observed_duration_ms;
        timing.observed_duration_ms = Number.isFinite(authoritativeDuration)
          ? authoritativeDuration
          : Date.parse(at) - Date.parse(timing.first_observed_at);
      }
      timing.last_observed_at = jobId ? at : timing.last_observed_at;
      timing.terminal_state = chatgptShot.value.terminal_state ?? null;
      timing.observations.push({ observed_at: at, job_id: jobId, state: chatgptShot.value.terminal_state ?? null, result: chatgptShot.value.result ?? null, error: chatgptShot.value.error ?? null });
    }
    const workerStartedAt = symphonyIssue.value?.running?.started_at || symphonyIssue.value?.retry?.started_at || null;
    if (workerStartedAt) {
      record.timing.symphony.worker_started_at ||= workerStartedAt;
      record.timing.symphony.observed_duration_ms = Date.parse(at) - Date.parse(record.timing.symphony.worker_started_at);
    }
    return snapshot;
  }
}
