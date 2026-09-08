import { fail } from './errors.js';
import type { NotionStore } from './notion.js';

const richText = (items: any[] = []) => items.map((item) => {
  const value = item.plain_text ?? item.text?.content ?? '';
  const href = item.href ?? item.text?.link?.url;
  return href
    ? `[${value.replace(/[\\\[\]]/g, '\\$&')}](${href.replace(/\)/g, '\\)')})`
    : value;
}).join('');

const rich = (block: any) => richText(
  block[block.type]?.rich_text ?? block[block.type]?.text ?? [],
);

const tableRow = (block: any) => `| ${(block.table_row?.cells ?? [])
  .map((cell: any[]) => richText(cell).replace(/\|/g, '\\|'))
  .join(' | ')} |`;

const fenceFor = (text: string) => {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  return '`'.repeat(Math.max(3, longest + 1));
};

const indent = (text: string, depth: number) => {
  const prefix = '    '.repeat(depth);
  return prefix ? text.split('\n').map((line) => `${prefix}${line}`).join('\n') : text;
};

const fallback = (block: any) => {
  const value = block[block.type] ?? {};
  const url = value.url ?? value.external?.url ?? value.file?.url;
  const caption = richText(value.caption);

  if (block.type === 'image' && url) return `![${caption || 'image'}](${url})`;
  if (url) return caption ? `[${caption}](${url})` : url;
  return caption || rich(block);
};

export async function markdownResult(store: NotionStore, pageId: string): Promise<string> {
  async function render(blocks: any[], listDepth = 0): Promise<string[]> {
    const lines: string[] = [];

    for (const block of blocks) {
      if (block.type === 'table') {
        const tableRows = (await store.children(block.id))
          .filter((row) => row.type === 'table_row');
        const output = tableRows.map(tableRow);

        if (!output.length) {
          fail('RESULT_SERIALIZATION_FAILED', 'Cannot serialize an empty Notion table.');
        }
        const columns = tableRows[0].table_row?.cells?.length ?? 0;
        // Markdown tables require a delimiter row even when Notion has no header.
        // The first Notion row becomes a synthetic Markdown header in that case.
        output.splice(1, 0, `| ${Array(columns).fill('---').join(' | ')} |`);
        lines.push(...output.map((line) => indent(line, listDepth)));
        continue;
      }

      const text = rich(block);
      let line: string | undefined;

      switch (block.type) {
        case 'paragraph': line = text; break;
        case 'heading_1': line = `# ${text}`; break;
        case 'heading_2': line = `## ${text}`; break;
        case 'heading_3': line = `### ${text}`; break;
        case 'equation': line = `$$\n${block.equation?.expression ?? ''}\n$$`; break;
        case 'bulleted_list_item': line = `- ${text}`; break;
        case 'numbered_list_item': line = `1. ${text}`; break;
        case 'to_do': line = `- [${block.to_do?.checked ? 'x' : ' '}] ${text}`; break;
        case 'quote': line = `> ${text}`; break;
        case 'code': { const fence = fenceFor(text); line = `${fence}${block.code?.language ?? ''}\n${text}\n${fence}`; break; }
        case 'divider': line = '---'; break;
        case 'table_row': line = tableRow(block); break;
        default:
          line = fallback(block);
          if (!line && !block.has_children) {
            fail('RESULT_SERIALIZATION_FAILED', `Cannot serialize meaningful ${block.type} block.`);
          }
      }

      if (line !== undefined) lines.push(indent(line, listDepth));
      if (block.has_children) {
        const listParent = ['bulleted_list_item', 'numbered_list_item', 'to_do'].includes(block.type);
        lines.push(...await render(await store.children(block.id), listParent ? listDepth + 1 : listDepth));
      }
    }
    return lines;
  }

  return (await render(await store.children(pageId)))
    .join('\n\n')
    .replace(/((?:^|\n)[ \t]*(?:[-*+] |\d+\. )[^\n]*)\n\n(?=[ \t]*(?:[-*+] |\d+\. ))/g, '$1\n')
    .replace(/\n\n(?=[ \t]*\|)/g, '\n');
}
