import test from 'node:test';
import assert from 'node:assert/strict';
import { bounded } from '../common.mjs';

test('bounded aborts an abort-aware operation when the limit expires', async () => {
  let aborted = false;
  await assert.rejects(
    bounded(signal => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }, { once: true });
      setTimeout(resolve, 100);
    }), 5, 'fixture operation'),
    /timed out after 5ms/
  );
  assert.equal(aborted, true);
});
