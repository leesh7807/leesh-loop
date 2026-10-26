export function managerFailedGuidance(instance = {}) {
  if (instance.process_absence_confirmed === true) {
    return 'The Loop failed and no active process remains. Review diagnosis and logs before restarting.';
  }
  if (instance.can_stop === true) {
    return 'The Loop reported a failure while its process is still owned. Stop it before restarting or changing its Workflow.';
  }
  return 'The Loop failed. Review its diagnosis and logs before retrying.';
}
