import { randomUUID } from 'node:crypto';

export const waitForNextPoll = milliseconds => new Promise(resolveSleep => setTimeout(resolveSleep, milliseconds));
export const currentTimeIso = () => new Date().toISOString();
export const createRunId = () => randomUUID();

export class RunTimingRecorder {
  recordSymphonyStartRequested(record, observedAt) {
    record.timing.symphony.start_requested_at = observedAt;
  }

  recordSymphonyStarted(record, observedAt) {
    record.timing.symphony.started_at = observedAt;
  }

  recordSymphonyStopped(record, observedAt) {
    record.timing.symphony.stopped_at = observedAt;
  }

  recordLifecycleTiming(record, state, observedAt) {
    record.timing.lifecycle[state] ||= { first_observed_at: observedAt, last_observed_at: observedAt, observed_duration_ms: null };
    record.timing.lifecycle[state].last_observed_at = observedAt;
    record.timing.lifecycle[state].observed_duration_ms = Date.parse(observedAt) - Date.parse(record.timing.lifecycle[state].first_observed_at);
  }

  recordEvidenceSnapshot(record, snapshot) {
    const at = snapshot.observed_at;
    const chatgptShot = snapshot.chatgpt_shot;
    if (chatgptShot) {
      const timing = record.timing.chatgpt_shot;
      const jobId = chatgptShot.job_id ?? null;
      if (jobId && timing.job_id !== jobId) {
        timing.job_id = jobId;
        timing.first_observed_at = at;
        timing.observed_duration_ms = chatgptShot.observed_duration_ms ?? 0;
      } else if (jobId) {
        const authoritativeDuration = chatgptShot.observed_duration_ms;
        timing.observed_duration_ms = Number.isFinite(authoritativeDuration)
          ? authoritativeDuration
          : Date.parse(at) - Date.parse(timing.first_observed_at);
      }
      timing.last_observed_at = jobId ? at : timing.last_observed_at;
      timing.terminal_state = chatgptShot.terminal_state ?? null;
      timing.observations.push({ observed_at: at, job_id: jobId, state: chatgptShot.terminal_state ?? null, result: chatgptShot.result ?? null, error: chatgptShot.error ?? null });
    }

    const workerStartedAt = snapshot.symphony?.issue?.running?.started_at || snapshot.symphony?.issue?.retry?.started_at || null;
    if (workerStartedAt) {
      record.timing.symphony.worker_started_at ||= workerStartedAt;
      record.timing.symphony.observed_duration_ms = Date.parse(at) - Date.parse(record.timing.symphony.worker_started_at);
    }
  }

  recordRunEnded(record, endedAt) {
    record.ended_at = endedAt;
    record.timing.run.ended_at = endedAt;
    record.timing.run.observed_duration_ms = Date.parse(endedAt) - Date.parse(record.started_at);
  }
}

export async function runWithTimeout(operation, timeoutMs, description) {
  const controller = new AbortController();
  let timeout;
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error(`${description} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
