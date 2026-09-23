import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir, cpus, totalmem, platform, release } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { chromium } from '@playwright/test';
import { archives } from './synthetic.js';
const baselineTree = '67b0d2170feddde9378c7bfe1f017d21cb9d7f39';
const dir = await mkdtemp(join(tmpdir(), 'branch-large-'));
const browser = await chromium.launch();
const results = { seed: 20260922, baselineTree, environment: { node: process.version, chromium: browser.version(), os: `${platform()} ${release()}`, cpu: cpus()[0].model, logicalCPUs: cpus().length, memoryBytes: totalmem() }, runs: [] };
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, `${command}: ${result.stderr}`); return result.stdout;
};
// Independent reference walks raw parent pointers and intersects ancestor IDs.
function reference(raw, a, b) {
  const ancestors = id => { const out = []; for (; id !== null; id = raw.mapping[id].parent) out.push(id); return out; };
  const aa = ancestors(a), bb = ancestors(b), set = new Set(bb);
  const lca = aa.find(id => set.has(id));
  return { lca, shared: aa.slice(aa.indexOf(lca)).reverse(), a: aa.slice(0, aa.indexOf(lca)).reverse(), b: bb.slice(0, bb.indexOf(lca)).reverse() };
}
try {
  const baseline = join(dir, 'baseline'); await mkdir(baseline);
  for (const file of ['package.json','src/cli.js','src/parser.js','src/report.js','web/app.js','web/style.css']) {
    await mkdir(join(baseline, file.split('/').slice(0,-1).join('/')), { recursive: true });
    await writeFile(join(baseline,file),run('git',['show',`${baselineTree}:${file}`]));
  }
  for (const [name, raw] of Object.entries(archives())) {
    const input = join(dir, `${name}.json`); await writeFile(input, JSON.stringify(raw));
    const split = Math.ceil(raw.length / 2);
    const parts = [join(dir,`${name}-a.json`),join(dir,`${name}-b.json`)];
    await writeFile(parts[0], JSON.stringify(raw.slice(0,split)));
    await writeFile(parts[1], JSON.stringify(raw.slice(split)));
    for (const version of ['baseline','updated']) {
      const report = join(dir, `${name}-${version}.html`), memory = join(dir, 'memory.txt');
      const start = performance.now();
      run('/usr/bin/time',['-f','%M','-o',memory,process.execPath,version === 'baseline' ? join(baseline,'src/cli.js') : resolve('src/cli.js'), ...(version === 'baseline' ? [input] : parts), '-o',report]);
      const metrics = { name, version, conversations: raw.length, nodes: raw.reduce((n,c) => n + Object.keys(c.mapping).length,0), generationMs: performance.now()-start, peakCliKiB: Number((await readFile(memory,'utf8')).trim()), reportBytes: (await readFile(report)).length, interactionMs: { navigation: [], search: [], comparison: [] } };
      const context = await browser.newContext({ offline: true });
      const errors = [], network = [];
      await context.route(/^https?:/, route => { network.push(route.request().url()); return route.abort(); });
      const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
      const load = performance.now(); await page.goto(pathToFileURL(report).href); await page.waitForFunction(() => document.querySelector('#title').textContent.length > 0);
      metrics.loadMs = performance.now()-load;
      const bounded = async () => {
        const counts = await page.evaluate(() => ({ dom: document.querySelectorAll('*').length, messages: document.querySelectorAll('.message').length }));
        metrics.maxDOM = Math.max(metrics.maxDOM ?? 0, counts.dom); metrics.maxMessages = Math.max(metrics.maxMessages ?? 0, counts.messages);
        if (version === 'updated') { assert.ok(counts.messages <= 500); assert.ok(counts.dom < 3000, `DOM ${counts.dom}`); }
      };
      await bounded();
      for (let trial = 0; trial < 5; trial++) {
        // A unique match in the last conversation / near the deep chain end is outside initial windows.
        const target = raw.at(-1), id = name === 'wide' ? 'n49' : 'n4499';
        const query = `${target.id} message ${Number(id.slice(1))} token`;
        const expected = raw.flatMap(c => Object.entries(c.mapping).filter(([,n]) => n.message.content.parts.join('\n').toLowerCase().includes(query.toLowerCase())).map(([node]) => [c.id,node]));
        assert.equal(expected.length,1);
        let tick = performance.now(); await page.locator('#search').fill(''); await page.locator('#search').fill(query);
        await page.waitForFunction(() => document.querySelector('#search-count').textContent === '1 matching message(s)');
        metrics.interactionMs.search.push(performance.now()-tick);
        tick = performance.now(); await page.locator('#results button').click();
        assert.equal(await page.locator('#path-title').textContent(), `Path to ${id}`);
        assert.equal(await page.locator('#path .message').last().getAttribute('data-node-id'), id);
        metrics.interactionMs.navigation.push(performance.now()-tick); await bounded();
        const a = name === 'wide' ? 'n49' : 'n4499', b = name === 'wide' ? 'n48' : 'n4999';
        tick = performance.now();
        if (version === 'updated') {
          for (const [side, endpoint] of [['a',a],['b',b]]) {
            await page.locator('#node-id').fill(endpoint); await page.locator('#node-id').press('Enter'); await page.locator(`#set-${side}`).click();
          }
        } else { await page.locator('#endpoint-a').selectOption(a); await page.locator('#endpoint-b').selectOption(b); }
        const ref = reference(target,a,b);
        assert.equal(await page.locator('#comparison-status').textContent(), `Shared ancestor: ${ref.lca}. ${ref.a.length} node(s) in A; ${ref.b.length} in B after divergence.`);
        for (const side of ['a','b','shared']) {
          const visible = await page.locator(`${side === 'shared' ? '#shared' : `#branch-${side}`} .message`).evaluateAll(els => els.map(el => el.dataset.nodeId));
          const wanted = ref[side]; const offset = version === 'updated' ? Math.floor(Math.max(0,wanted.length-1)/100)*100 : 0;
          assert.deepEqual(visible,wanted.slice(offset));
        }
        metrics.interactionMs.comparison.push(performance.now()-tick); await bounded();
      }
      if (version === 'updated') {
        metrics.exports = [];
        const targetIndex = raw.length - 1;
        const endpoints = name === 'wide' ? ['n49', 'n48'] : ['n4499', 'n4999'];
        for (const selection of [[endpoints[0]], endpoints]) {
          const output = join(dir, `${name}-${selection.length}.md`);
          const tick = performance.now();
          run(process.execPath,[resolve('src/cli.js'),...parts,'--markdown','--conversation-index',String(targetIndex),...selection.flatMap(id => ['--endpoint',id]),'-o',output]);
          const cliMs = performance.now() - tick;
          for (const [index,id] of selection.entries()) {
            await page.locator('#node-id').fill(id); await page.locator('#node-id').press('Enter');
            await page.locator(index ? '#set-b' : '#set-a').click();
          }
          const start = performance.now();
          await page.locator(selection.length === 1 ? '#export-path' : '#export-comparison').click();
          await page.waitForFunction(() => document.querySelector('#export-status').textContent.startsWith('Ready.'));
          const browserPrepareMs = performance.now() - start;
          const sizes = {};
          for (const [label,file,key] of [['Download Markdown',output,'markdownBytes'],['Download JSON sidecar',output+'.json','sidecarBytes']]) {
            const downloaded = page.waitForEvent('download');
            await page.getByRole('link',{name:label,exact:true}).click();
            const download = await downloaded;
            const actual = await readFile(await download.path()), expected = await readFile(file);
            assert.deepEqual(actual,expected); sizes[key] = actual.length;
          }
          const metadata = JSON.parse(await readFile(output+'.json','utf8'));
          const ref = reference(raw[targetIndex],...endpoints);
          assert.deepEqual(metadata.paths, selection.length === 1 ? {path:[...ref.shared,...ref.a]} : {shared:ref.shared,a:ref.a,b:ref.b});
          metrics.exports.push({mode:selection.length === 1 ? 'path' : 'comparison', cliMs, browserPrepareMs, ...sizes});
          await bounded();
        }
        // Restore the endpoint used by the following pagination regression.
        await page.locator('#node-id').fill(endpoints[1]); await page.locator('#node-id').press('Enter');
      }
      // Full Unicode search reference, including all conversations, not rendered cards.
      await page.locator('#search').fill('CAFÉ こんにちは 🌍');
      const total = raw.reduce((sum,c) => sum+Object.values(c.mapping).filter(n => n.message.content.parts.join('\n').toLowerCase().includes('café こんにちは 🌍')).length,0);
      assert.match(await page.locator('#search-count').textContent(),new RegExp(`^${total} matching`));
      assert.equal(await page.locator('#results button').count(),100);
      if (version === 'updated' && name === 'wide') {
        await page.locator('#library-previous').focus(); await page.keyboard.press('Enter');
        assert.equal(await page.locator('#conversation').inputValue(), '800');
        await page.locator('#library-next').click();
        await page.locator('#conversation').selectOption('999');
        assert.equal(await page.locator('#title').textContent(), 'Synthetic c999');
        await bounded();
      }
      if (version === 'updated' && name === 'deep') {
        await page.locator('#tree > .actions button').last().focus(); await page.keyboard.press('Enter');
        assert.equal(await page.locator('#tree button[data-node-id]').count(),100);
        assert.equal(await page.locator('#tree > .actions button').last().evaluate(el => el === document.activeElement),true);
        await page.locator('#path > .actions button').first().click();
        const path = [];
        for (let id = 'n4999'; id !== null; id = raw[0].mapping[id].parent) path.unshift(id);
        const previousStart = Math.floor((path.length - 1) / 100) * 100 - 100;
        assert.deepEqual(await page.locator('#path .message').evaluateAll(els => els.map(el => el.dataset.nodeId)), path.slice(previousStart, previousStart + 100));
        await bounded();
      }
      assert.deepEqual(errors,[]); assert.deepEqual(network,[]);
      results.runs.push(metrics); await context.close();
      console.log(`${name} ${version}: ${metrics.reportBytes} bytes, ${metrics.peakCliKiB} KiB peak, ${metrics.maxDOM} DOM elements, ${metrics.maxMessages} message cards`);
    }
  }
  await mkdir('results',{ recursive:true });
  await writeFile('results/performance.json', JSON.stringify(results,null,2)+'\n');
} finally { await browser.close(); await rm(dir,{recursive:true,force:true}); }
