import { fail } from './errors.js';
import type { NotionStore } from './notion.js';

const escapeLiteral = (value: string) => value
  .replace(/([\\`*_{}\[\]()!|])/g, '\\$1')
  .replace(/(^|\n)([ \t]*)(?=(?:[-+*] |\d+\. |#{1,6} |> |-){1})/g, '$1$2\\');
const inlineFence = (value: string) => '`'.repeat(Math.max(1, ...(value.match(/`+/g) ?? []).map((run) => run.length + 1)));
const richText = (items: any[] = [], literal = false) => items.map((item) => {
  const raw = item.plain_text ?? item.text?.content ?? '';
  const href = item.href ?? item.text?.link?.url;
  if (literal) return raw;
  const annotations = item.annotations ?? {};
  let value = annotations.code ? `${inlineFence(raw)}${raw}${inlineFence(raw)}` : escapeLiteral(raw);
  if (!annotations.code) {
    if (annotations.bold) value = `**${value}**`;
    if (annotations.italic) value = `*${value}*`;
    if (annotations.strikethrough) value = `~~${value}~~`;
    if (annotations.underline) value = `<u>${value}</u>`;
  }
  return href ? `[${value}](${href.replace(/\)/g, '\\)')})` : value;
}).join('');

const rich = (block: any, literal = false) => richText(
  block[block.type]?.rich_text ?? block[block.type]?.text ?? [],
  literal,
);

const tableRow = (block: any) => `| ${(block.table_row?.cells ?? [])
  .map((cell: any[]) => richText(cell))
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

      const text = rich(block, block.type === 'code');
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

  const normalize = (markdown: string) => markdown
    .replace(/((?:^|\n)[ \t]*(?:[-*+] |\d+\. )[^\n]*)\n\n(?=[ \t]*(?:[-*+] |\d+\. ))/g, '$1\n')
    .replace(/\n\n(?=[ \t]*\|)/g, '\n');
  const source = (await render(await store.children(pageId))).join('\n\n');
  const output: string[] = []; let prose: string[] = []; let literal: string[] | undefined; let fence: string | undefined;
  const flushProse = () => { if (prose.length) output.push(normalize(prose.join('\n'))); prose = []; };
  for (const line of source.split('\n')) {
    const opened = line.match(/^[ \t]*(`{3,})/);
    if (!literal && opened) { flushProse(); literal = [line]; fence = opened[1]; continue; }
    if (literal) { literal.push(line); if (new RegExp(`^[ \\t]*${fence}[ \\t]*$`).test(line)) { output.push(literal.join('\n')); literal = undefined; fence = undefined; } continue; }
    prose.push(line);
  }
  if (literal) output.push(literal.join('\n')); else flushProse();
  return output.join('\n');
}
