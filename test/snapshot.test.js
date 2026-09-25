import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSnapshots, SNAPSHOT_LIMITS } from '../src/snapshot.js';
import { parseSnapshotJSON } from '../src/snapshot-json.js';
const source = input => [{input}];
const compare = (a,b,limits) => compareSnapshots(source(a),source(b),limits);
const message = text => ({author:{role:'assistant'},create_time:1,content:{content_type:'text',parts:[text]}});
const conversation = () => ({id:'c',title:'Title',current_node:'b',mapping:{root:{parent:null,message:null},a:{parent:'root',message:message('one')},b:{parent:'a',message:message('two')}}});
const signature = f => JSON.stringify([f.kind,f.conversation,f.node]);
const signatures = data => data.findings.map(signature).sort();

test('explicit before/after content, structural, parent, metadata and path semantics', () => {
  const a = conversation(), b = structuredClone(a);
  b.mapping.b.message.content.parts = ['two\n','café 🌍']; b.mapping.b.message.author.role = 'tool';
  b.mapping.b.parent = 'root'; b.title = 'Renamed'; b.mapping.a.extra = {present:true};
  b.mapping.root.message = message('previously structural');
  const data = compare([a],[b]);
  assert.equal(data.summary.analysis,'complete'); assert.equal(data.summary.equivalence,'different');
  assert.deepEqual(signatures(data), [
    ['conversation-metadata','c',null],['active-path','c',null],['parent','c','b'],['message-content','c','b'],['message-metadata','c','b'],['node-metadata','c','a'],['message-content','c','root'],['message-metadata','c','root']
  ].map(JSON.stringify).sort());
  const content = data.findings.find(f => f.kind === 'message-content' && f.node === 'b');
  assert.deepEqual(content.before.content.value.parts,['two']); assert.deepEqual(content.after.content.value.parts,['two\n','café 🌍']);
  const active = data.findings.find(f => f.kind === 'active-path');
  assert.deepEqual(active.before.path,['root','a','b']); assert.deepEqual(active.after.path,['root','b']);
  assert.deepEqual(a, conversation(), 'inputs not modified');
});

test('no identity guessing; empty and unusual IDs; duplicate aliases fail', () => {
  const a = conversation(); delete a.id;
  assert.throws(() => compare([a],[]),/string id/);
  assert.throws(() => compare([conversation(),conversation()],[]),/duplicate conversation/);
  const b = conversation(); b.mapping.a.id = 'wrong';
  assert.throws(() => compare([b],[]),/disagrees/);
  for (const id of ['', '__proto__', 'constructor', '</script>', 'é', 'e\u0301', '\ud800']) {
    const raw = {id,current_node:id,mapping:{[id]:{id,parent:null,message:null}}};
    assert.equal(compare([raw],[raw]).summary.equivalence,'equivalent-under-v1');
    assert.equal(compare([raw],[]).findings[1].node,id);
  }
});

test('raw JSON validator rejects duplicate keys, malformed tokens, excess depth and unsafe numbers', () => {
  for (const text of ['{"mapping":{"x":{},"x":{}}}', '{"id":1,"\\u0069d":2}', '{"a":1,}', '[1,]', 'true false', '01', '[NaN]', '"bad\nstring"', '1e400', '9007199254740993']) assert.throws(() => parseSnapshotJSON(text), Error, text);
  assert.throws(() => parseSnapshotJSON('[[[[]]]]',2), /nesting/);
  for (const value of [[], {a:[true,false,null,-1,0.1,'quote" backslash\\ emoji🌍']}, JSON.parse('{"__proto__":1}')]) assert.deepEqual(parseSnapshotJSON('\uFEFF' + JSON.stringify(value)),value);
});

