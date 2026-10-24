import assert from 'node:assert/strict';
import test from 'node:test';
import { managerInventoryViewState, operatorConfigViewState, readFailureState } from '../src/manager-read-state.js';

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
