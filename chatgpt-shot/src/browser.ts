import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { brokerRequest, brokerSocket } from './broker.js';
import { fail } from './errors.js';

export type Inspection = 'submitted' | 'not_submitted' | 'uncertain';
export interface BrowserTransport { withBrowser<T>(operation: () => Promise<T>): Promise<T>; ensureAvailable(): Promise<void>; ensureAuthenticated(): Promise<void>; openFreshContext(): Promise<void>; fillPrompt(prompt: string): Promise<void>; submitPrompt(): Promise<void>; inspectSubmission(invocationId: string): Promise<Inspection>; close(): Promise<void>; }

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const profilePath = (root: string) => `${root}/.chatgpt-shot-profile`;
const systemChrome = () => [process.env.CHATGPT_SHOT_BROWSER, '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome'].find((path): path is string => Boolean(path && existsSync(path)));
async function request(root: string, operation: string, sessionId?: string, prompt?: string, invocationId?: string) { try { return await brokerRequest(root, { operation, sessionId, prompt, invocationId }); } catch (error: any) { if (error.code) return fail(error.code, error.message); throw error; } }
export async function ensureBroker(root: string) {
  try { await request(root, 'ensure'); return; } catch (error: any) { if (error?.code === 'ECONNREFUSED') try { unlinkSync(brokerSocket(root)); } catch {} }
  if (!existsSync(process.argv[1])) fail('BROWSER_UNAVAILABLE', 'Cannot locate the chatgpt-shot broker entry point.');
  const child = spawn(process.execPath, [process.argv[1], '__broker'], { detached: true, stdio: 'ignore' }); child.unref();
  for (let attempt = 0; attempt < 50; attempt++) { try { await request(root, 'ensure'); return; } catch { await wait(100); } }
  fail('BROWSER_UNAVAILABLE', 'Could not start the local ChatGPT browser broker.');
}
export async function manualLogin(root: string): Promise<void> {
  await shutdownBroker(root);
  const executable = systemChrome(); if (!executable) fail('BROWSER_UNAVAILABLE', 'A supported system Chrome executable is required for manual login.');
  const profile = profilePath(root); mkdirSync(profile, { recursive: true, mode: 0o700 });
  await new Promise<void>((resolve, reject) => { const child: import('node:child_process').ChildProcess = spawn(executable!, [`--user-data-dir=${profile}`, '--profile-directory=Default', '--no-first-run', '--no-default-browser-check', 'https://chatgpt.com/'], { stdio: 'ignore' }); child.once('error', reject); child.once('close', () => resolve()); });
}
export async function shutdownBroker(root: string): Promise<void> { await request(root, 'shutdown'); }

export class ChatGPTBrowser implements BrowserTransport {
  private sessionId?: string;
  constructor(private readonly root: string) {}
  async withBrowser<T>(operation: () => Promise<T>) { try { return await operation(); } finally { await this.close(); } }
  async ensureAvailable() { await ensureBroker(this.root); }
  async ensureAuthenticated() { const status = await request(this.root, 'auth') as { authenticated?: boolean }; if (!status?.authenticated) fail('CHATGPT_AUTH_REQUIRED', 'ChatGPT authentication is required. Run `chatgpt-shot login`.'); }
  async openFreshContext() { await this.close(); this.sessionId = await request(this.root, 'open'); }
  async fillPrompt(prompt: string) { if (!this.sessionId) fail('BROWSER_UNAVAILABLE', 'Browser invocation page is unavailable.'); await request(this.root, 'fill', this.sessionId, prompt); }
  async submitPrompt() { if (!this.sessionId) fail('BROWSER_UNAVAILABLE', 'Browser invocation page is unavailable.'); await request(this.root, 'submit', this.sessionId); }
  async inspectSubmission(invocationId: string): Promise<Inspection> { if (!this.sessionId) return 'uncertain'; return request(this.root, 'inspect', this.sessionId, undefined, invocationId); }
  async close() { if (this.sessionId) await request(this.root, 'close', this.sessionId).catch(() => {}); this.sessionId = undefined; }
}

export { brokerSocket };
