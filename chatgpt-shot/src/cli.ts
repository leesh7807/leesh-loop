#!/usr/bin/env node
import { loadConfig } from './config.js';
import { ShotError, fail } from './errors.js';
import { NotionStore, databaseIdFromUrl } from './notion.js';
import { ChatGPTBrowser, manualLogin, shutdownBroker } from './browser.js';
import { runBroker } from './broker.js';
import { installCancellationHandler } from './cancellation.js';
import { submit } from './service.js';

const out = (value: string) => process.stdout.write(`${value}\n`);
const configuredDatabaseId = (config: ReturnType<typeof loadConfig>) => databaseIdFromUrl(config.databaseUrl);
async function initialized(config: ReturnType<typeof loadConfig>): Promise<NotionStore> { const store = new NotionStore(config.notionToken); store.validateSchema(await store.database(configuredDatabaseId(config))); return store; }
async function submitWithCancellation(store: NotionStore, databaseId: string, browser: ChatGPTBrowser, prompt: string) {
  const removeCancellationHandler = installCancellationHandler(() => browser.close());
  try { return await submit(store, databaseId, browser, prompt, { log: (event, id) => process.stderr.write(`${event}${id ? ` invocation_id=${id}` : ''}\n`) }); }
  finally { removeCancellationHandler(); }
}
async function main(args: string[]) {
  const [command, ...rest] = args; const config = loadConfig();
  if (command === '__broker') return runBroker(config.root);
  if (command === 'init') { if (rest.length) return fail('CONFIG_INVALID', 'Usage: chatgpt-shot init'); const databaseId = configuredDatabaseId(config); const store = new NotionStore(config.notionToken); const database = await store.database(databaseId); try { store.validateSchema(database); out(`already initialized: ${databaseId}`); } catch (error) { if (!(error instanceof ShotError) || error.code !== 'NOTION_SCHEMA_INVALID') throw error; if (!store.isProvisionable(database)) throw error; await store.initializeSchema(database); store.validateSchema(await store.database(databaseId)); out(`initialized: ${databaseId}`); } return; }
  if (command === 'login') { out('Plain system Chrome opened with the dedicated chatgpt-shot profile. Authenticate manually, then close it to continue.'); await manualLogin(config.root); const browser = new ChatGPTBrowser(config.root); await browser.ensureAvailable(); await browser.ensureAuthenticated(); out('ChatGPT authentication is available in the retained broker runtime.'); return; }
  if (command === 'doctor') { const store = await initialized(config); const browser = new ChatGPTBrowser(config.root); await browser.withBrowser(async () => { await browser.ensureAvailable(); await browser.ensureAuthenticated(); await browser.openFreshContext(); }); out('OK: local configuration, Invocation database, browser profile, authenticated ChatGPT session, and composer are available. ChatGPT-to-Notion write access is not verified; confirm it with a smoke submit.'); return; }
  if (command === 'submit') { const prompt = rest.length === 1 ? rest[0] : undefined; if (!prompt) return fail('CONFIG_INVALID', 'Usage: chatgpt-shot submit "<prompt>"'); const store = await initialized(config); const browser = new ChatGPTBrowser(config.root); const result = await submitWithCancellation(store, configuredDatabaseId(config), browser, prompt); out(result); return; }
  if (command === 'shutdown') { await shutdownBroker(config.root); out('chatgpt-shot broker shut down.'); return; }
  fail('CONFIG_INVALID', 'Usage: chatgpt-shot <init|login|doctor|submit|shutdown>');
}
main(process.argv.slice(2)).catch(e => { if (e instanceof ShotError) { process.stderr.write(`${e.code}: ${e.message}\n`); process.exitCode = 1; } else { process.stderr.write(`INTERNAL_ERROR: ${e instanceof Error ? e.message : String(e)}\n`); process.exitCode = 1; } });
