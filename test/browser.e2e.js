import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));

async function setup(t, input) {
  const dir = await mkdtemp(join(tmpdir(), 'branch-browser-'));
  t.after(() => rm(dir, {recursive:true,force:true}));
  const source = join(dir, 'conversations.json'), report = join(dir, 'report.html');
  await writeFile(source, input ?? await readFile(join(root,'fixtures/synthetic-conversations.json')));
  const converted = spawnSync(process.execPath,[join(root,'src/cli.js'),source,'-o',report],{encoding:'utf8'});
  assert.equal(converted.status,0,converted.stderr);
  const browser = await chromium.launch({headless:true});
  t.after(() => browser.close());
  const context = await browser.newContext({offline:true,viewport:{width:1440,height:1050}});
  const network = [], errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route(/^https?:/, route => { network.push(route.request().url()); return route.abort(); });
  const page = await context.newPage();
  page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
  await page.goto(pathToFileURL(report).href);
  t.after(() => { assert.deepEqual(errors,[],'no browser runtime errors'); assert.deepEqual(network,[],'no network requests'); });
  return {page,context,dir};
}

test('offline import → tree navigation → shared-ancestor comparison → cross-conversation search', async t => {
  const {page} = await setup(t);
  await expect(page.locator('#title')).toHaveText('Synthetic · Two weekend ideas');
  await expect(page.locator('#conversation option')).toHaveCount(3);
  await expect(page.locator('#tree button')).toHaveCount(7);
  await expect(page.locator('#path')).toContainText('Use a pot with drainage');
  await page.locator('#tree button[data-node-id="reply-b"]').click();
  await expect(page.locator('#path')).toContainText('Make a notebook for birdwatching');
  await expect(page.locator('#path')).not.toContainText('Build a tiny herb garden');
  await page.locator('#set-b').click();
  await page.locator('#endpoint-a').selectOption('end-a');
  await expect(page.locator('#comparison-status')).toHaveText('Shared ancestor: prompt. 3 node(s) in A; 1 in B after divergence.');
  await expect(page.locator('#shared .message')).toHaveCount(2);
  await expect(page.locator('#shared')).toContainText('Suggest a quiet weekend project.');
  await expect(page.locator('#branch-a')).toContainText('basil');
  await expect(page.locator('#branch-b')).toContainText('birdwatching');
  await expect(page.locator('#branch-b')).not.toContainText('basil');
  await page.locator('#parent').click();
  await expect(page.locator('#path-title')).toHaveText('Path to prompt');
  await page.locator('#set-a').click();
  await expect(page.locator('#branch-a')).toContainText('No further messages');
  await page.locator('#endpoint-b').selectOption('prompt');
  await expect(page.locator('#comparison-status')).toContainText('Same endpoint selected');
  await page.locator('#search').fill('SAFFRON');
  await expect(page.locator('#search-count')).toHaveText('1 matching message(s)');
  await page.locator('#results button').click();
  await expect(page.locator('#conversation')).toHaveValue('1');
  await expect(page.locator('#path')).toContainText('こんにちは 🌍 — naïve café.');
  await page.locator('#search').fill('no-such-message');
  await expect(page.locator('#search-count')).toHaveText('0 matching message(s)');
  await page.locator('#search').fill('');
  await expect(page.locator('#search-count')).toHaveText('');
  await page.locator('#conversation').selectOption('2');
  await expect(page.locator('#comparison-status')).toContainText('No shared ancestor');
  await page.locator('#diagnostic-count').click();
  await expect(page.locator('#warnings')).toContainText('missing-parent');
  await expect(page.locator('#warnings')).toContainText('unsupported-part');
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true,'mobile layout fits viewport');
});

test('malicious message markup remains literal with CSP and without CSP', async t => {
  const {page,context,dir} = await setup(t);
  const inspect = async target => {
    await target.locator('#conversation').selectOption('1');
    await target.locator('#tree button[data-node-id="markup"]').click();
    await expect(target.locator('#path')).toContainText('</script><script>globalThis.__messageExecuted');
    assert.equal(await target.evaluate(() => globalThis.__messageExecuted),undefined);
    await expect(target.locator('img,svg,iframe')).toHaveCount(0);
    await expect(target.locator('script')).toHaveCount(2);
  };
  await inspect(page);
  // Defense in depth: verify escaping/textContent even if a browser ignores CSP.
  const original = await readFile(join(dir,'report.html'),'utf8');
  const noCsp = original.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/,'');
  await writeFile(join(dir,'without-csp.html'),noCsp);
  const unprotected = await context.newPage();
  await unprotected.goto(pathToFileURL(join(dir,'without-csp.html')).href);
  await inspect(unprotected);
});

test('empty export and empty conversation remain usable', async t => {
  const first = await setup(t,'[]');
  await expect(first.page.locator('#title')).toHaveText('No conversations in this export');
  await expect(first.page.locator('#set-a')).toBeDisabled();
  await first.page.locator('#search').fill('anything');
  await expect(first.page.locator('#search-count')).toHaveText('0 matching message(s)');
  const second = await setup(t,'[{"title":"Empty","mapping":{}}]');
  await expect(second.page.locator('#path')).toContainText('no nodes');
  await expect(second.page.locator('#comparison-status')).toHaveText('No endpoints to compare.');
});

