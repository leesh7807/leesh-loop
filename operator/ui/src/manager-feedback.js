export const initialManagerFeedback = {
  readErrors: {},
  operationErrors: {},
  notices: {}
};

export const initialInstanceOperationFeedback = {};

export function managerOperationAnnouncement(operation) {
  if (!operation?.label) return '';
  const target = operation.repositoryName ? ` for ${operation.repositoryName}` : '';
  return `${operation.label}${target} is in progress. Other Manager actions are temporarily unavailable; instance switching and Task management remain available.`;
}

export function lifecycleCompletionMessage(operation, instance) {
  const name = instance?.repository_name || instance?.id || 'Loop';
  const status = instance?.status ? ` Manager reported ${instance.status} at completion.` : '';
  const action = operation === 'start-loop' ? 'Start' : operation === 'stop-loop' ? 'Stop' : 'Loop';
  return `${action} request completed for ${name}.${status}`;
}

export function managerOperationCompletionMessage(operation, instance) {
  if (operation === 'update-runtime') return 'Runtime update completed.';
  if (operation === 'update-workflow') return 'Workflow update completed.';
  if (operation === 'stop-manager') return 'Manager Service stopped. Running Loops and Workers continue.';
  if (operation === 'start-loop' || operation === 'stop-loop') return lifecycleCompletionMessage(operation, instance);
  return 'Change saved.';
}

export function workflowOperationFeedbackPlacement(isOpen, hasComparison) {
  if (!isOpen) return 'header';
  return hasComparison ? 'actions' : 'panel';
}

export function instanceOperationFeedbackReducer(state, action) {
  const targetFeedback = { ...(state[action.instanceId] || {}) };
  if (action.type === 'started') delete targetFeedback[action.target];
  else if (action.type === 'success') targetFeedback[action.target] = { kind: 'success', message: action.message };
  else if (action.type === 'error') targetFeedback[action.target] = { kind: 'failure', message: action.message };
  else return state;

  const next = { ...state };
  if (Object.keys(targetFeedback).length) next[action.instanceId] = targetFeedback;
  else delete next[action.instanceId];
  return next;
}

export function instanceOperationFeedbackFor(state, instanceId, target) {
  return state[instanceId]?.[target] || null;
}

function updateMessage(messages, target, message) {
  const next = { ...messages };
  if (message) next[target] = message;
  else delete next[target];
  return next;
}

function clearSelectionMessages(messages) {
  const next = { ...messages };
  delete next.lifecycle;
  delete next.workflow;
  delete next.logs;
  return next;
}

export function managerFeedbackReducer(state, action) {
  const target = action.target || 'manager';
  switch (action.type) {
    case 'read-error':
      return { ...state, readErrors: updateMessage(state.readErrors, target, action.message) };
    case 'read-cleared':
      return {
        ...state,
        readErrors: action.target
          ? updateMessage(state.readErrors, target, '')
          : {}
      };
    case 'operation-started':
      return {
        ...state,
        readErrors: updateMessage(state.readErrors, target, ''),
        operationErrors: updateMessage(state.operationErrors, target, ''),
        notices: updateMessage(state.notices, target, '')
      };
    case 'operation-success':
      return {
        ...state,
        operationErrors: updateMessage(state.operationErrors, target, ''),
        notices: updateMessage(state.notices, target, action.message)
      };
    case 'instance-changed':
      return {
        ...state,
        readErrors: clearSelectionMessages(state.readErrors),
        operationErrors: clearSelectionMessages(state.operationErrors),
        notices: clearSelectionMessages(state.notices)
      };
    case 'operation-error':
      return {
        ...state,
        operationErrors: updateMessage(state.operationErrors, target, action.message),
        notices: updateMessage(state.notices, target, '')
      };
    default:
      return state;
  }
}
