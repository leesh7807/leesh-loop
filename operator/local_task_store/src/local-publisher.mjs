import { createHash } from 'node:crypto';

const DEFAULT_STATE = 'Ready';
const PLAN_TITLE_LIMIT = 1900;

export function publishAcceptedPlan(store, plan, { state = DEFAULT_STATE, blockedBy = [] } = {}) {
  if (typeof plan !== 'string' || !plan.trim()) throw new TypeError('Plan content must be non-empty');
  if (typeof state !== 'string' || !state.trim()) throw new TypeError('publication State must be a non-empty string');
  if (!Array.isArray(blockedBy) || blockedBy.some(id => typeof id !== 'string' || !id.trim())) {
    throw new TypeError('Blocked By must be a list of task identities');
  }

  const heading = plan.split(/\r?\n/).find(line => line.startsWith('# '));
  const title = heading?.slice(2).trim();
  if (!title) throw new TypeError('Plan title requires a Markdown H1');
  if (title.length > PLAN_TITLE_LIMIT) throw new TypeError(`Plan title exceeds the ${PLAN_TITLE_LIMIT}-character limit`);

  const identifier = `PLAN-${createHash('sha256').update(plan, 'utf8').digest('hex').slice(0, 12).toUpperCase()}`;
  const task = store.publishTask({
    publicationKey: identifier,
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
