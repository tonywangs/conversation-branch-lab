import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { importExports } from '../src/import.js';
import { exportSelection, selectPaths, serializeSidecar } from '../src/export.js';
const digest = text => createHash('sha256').update(text).digest('hex');
const node = (parent, text = '', role = 'assistant') => ({ parent, message: { author: { role }, content: {content_type:'text', parts:[text]} } });
const load = mapping => importExports([{source:'PRIVATE_FILENAME_SENTINEL',input:[{id:'selected',title:'Sample',mapping}]}]);

test('250 seeded graphs match independent root-to-node traversal, including nonleaf and separate roots', async () => {
  for (let seed = 1; seed <= 250; seed++) {
    let state = seed;
    const rand = n => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % n; };
    const ids = ['', '__proto__', 'constructor', 'a\n```🌍', ...Array.from({length:96}, (_,i) => `node${i}`)];
    const mapping = Object.create(null);
    ids.forEach((id,i) => mapping[id] = node(i && rand(10) ? ids[rand(i)] : null, i % 7 ? `message ${i}` : ''));
    const data = load(mapping), c = data.conversations[0];
    // Independent forward traversal from roots, carrying complete paths.
    const reference = new Map(), stack = Object.keys(mapping).filter(id => mapping[id].parent === null).map(id => [id, []]);
    while (stack.length) {
      const [id, prefix] = stack.pop(), path = [...prefix,id]; reference.set(id,path);
      for (const child of Object.keys(mapping)) if (mapping[child].parent === id) stack.push([child,path]);
    }
    const a = ids[rand(ids.length)], b = ids[rand(ids.length)], aa = reference.get(a), bb = reference.get(b);
    const common = aa.filter(id => bb.includes(id));
    assert.deepEqual(selectPaths(c,[a]), {path:aa});
    const expected = {shared:common,a:aa.slice(common.length),b:bb.slice(common.length)};
    assert.deepEqual(selectPaths(c,[a,b]), expected);
    assert.deepEqual(JSON.parse((await exportSelection(data,0,[a,b])).sidecar).paths, expected);
  }
});

test('literal bodies, metadata, omission boundaries and reproducible artifact hashes', async () => {
  const mapping = {
    root:{parent:null,message:null},
    user:node('root','Unicode café こんにちは 🌍\n```js\nx()\n```\n<script>alert(1)</script>\n![image](https://example.org/x)','user'),
    tool:node('user','tool output','tool'),
    empty:node('tool',''),
    media:{parent:'empty',message:{author:{role:'assistant'},create_time:'not-a-time',metadata:{attachments:[{name:'ATTACHMENT_PRIVATE_SENTINEL'}]},content:{content_type:'multimodal_text',parts:['visible', {image:'PAYLOAD_PRIVATE_SENTINEL'}]}}},
    sibling:node('root','SIBLING_TEXT_SENTINEL')
  };
  mapping.tool.message.create_time = 1.25;
  const input = [{id:'selected',title:'Sample',mapping},{id:'UNRELATED_ID_SENTINEL',title:'UNRELATED_TITLE_SENTINEL',mapping:{other:node(null,'UNRELATED_TEXT_SENTINEL')}}];
  const data = importExports([{source:'PRIVATE_FILENAME_SENTINEL',input,sha256:digest(JSON.stringify(input))}]);
  const out = await exportSelection(data,0,['media']);
  assert.deepEqual(out,await exportSelection(data,0,['media']));
  for (const sentinel of ['SIBLING_TEXT_SENTINEL','UNRELATED_ID_SENTINEL','UNRELATED_TITLE_SENTINEL','UNRELATED_TEXT_SENTINEL','ATTACHMENT_PRIVATE_SENTINEL','PAYLOAD_PRIVATE_SENTINEL','PRIVATE_FILENAME_SENTINEL']) assert.ok(!JSON.stringify(out).includes(sentinel),sentinel);
  assert.ok(out.markdown.includes(mapping.user.message.content.parts[0]));
  const meta = JSON.parse(out.sidecar);
  assert.equal(meta.included.find(n=>n.nodeId==='tool').timestamp,1.25);
  assert.equal(meta.included[0].structural,true);
  assert.ok(meta.omissions.some(o=>o.code==='unsupported-part'));
  assert.ok(meta.omissions.some(o=>o.code==='unavailable-attachments'));
  assert.ok(meta.omissions.some(o=>o.code==='invalid-timestamp'));
  assert.equal(meta.artifacts.markdown.sha256,digest(out.markdown));
  assert.equal(meta.artifacts.markdown.bytes,Buffer.byteLength(out.markdown));
  const hash = meta.artifacts.sidecar.sha256; meta.artifacts.sidecar.sha256 = null;
  assert.equal(hash,digest(serializeSidecar(meta)));
});

test('deep chains, same endpoints, ancestors, malformed selections and repaired graphs', async () => {
  const mapping = Object.fromEntries(Array.from({length:12000},(_,i)=>[String(i),node(i ? String(i-1) : null)]));
  const data = load(mapping), c = data.conversations[0];
  assert.equal(selectPaths(c,['11999']).path.length,12000);
  assert.deepEqual(selectPaths(c,['1','0']),{shared:['0'],a:['1'],b:[]});
  assert.deepEqual(selectPaths(c,['0','0']),{shared:['0'],a:[],b:[]});
  for (const endpoints of [[],['missing'],[0],['0','1','2'],null]) assert.throws(()=>selectPaths(c,endpoints));
  await assert.rejects(exportSelection(data,-1,['0']));
  const repaired = load({a:node('b'),b:node('a'),orphan:node('absent')});
  const out = JSON.parse((await exportSelection(repaired,0,['b','orphan'])).sidecar);
  assert.ok(out.omissions.some(o=>o.code==='cycle'));
  assert.ok(out.omissions.some(o=>o.code==='missing-parent'));
  assert.ok(!JSON.stringify(out).includes('absent'));
  // Many tiny backtick runs must not overflow a function argument stack.
  const huge = load({a:node(null,'` '.repeat(150000))});
  assert.ok((await exportSelection(huge,0,['a'])).markdown.length > 300000);
});
