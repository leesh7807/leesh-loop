import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatgptShotClient } from '../systems/chatgpt-shot/chatgpt-shot-client.mjs';

test('review evidence preserves Job terminal state and authoritative duration when present', async () => {
  const id = '123e4567-e89b-42d3-a456-426614174000';
  const review = new ChatgptShotClient({ commandRunner: async () => ({ stdout: JSON.stringify({ id, state: 'completed', result: '# Verdict\nPASS', error: null, started_at: '2026-09-19T00:00:00.000Z', completed_at: '2026-09-19T00:00:02.000Z' }) }) });
  const evidence = await review.inspectReviewJobs(`Job ID: ${id}`);
  assert.equal(evidence.terminal_state, 'completed');
  assert.equal(evidence.observed_duration_ms, 2_000);
  assert.match(evidence.result, /PASS/);
});

test('review evidence does not reuse an older completed Job when the latest Job is still running', async () => {
  const completed = '123e4567-e89b-42d3-a456-426614174000';
  const running = '223e4567-e89b-42d3-a456-426614174000';
  const review = new ChatgptShotClient({ commandRunner: async (_command, args) => ({ stdout: JSON.stringify(args[1] === completed ? { id: completed, state: 'completed', result: '# Verdict\nPASS' } : { id: running, state: 'running', result: null }) }) });
  const evidence = await review.inspectReviewJobs(`old Job ID: ${completed}\ncurrent Job ID: ${running}`);
  assert.equal(evidence.job_id, running);
  assert.equal(evidence.terminal_state, 'running');
  assert.equal(evidence.result, null);
});

test('review evidence ignores unrelated workspace UUIDs', () => {
  const id = '123e4567-e89b-42d3-a456-426614174000';
  const runId = '223e4567-e89b-42d3-a456-426614174000';
  const review = new ChatgptShotClient();
  assert.deepEqual(review.extractReviewJobIds(`workspace: /tmp/${runId}\nJob ID: ${id}`), [id]);
});
