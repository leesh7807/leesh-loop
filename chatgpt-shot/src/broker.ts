import { ChildProcess, spawn } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, unlinkSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { fail } from './errors.js';

type Request = { operation: string; sessionId?: string; prompt?: string; invocationId?: string };
type Response = { ok: true; value?: unknown } | { ok: false; code: string; message: string };
type Message = { id?: number; sessionId?: string; result?: any; error?: { message: string } };
const uid = process.getuid?.();
const ownedDirectory = (path: string) => { try { const stat = lstatSync(path); return stat.isDirectory() && (uid === undefined || stat.uid === uid) && (stat.mode & 0o022) === 0; } catch { return false; } };
const runtimeBase = () => {
  const candidate = process.env.XDG_RUNTIME_DIR;
  if (candidate && ownedDirectory(candidate)) return candidate;
  const cache = join(homedir(), '.cache');
  if (!ownedDirectory(cache)) fail('BROWSER_UNAVAILABLE', 'No owner-controlled local runtime directory is available.');
  return cache;
};
const runtimeDirectory = (root: string) => join(runtimeBase(), 'chatgpt-shot', createHash('sha256').update(root).digest('hex').slice(0, 16));
export const brokerSocket = (root: string) => join(runtimeDirectory(root), 'broker.sock');
const profile = (root: string) => join(root, '.chatgpt-shot-profile');
const chrome = () => [process.env.CHATGPT_SHOT_BROWSER, '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome'].find((path): path is string => Boolean(path && existsSync(path)));

/** Minimal, process-private CDP adapter; it deliberately exposes no raw CDP across broker IPC. */
class PipeCdp {
  private next = 0; private buffer = ''; private closed = false; private readonly pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  constructor(private readonly input: NodeJS.WritableStream, output: NodeJS.ReadableStream) {
    output.setEncoding('utf8'); output.on('data', (chunk: string) => { this.buffer += chunk; let end: number; while ((end = this.buffer.indexOf('\0')) >= 0) { const body = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1); if (body) this.receive(JSON.parse(body)); } });
    const close = () => this.finish(); output.once('end', close); output.once('close', close); output.once('error', close);
  }
  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> {
    if (this.closed) return Promise.reject(new Error('Chrome private debugging pipe is closed.'));
    const id = ++this.next; this.input.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`CDP ${method} timed out.`)); }, 30_000);
      this.pending.set(id, { resolve: (value) => { clearTimeout(timeout); resolve(value); }, reject: (error) => { clearTimeout(timeout); reject(error); } });
    });
  }
  private receive(message: Message) { if (!message.id) return; const pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id); message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result); }
  private finish() { if (this.closed) return; this.closed = true; for (const pending of this.pending.values()) pending.reject(new Error('Chrome private debugging pipe closed.')); this.pending.clear(); }
  close() { this.finish(); }
}

