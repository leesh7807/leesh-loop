import { randomUUID } from 'node:crypto';

const DEFAULT_STATE = 'Ready';
const PLAN_TITLE_LIMIT = 80;

export function publishAcceptedPlan(store, plan, { state = DEFAULT_STATE, blockedBy = [] } = {}) {
  if (typeof plan !== 'string' || !plan.trim()) throw new TypeError('Plan content must be non-empty');
  if (typeof state !== 'string' || !state.trim()) throw new TypeError('publication State must be a non-empty string');
  if (!Array.isArray(blockedBy) || blockedBy.some(id => typeof id !== 'string' || !id.trim())) {
    throw new TypeError('Blocked By must be a list of task identities');
  }

  const normalizedStart = plan.trim().replace(/\s+/gu, ' ');
  const title = Array.from(normalizedStart).slice(0, PLAN_TITLE_LIMIT).join('');

  const publicationKey = randomUUID();
  const identifier = `PLAN-${publicationKey.toUpperCase()}`;
  const task = store.publishTaskWithUniqueTitle({
    publicationKey,
    identifier,
    title,
    state: state.trim(),
    priority: 3,
    labels: [],
    blockedBy,
    acceptedPlan: plan
  });

  return { identifier, page_id: task.id, state: task.state, task };
}
