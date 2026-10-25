export function canUnregisterLoop(instance) {
  return instance?.status === 'Stopped'
    || (instance?.status === 'Failed' && instance.process_absence_confirmed === true);
}
