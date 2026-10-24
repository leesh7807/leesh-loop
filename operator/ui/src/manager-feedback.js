export const initialManagerFeedback = { readError: '', operationError: '' };

export function managerFeedbackReducer(state, action) {
  switch (action.type) {
    case 'read-error':
      return { ...state, readError: action.message };
    case 'read-cleared':
      return state.readError ? { ...state, readError: '' } : state;
    case 'operation-started':
    case 'instance-changed':
      return { readError: '', operationError: '' };
    case 'operation-error':
      return { ...state, operationError: action.message };
    default:
      return state;
  }
}
