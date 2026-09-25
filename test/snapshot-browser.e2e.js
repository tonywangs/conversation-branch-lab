import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
async function setup(t,before,after) {
  const dir=await mkdtemp(join(tmpdir(),'snapshot-browser-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await writeFile(join(dir,'a.json'),JSON.stringify(before));await writeFile(join(dir,'b.json'),JSON.stringify(after));
  const output=join(dir,'report.html');
  const result=spawnSync(process.execPath,[resolve('src/cli.js'),'--compare',join(dir,'a.json'),join(dir,'b.json'),'-o',output],{encoding:'utf8'});
  assert.ok([0,2].includes(result.status),result.stderr);
  const browser=await chromium.launch();t.after(()=>browser.close());
  const context=await browser.newContext({offline:true,viewport:{width:1280,height:900}});
  const network=[],errors=[];await context.route(/^https?:/,route=>{network.push(route.request().url());return route.abort();});
  context.on('page',p=>{p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});});
  const page=await context.newPage();await page.goto(pathToFileURL(output).href);
  t.after(()=>{assert.deepEqual(network,[]);assert.deepEqual(errors,[]);});
  return {page,context,output,dir};
}
const raw=()=>({id:'',title:'Empty ID is valid',current_node:'n0',mapping:Object.fromEntries(Array.from({length:130},(_,i)=>[`n${i}`,{parent:null,message:{author:{role:'tool'},content:{content_type:'text',parts:[`before ${i}`]}}}]))});
test('offline snapshot keyboard navigation, paged filtering and exact before/after views',async t=>{
  const before=raw(),after=raw();for(const [id,n] of Object.entries(after.mapping))n.message.content.parts=[`after ${id}`];after.title='Revised';
  const {page}=await setup(t,[before],[after]);
  await expect(page.locator('#summary')).toContainText('Analysis: complete');
  await expect(page.locator('.finding')).toHaveCount(50);assert.equal(await page.locator('.message').count(),100);
  await page.locator('#next').focus();await page.keyboard.press('Enter');
  await expect(page.locator('#position')).toHaveText('51–100 of 131 matching findings (131 total)');
  await expect(page.locator('#next')).toBeFocused();
  await page.keyboard.press('Enter');await expect(page.locator('.finding')).toHaveCount(31);
  await page.locator('#previous').focus();await page.keyboard.press('Enter');await expect(page.locator('#previous')).toBeFocused();
  await page.locator('#search').fill('after n129');await expect(page.locator('.finding')).toHaveCount(1);
  await expect(page.locator('.finding [aria-label="Before"] pre')).toContainText('before 129');
  await expect(page.locator('.finding [aria-label="After"] pre')).toContainText('after n129');
  await page.locator('#kind').selectOption('conversation-metadata');await expect(page.locator('.finding')).toHaveCount(0);
  await page.locator('#search').fill('');await expect(page.locator('.finding')).toHaveCount(1);
  await page.locator('#exact-conversation').focus();await page.keyboard.press('Space');
  await expect(page.locator('.finding')).toHaveCount(1);
  await page.locator('#conversation').fill('not-present');await expect(page.locator('.finding')).toHaveCount(0);
  await page.locator('#reset').focus();await page.keyboard.press('Enter');await expect(page.locator('.finding')).toHaveCount(50);
  await page.keyboard.press('Tab');await expect(page.locator('#next')).toBeFocused();
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.ok(await page.locator('.message').count()<=500);
});
test('hostile values are literal with and without CSP, including IDs and unsupported payloads',async t=>{
  const payload='</script><script>globalThis.__snapshotAttack=true</script><img src="https://example.invalid/x" onerror="globalThis.__snapshotAttack=true">';
  const before={id:payload,current_node:payload,mapping:{[payload]:{parent:'missing',message:{content:{content_type:payload,parts:[payload]}}}}};
  const {page,context,dir,output}=await setup(t,[],[before]);
  const inspect=async p=>{
    await expect(p.locator('#summary')).toContainText('undetermined');await expect(p.locator('#changes')).toContainText(JSON.stringify(payload));
    assert.equal(await p.evaluate(()=>globalThis.__snapshotAttack),undefined);await expect(p.locator('img,svg,iframe')).toHaveCount(0);
    await expect(p.locator('script')).toHaveCount(2);await p.locator('#limitations-title').click();await expect(p.locator('#limitations')).toContainText('unsupported-content');
  };
  await inspect(page);
  const noCsp=(await readFile(output,'utf8')).replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/,'');
  const file=join(dir,'no-csp.html');await writeFile(file,noCsp);const unprotected=await context.newPage();await unprotected.goto(pathToFileURL(file).href);await inspect(unprotected);
});
test('empty, unchanged, incomplete and long-value reports accurately describe their limits',async t=>{
  const {page}=await setup(t,[],[]);await expect(page.locator('#summary')).toContainText('equivalent-under-v1');await expect(page.locator('#next')).toBeDisabled();
  const a=raw();a.mapping.n0.message.content.parts=['x'.repeat(15000)+'tail-sentinel'];a.mapping.n0.message.content.content_type='unsupported';
  const long=await setup(t,[],[a]);await long.page.locator('#search').fill('tail-sentinel');await expect(long.page.locator('.finding')).toHaveCount(1);
  await expect(long.page.locator('#changes')).toContainText('Display truncated');
  const incomplete=await setup(t,[a],[a]);await expect(incomplete.page.locator('#changes')).toContainText('does not establish equivalence');
});
