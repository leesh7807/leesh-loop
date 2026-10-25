export function canUnregisterLoop(instance) {
  return instance?.status === 'Stopped'
    || (instance?.status === 'Failed' && instance.can_update_workflow === true);
}
