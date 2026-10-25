import assert from 'node:assert/strict';
import test from 'node:test';
import { createManagerSelectionGate } from '../src/manager-selection-gate.js';
import { workflowComparisonAfterApply } from '../src/workflow-apply-result.js';

test('a late Workflow apply result cannot rewrite the newly selected Loop comparison', () => {
  const selectionGate = createManagerSelectionGate('loop-a');
  const selectionSnapshot = selectionGate.capture();
  const loopBComparison = {
    current: '# Loop B current',
    candidate: '# Loop B candidate',
    candidate_digest: 'loop-b-digest',
    changed: true
  };
  selectionGate.select('loop-b');

  assert.equal(workflowComparisonAfterApply(loopBComparison, {
    selectionGate,
    selectionSnapshot,
    candidateDigest: 'loop-a-digest'
  }), loopBComparison);
});

test('Workflow apply reconciliation requires the same selection generation and candidate', () => {
  const selectionGate = createManagerSelectionGate('loop-a');
  const selectionSnapshot = selectionGate.capture();
  const comparison = {
    current: '# current',
    candidate: '# candidate',
    candidate_digest: 'candidate-1',
    changed: true
  };

  assert.equal(workflowComparisonAfterApply(comparison, {
    selectionGate,
    selectionSnapshot,
    candidateDigest: 'candidate-2'
  }), comparison);
  assert.deepEqual(workflowComparisonAfterApply(comparison, {
    selectionGate,
    selectionSnapshot,
    candidateDigest: 'candidate-1'
  }), { ...comparison, current: comparison.candidate, changed: false });
});
