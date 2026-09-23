import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, symlink, link, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const cli = new URL('../src/cli.js',import.meta.url).pathname;
test('CLI export validates selection, protects both output files and records raw source hashes',async t=>{
  const dir = await mkdtemp(join(tmpdir(),'branch-export-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  const input = join(dir,'source.json'), output = join(dir,'selection.md');
  const bytes = '\uFEFF'+JSON.stringify([{id:'c',mapping:{'':{parent:null,message:null},'--endpoint':{parent:'',message:{author:{role:'tool'},content:{content_type:'text',parts:['hello']}}}}}]);
  await writeFile(input,bytes);
  const args = [input,'--markdown','--conversation-index','0','--endpoint','--endpoint','-o',output];
  const run = extra=>spawnSync(process.execPath,[cli,...extra],{encoding:'utf8'});
  let result = run(args); assert.equal(result.status,0,result.stderr);
  const meta = JSON.parse(await readFile(output+'.json','utf8'));
  assert.equal(meta.provenance.sourceSha256,createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(meta.paths.path,['','--endpoint']);
  assert.equal(run(args).status,1);
  assert.equal(run([...args,'--force']).status,0);
  for (const bad of [[],['--conversation-index','0'],['--conversation-index','-1','--endpoint',''],['--conversation-index','99','--endpoint',''],['--conversation-index','0','--endpoint','missing'],['--conversation-index','0','--endpoint','','--endpoint','','--endpoint','']]) {
    assert.equal(run([input,'--markdown',...bad,'-o',join(dir,'bad.md')]).status,1);
    assert.ok(!(await readdir(dir)).includes('bad.md'));
  }
  for (const type of ['symlink','hardlink','directory','existing']) {
    await rm(output); await rm(output+'.json');
    if (type==='symlink') await symlink(input,output+'.json');
    if (type==='hardlink') await link(input,output+'.json');
    if (type==='directory') await mkdir(output+'.json');
    if (type==='existing') await writeFile(output+'.json','keep');
    result = run(type==='existing' ? args : [...args,'--force']);
    assert.equal(result.status,1,type);
    assert.equal(await readFile(input,'utf8'),bytes);
    assert.ok(!(await readdir(dir)).includes('selection.md'));
    await rm(output+'.json',{recursive:true});
    await writeFile(output,'reset'); await writeFile(output+'.json','reset');
  }
});
