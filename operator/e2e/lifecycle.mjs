export const NORMAL_PATH = ['Ready', 'In Progress', 'Human Review', 'Merging', 'Done'];
export const TERMINAL_STATES = new Set(['Done', 'Cancelled']);
export const ACTIVE_STATES = new Set(['Ready', 'In Progress', 'Rework', 'Human Review', 'Merging']);

const strategies = new Map([
  ['Ready', { phase: 'Ready', capability: 'observe' }],
  ['In Progress', { phase: 'In Progress', capability: 'observe' }],
  ['Human Review', { phase: 'Human Review', capability: 'mechanical_review_approval' }],
  ['Merging', { phase: 'Merging', capability: 'observe' }],
  ['Done', { phase: 'Done', capability: 'terminal' }],
  ['Cancelled', { phase: 'Cancelled', capability: 'terminal' }],
  ['Rework', { phase: 'Rework', capability: 'observe' }]
]);

export class LifecycleInterpreter {
  interpret(task) {
    const strategy = strategies.get(task?.state);
    return strategy ? { ...strategy, state: task.state } : { phase: 'Unknown', capability: 'unsupported_state', state: task?.state ?? null };
  }

  verifiedThrough(observations) {
    let highest = -1;
    for (const observation of observations) highest = Math.max(highest, NORMAL_PATH.indexOf(observation.state));
    return highest < 0 ? null : NORMAL_PATH[highest];
  }

  gaps(verifiedThrough) {
    const index = verifiedThrough ? NORMAL_PATH.indexOf(verifiedThrough) : -1;
    return NORMAL_PATH.slice(index + 1);
  }
}

export function mechanicalReviewAllowed(task) {
  if (task?.state !== 'Human Review') return { allowed: false, reason: 'authoritative task is not Human Review' };
  const workpad = task.workpad || '';
  const marker = [...workpad.matchAll(/Human Review\s*\ncycle:\s*(\d+)\s*\nreason:\s*([^\n]+)\s*\ndelivered_pr:\s*([^\n]+)\s*\ndelivered_head:\s*([^\n]+)[\s\S]*?(?=\nHuman Review\s*\ncycle:|$)/g)].at(-1);
  if (!marker) return { allowed: false, reason: 'latest Human Review marker is unavailable' };
  const [, cycle, reason, deliveredPr, deliveredHead] = marker;
  if (reason.trim() !== 'review') return { allowed: false, reason: `Human Review reason is ${reason.trim()}, not review`, cycle: Number(cycle) };
  if (deliveredPr.trim() === 'none' || deliveredHead.trim() === 'none') return { allowed: false, reason: 'review delivery identity is incomplete', cycle: Number(cycle) };
  if (!/^[0-9a-f]{40}$/i.test(deliveredHead.trim())) return { allowed: false, reason: 'delivered_head is not an immutable commit', cycle: Number(cycle) };
  if (!/(?:# Verdict|Verdict)\s*\n?\s*PASS\b/i.test(workpad)) return { allowed: false, reason: 'independent review PASS evidence is unavailable', cycle: Number(cycle) };
  return { allowed: true, cycle: Number(cycle), delivered_pr: deliveredPr.trim(), delivered_head: deliveredHead.trim() };
}
