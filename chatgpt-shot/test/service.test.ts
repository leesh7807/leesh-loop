import test from 'node:test';
import assert from 'node:assert/strict';
import { submit, wrapPrompt } from '../src/service.js';
import { ShotError } from '../src/errors.js';

class Store {
  created = 0; reads = 0;
  constructor(readonly states: any[]) {}
  async createInvocation(_: string, id: string) { this.created++; return { id, pageId: 'page-1', state: 'pending', error: '' }; }
  async readInvocation(pageId: string, id: string) { return this.states[Math.min(this.reads++, this.states.length - 1)] ?? { pageId, id, state: 'pending', error: '' }; }
  async children() { return [{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Result' }] }, has_children: false }]; }
}
class Browser {
  attempts = 0; inspected: 'submitted'|'not_submitted'|'uncertain' = 'submitted'; authenticated = true;
  async ensureAvailable() {} async ensureAuthenticated() { if (!this.authenticated) throw new ShotError('CHATGPT_AUTH_REQUIRED', 'required'); }
  async runSubmission<T>(operation: () => Promise<T>) { return operation(); }
  async openFreshContext() {} async fillPrompt() {} async submitPrompt() { this.attempts++; } async inspectSubmission() { return this.inspected; } async close() {}
}
const options = { acknowledgementMs: 0, executionMs: 25, pollMs: 1 };
test('completed invocation reads only completed page body', async () => { const result = await submit(new Store([{ state: 'completed', error: '' }]) as any, 'db', new Browser() as any, 'task', options); assert.equal(result, 'Result'); });
test('pending then in_progress never consumes Result before completed', async () => { const store = new Store([{ state: 'pending', error: '' }, { state: 'in_progress', error: '' }, { state: 'completed', error: '' }]); const result = await submit(store as any, 'db', new Browser() as any, 'task', { ...options, acknowledgementMs: 20 }); assert.equal(result, 'Result'); assert.equal(store.reads, 3); });
test('failed invocation reports Error and blank Error violates protocol', async () => { await assert.rejects(() => submit(new Store([{ state: 'failed', error: 'work failed' }]) as any, 'db', new Browser() as any, 'task', options), (e: any) => e.code === 'INVOCATION_FAILED'); await assert.rejects(() => submit(new Store([{ state: 'failed', error: '' }]) as any, 'db', new Browser() as any, 'task', options), (e: any) => e.code === 'INVALID_INVOCATION_STATE'); });
test('submitted and uncertain inspections never retry', async () => { for (const result of ['submitted', 'uncertain'] as const) { const browser = new Browser(); browser.inspected = result; await assert.rejects(() => submit(new Store([{ state: 'pending', error: '' }]) as any, 'db', browser as any, 'task', options)); assert.equal(browser.attempts, 1); } });
test('not submitted is retried once, never a third time', async () => { const browser = new Browser(); browser.inspected = 'not_submitted'; await assert.rejects(() => submit(new Store([{ state: 'pending', error: '' }]) as any, 'db', browser as any, 'task', options)); assert.equal(browser.attempts, 2); });
test('authentication fails before pending invocation creation', async () => { const browser = new Browser(); browser.authenticated = false; const store = new Store([]); await assert.rejects(() => submit(store as any, 'db', browser as any, 'task', options), (e: any) => e.code === 'CHATGPT_AUTH_REQUIRED'); assert.equal(store.created, 0); });
test('wrapped prompt fixes Notion delivery protocol around caller task', () => { const prompt = wrapPrompt('caller task', 'inv-1', 'page-1'); assert.match(prompt, /caller task/); assert.match(prompt, /State/); assert.match(prompt, /Error/); assert.match(prompt, /inv-1/); });