test('reordered arrays, mapping and object keys retain semantic equality and deterministic results', () => {
  const a = conversation(), b = {...conversation(),id:'b'};
  const reverse = v => Array.isArray(v) ? v.map(reverse) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k,x])=>[k,reverse(x)])) : v;
  const reordered = [reverse(b), reverse(a)];
  const data = compare([a,b],reordered);
  assert.equal(data.summary.equivalence,'equivalent-under-v1');
  const other = compare([b,a],[reverse(a),reverse(b)]);
  assert.deepEqual(data.findings,other.findings); assert.deepEqual(data.summary,other.summary);
  assert.notDeepEqual(data.sources,other.sources,'source hashes retain actual array order');
  assert.deepEqual(data,compare([a,b],reordered),'same sources produce identical output');
});

test('unsupported content and malformed graphs never establish complete equivalence', () => {
  const fixtures = [];
  const alter = fn => {const raw = conversation(); fn(raw); fixtures.push(raw);};
  alter(c => c.mapping.a.message.content = {content_type:'image',asset_pointer:'unavailable'});
  alter(c => c.mapping.a.message.content.parts.push({image:'absent'}));
  alter(c => c.mapping.a.message.metadata = {attachments:[{id:'asset'}]});
  alter(c => c.mapping.a.parent = 'missing');
  alter(c => c.mapping.root.parent = 'b');
  alter(c => c.current_node = 'missing');
  alter(c => delete c.current_node);
  alter(c => c.mapping.a.children = ['x']);
  alter(c => c.mapping.a.message.create_time = 'yesterday');
  alter(c => c.mapping.a.message = 42);
  alter(c => {c.mapping.a.message.id = 'same';c.mapping.b.message.id = 'same';});
  for (const raw of fixtures) {
    const data = compare([raw],[raw]);
    assert.equal(data.findings.length,0); assert.equal(data.summary.analysis,'incomplete');
    assert.equal(data.summary.equivalence,'undetermined'); assert.ok(data.limitations.length);
  }
});

test('Unicode, timestamps, text part boundaries, missing vs null and ignored child ordering', () => {
  const a = conversation(), b = structuredClone(a);
  a.mapping.a.message.content.parts = ['é']; b.mapping.a.message.content.parts = ['e\u0301'];
  b.mapping.b.message.create_time = 1.25;
  assert.deepEqual(compare([a],[b]).findings.map(f=>f.kind),['message-content','message-metadata']);
  a.mapping.a.message.content.parts = ['a','b']; b.mapping.a.message.content.parts = ['a\nb'];
  assert.ok(compare([a],[b]).findings.some(f=>f.kind === 'message-content'));
  const c = conversation(), d = structuredClone(c); delete d.mapping.root.message;
  assert.equal(compare([c],[d]).findings[0].kind,'message-content');
  c.mapping.b.parent = 'root'; d.mapping.b.parent = 'root'; d.mapping.root.message = null;
  c.mapping.root.children = ['a','b']; d.mapping.root.children = ['b','a'];
  assert.equal(compare([c],[d]).summary.equivalence,'equivalent-under-v1');
});

test('bounded counts fail explicitly; deep parent chains are iterative', () => {
  for (const [key, value] of [['conversations',0],['nodes',2],['files',1],['findings',0]]) assert.throws(() => compare([conversation()],[],{...SNAPSHOT_LIMITS,[key]:value}), /limit/);
  const mapping = Object.fromEntries(Array.from({length:20000},(_,i)=>[String(i),{parent:i ? String(i-1):null,message:null}]));
  const raw = {id:'deep',current_node:'19999',mapping};
  assert.equal(compare([raw],[raw]).summary.equivalence,'equivalent-under-v1');
});

