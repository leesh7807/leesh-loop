import assert from 'node:assert/strict';
import test from 'node:test';
import { logsPanelViewState, logsReadFailureState, logsReadStartState, managerInventoryViewState, managerRuntimeAttentionState, operatorConfigViewState, readFailureState, sharedRuntimeViewState, workflowComparisonViewState } from '../src/manager-read-state.js';

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
  assert.equal(sharedRuntimeViewState('loaded', { active: null, active_error: 'Runtime hash mismatch' }), 'invalid');
  assert.equal(sharedRuntimeViewState('loaded', { active: null }), 'missing');
});

test('the selected Loop surfaces only confirmed Runtime repair and Manager restart debt', () => {
  const healthyRuntime = { active: { id: 'runtime-a' }, manager_runtime_version: 'runtime-a' };
  assert.equal(managerRuntimeAttentionState('loading', { active_error: 'hash mismatch' }), null);
  assert.equal(managerRuntimeAttentionState('error', { active_error: 'hash mismatch' }), null);
  assert.equal(managerRuntimeAttentionState('loaded', { active_error: 'hash mismatch' }), 'repair');
  assert.equal(managerRuntimeAttentionState('loaded', { ...healthyRuntime, manager_runtime_version: 'runtime-old' }), 'restart');
  assert.equal(managerRuntimeAttentionState('loaded', { ...healthyRuntime, manager_restart_required: true }), 'restart');
  assert.equal(managerRuntimeAttentionState('loaded', healthyRuntime), null);
  assert.equal(managerRuntimeAttentionState('loaded', { active: null }), null);
});

test('an open Workflow comparison exposes pending and failed reads for recovery', () => {
  assert.equal(workflowComparisonViewState('idle', false, false), 'closed');
  assert.equal(workflowComparisonViewState('idle', false, true), 'loading');
  assert.equal(workflowComparisonViewState('error', false, true), 'error');
  assert.equal(workflowComparisonViewState('loaded', true, true), 'ready');
});

test('log refreshes distinguish first-read failures from stale successful output', () => {
  assert.equal(logsPanelViewState('idle', false), 'closed');
  assert.equal(logsPanelViewState('idle', true), 'loading');
  assert.equal(logsReadStartState('idle'), 'loading');
  assert.equal(logsReadFailureState('loading'), 'error');
  assert.equal(logsReadStartState('loaded'), 'refreshing');
  assert.equal(logsReadFailureState('refreshing'), 'stale-error');
  assert.equal(logsPanelViewState('stale-error', true), 'stale-error');
});
