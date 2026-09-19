import { command, commandError } from './common.mjs';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const jobId = new RegExp(`(?:\\bJob ID\\b|\\bjob_id\\b|\\breview job(?: id)?\\b)\\s*:\\s*(${uuid})`, 'ig');

export class ChatgptShotCapability {
  constructor({ commandRunner = command } = {}) { this.commandRunner = commandRunner; }

  jobIds(workpad) {
    return [...new Set([...workpad.matchAll(jobId)].map(match => match[1].toLowerCase()))];
  }

  async inspect(workpad, signal) {
    const jobs = [];
    for (const id of this.jobIds(workpad)) {
      try {
        const { stdout } = await this.commandRunner('chatgpt-shot', ['jobs', id], { timeout: 10_000, signal });
        const snapshot = JSON.parse(stdout.trim());
        jobs.push({ id, observed_at: new Date().toISOString(), state: snapshot.state ?? null, result: snapshot.result ?? null, error: snapshot.error ?? null, started_at: snapshot.started_at ?? snapshot.created_at ?? null, finished_at: snapshot.finished_at ?? snapshot.completed_at ?? null, duration_ms: Number.isFinite(snapshot.duration_ms) ? snapshot.duration_ms : null });
      } catch (error) {
        jobs.push({ id, observed_at: new Date().toISOString(), state: null, result: null, error: commandError(error) || 'chatgpt-shot job inspection failed', started_at: null, finished_at: null, duration_ms: null });
      }
    }
    const terminal = ['completed', 'failed'].includes(jobs.at(-1)?.state) ? jobs.at(-1) : null;
    const duration = terminal?.duration_ms ?? (terminal?.started_at && terminal?.finished_at ? Date.parse(terminal.finished_at) - Date.parse(terminal.started_at) : null);
    return { job_id: jobs.at(-1)?.id ?? null, observations: jobs, terminal_state: jobs.at(-1)?.state ?? null, result: terminal?.state === 'completed' ? terminal.result : null, error: terminal?.state === 'failed' ? terminal.error : null, observed_duration_ms: Number.isFinite(duration) ? duration : null };
  }
}
