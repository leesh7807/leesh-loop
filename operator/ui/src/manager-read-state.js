export function readFailureState(currentState) {
  return currentState === 'loaded' ? 'loaded' : 'error';
}

export function managerInventoryViewState(readState, instanceCount) {
  if (readState !== 'loaded') return readState;
  return instanceCount === 0 ? 'empty' : 'list';
}

export function operatorConfigViewState(readState, config) {
  if (readState === 'loading') return 'loading';
  return readState === 'loaded' && config ? 'loaded' : 'error';
}

export function sharedRuntimeViewState(readState, runtime) {
  if (readState === 'loading') return 'loading';
  if (readState === 'error') return 'error';
  return runtime?.active ? 'ready' : 'missing';
}
