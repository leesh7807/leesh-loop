import assert from 'node:assert/strict';
import test from 'node:test';
import { managerInventoryViewState, operatorConfigViewState, readFailureState, sharedRuntimeViewState, workflowComparisonViewState } from '../src/manager-read-state.js';

test('the Manager distinguishes an unread or failed inventory from a confirmed empty inventory', () => {
  assert.equal(managerInventoryViewState('loading', 0), 'loading');
  assert.equal(managerInventoryViewState('error', 0), 'error');
  assert.equal(managerInventoryViewState('loaded', 0), 'empty');
  assert.equal(managerInventoryViewState('loaded', 1), 'list');
});

test('a refresh failure preserves an already loaded inventory view', () => {
  assert.equal(readFailureState('loading'), 'error');
  assert.equal(readFailureState('error'), 'error');
  assert.equal(readFailureState('loaded'), 'loaded');
});

test('the Operator shows a configuration failure only after the read fails', () => {
  assert.equal(operatorConfigViewState('loading', null), 'loading');
  assert.equal(operatorConfigViewState('error', null), 'error');
  assert.equal(operatorConfigViewState('loaded', { githubRepositoryName: 'repo' }), 'loaded');
});

test('the Shared Runtime distinguishes pending, failed, installed, and missing reads', () => {
  assert.equal(sharedRuntimeViewState('loading', null), 'loading');
  assert.equal(sharedRuntimeViewState('error', null), 'error');
  assert.equal(sharedRuntimeViewState('loaded', { active: { version: '2026.10.24' } }), 'ready');
  assert.equal(sharedRuntimeViewState('loaded', { active: null }), 'missing');
});

test('an open Workflow comparison exposes pending and failed reads for recovery', () => {
  assert.equal(workflowComparisonViewState('idle', false, false), 'closed');
  assert.equal(workflowComparisonViewState('idle', false, true), 'loading');
  assert.equal(workflowComparisonViewState('error', false, true), 'error');
  assert.equal(workflowComparisonViewState('loaded', true, true), 'ready');
});
