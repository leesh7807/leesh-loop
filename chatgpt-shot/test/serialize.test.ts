import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownResult } from '../src/serialize.js';
test('serializes headings, lists, code, and nested blocks', async () => {
  const blocks = new Map<string, any[]>([['page', [{ id:'h', type:'heading_1', heading_1:{rich_text:[{plain_text:'Title'}]},has_children:false }, { id:'l', type:'bulleted_list_item', bulleted_list_item:{rich_text:[{plain_text:'one'}]},has_children:true }, { id:'c', type:'code', code:{language:'ts',rich_text:[{plain_text:'let x = 1;'}]},has_children:false }]], ['l', [{id:'n',type:'numbered_list_item',numbered_list_item:{rich_text:[{plain_text:'nested'}]},has_children:false}]]]);
  const result = await markdownResult({ children: async (id: string) => blocks.get(id) ?? [] } as any, 'page');
  assert.equal(result, '# Title\n\n- one\n  1. nested\n\n```ts\nlet x = 1;\n```');
});
test('preserves rich-text hyperlink targets', async () => {
  const result = await markdownResult({ children: async () => [{ id:'p', type:'paragraph', paragraph:{rich_text:[{plain_text:'OpenAI',href:'https://openai.com'}]},has_children:false }] } as any, 'page');
  assert.equal(result, '[OpenAI](https://openai.com)');
});
