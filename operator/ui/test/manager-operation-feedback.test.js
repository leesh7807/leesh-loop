import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkflowOperationFeedback } from '../src/manager-operation-feedback.js';

const placements = [
  ['header', null],
  ['panel', 'workflow-read-feedback'],
  ['actions', 'workflow-update-feedback']
];

for (const [placement, wrapperClass] of placements) {
  test(`Workflow feedback renders once in its ${placement} placement`, () => {
    const html = renderToStaticMarkup(createElement(WorkflowOperationFeedback, {
      feedback: { kind: 'failure', message: 'Could not apply the Workflow.' },
      placement
    }));

    assert.match(html, /class="manager-feedback manager-feedback-workflow"/);
    assert.match(html, /role="alert"/);
    assert.match(html, /Could not apply the Workflow\./);
    assert.equal((html.match(/Could not apply the Workflow\./g) || []).length, 1);
    if (wrapperClass) assert.match(html, new RegExp(`class="${wrapperClass}"`));
    else assert.doesNotMatch(html, /workflow-(?:read|update)-feedback/);
  });
}

test('successful Workflow feedback is announced as a status', () => {
  const html = renderToStaticMarkup(createElement(WorkflowOperationFeedback, {
    feedback: { kind: 'success', message: 'Workflow update completed.' },
    placement: 'actions'
  }));

  assert.match(html, /role="status"/);
  assert.match(html, /Workflow update completed\./);
});
