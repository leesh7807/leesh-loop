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
  if (runtime?.active_error) return 'invalid';
  return runtime?.active ? 'ready' : 'missing';
}

export function managerRuntimeAttentionState(readState, runtime) {
  if (readState !== 'loaded') return null;
  if (runtime?.active_error) return 'repair';
  if (runtime?.active && (runtime.manager_restart_required || runtime.manager_runtime_version !== runtime.active.id)) return 'restart';
  return null;
}

export function workflowComparisonViewState(readState, hasComparison, isOpen) {
  if (!isOpen) return 'closed';
  if (hasComparison) return 'ready';
  return readState === 'error' ? 'error' : 'loading';
}

export function logsReadStartState(currentState) {
  return currentState === 'loaded' || currentState === 'stale-error' ? 'refreshing' : 'loading';
}

export function logsReadFailureState(currentState) {
  return currentState === 'refreshing' ? 'stale-error' : 'error';
}

export function logsPanelViewState(readState, isOpen) {
  if (!isOpen) return 'closed';
  return readState === 'idle' ? 'loading' : readState;
}
