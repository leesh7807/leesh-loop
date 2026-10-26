export function managerLifecycleAction(status, canStop) {
  if (status === 'Starting') return 'pending';
  if (status === 'Stopping') return 'stopping';
  if (status === 'Unconfirmed') return 'unconfirmed';
  if (status === 'Running' || (status === 'Failed' && canStop === true)) return 'stop';
  return 'start';
}

export function managerStartBlockedByRuntimeRepair(lifecycleAction, runtimeAttention) {
  return lifecycleAction === 'start' && runtimeAttention === 'repair';
}
