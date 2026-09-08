import { existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { fail } from './errors.js';

export type Inspection = 'submitted' | 'not_submitted' | 'uncertain';
export interface BrowserTransport { ensureAvailable(): Promise<void>; ensureAuthenticated(): Promise<void>; openFreshContext(): Promise<void>; fillPrompt(prompt: string): Promise<void>; submitPrompt(): Promise<void>; inspectSubmission(invocationId: string): Promise<Inspection>; close(): Promise<void>; }
const profilePath = (root: string) => join(root, '.chatgpt-shot-profile');
const systemChrome = () => [process.env.CHATGPT_SHOT_BROWSER, '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome'].find((path): path is string => Boolean(path && existsSync(path)));

/** Login is a normal system-Chrome process, never an automation-controlled browser. */
export async function manualLogin(root: string): Promise<void> {
  const executable = systemChrome(); if (!executable) return fail('BROWSER_UNAVAILABLE', 'A supported system Chrome executable is required for manual login.');
  const profile = profilePath(root); mkdirSync(profile, { recursive: true, mode: 0o700 });
  await new Promise<void>((resolve, reject) => { const child = spawn(executable, [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-mode', 'https://chatgpt.com/'], { stdio: 'ignore' }); child.once('error', error => reject(new Error(`Could not launch system Chrome: ${error.message}`))); child.once('close', () => resolve()); });
}

export class ChatGPTBrowser implements BrowserTransport {
  private context?: BrowserContext; private page?: Page; private submittedPrompt = '';
  // Headful Chrome preserves the user-validated session and avoids the provider's headless challenge.
  constructor(private readonly root: string, private readonly headed = true) {}
  private async start(): Promise<Page> { if (this.page) return this.page; try { const profile = profilePath(this.root); mkdirSync(profile, { recursive: true, mode: 0o700 }); this.context = await chromium.launchPersistentContext(profile, { headless: !this.headed, channel: systemChrome() ? 'chrome' : undefined, ignoreDefaultArgs: ['--password-store=basic'] }); this.page = this.context.pages()[0] ?? await this.context.newPage(); await this.page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 }); return this.page; } catch (e) { return fail('BROWSER_UNAVAILABLE', 'Could not open the persistent ChatGPT browser profile.', e); } }
  async ensureAvailable() { await this.start(); }
  async ensureAuthenticated() {
    const page = await this.start();
    const loginLink = page.locator('a[href*="auth"], a[href*="login"]').filter({ visible: true }).first();
    const loginButton = page.getByRole('button', { name: /log in|sign up/i }).filter({ visible: true }).first();
    if (await loginLink.isVisible({ timeout: 1_000 }).catch(() => false) || await loginButton.isVisible({ timeout: 1_000 }).catch(() => false)) fail('CHATGPT_AUTH_REQUIRED', 'ChatGPT authentication is required. Run `chatgpt-shot login`.');
    const composer = page.locator('textarea, [contenteditable="true"]').filter({ visible: true }).first();
    if (!await composer.isVisible({ timeout: 8_000 }).catch(() => false)) fail('CHATGPT_AUTH_REQUIRED', 'ChatGPT authentication is required. Run `chatgpt-shot login`.');
  }
  async openFreshContext() { const page = await this.start(); await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 }); await this.ensureAuthenticated(); }
  private async composer(): Promise<any> { const page = await this.start(); const locator = page.locator('textarea, [contenteditable="true"]').filter({ visible: true }).first(); if (!await locator.isVisible({ timeout: 8_000 }).catch(() => false)) fail('USER_INTERVENTION_REQUIRED', 'ChatGPT composer is unavailable.'); return locator; }
  async fillPrompt(prompt: string) { const input = await this.composer(); this.submittedPrompt = prompt; await input.fill(prompt); }
  async submitPrompt() { const page = await this.start(); const button = page.getByRole('button', { name: /send prompt|send message/i }).first(); if (await button.isVisible().catch(() => false)) await button.click(); else { const input = await this.composer(); await input.press('Enter'); } }
  async inspectSubmission(invocationId: string): Promise<Inspection> { const page = await this.start(); const turns = page.getByText(invocationId, { exact: false }); const seen = await turns.count().catch(() => 0); const composer = await this.composer(); const value = await composer.inputValue().catch(async () => await composer.textContent() ?? ''); if (seen > 0 && !value?.includes(invocationId)) return 'submitted'; if (seen === 0 && value?.includes(invocationId)) return 'not_submitted'; return 'uncertain'; }
  async close() { await this.context?.close(); this.context = undefined; this.page = undefined; }
}
