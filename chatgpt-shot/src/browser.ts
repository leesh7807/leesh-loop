import { existsSync, mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import net from 'node:net';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { fail } from './errors.js';

export type Inspection = 'submitted' | 'not_submitted' | 'uncertain';
export interface BrowserTransport { ensureAvailable(): Promise<void>; ensureAuthenticated(): Promise<void>; runSubmission<T>(operation: () => Promise<T>): Promise<T>; openFreshContext(): Promise<void>; fillPrompt(prompt: string): Promise<void>; submitPrompt(): Promise<void>; inspectSubmission(invocationId: string): Promise<Inspection>; close(): Promise<void>; }
type Runtime = { port: number; pid: number };
const profilePath = (root: string) => join(root, '.chatgpt-shot-profile');
const statePath = (root: string) => join(root, '.chatgpt-shot-runtime.json');
const systemChrome = () => [process.env.CHATGPT_SHOT_BROWSER, '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome'].find((path): path is string => Boolean(path && existsSync(path)));
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const port = async () => await new Promise<number>((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const address = server.address(); server.close(error => error ? reject(error) : resolve((address as net.AddressInfo).port)); }); });
const endpoint = async (value: Runtime): Promise<string | undefined> => { try { const response = await fetch(`http://127.0.0.1:${value.port}/json/version`, { signal: AbortSignal.timeout(500) }); const body: any = await response.json(); return typeof body.webSocketDebuggerUrl === 'string' ? body.webSocketDebuggerUrl : undefined; } catch { return undefined; } };
const readRuntime = (root: string): Runtime | undefined => { try { const value = JSON.parse(readFileSync(statePath(root), 'utf8')); return Number.isInteger(value.port) && Number.isInteger(value.pid) ? value : undefined; } catch { return undefined; } };
const writeRuntime = (root: string, value: Runtime) => writeFileSync(statePath(root), JSON.stringify(value), { mode: 0o600 });
class RuntimeLock {
  private readonly path: string; private readonly owner: string;
  constructor(root: string, name: 'runtime' | 'submit') { this.path = join(root, `.chatgpt-shot-${name}.lock`); this.owner = join(this.path, 'owner.json'); }
  private stale() { try { const pid = JSON.parse(readFileSync(this.owner, 'utf8')).pid; process.kill(pid, 0); return false; } catch { try { unlinkSync(this.owner); rmdirSync(this.path); } catch {} return true; } }
  async run<T>(operation: () => Promise<T>): Promise<T> { for (let attempt = 0; attempt < 600; attempt++) { try { mkdirSync(this.path, { mode: 0o700 }); writeFileSync(this.owner, JSON.stringify({ pid: process.pid }), { mode: 0o600 }); try { return await operation(); } finally { try { unlinkSync(this.owner); rmdirSync(this.path); } catch {} } } catch (error: any) { if (error.code !== 'EEXIST') throw error; this.stale(); await wait(100); } } return fail('BROWSER_UNAVAILABLE', 'Timed out waiting for the shared browser submission lock.'); }
}

