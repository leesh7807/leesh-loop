import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { command, parseJsonOutput, remove } from './common.mjs';

export class PublisherCapability {
  constructor({ root, notion, publisherDirectory = join(root, 'operator/notion_publisher') } = {}) {
    this.root = root;
    this.notion = notion;
    this.publisherDirectory = publisherDirectory;
    this.cli = join(publisherDirectory, 'dist/src/cli.js');
    this.publisherConfig = join(publisherDirectory, 'examples/publisher-config.json');
  }

  async prepare() {
    if (existsSync(this.cli)) return { reused: true };
    try { await command('node', ['-e', ''], { cwd: this.publisherDirectory, timeout: 10_000 }); }
    catch { throw new Error('Node is unavailable for the production Notion Publisher'); }
    await command('npm', ['ci'], { cwd: this.publisherDirectory, timeout: 120_000 });
    const { stdout } = await command('npm', ['run', 'build'], { cwd: this.publisherDirectory, timeout: 120_000 });
    return stdout;
  }

  async publish({ plan, databaseUrl, directory }) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const planPath = join(directory, 'accepted-plan.md');
    await writeFile(planPath, plan, { mode: 0o600 });
    try {
      const result = await command('node', [this.cli, '--plan', planPath, '--config', this.publisherConfig, '--database-url', databaseUrl], { cwd: this.root, timeout: 120_000 });
      return parseJsonOutput(result.stdout, 'Notion Publisher');
    } finally {
      await remove(planPath);
    }
  }
}
