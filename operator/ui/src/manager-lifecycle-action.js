export function managerLifecycleAction(status, canStop) {
  if (status === 'Starting') return 'pending';
  if (status === 'Stopping') return 'stopping';
  if (status === 'Running' || (status === 'Failed' && canStop === true)) return 'stop';
  return 'start';
}