// Independent mutation ledger: each operation targets a disjoint node/field.
// Expected changes come from operations, not a second implementation of the comparator.
// The active-path oracle separately walks the raw graph from the endpoint.
test('250 seeded snapshot pairs match mutation ledger and independent active-path oracle', () => {
  const path = raw => {const result=[];let id=raw.current_node;while(id !== null){result.unshift(id);id=raw.mapping[id].parent;}return result;};
  for (let seed = 1; seed <= 250; seed++) {
    let state = seed; const random = () => {state = (Math.imul(state,1664525)+1013904223)>>>0;return state/2**32;};
    const raw = {id:seed % 9 ? 'c' : '__proto__',title:'Base',current_node:'n29',mapping:{root:{parent:null,message:null}}};
    for (let i=0;i<30;i++) raw.mapping[`n${i}`]={parent:i ? (random()<.6 ? `n${i-1}` : 'root'):'root',message:message(`seed ${seed} node ${i}`)};
    const before = [raw], after = structuredClone(before), changed = after[0], expected = [];
    const add = (kind,node=null,id=raw.id) => expected.push(JSON.stringify([kind,id,node]));
    const mutate = (fn,kind,node) => {if(random()<.55){fn();add(kind,node);}};
    mutate(()=>changed.title+=' revised','conversation-metadata');
    mutate(()=>changed.mapping.n1.message.content.parts=['changed 🌍\n```'], 'message-content','n1');
    mutate(()=>changed.mapping.n2.message.author.role='tool','message-metadata','n2');
    mutate(()=>changed.mapping.n3.parent = changed.mapping.n3.parent==='root' ? 'n0':'root','parent','n3');
    mutate(()=>changed.mapping.n4.annotation={seed},'node-metadata','n4');
    // Isolated leaf present only before and a distinct leaf present only after.
    before[0].mapping.old={parent:'root',message:null}; add('node-only-before','old');
    changed.mapping.new={parent:'root',message:null}; add('node-only-after','new');
    if(random()<.5) changed.current_node='n10';
    if(JSON.stringify(path(raw))!==JSON.stringify(path(changed))) add('active-path');
    if(random()<.4){before.push({id:'absent-after',current_node:'x',mapping:{x:{parent:null,message:null}}});add('conversation-only-before',null,'absent-after');add('node-only-before','x','absent-after');}
    if(random()<.4){after.push({id:'absent-before',current_node:'',mapping:{'':{parent:null,message:null}}});add('conversation-only-after',null,'absent-before');add('node-only-after','','absent-before');}
    after.reverse(); changed.mapping=Object.fromEntries(Object.entries(changed.mapping).reverse());
    const data = compare(before,after);
    assert.deepEqual(signatures(data),expected.sort(),`seed ${seed}`);
    assert.equal(data.summary.analysis,'complete',`seed ${seed}`);
    const active = data.findings.find(f=>f.kind==='active-path');
    if(active){assert.deepEqual(active.before.path,path(raw));assert.deepEqual(active.after.path,path(changed));}
    assert.deepEqual(compare(before,after),data,`deterministic seed ${seed}`);
    if(seed%10===0) assert.equal(compare(before,before).summary.equivalence,'equivalent-under-v1');
    if(seed%11===0) assert.throws(()=>compare([...before,before[0]],after),/duplicate conversation/);
    if(seed%13===0){const malformed=structuredClone(after);malformed.find(c=>c.id===raw.id).mapping.n1.parent='unavailable';assert.equal(compare(malformed,malformed).summary.equivalence,'undetermined');}
  }
});

test('artifact byte bounds check both outputs including HTML escaping expansion', async () => {
  const { snapshotArtifacts } = await import('../src/snapshot-report.js');
  const raw = conversation();raw.mapping.a.message.content.parts=['<'.repeat(10000)];
  const data = compare([], [raw]);
  const contents = await snapshotArtifacts(data, SNAPSHOT_LIMITS.artifactBytes);
  const sizes = contents.map(c=>Buffer.byteLength(c));
  assert.ok(sizes[0] > sizes[1]);
  await assert.rejects(snapshotArtifacts(data,sizes[1]-1),/JSON artifact/);
  await assert.rejects(snapshotArtifacts(data,sizes[0]-1),/HTML artifact/);
  assert.deepEqual(await snapshotArtifacts(data,sizes[0]),contents);
});
