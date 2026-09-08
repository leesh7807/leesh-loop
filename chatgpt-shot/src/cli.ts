#!/usr/bin/env node
import { loadConfig } from './config.js';
import { ShotError, fail } from './errors.js';
import { NotionStore, databaseIdFromUrl } from './notion.js';
import { ChatGPTBrowser, manualLogin } from './browser.js';
import { submit } from './service.js';

const out = (value: string) => process.stdout.write(`${value}\n`);
const configuredDatabaseId = (config: ReturnType<typeof loadConfig>) => databaseIdFromUrl(config.databaseUrl);
async function initialized(config: ReturnType<typeof loadConfig>): Promise<NotionStore> { const store = new NotionStore(config.notionToken); store.validateSchema(await store.database(configuredDatabaseId(config))); return store; }
async function main(args: string[]) {
  const [command, ...rest] = args; const config = loadConfig();
  if (command === 'init') { if (rest.length) return fail('CONFIG_INVALID', 'Usage: chatgpt-shot init'); const databaseId = configuredDatabaseId(config); const store = new NotionStore(config.notionToken); const database = await store.database(databaseId); try { store.validateSchema(database); out(`already initialized: ${databaseId}`); } catch (error) { if (!(error instanceof ShotError) || error.code !== 'NOTION_SCHEMA_INVALID') throw error; await store.initializeSchema(database); store.validateSchema(await store.database(databaseId)); out(`initialized: ${databaseId}`); } return; }
  if (command === 'login') { out('System Chrome opened with the dedicated chatgpt-shot profile. Authenticate manually, then close Chrome to finish.'); await manualLogin(config.root); return; }
  if (command === 'doctor') { const store = await initialized(config); const browser = new ChatGPTBrowser(config.root); try { await browser.ensureAvailable(); await browser.ensureAuthenticated(); out('OK: repository configuration, Invocation database, browser profile, and authenticated ChatGPT composer are available.'); } finally { await browser.close(); } return; }
  if (command === 'submit') { const prompt = rest.length === 1 ? rest[0] : undefined; if (!prompt) return fail('CONFIG_INVALID', 'Usage: chatgpt-shot submit "<prompt>"'); const store = await initialized(config); const browser = new ChatGPTBrowser(config.root); const result = await submit(store, configuredDatabaseId(config), browser, prompt, { log: (event, id) => process.stderr.write(`${event}${id ? ` invocation_id=${id}` : ''}\n`) }); out(result); return; }
  fail('CONFIG_INVALID', 'Usage: chatgpt-shot <init|login|doctor|submit>');
}
main(process.argv.slice(2)).catch(e => { if (e instanceof ShotError) { process.stderr.write(`${e.code}: ${e.message}\n`); process.exitCode = 1; } else { process.stderr.write(`INTERNAL_ERROR: ${e instanceof Error ? e.message : String(e)}\n`); process.exitCode = 1; } });
