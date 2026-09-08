#!/usr/bin/env node
import { loadConfig, persistDatabaseId } from './config.js';
import { ShotError, fail } from './errors.js';
import { NotionStore, databaseIdFromUrl } from './notion.js';
import { ChatGPTBrowser } from './browser.js';
import { submit } from './service.js';

const out = (value: string) => process.stdout.write(`${value}\n`);
async function initialized(config: ReturnType<typeof loadConfig>): Promise<NotionStore> { const databaseId = config.databaseId; if (!databaseId) return fail('CONFIG_INVALID', 'NOTION_INVOCATION_DATABASE_ID is required; run `chatgpt-shot init --notion-database <url>`.'); const store = new NotionStore(config.notionToken); store.validateSchema(await store.database(databaseId)); return store; }
async function main(args: string[]) {
  const [command, ...rest] = args; const config = loadConfig();
  if (command === 'init') { const pos = rest.indexOf('--notion-database'); const url = pos >= 0 ? rest[pos + 1] : undefined; if (!url) return fail('CONFIG_INVALID', 'Usage: chatgpt-shot init --notion-database <url>'); const requested = databaseIdFromUrl(url); const store = new NotionStore(config.notionToken); const configured = config.databaseId; if (configured) { if (configured.replace(/-/g, '') !== requested) return fail('CONFIG_INVALID', 'Configured Invocation database differs from --notion-database; refusing to replace it.'); store.validateSchema(await store.database(configured)); out(`already initialized: ${configured}`); return; } await store.initializeSchema(await store.database(requested)); store.validateSchema(await store.database(requested)); persistDatabaseId(config, requested); out(`initialized: ${requested}`); return; }
  if (command === 'login') { const browser = new ChatGPTBrowser(config.root, true); await browser.ensureAvailable(); out('System Chrome opened with the dedicated chatgpt-shot profile. Authenticate manually, then close Chrome to finish.'); await browser.waitForUserClose(); return; }
  if (command === 'doctor') { const store = await initialized(config); const browser = new ChatGPTBrowser(config.root); try { await browser.ensureAvailable(); await browser.ensureAuthenticated(); out('OK: repository configuration, Invocation database, browser profile, and authenticated ChatGPT composer are available.'); } finally { await browser.close(); } return; }
  if (command === 'submit') { const prompt = rest.length === 1 ? rest[0] : undefined; if (!prompt) return fail('CONFIG_INVALID', 'Usage: chatgpt-shot submit "<prompt>"'); const store = await initialized(config); const databaseId = config.databaseId; if (!databaseId) return fail('CONFIG_INVALID', 'NOTION_INVOCATION_DATABASE_ID is required.'); const browser = new ChatGPTBrowser(config.root); const result = await submit(store, databaseId, browser, prompt, { log: (event, id) => process.stderr.write(`${event}${id ? ` invocation_id=${id}` : ''}\n`) }); out(result); return; }
  fail('CONFIG_INVALID', 'Usage: chatgpt-shot <init|login|doctor|submit>');
}
main(process.argv.slice(2)).catch(e => { if (e instanceof ShotError) { process.stderr.write(`${e.code}: ${e.message}\n`); process.exitCode = 1; } else { process.stderr.write(`INTERNAL_ERROR: ${e instanceof Error ? e.message : String(e)}\n`); process.exitCode = 1; } });
