// Exercise the packed artifact in an isolated prefix with no dependencies or network.
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
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
  run(cli,[fixture,'-o',join(dir,'isolated.html')],dir);
  const html = await readFile(join(dir,'isolated.html'),'utf8');
  assert.match(html,/Synthetic · Two weekend ideas/);
  assert.match(html,/id="branch-b"/);
  console.log('PASS: packed CLI installed offline in an isolated prefix and generated a self-contained synthetic report.');
} finally { await rm(dir,{recursive:true,force:true}); }
