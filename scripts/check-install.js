// Exercise the packed artifact in an isolated prefix with no dependencies or network.
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const dir = await mkdtemp(join(tmpdir(),'branch-install-'));
const run = (command, args, cwd) => {
  const result = spawnSync(command,args,{cwd,encoding:'utf8',env:{...process.env,npm_config_cache:join(dir,'cache')}});
  assert.equal(result.status,0,`${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
};
try {
  const packed = JSON.parse(run('npm',['pack','--json','--pack-destination',dir],resolve('.')));
  run('npm',['install','--offline','--global','--prefix',join(dir,'prefix'),'--ignore-scripts','--omit=dev','--no-audit','--no-fund',join(dir,packed[0].filename)],dir);
  const cli = join(dir,'prefix','bin','conversation-branch-lab');
  run(cli,['--help'],dir);
  const fixture = join(dir,'prefix','lib','node_modules','conversation-branch-lab','fixtures','synthetic-conversations.json');
  const second = join(dir,'second.json');
  const originals = JSON.parse(await readFile(fixture,'utf8'));
  await writeFile(second,JSON.stringify([originals[0],{id:'installed-extra',title:'Installed extra',mapping:{}}]));
  run(cli,[fixture,second,'-o',join(dir,'isolated.html')],dir);
  const html = await readFile(join(dir,'isolated.html'),'utf8');
  assert.match(html,/Synthetic · Two weekend ideas/);
  assert.match(html,/id="branch-b"/);
  const data = JSON.parse(html.match(/id="report-data">(.*?)<\/script>/s)[1]);
  assert.equal(data.conversations.length,4);
  assert.equal(data.conversations.at(-1).id,'installed-extra');
  if (process.env.VERIFY_INSTALL_BROWSER === '1') {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({offline:true});
      const network = [], errors = [];
      await context.route(/^https?:/, route => { network.push(route.request().url()); return route.abort(); });
      const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
      await page.goto(pathToFileURL(join(dir,'isolated.html')).href);
      await page.locator('#search').fill('saffron'); await page.locator('#results button').click();
      assert.match(await page.locator('#path').textContent(), /こんにちは/);
      assert.deepEqual(network,[]); assert.deepEqual(errors,[]);
    } finally { await browser.close(); }
  }
  console.log('PASS: packed CLI installed offline in an isolated prefix and generated a self-contained synthetic report.');
} finally { await rm(dir,{recursive:true,force:true}); }
