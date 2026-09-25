import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir, cpus, totalmem, platform, release } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { chromium } from '@playwright/test';
import { archives } from './synthetic.js';
import { sha256 } from '../src/snapshot.js';
const dir=await mkdtemp(join(tmpdir(),'snapshot-large-')), browser=await chromium.launch();
const seed=20260925;
const results={seed, semanticsVersion:1, environment:{node:process.version,chromium:browser.version(),os:`${platform()} ${release()}`,cpu:cpus()[0].model,logicalCPUs:cpus().length,memoryBytes:totalmem()},method:'One measured CLI run per case, GNU time maximum resident set size. Generated fixtures; no external data. Browser timings include Playwright round trips. Limits are not responsiveness guarantees.',runs:[]};
try {
  for(const [name,before] of Object.entries(archives(seed))){
    const a=join(dir,'before.json'),b=join(dir,'after.json'),out=join(dir,'comparison.html'),memory=join(dir,'memory.txt');
    await writeFile(a,JSON.stringify(before));
    for(const mode of ['unchanged','sparse','dense']){
      const after=structuredClone(before);let changedMessages=0;
      if(mode!=='unchanged'){
        for(const c of after){
          const ids=Object.keys(c.mapping);
          for(const id of mode==='dense' ? ids : [ids.at(-1)]){c.mapping[id].message.content.parts.push(`revised ${name} ${c.id} ${id}`);changedMessages++;}
        }
        after[0].title='Revised title';after[0].current_node='n0';
      }
      // Reorder all identities without changing graph semantics.
      for(const c of after)c.mapping=Object.fromEntries(Object.entries(c.mapping).reverse());after.reverse();
      await writeFile(b,JSON.stringify(after));
      const start=performance.now();
      const cli=spawnSync('/usr/bin/time',['-f','%M','-o',memory,process.execPath,resolve('src/cli.js'),'--compare',a,b,'-o',out,'--force'],{encoding:'utf8'});
      assert.equal(cli.status,0,cli.stderr);
      const metrics={name,mode,nodesPerSnapshot:before.reduce((n,c)=>n+Object.keys(c.mapping).length,0),conversationsPerSnapshot:before.length,generationMs:performance.now()-start,peakCliKiB:Number((await readFile(memory,'utf8')).trim()),inputBytes:{before:(await readFile(a)).length,after:(await readFile(b)).length},inputSha256:{before:sha256(await readFile(a)),after:sha256(await readFile(b))},htmlBytes:(await readFile(out)).length,jsonBytes:(await readFile(out+'.json')).length,maxMessages:0,maxDOM:0};
      const data=JSON.parse(await readFile(out+'.json','utf8'));
      assert.equal(data.summary.analysis,'complete');assert.equal(data.findings.length,changedMessages+(mode==='unchanged'?0:2));
      assert.equal(data.findings.filter(f=>f.kind==='message-content').length,changedMessages);
      if(mode==='unchanged')assert.equal(data.summary.equivalence,'equivalent-under-v1');
      else{
        assert.equal(data.findings.filter(f=>f.kind==='conversation-metadata').length,1);assert.equal(data.findings.filter(f=>f.kind==='active-path').length,1);
        // Independent raw parent walker for the changed active path.
        const path=[];let id=before[0].current_node;while(id!==null){path.unshift(id);id=before[0].mapping[id].parent;}
        const active=data.findings.find(f=>f.kind==='active-path');assert.deepEqual(active.before.path,path);assert.deepEqual(active.after.path,['n0']);
      }
      const context=await browser.newContext({offline:true});const requests=[],errors=[];
      await context.route(/^https?:/,route=>{requests.push(route.request().url());return route.abort();});
      const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
      let tick=performance.now();await page.goto(pathToFileURL(out).href);metrics.loadMs=performance.now()-tick;
      const bounded=async()=>{const counts=await page.evaluate(()=>({messages:document.querySelectorAll('.message').length,dom:document.querySelectorAll('*').length}));metrics.maxMessages=Math.max(metrics.maxMessages,counts.messages);metrics.maxDOM=Math.max(metrics.maxDOM,counts.dom);assert.ok(counts.messages<=500);assert.ok(counts.dom<2000);};
      await bounded();
      if(mode!=='unchanged'){
        if(await page.locator('#next').isEnabled()){tick=performance.now();await page.locator('#next').focus();await page.keyboard.press('Enter');metrics.pageMs=performance.now()-tick;}else metrics.pageMs=null;await bounded();
        const target=before.at(-1),node=Object.keys(target.mapping).at(-1);
        tick=performance.now();await page.locator('#search').fill(`revised ${name} ${target.id} ${node}`);metrics.searchMs=performance.now()-tick;
        assert.equal(await page.locator('.finding').count(),1);assert.match(await page.locator('.finding [aria-label="After"]').textContent(),/revised/);
        await bounded();await page.locator('#search').fill('');await page.locator('#kind').selectOption('active-path');
        assert.equal(await page.locator('.finding').count(),1);await bounded();
      }
      assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);await context.close();results.runs.push(metrics);
      console.log(`${name} ${mode}: ${data.findings.length} findings, ${metrics.generationMs.toFixed(0)} ms, ${metrics.peakCliKiB} KiB peak, ${metrics.htmlBytes} HTML bytes, ${metrics.maxMessages} message elements`);
    }
  }
  await writeFile('results/snapshot-performance.json',JSON.stringify(results,null,2)+'\n');
}finally{await browser.close();await rm(dir,{recursive:true,force:true});}
