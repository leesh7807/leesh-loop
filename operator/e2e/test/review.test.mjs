import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatgptShotCapability } from '../review.mjs';

test('review evidence preserves Job terminal state and authoritative duration when present', async () => {
  const id = '123e4567-e89b-42d3-a456-426614174000';
  const review = new ChatgptShotCapability({ commandRunner: async () => ({ stdout: JSON.stringify({ id, state: 'completed', result: '# Verdict\nPASS', error: null, started_at: '2026-09-19T00:00:00.000Z', completed_at: '2026-09-19T00:00:02.000Z' }) }) });
  const evidence = await review.inspect(`Job ID: ${id}`);
  assert.equal(evidence.terminal_state, 'completed');
  assert.equal(evidence.observed_duration_ms, 2_000);
  assert.match(evidence.result, /PASS/);
});
