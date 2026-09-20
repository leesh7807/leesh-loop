import test from 'node:test';
import assert from 'node:assert/strict';
import { E2ELifecycleInterpreter, verifyMechanicalReviewApproval } from '../run/lifecycle/lifecycle-interpreter.mjs';

test('interpreter maps task states without owning a competing lifecycle state model', () => {
  const interpreter = new E2ELifecycleInterpreter();
  assert.deepEqual(interpreter.interpretTaskState({ state: 'Human Review' }), { phase: 'Human Review', handling: 'approve_mechanical_review', state: 'Human Review' });
  assert.equal(interpreter.interpretTaskState({ state: 'Rework' }).handling, 'unsupported_state');
  assert.equal(interpreter.interpretTaskState({ state: 'Unexpected' }).handling, 'unsupported_state');
  assert.deepEqual(interpreter.findMissingLifecyclePhases('In Progress'), ['Human Review', 'Merging', 'Done']);
});

test('verified-through stops at the first unobserved normal lifecycle phase', () => {
  const interpreter = new E2ELifecycleInterpreter();
  const observations = [{ state: 'Human Review' }, { state: 'Merging' }, { state: 'Done' }];
  assert.equal(interpreter.findVerifiedLifecycleThrough(observations), null);
  assert.deepEqual(interpreter.findMissingLifecyclePhases(null), ['Ready', 'In Progress', 'Human Review', 'Merging', 'Done']);
  assert.equal(interpreter.findVerifiedLifecycleThrough([
    { state: 'Ready' },
    { state: 'Human Review' },
    { state: 'In Progress' },
    { state: 'Merging' },
    { state: 'Done' }
  ]), 'Ready');
});

test('mechanical approval only accepts normal review with matching delivery evidence and PASS', () => {
  const valid = {
    state: 'Human Review',
    workpad: 'review target: https://github.com/a/b/pull/4\nreview head: 0123456789012345678901234567890123456789\nJob ID: 123e4567-e89b-42d3-a456-426614174000\n# Verdict\nPASS\nHuman Review\ncycle: 2\nreason: review\ndelivered_pr: https://github.com/a/b/pull/4\ndelivered_head: 0123456789012345678901234567890123456789\n'
  };
  const reviewEvidence = { job_id: '123e4567-e89b-42d3-a456-426614174000', terminal_state: 'completed', result: '# Verdict\nPASS' };
  assert.equal(verifyMechanicalReviewApproval(valid, reviewEvidence).allowed, true);
  assert.equal(verifyMechanicalReviewApproval(valid, { ...reviewEvidence, job_id: null }).pending, true);
  assert.equal(verifyMechanicalReviewApproval({ ...valid, workpad: valid.workpad.replace('reason: review', 'reason: blocker') }).allowed, false);
  assert.equal(verifyMechanicalReviewApproval(valid, { ...reviewEvidence, result: '# Verdict\nFINDINGS' }).allowed, false);
  assert.equal(verifyMechanicalReviewApproval(valid, { ...reviewEvidence, terminal_state: 'failed', result: null }).allowed, false);
  const staleJob = valid.workpad.replace('123e4567-e89b-42d3-a456-426614174000', '223e4567-e89b-42d3-a456-426614174000');
  assert.equal(verifyMechanicalReviewApproval({ ...valid, workpad: staleJob }, reviewEvidence).allowed, false);
  assert.equal(verifyMechanicalReviewApproval({ ...valid, workpad: valid.workpad.replace('review head: 0123456789012345678901234567890123456789', 'review head: abcdefabcdefabcdefabcdefabcdefabcdefabcd') }, reviewEvidence).allowed, false);
});

test('mechanical approval accepts the production workpad result rendering', () => {
  const deliveredPr = 'https://github.com/a/b/pull/4';
  const deliveredHead = '0123456789012345678901234567890123456789';
  const task = {
    state: 'Human Review',
    workpad: `Independent review result\n- review target: ${deliveredPr}\n- review head: ${deliveredHead}\n- Job ID: 123e4567-e89b-42d3-a456-426614174000\n- Result: \`# Verdict\` / PASS\nHuman Review\ncycle: 1\nreason: review\ndelivered_pr: ${deliveredPr}\ndelivered_head: ${deliveredHead}\n`
  };
  const evidence = { job_id: '123e4567-e89b-42d3-a456-426614174000', terminal_state: 'completed', result: '# Verdict\n\nPASS' };
  assert.deepEqual(verifyMechanicalReviewApproval(task, evidence), { allowed: true, cycle: 1, delivered_pr: deliveredPr, delivered_head: deliveredHead });
});