/** Opens a user-controlled Chrome process; Playwright is deliberately not involved in credential entry. */
export async function manualLogin(root: string): Promise<void> {
  const executable = systemChrome(); if (!executable) return fail('BROWSER_UNAVAILABLE', 'A supported system Chrome executable is required for manual login.');
  const profile = profilePath(root); mkdirSync(profile, { recursive: true, mode: 0o700 });
  await new Promise<void>((resolve, reject) => { const child = spawn(executable, [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-mode', 'https://chatgpt.com/'], { stdio: 'ignore' }); child.once('error', error => reject(new Error(`Could not launch system Chrome: ${error.message}`))); child.once('close', () => resolve()); });
}

async function connectRuntime(root: string): Promise<Browser> {
  return new RuntimeLock(root, 'runtime').run(async () => { const remembered = readRuntime(root); const active = remembered && await endpoint(remembered);
  if (active) return chromium.connectOverCDP(active);
  const executable = systemChrome(); if (!executable) return fail('BROWSER_UNAVAILABLE', 'A supported system Chrome executable is unavailable.');
  const profile = profilePath(root); mkdirSync(profile, { recursive: true, mode: 0o700 }); const allocated = await port();
  const child = spawn(executable, [`--user-data-dir=${profile}`, `--remote-debugging-port=${allocated}`, '--remote-debugging-address=127.0.0.1', '--no-first-run', '--no-default-browser-check', '--disable-background-mode', '--start-minimized', 'https://chatgpt.com/'], { detached: true, stdio: 'ignore' }); child.unref();
  const runtime = { port: allocated, pid: child.pid! }; for (let attempt = 0; attempt < 30; attempt++) { const connected = await endpoint(runtime); if (connected) { writeRuntime(root, runtime); return chromium.connectOverCDP(connected); } await wait(200); }
  return fail('BROWSER_UNAVAILABLE', 'Could not start the managed local Chrome runtime.'); });
}

export class ChatGPTBrowser implements BrowserTransport {
  private browser?: Browser; private context?: BrowserContext; private page?: Page; private submitted = false;
  constructor(private readonly root: string) {}
  private async start(): Promise<Page> { if (this.page) return this.page; try { this.browser = await connectRuntime(this.root); this.context = this.browser.contexts()[0] ?? await this.browser.newContext(); this.page = await this.context.newPage(); await this.page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 }); return this.page; } catch (e) { return fail('BROWSER_UNAVAILABLE', 'Could not attach to the managed local ChatGPT browser runtime.', e); } }
  async ensureAvailable() { await this.start(); }
  async runSubmission<T>(operation: () => Promise<T>): Promise<T> { return new RuntimeLock(this.root, 'submit').run(operation); }
  async ensureAuthenticated() { const page = await this.start(); await page.waitForTimeout(1_500); const loginLink = page.locator('a[href*="auth"], a[href*="login"]').filter({ visible: true }).first(); const loginButton = page.getByRole('button', { name: /log in|sign up/i }).filter({ visible: true }).first(); if (await loginLink.isVisible({ timeout: 1_000 }).catch(() => false) || await loginButton.isVisible({ timeout: 1_000 }).catch(() => false)) fail('CHATGPT_AUTH_REQUIRED', 'ChatGPT authentication is required. Run `chatgpt-shot login`.'); const composer = page.locator('textarea, [contenteditable="true"]').filter({ visible: true }).first(); if (!await composer.isVisible({ timeout: 8_000 }).catch(() => false)) fail('CHATGPT_AUTH_REQUIRED', 'ChatGPT authentication is required. Run `chatgpt-shot login`.'); }
  async openFreshContext() { const page = await this.start(); await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 }); await this.ensureAuthenticated(); }
  private async composer(): Promise<any> { const page = await this.start(); const locator = page.locator('textarea, [contenteditable="true"]').filter({ visible: true }).first(); if (!await locator.isVisible({ timeout: 8_000 }).catch(() => false)) fail('USER_INTERVENTION_REQUIRED', 'ChatGPT composer is unavailable.'); return locator; }
  async fillPrompt(prompt: string) { await (await this.composer()).fill(prompt); }
  async submitPrompt() { const page = await this.start(); const button = page.getByRole('button', { name: /send prompt|send message/i }).first(); if (await button.isVisible().catch(() => false)) await button.click(); else await (await this.composer()).press('Enter'); this.submitted = true; }
  async inspectSubmission(invocationId: string): Promise<Inspection> { const page = await this.start(); const turns = page.getByText(invocationId, { exact: false }); const seen = await turns.count().catch(() => 0); const composer = await this.composer(); const value = await composer.inputValue().catch(async () => await composer.textContent() ?? ''); if (seen > 0 && !value?.includes(invocationId)) return 'submitted'; if (seen === 0 && value?.includes(invocationId)) return 'not_submitted'; return 'uncertain'; }
  // connectOverCDP marks Browser.close() as a connection close, leaving Chrome itself running.
  async close() { if (!this.submitted) await this.page?.close().catch(() => {}); await this.browser?.close(); this.page = undefined; this.context = undefined; this.browser = undefined; }
}
