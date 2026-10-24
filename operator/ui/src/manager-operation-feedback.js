import { createElement } from 'react';

export function InstanceOperationFeedback({ feedback, target }) {
  if (!feedback) return null;
  const message = createElement('p', {
    className: feedback.kind === 'failure' ? 'inline-message failure' : 'inline-message',
    role: feedback.kind === 'failure' ? 'alert' : 'status'
  }, feedback.message);
  return createElement('div', { className: `manager-feedback manager-feedback-${target}` }, message);
}

export function WorkflowOperationFeedback({ feedback, placement }) {
  if (!feedback) return null;
  const message = createElement(InstanceOperationFeedback, { feedback, target: 'workflow' });
  if (placement === 'panel') return createElement('div', { className: 'workflow-read-feedback' }, message);
  if (placement === 'actions') return createElement('div', { className: 'workflow-update-feedback' }, message);
  if (placement === 'header') return message;
  return null;
}
