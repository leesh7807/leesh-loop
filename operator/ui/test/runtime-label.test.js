import assert from 'node:assert/strict';
import test from 'node:test';
import { runtimeLabel } from '../src/runtime-label.js';

test('runtime labels keep version and immutable identity together', () => {
  const id = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  assert.equal(runtimeLabel(id, [{ id, version: '0.1.0' }]), '0.1.0 · 0123456789ab');
});

test('runtime labels retain the identity when distribution metadata is unavailable', () => {
  assert.equal(runtimeLabel('fedcba9876543210'), 'fedcba987654');
});

test('runtime labels show an em dash when no distribution is selected', () => {
  assert.equal(runtimeLabel(null), '—');
});