test('special node identifiers, distinct conversation IDs, and cycles survive browser navigation', async t => {
  const {page} = await setup(t,'[{"id":"same","title":"Special keys","mapping":{"__proto__":{"parent":null,"message":null},"constructor":{"parent":"__proto__","message":null},"":{"parent":"constructor","message":null}}},{"id":"cycle","title":"Cycle","mapping":{"a":{"parent":"b","message":null},"b":{"parent":"a","message":null}}}]');
  await expect(page.locator('#path .message')).toHaveCount(3);
  await page.locator('#endpoint-a').selectOption('__proto__');
  await page.locator('#endpoint-b').selectOption('');
  await expect(page.locator('#comparison-status')).toContainText('Shared ancestor: __proto__');
  await page.locator('#conversation').selectOption('1');
  await expect(page.locator('#title')).toHaveText('Cycle');
  await expect(page.locator('#tree button')).toHaveCount(2);
  await expect(page.locator('#diagnostic-count')).toContainText('(1)');
});

test('untrusted titles, roles, node identifiers, and diagnostics are also rendered as text', async t => {
  const payload = '</script><script>globalThis.__messageExecuted=true</script><img src="https://example.invalid/metadata" onerror="globalThis.__messageExecuted=true">';
  const input = JSON.stringify([{id:payload,title:payload,current_node:payload,mapping:{
    [payload]:{parent:'missing',message:{author:{role:payload},content:{content_type:payload}}}
  }}]);
  const {page} = await setup(t,input);
  await expect(page.locator('#title')).toHaveText(payload);
  await expect(page.locator('#path')).toContainText(payload);
  await page.locator('#diagnostic-count').click();
  await expect(page.locator('#warnings')).toContainText(payload);
  await expect(page.locator('img')).toHaveCount(0);
  await expect(page.locator('script')).toHaveCount(2);
  assert.equal(await page.evaluate(() => globalThis.__messageExecuted),undefined);
});

test('keyboard downloads match CLI bytes for paths and comparisons; stale downloads clear', async t => {
  const sample = JSON.stringify([{id:'c',title:'Selected',current_node:'a',mapping:{
    root:{parent:null,message:null},
    a:{parent:'root',message:{author:{role:'user'},create_time:123.5,content:{content_type:'text',parts:['SELECTED café\n```js\nalert(1)\n```']}}},
    b:{parent:'root',message:{author:{role:'tool'},content:{content_type:'text',parts:['ALTERNATIVE']}}},
    sibling:{parent:'root',message:{author:{role:'assistant'},content:{content_type:'text',parts:['SIBLING_SENTINEL']}}}
  }},{id:'UNRELATED_ID',title:'UNRELATED_TITLE',mapping:{x:{parent:null,message:{content:{content_type:'text',parts:['UNRELATED_BODY']}}}}}]);
  const {page,dir} = await setup(t,sample);
  for (const endpoints of [['a'],['a','b'],['root'],['a','a'],['a','root']]) {
    for (const [i,id] of endpoints.entries()) {
      await page.locator('#node-id').fill(id); await page.locator('#node-id').press('Enter');
      await page.locator(`#set-${i === 0 ? 'a' : 'b'}`).click();
    }
    const output = join(dir,'selected.md');
    const cli = spawnSync(process.execPath,[join(root,'src/cli.js'),join(dir,'conversations.json'),'--markdown','--conversation-index','0',...endpoints.flatMap(id=>['--endpoint',id]),'-o',output,'--force'],{encoding:'utf8'});
    assert.equal(cli.status,0,cli.stderr);
    const prepare = page.locator(endpoints.length === 1 ? '#export-path' : '#export-comparison');
    await prepare.focus(); await page.keyboard.press('Enter');
    await expect(page.locator('#export-status')).toContainText('Ready.');
    await expect(page.getByRole('link',{name:'Download Markdown',exact:true})).toBeFocused();
    for (const [name,file] of [['Download Markdown',output],['Download JSON sidecar',output+'.json']]) {
      const link = page.getByRole('link',{name,exact:true}); await link.focus();
      const promise = page.waitForEvent('download'); await page.keyboard.press('Enter');
      const download = await promise;
      const bytes = await readFile(await download.path());
      assert.deepEqual(bytes,await readFile(file));
      for (const sentinel of ['SIBLING_SENTINEL','UNRELATED_ID','UNRELATED_TITLE','UNRELATED_BODY']) assert.ok(!bytes.toString().includes(sentinel));
      if (endpoints.length === 1) assert.ok(!bytes.toString().includes('ALTERNATIVE'));
    }
    await page.locator('#node-id').fill('root'); await page.locator('#node-id').press('Enter');
    await expect(page.locator('#export-downloads a')).toHaveCount(0);
    assert.ok(await page.locator('.message').count() <= 500);
  }
  await page.locator('#conversation').selectOption('1');
  await expect(page.locator('#export-downloads a')).toHaveCount(0);
});
