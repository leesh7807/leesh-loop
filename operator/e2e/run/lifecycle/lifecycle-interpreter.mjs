export const NORMAL_PATH = ['Ready', 'In Progress', 'Human Review', 'Merging', 'Done'];
export const TERMINAL_STATES = new Set(['Done', 'Cancelled']);
export const ACTIVE_STATES = new Set(['Ready', 'In Progress', 'Rework', 'Human Review', 'Merging']);
const strategies = new Map([
  ['Ready', { phase: 'Ready', handling: 'observe_lifecycle' }],
  ['In Progress', { phase: 'In Progress', handling: 'observe_lifecycle' }],
  ['Human Review', { phase: 'Human Review', handling: 'mechanical_human_review_transition' }],
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
