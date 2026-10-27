#!/usr/bin/env node
import { unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { managerPaths, readJsonFile } from './manager-storage.mjs';
import { startManagerServer } from './manager-service.mjs';

async function serve() {
  const started = await startManagerServer({ runtimeRoot: process.env.LEESH_LOOP_RUNTIME_ROOT || fileURLToPath(new URL('../..', import.meta.url)) });
  console.log(`Leesh Loop Manager listening at ${started.url}`);
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    for (const server of started.servers || [started.server]) {
      server.close();
      server.closeAllConnections();
    }
    const current = await readJsonFile(started.record, 'Manager service record').catch(() => null);
    if (current?.pid === process.pid) await unlink(started.record).catch(error => { if (error?.code !== 'ENOENT') throw error; });
  };
  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
  started.server.once('close', () => { process.exitCode = 0; });
}

const [command] = process.argv.slice(2);
if (command === 'serve') {
  serve().catch(error => {
    console.error(`Leesh Loop Manager could not start: ${error.message}`);
    process.exitCode = 1;
  });
} else if (command === '--help' || command === '-h') {
  console.log('Usage: node operator/app/manager.mjs serve');
} else {
  console.error('Usage: node operator/app/manager.mjs serve');
  process.exitCode = 2;
}
