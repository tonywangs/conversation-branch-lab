import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseExport } from '../src/parser.js';
const entry = (parent = null, text = 'hello') => ({ parent, message: {author:{role:'user'}, content:{content_type:'text', parts:[text]}} });
const parse = mapping => parseExport([{title:'test',mapping}]);

test('synthetic export retains alternatives, shared ancestry, null roots and Unicode', async () => {
  const result = parseExport(JSON.parse(await readFile(new URL('../fixtures/synthetic-conversations.json', import.meta.url))));
  assert.equal(result.conversations.length, 3);
  const c = result.conversations[0];
  assert.deepEqual(c.nodes.prompt.children, ['reply-a', 'reply-b']);
  assert.equal(c.nodes.root.kind, 'null');
  assert.equal(c.nodes.root.text, '');
  assert.match(c.nodes['end-b'].text, /café, 雀, 🐦/);
  assert.equal(c.current, 'end-a');
  assert.deepEqual(result.diagnostics.map(d => d.code), ['unsupported-part', 'missing-parent']);
});

test('missing parents become roots with explicit diagnostics', () => {
  const result = parse({ a:entry('missing') });
  assert.equal(result.conversations[0].nodes.a.parent, null);
  assert.deepEqual(result.conversations[0].roots, ['a']);
  assert.equal(result.diagnostics[0].code, 'missing-parent');
});

test('cycles, self-links, and tails terminate and retain every node', () => {
  const result = parse({ tail:entry('a'), a:entry('b'), b:entry('a'), self:entry('self') });
  const c = result.conversations[0];
  assert.equal(result.diagnostics.filter(d => d.code === 'cycle').length, 2);
  assert.equal(Object.keys(c.nodes).length, 4);
  for (const start of Object.keys(c.nodes)) {
    let id = start; const seen = new Set();
    while (id !== null) { assert.ok(!seen.has(id)); seen.add(id); id = c.nodes[id].parent; }
  }
});

test('deep chains are handled without recursion', () => {
  const mapping = Object.create(null);
  for (let i = 0; i < 20000; i++) mapping[`n${i}`] = {parent:i === 19999 ? null : `n${i + 1}`, message:null};
  const result = parse(mapping);
  assert.equal(Object.keys(result.conversations[0].nodes).length, 20000);
  assert.equal(result.diagnostics.length, 0);
});

test('unsupported content and malformed messages produce placeholders and diagnostics', () => {
  const result = parse({
    a:{parent:42,message:5},
    b:{message:{content:{content_type:'audio',parts:['hidden']}}},
    c:{message:{content:{content_type:'text',parts:[{image:'x'},'retained text']}}},
    d:{message:{content:{content_type:'text',parts:'not-an-array'}}}
  });
  assert.deepEqual(result.diagnostics.map(d => d.code), ['invalid-parent','invalid-message','unsupported-content','unsupported-part','unsupported-content']);
  assert.match(result.conversations[0].nodes.c.text, /retained text/);
  assert.doesNotMatch(result.conversations[0].nodes.b.text, /hidden/);
});

test('parent links win over inconsistent, duplicated or invalid children', () => {
  const result = parse({ a:{...entry(),children:['b','b']}, b:entry('a'), c:{...entry(),children:'a'} });
  assert.deepEqual(result.conversations[0].nodes.a.children, ['b']);
  assert.equal(result.diagnostics.filter(d => d.code === 'children-mismatch').length, 2);
});

test('special object keys and empty identifiers are ordinary node identifiers', () => {
  const result = parse(JSON.parse('{"__proto__":{"parent":null,"message":null},"constructor":{"parent":"__proto__","message":null},"":{"parent":"constructor","message":null}}'));
  const c = result.conversations[0];
  assert.deepEqual(c.roots, ['__proto__']);
  assert.equal(c.nodes[''].parent, 'constructor');
  assert.equal(c.current, '');
  assert.equal(result.diagnostics.length, 0);
});

test('invalid top-level shapes fail explicitly; empty exports and mappings are valid', () => {
  for (const value of [null, {}, 'text', [null], [{mapping:[]}], [{mapping:{n:null}}]]) assert.throws(() => parseExport(value), /expected|must be/);
  assert.deepEqual(parseExport([]), {conversations:[],diagnostics:[]});
  assert.equal(parse({}).conversations[0].current, null);
});

test('unknown current node warns and falls back; duplicate conversation IDs retain both records', () => {
  const result = parseExport([{id:'same',mapping:{a:entry()},current_node:'absent'},{id:'same',mapping:{b:entry()}}]);
  assert.equal(result.conversations.length, 2);
  assert.equal(result.conversations[0].current, 'a');
  assert.equal(result.diagnostics[0].code, 'missing-current');
});
