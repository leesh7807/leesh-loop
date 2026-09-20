export const NORMAL_PATH = ['Ready', 'In Progress', 'Human Review', 'Merging', 'Done'];
export const TERMINAL_STATES = new Set(['Done', 'Cancelled']);
export const ACTIVE_STATES = new Set(['Ready', 'In Progress', 'Rework', 'Human Review', 'Merging']);
const JOB_ID = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/ig;
const PASS_VERDICT = /(?:#\s*Verdict|Verdict)[\s`*_:/-]*PASS\b/i;

const strategies = new Map([
  ['Ready', { phase: 'Ready', handling: 'observe_lifecycle' }],
  ['In Progress', { phase: 'In Progress', handling: 'observe_lifecycle' }],
  ['Human Review', { phase: 'Human Review', handling: 'approve_mechanical_review' }],
  ['Merging', { phase: 'Merging', handling: 'observe_lifecycle' }],
  ['Done', { phase: 'Done', handling: 'terminal_state' }],
  ['Cancelled', { phase: 'Cancelled', handling: 'terminal_state' }]
]);

export class E2ELifecycleInterpreter {
  interpretTaskState(task) {
    const strategy = strategies.get(task?.state);
    return strategy ? { ...strategy, state: task.state } : { phase: 'Unknown', handling: 'unsupported_state', state: task?.state ?? null };
  }

  findVerifiedLifecycleThrough(observations) {
    let next = 0;
    for (const observation of observations) {
      const index = NORMAL_PATH.indexOf(observation.state);
      if (index < 0) continue;
      if (index === next) {
        next += 1;
        continue;
      }
      if (index === next - 1) continue;
      break;
    }
    return next === 0 ? null : NORMAL_PATH[next - 1];
  }

  findMissingLifecyclePhases(verifiedThrough) {
    const index = verifiedThrough ? NORMAL_PATH.indexOf(verifiedThrough) : -1;
    return NORMAL_PATH.slice(index + 1);
  }
}

export function verifyMechanicalReviewApproval(task, reviewEvidence) {
  if (task?.state !== 'Human Review') return { allowed: false, reason: 'authoritative task is not Human Review' };
  const workpad = task.workpad || '';
  const markers = [...workpad.matchAll(/Human Review\s*\ncycle:\s*(\d+)\s*\nreason:\s*([^\n]+)\s*\ndelivered_pr:\s*([^\n]+)\s*\ndelivered_head:\s*([^\n]+)/g)];
  const marker = markers.at(-1);
  if (!marker) return { allowed: false, reason: 'latest Human Review marker is unavailable' };
  const [, cycle, reason, deliveredPr, deliveredHead] = marker;
  if (reason.trim() !== 'review') return { allowed: false, reason: `Human Review reason is ${reason.trim()}, not review`, cycle: Number(cycle) };
  if (deliveredPr.trim() === 'none' || deliveredHead.trim() === 'none') return { allowed: false, reason: 'review delivery identity is incomplete', cycle: Number(cycle) };
  if (!/^[0-9a-f]{40}$/i.test(deliveredHead.trim())) return { allowed: false, reason: 'delivered_head is not an immutable commit', cycle: Number(cycle) };
  const previous = markers.at(-2);
  const reviewWindow = workpad.slice(previous ? previous.index + previous[0].length : 0, marker.index);
  if (!reviewEvidence?.job_id || !['completed', 'failed'].includes(reviewEvidence.terminal_state)) return { allowed: false, pending: true, reason: 'current independent review Job has not reached a terminal state', cycle: Number(cycle) };
  const currentJobIds = [...reviewWindow.matchAll(JOB_ID)].map(match => match[0].toLowerCase());
  if (!currentJobIds.includes(reviewEvidence.job_id.toLowerCase())) return { allowed: false, reason: 'current Human Review cycle is not bound to the observed independent review Job', cycle: Number(cycle) };
  const jobPosition = reviewWindow.toLowerCase().indexOf(reviewEvidence.job_id.toLowerCase());
  const reviewRequest = reviewWindow.slice(0, jobPosition);
  const targetPrs = [...reviewRequest.matchAll(/(?:review target|target_pr)\s*:\s*([^\n]+)/gi)].map(match => match[1].trim());
  const targetHeads = [...reviewRequest.matchAll(/(?:review head|target_head)\s*:\s*([^\n]+)/gi)].map(match => match[1].trim());
  if (targetPrs.at(-1) !== deliveredPr.trim() || targetHeads.at(-1)?.toLowerCase() !== deliveredHead.trim().toLowerCase()) return { allowed: false, reason: 'independent review Job is not bound to the delivered PR and HEAD', cycle: Number(cycle) };
  if (reviewEvidence.terminal_state !== 'completed' || !reviewWindow.includes(deliveredPr.trim()) || !reviewWindow.includes(deliveredHead.trim()) || !PASS_VERDICT.test(reviewEvidence.result || '')) return { allowed: false, reason: 'current Human Review cycle has no matching independent review PASS evidence', cycle: Number(cycle) };
  return { allowed: true, cycle: Number(cycle), delivered_pr: deliveredPr.trim(), delivered_head: deliveredHead.trim() };
}
