import { fail } from './errors.js';
import type { NotionStore } from './notion.js';
const rich = (block: any) => (block[block.type]?.rich_text ?? block[block.type]?.text ?? []).map((x: any) => { const value = x.plain_text ?? x.text?.content ?? ''; const href = x.href ?? x.text?.link?.url; return href ? `[${value.replace(/[\\\[\]]/g, '\\$&')}](${href.replace(/\)/g, '\\)')})` : value; }).join('');
export async function markdownResult(store: NotionStore, pageId: string): Promise<string> {
  async function render(blocks: any[], depth = 0): Promise<string[]> { const lines: string[] = []; for (const b of blocks) { const t = rich(b); let line: string | undefined; switch (b.type) {
    case 'paragraph': line = t; break; case 'heading_1': line = `# ${t}`; break; case 'heading_2': line = `## ${t}`; break; case 'heading_3': line = `### ${t}`; break;
    case 'bulleted_list_item': line = `${'  '.repeat(depth)}- ${t}`; break; case 'numbered_list_item': line = `${'  '.repeat(depth)}1. ${t}`; break; case 'quote': line = `> ${t}`; break;
    case 'code': line = `\`\`\`${b.code?.language ?? ''}\n${t}\n\`\`\``; break; case 'divider': line = '---'; break;
    default: if (t) line = t; else if (!b.has_children) fail('RESULT_SERIALIZATION_FAILED', `Cannot serialize meaningful ${b.type} block.`);
  } if (line !== undefined) lines.push(line); if (b.has_children) lines.push(...await render(await store.children(b.id), depth + 1)); } return lines; }
  return (await render(await store.children(pageId))).join('\n\n');
}
