import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownResult } from '../src/serialize.js';
test('serializes headings, lists, code, and nested blocks', async () => {
  const blocks = new Map<string, any[]>([['page', [{ id:'h', type:'heading_1', heading_1:{rich_text:[{plain_text:'Title'}]},has_children:false }, { id:'l', type:'bulleted_list_item', bulleted_list_item:{rich_text:[{plain_text:'one'}]},has_children:true }, { id:'c', type:'code', code:{language:'ts',rich_text:[{plain_text:'let x = 1;'}]},has_children:false }]], ['l', [{id:'n',type:'numbered_list_item',numbered_list_item:{rich_text:[{plain_text:'nested'}]},has_children:false}]]]);
  const result = await markdownResult({ children: async (id: string) => blocks.get(id) ?? [] } as any, 'page');
  assert.equal(result, '# Title\n\n- one\n    1. nested\n\n```ts\nlet x = 1;\n```');
});
test('preserves rich-text hyperlink targets', async () => {
  const result = await markdownResult({ children: async () => [{ id:'p', type:'paragraph', paragraph:{rich_text:[{plain_text:'OpenAI',href:'https://openai.com'}]},has_children:false }] } as any, 'page');
  assert.equal(result, '[OpenAI](https://openai.com)');
});
test('serializes Notion tables with headers and cells', async () => {
  const blocks = new Map<string, any[]>([['page', [{ id:'t', type:'table', table:{has_column_header:true}, has_children:true }]], ['t', [{ id:'r1',type:'table_row',table_row:{cells:[[{plain_text:'Name'}],[{plain_text:'URL'}]]},has_children:false }, { id:'r2',type:'table_row',table_row:{cells:[[{plain_text:'OpenAI'}],[{plain_text:'https://openai.com'}]]},has_children:false }]]]);
  const result = await markdownResult({ children: async (id: string) => blocks.get(id) ?? [] } as any, 'page');
  assert.equal(result, '| Name | URL |\n| --- | --- |\n| OpenAI | https://openai.com |');
});
test('uses a synthetic Markdown header for a headerless Notion table', async () => {
  const blocks = new Map<string, any[]>([
    ['page', [{ id: 't', type: 'table', table: { has_column_header: false }, has_children: true }]],
    ['t', [
      { id: 'r1', type: 'table_row', table_row: { cells: [[{ plain_text: 'Alice' }], [{ plain_text: '10' }]] }, has_children: false },
      { id: 'r2', type: 'table_row', table_row: { cells: [[{ plain_text: 'Bob' }], [{ plain_text: '20' }]] }, has_children: false },
    ]],
  ]);

  const result = await markdownResult({ children: async (id: string) => blocks.get(id) ?? [] } as any, 'page');
  assert.equal(result, '| Alice | 10 |\n| --- | --- |\n| Bob | 20 |');
});
test('serializes media URLs instead of failing completed Results', async () => {
  const result = await markdownResult({ children: async () => [
    { id:'image',type:'image',image:{external:{url:'https://example.com/image.png'},caption:[{plain_text:'Diagram'}]},has_children:false },
    { id:'bookmark',type:'bookmark',bookmark:{url:'https://example.com'},has_children:false },
  ] } as any, 'page');
  assert.equal(result, '![Diagram](https://example.com/image.png)\n\nhttps://example.com');
});
