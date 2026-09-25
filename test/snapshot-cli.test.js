import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, symlink, link, truncate, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { sha256, SNAPSHOT_LIMITS } from '../src/snapshot.js';
const raw = [{id:'c',title:'Before',current_node:'n',mapping:{n:{parent:null,message:{author:{role:'tool'},content:{content_type:'text',parts:['before']}}}}}];
const run = args => spawnSync(process.execPath,[resolve('src/cli.js'),'--compare',...args],{encoding:'utf8'});
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(),'snapshot-cli-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  const before=join(dir,'before.json'),after=join(dir,'after.json'),out=join(dir,'report.html');
  await writeFile(before,'\uFEFF'+JSON.stringify(raw));
  const changed=structuredClone(raw);changed[0].mapping.n.message.content.parts=['after'];await writeFile(after,JSON.stringify(changed));
  return {dir,before,after,out};
}
test('snapshot CLI writes reproducible HTML/JSON with exact raw hashes and no input modification',async t=>{
  const {before,after,out,dir}=await setup(t); const saved=await readFile(before);
  assert.equal(run([before,after,'-o',out]).status,0);
  const json=await readFile(out+'.json'),html=await readFile(out);
  const data=JSON.parse(json);assert.equal(data.version,1);assert.equal(data.findings.length,1);
  assert.equal(data.sources.before[0].sha256,sha256(saved));assert.equal(data.sources.after[0].sha256,sha256(await readFile(after)));
  assert.equal(run([before,after,'-o',out]).status,1);
  assert.equal(run([before,after,'-o',out,'--force']).status,0);
  assert.deepEqual(await readFile(out+'.json'),json);assert.deepEqual(await readFile(out),html);assert.deepEqual(await readFile(before),saved);
  assert.equal((await stat(out)).mode & 0o777,0o600);
  const empty=join(dir,'empty.json');await writeFile(empty,'[]');
  assert.equal(run(['--before',empty,'--before',before,'--after',after,'-o',out,'--force']).status,0);
  assert.equal(run(['--before',before,'--before',before,'--after',after,'-o',out,'--force']).status,1);
  assert.deepEqual(await readFile(before),saved);
});
test('snapshot CLI protects both inputs from direct, symlink and hardlink output aliases',async t=>{
  const {before,after,out}=await setup(t);const saved=await readFile(before);
  for(const victim of [before,after])assert.equal(run([before,after,'-o',victim,'--force']).status,1);
  await symlink(before,out);assert.equal(run([before,after,'-o',out,'--force']).status,1);await rm(out);
  await link(after,out+'.json');assert.equal(run([before,after,'-o',out,'--force']).status,1);
  assert.deepEqual(await readFile(before),saved);
});
test('incomplete analysis writes exit 2; strict and ambiguous identity fail before writing',async t=>{
  const {before,after,out}=await setup(t);
  const unsupported=structuredClone(raw);unsupported[0].mapping.n.message.content={content_type:'image'};
  await writeFile(after,JSON.stringify(unsupported));
  let result=run([before,after,'-o',out]);assert.equal(result.status,2,result.stderr);
  assert.equal(JSON.parse(await readFile(out+'.json')).summary.equivalence,'undetermined');
  await rm(out);await rm(out+'.json');
  result=run([before,after,'-o',out,'--strict']);assert.equal(result.status,1);await assert.rejects(stat(out),{code:'ENOENT'});
  for(const invalid of ['[{"id":"c","mapping":{"x":{},"x":{}}}]','[{"mapping":{}}]','[{"id":"c","mapping":{}},{"id":"c","mapping":{}}]','[[[[[', '[1e400]']){
    await writeFile(after,invalid);assert.equal(run([before,after,'-o',out]).status,1);await assert.rejects(stat(out),{code:'ENOENT'});
  }
  await writeFile(after,Buffer.from([0xff]));assert.match(run([before,after,'-o',out]).stderr,/encoded data/);
});
test('snapshot input byte/file/depth bounds and argument errors fail without output',async t=>{
  const {before,after,out}=await setup(t);
  await truncate(after,SNAPSHOT_LIMITS.bytes+1);
  assert.match(run([before,after,'-o',out]).stderr,/byte limit/);
  await writeFile(after,'['.repeat(66)+']'.repeat(66));assert.match(run([before,after,'-o',out]).stderr,/nesting limit/);
  assert.match(run([...Array.from({length:64},()=>['--before',before]).flat(),'--after',after,'-o',out]).stderr,/file limit/);
  for(const args of [[],[before],[before,after,before],['--before',before,after],['--before'],[before,after,'--markdown'],[before,after,'-o']])assert.equal(run(args).status,1);
  await assert.rejects(stat(out),{code:'ENOENT'});
});
