export const initialManagerFeedback = {
  readErrors: {},
  operationErrors: {},
  notices: {}
};

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