class Page {
  constructor(readonly targetId: string, readonly sessionId: string, private readonly cdp: PipeCdp) {}
  async evaluate<T>(expression: string, args: unknown[] = []): Promise<T> { const result = await this.cdp.send('Runtime.evaluate', { expression: `(${expression})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true }, this.sessionId); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'Page evaluation failed.'); return result.result.value as T; }
  async navigate(url = 'https://chatgpt.com/') { await this.cdp.send('Page.enable', {}, this.sessionId); await this.cdp.send('Page.navigate', { url }, this.sessionId); }
  async close() { await this.cdp.send('Target.closeTarget', { targetId: this.targetId }); }
}

const visibility = `const visible=e=>{const s=getComputedStyle(e),b=e.getBoundingClientRect();return s.visibility!=='hidden'&&s.display!=='none'&&b.width>0&&b.height>0};`;
const authProbe = `()=>{${visibility}const c=[...document.querySelectorAll('a,button')].filter(visible);const loginVisible=c.some(e=>/^(log in|sign up)$/i.test((e.textContent||'').trim())||/\\/(auth|login)/i.test(e.href||''));const accountVisible=c.some(e=>/(account|profile|settings|upgrade plan|my plan|log out|user menu|avatar)/i.test([e.getAttribute('aria-label'),e.getAttribute('title'),e.getAttribute('data-testid'),e.textContent].filter(Boolean).join(' ')))||[...document.querySelectorAll('[data-testid*="profile"],[data-testid*="account"],img[alt*="profile" i],img[alt*="avatar" i]')].some(visible);return {loginVisible,accountVisible,authenticated:!loginVisible&&accountVisible}}`;
const composerProbe = `()=>{${visibility}return [...document.querySelectorAll('textarea,[contenteditable="true"]')].some(visible)}`;

class Broker {
  private process?: ChildProcess; private cdp?: PipeCdp; private control?: Page; private starting?: Promise<void>;
  private readonly pages = new Map<string, Page>();
  constructor(private readonly root: string) {}
  private async runtime() {
    if (this.cdp && this.control) return;
    if (this.starting) return this.starting;
    const start = this.startRuntime(); this.starting = start; try { return await start; } finally { this.starting = undefined; }
  }
  private async startRuntime() {
    const executable = chrome(); if (!executable) fail('BROWSER_UNAVAILABLE', 'A supported system Chrome executable is unavailable.');
    const directory = profile(this.root); mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700);
    const child = spawn(executable!, [`--user-data-dir=${directory}`, '--profile-directory=Default', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check', '--disable-background-mode', '--start-minimized'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] }) as ChildProcess;
    const input = child.stdio[3], output = child.stdio[4]; if (!input || !output) { child.kill(); fail('BROWSER_UNAVAILABLE', 'Chrome did not create its private debugging pipe.'); }
    const cdp = new PipeCdp(input as NodeJS.WritableStream, output as NodeJS.ReadableStream);
    child.once('exit', () => { if (this.process === child) { this.process = undefined; this.cdp = undefined; this.control = undefined; this.pages.clear(); } });
    try {
      const control = await this.createPage(cdp); await control.navigate(); await this.ready(control);
      this.process = child; this.cdp = cdp; this.control = control;
    } catch (error) {
      cdp.close(); if (child.exitCode === null) child.kill('SIGTERM');
      throw error;
    }
  }
  private async createPage(cdp = this.cdp!) { const created = await cdp.send('Target.createTarget', { url: 'about:blank' }); const attached = await cdp.send('Target.attachToTarget', { targetId: created.targetId, flatten: true }); return new Page(created.targetId, attached.sessionId, cdp); }
  private async ready(page: Page) {
    for (let i = 0; i < 30; i++) { const state = await page.evaluate<boolean>('()=>document.readyState!=="loading"'); if (state) break; await delay(500); }
    if (await page.evaluate<boolean>('()=>/just a moment|checking your browser/i.test(document.body.innerText)')) fail('USER_INTERVENTION_REQUIRED', 'ChatGPT Web requires user intervention before automation can continue.');
  }
  private async auth(page: Page) { await this.ready(page); return page.evaluate<{ loginVisible: boolean; accountVisible: boolean; authenticated: boolean }>(authProbe); }
  private async composer(page: Page) { await this.ready(page); for (let i = 0; i < 60; i++) { if (await page.evaluate<boolean>(composerProbe)) return; await delay(500); } fail('BROWSER_UNAVAILABLE', 'The authenticated ChatGPT composer is unavailable.'); }
  async handle(request: Request): Promise<unknown> {
    await this.runtime();
    if (request.operation === 'ensure') return;
    if (request.operation === 'auth') return this.auth(this.control!);
    if (request.operation === 'open') { const page = await this.createPage(); try { await page.navigate(); const auth = await this.auth(page); if (!auth.authenticated) fail('CHATGPT_AUTH_REQUIRED', 'ChatGPT authentication is required. Run `chatgpt-shot login`.'); await this.composer(page); const id = randomUUID(); this.pages.set(id, page); return id; } catch (error) { await page.close().catch(() => {}); throw error; } }
    const page = request.sessionId ? this.pages.get(request.sessionId) : undefined; if (!page) return fail('BROWSER_UNAVAILABLE', 'Browser invocation page is unavailable.');
    if (request.operation === 'fill') { await this.composer(page); await page.evaluate(`value=>{${visibility}const e=[...document.querySelectorAll('textarea,[contenteditable="true"]')].find(visible);if(!e)throw new Error('composer unavailable');e.focus();if(e instanceof HTMLTextAreaElement){const s=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;s.call(e,value)}else e.textContent=value;e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}))}`, [request.prompt ?? '']); return; }
    if (request.operation === 'submit') { const clicked = await page.evaluate<boolean>(`()=>{${visibility}const b=[...document.querySelectorAll('button')].find(e=>/send prompt|send message/i.test([e.getAttribute('aria-label'),e.textContent].filter(Boolean).join(' '))&&!e.disabled&&visible(e));if(!b)return false;b.click();return true}`); if (!clicked) await this.cdp!.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, page.sessionId).then(() => this.cdp!.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, page.sessionId)); return; }
    if (request.operation === 'inspect') { const id = request.invocationId ?? ''; const value = await page.evaluate<{ seen: boolean; value: string }>(`id=>{${visibility}const e=[...document.querySelectorAll('textarea,[contenteditable="true"]')].find(visible);const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let seen=false,node;while(node=walker.nextNode()){const parent=node.parentElement;if(!parent?.closest('textarea,[contenteditable="true"]')&&node.textContent?.includes(id)){seen=true;break}}return {seen,value:e instanceof HTMLTextAreaElement?e.value:(e?.textContent||'')}}`, [id]); return value.seen && !value.value.includes(id) ? 'submitted' : !value.seen && value.value.includes(id) ? 'not_submitted' : 'uncertain'; }
    if (request.operation === 'close') { await page.close().catch(() => {}); this.pages.delete(request.sessionId!); return; }
    fail('INTERNAL_ERROR', `Unsupported broker operation ${request.operation}.`);
  }
  async close() {
    await Promise.all([...this.pages.values()].map((page) => page.close().catch(() => {})));
    this.pages.clear(); this.cdp?.close(); const child = this.process;
    this.process = undefined; this.cdp = undefined; this.control = undefined;
    if (!child || child.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      const force = setTimeout(() => child.kill('SIGKILL'), 5_000);
      child.once('exit', () => { clearTimeout(force); resolve(); });
      child.kill('SIGTERM');
    });
  }
}
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function runBroker(root: string): Promise<void> {
  const directory = runtimeDirectory(root); mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700); if (!ownedDirectory(directory)) fail('BROWSER_UNAVAILABLE', 'Broker runtime directory is not owner-controlled.'); const socket = brokerSocket(root); const broker = new Broker(root); let stopping = false;
  const server = net.createServer({ allowHalfOpen: true }, connection => { const peer = (connection as unknown as { getPeerCredentials?: () => { uid?: number } }).getPeerCredentials?.(); if (peer?.uid !== undefined && process.getuid && peer.uid !== process.getuid()) return connection.destroy(); let body = ''; connection.setEncoding('utf8'); connection.on('data', chunk => { body += chunk; }); connection.on('end', async () => { let response: Response; try { const request = JSON.parse(body) as Request; if (request.operation === 'shutdown') { await shutdown(); response = { ok: true }; } else response = { ok: true, value: await broker.handle(request) }; } catch (error: any) { response = { ok: false, code: error?.code ?? 'INTERNAL_ERROR', message: error?.message ?? String(error) }; } connection.end(JSON.stringify(response)); }); });
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = () => shutdownPromise ??= (async () => { if (stopping) return; stopping = true; await broker.close(); server.close(); try { unlinkSync(socket); } catch {} })();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, () => { try { chmodSync(socket, 0o600); resolve(); } catch (error) { reject(error); } }); }); process.on('SIGINT', () => void shutdown()); process.on('SIGTERM', () => void shutdown());
}
export const brokerRequest = async (root: string, request: Request): Promise<any> => await new Promise((resolve, reject) => {
  const path = brokerSocket(root); try { const stat = lstatSync(path); if (!stat.isSocket() || (uid !== undefined && stat.uid !== uid)) throw new Error('Broker socket is not owned by this OS user.'); } catch (error: any) { if (error.code !== 'ENOENT') return reject(error); }
  const socket = net.createConnection(path); let body = ''; let settled = false;
  const finish = (error?: Error, value?: any) => { if (settled) return; settled = true; clearTimeout(timeout); socket.destroy(); error ? reject(error) : resolve(value); };
  const timeoutMs = request.operation === 'open' || request.operation === 'shutdown' ? 90_000 : 15_000;
  const timeout = setTimeout(() => finish(new Error('Broker RPC timed out.')), timeoutMs);
  socket.setEncoding('utf8'); socket.once('error', (error) => finish(error)); socket.on('data', chunk => { body += chunk; }); socket.on('end', () => { try { const response = JSON.parse(body) as Response; if (!response.ok) { const error: any = new Error(response.message); error.code = response.code; finish(error); } else finish(undefined, response.value); } catch (error: any) { finish(error); } }); socket.end(JSON.stringify(request));
});
