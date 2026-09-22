import test from 'node:test';
import assert from 'node:assert/strict';
import { importExports, LIMITS } from '../src/import.js';
const raw = { id: 'one', mapping: { a: { parent: null, message: null } } };
const source = (input, name = 'first.json') => ({ source: name, input });
test('multi-file order, canonical duplicate equality, missing IDs and conflicts', () => {
  const duplicate = { mapping: { a: { message: null, parent: null } }, id: 'one' };
  const data = importExports([source([raw]), source([duplicate, {id:'two',mapping:{}}], 'second.json')]);
  assert.deepEqual(data.conversations.map(c => c.id), ['one','two']);
  assert.throws(() => importExports([source([raw]),source([{...raw,title:'changed'}],'second.json')]), /second.json: conversation 1: conflicting duplicate ID.*first.json/);
  assert.equal(importExports([source([{mapping:{}},{mapping:{}}])]).conversations.length, 1);
  assert.throws(() => importExports([source([{mapping:{x:false}}], 'bad.json')]), /bad.json.*node x/);
});
test('explicit file, conversation and node limits count duplicate input too', () => {
  for (const [key, value] of [['files',0],['conversations',0],['nodes',0]]) {
    assert.throws(() => importExports([source([raw])], {...LIMITS,[key]:value}), /limit/);
  }
});
test('diagnostics retain source and final conversation index', () => {
  const data = importExports([source([raw]),source([{id:'two',mapping:{x:{parent:'absent'}}}], 'other.json')]);
  assert.equal(data.diagnostics[0].source, 'other.json: conversation 1');
  assert.equal(data.diagnostics[0].conversation, 1);
});
