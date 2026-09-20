import { randomUUID } from 'node:crypto';

export const waitForNextPoll = milliseconds => new Promise(resolveSleep => setTimeout(resolveSleep, milliseconds));
export const currentTimeIso = () => new Date().toISOString();
export const createRunId = () => randomUUID();

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
