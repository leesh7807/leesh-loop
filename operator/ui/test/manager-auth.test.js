import assert from 'node:assert/strict';
import test from 'node:test';
import { bootstrapManagerToken } from '../src/manager-auth.js';

function makeBrowserContext(hash, storedToken = null) {
  const values = new Map(storedToken ? [['leesh-loop.manager.token.v1', storedToken]] : []);
  const context = {
    location: { hash, pathname: '/', search: '?view=manager' },
    history: {
      state: { existing: true },
      replaceState(state, _title, url) { context.replaced = { state, url }; }
    },
    storage: {
      getItem(key) { return values.get(key) ?? null; },
      setItem(key, value) { values.set(key, value); }
    },
    values
  };
  return context;
}

test('Manager token bootstrap consumes a URL fragment into session storage and removes it from browser history', () => {
  const token = 'a'.repeat(64);
  const context = makeBrowserContext(`#manager-token=${token}`);

  assert.equal(bootstrapManagerToken(context), token);
  assert.equal(context.values.get('leesh-loop.manager.token.v1'), token);
  assert.deepEqual(context.replaced, { state: context.history.state, url: '/?view=manager' });
});

test('Manager token bootstrap reuses only a stored token when the URL has no valid credential', () => {
  const token = 'b'.repeat(64);
  const context = makeBrowserContext('#manager-token=invalid', token);

  assert.equal(bootstrapManagerToken(context), token);
  assert.equal(context.replaced, undefined);
});
