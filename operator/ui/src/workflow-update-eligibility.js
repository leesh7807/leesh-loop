export function workflowUpdateEligibility(instance) {
  if (!instance) return null;
  if (instance.status === 'Stopped') {
    return {
      canApply: true,
      summary: 'Stopped — the reviewed Workflow update is ready to apply.'
    };
  }
  if (instance.can_update_workflow === true) {
    return {
      canApply: true,
      summary: 'Failed with no active processes — Workflow repair is available before restarting.'
    };
  }
  if (instance.status === 'Unconfirmed') {
    return {
      canApply: false,
      summary: 'Unconfirmed — resolve process ownership before changing this Workflow.',
      controlHint: 'Manager cannot safely stop this Loop while its process ownership is unconfirmed.'
    };
  }
  if (instance.status === 'Starting') {
    return {
      canApply: false,
      summary: 'Starting — wait until the Loop is ready, then stop it to apply the Workflow.',
      controlHint: 'Stop becomes available when startup is ready.'
    };
  }
  if (instance.status === 'Stopping') {
    return {
      canApply: false,
      summary: 'Stopping — wait for the Loop to stop before applying the Workflow.',
      controlHint: 'Wait for Stop to finish before applying the update.'
    };
  }
  if (instance.status === 'Running' || (instance.status === 'Failed' && instance.can_stop === true)) {
    const status = instance.status === 'Running' ? 'Running' : 'Failed with an active process';
    return {
      canApply: false,
      summary: `${status} — stop this Loop to apply the reviewed Workflow.`,
      controlHint: 'Stop this Loop to enable Apply Workflow Update.'
    };
  }
  return {
    canApply: false,
    summary: `${instance.status || 'Unknown'} — confirm the Loop is stopped before applying the Workflow.`,
    controlHint: 'Apply is available only when the Loop is stopped and its process state is confirmed.'
  };
}
