import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, symlink, link, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const fixture = fileURLToPath(new URL('../fixtures/synthetic-conversations.json', import.meta.url));
const run = args => spawnSync(process.execPath, [cli, ...args], {encoding:'utf8'});
async function temp(t) { const dir = await mkdtemp(join(tmpdir(), 'branch-cli-')); t.after(() => rm(dir, {recursive:true,force:true})); return dir; }

test('CLI imports synthetic export, reports repairs, and embeds safely', async t => {
  const dir = await temp(t), output = join(dir,'report.html');
  const result = run([fixture,'-o',output]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /missing-parent/);
  const html = await readFile(output, 'utf8');
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /\\u003c\/script\\u003e/);
  assert.ok(!html.includes('<script>globalThis.__messageExecuted'));
  assert.equal((html.match(/<script/g) || []).length, 2);
});

test('CLI refuses overwrite, supports explicit force, and protects input', async t => {
  const dir = await temp(t), output = join(dir,'report.html');
  await writeFile(output,'keep me');
  assert.notEqual(run([fixture,'-o',output]).status, 0);
  assert.equal(await readFile(output,'utf8'),'keep me');
  assert.equal(run([fixture,'-o',output,'--force']).status, 0);
  assert.match(await readFile(output,'utf8'), /<!doctype html>/);
  const input = join(dir,'input.json'); await writeFile(input,'[]');
  assert.notEqual(run([input,'-o',input,'--force']).status, 0);
  assert.equal(await readFile(input,'utf8'),'[]');
});

test('strict diagnostics, malformed JSON, structural errors, and arguments fail without output', async t => {
  const dir = await temp(t), output = join(dir,'report.html');
  const result = run([fixture,'-o',output,'--strict']);
  assert.equal(result.status, 1); assert.match(result.stderr, /Strict mode/);
  await assert.rejects(readFile(output), {code:'ENOENT'});
  for (const text of ['{oops', '{}', '[{"mapping":{"x":false}}]']) {
    const input = join(dir,'input.json'); await writeFile(input,text);
    assert.equal(run([input,'-o',output]).status, 1);
    await assert.rejects(readFile(output), {code:'ENOENT'});
  }
  for (const args of [[], ['--wat'], [fixture,'-o']]) assert.equal(run(args).status, 1);
  assert.equal(run(['--help']).status, 0);
});

test('UTF-8 BOM and empty exports generate valid reports', async t => {
  const dir = await temp(t), input = join(dir,'empty.json');
  await writeFile(input, '\ufeff[]');
  assert.equal(run([input,'-o',join(dir,'empty.html')]).status, 0);
});

test('force cannot modify the input via symlinks or hard links and replaces other symlinks safely', async t => {
  const dir = await temp(t), input = join(dir,'input.json');
  await writeFile(input,'[]');
  for (const [name, makeLink] of [['symlink',symlink],['hardlink',link]]) {
    const alias = join(dir,name); await makeLink(input,alias);
    const result = run([input,'-o',alias,'--force']);
    assert.equal(result.status,1); assert.match(result.stderr,/same file/);
    assert.equal(await readFile(input,'utf8'),'[]');
  }
  const unrelated = join(dir,'unrelated.txt'), output = join(dir,'report.html');
  await writeFile(unrelated,'preserve'); await symlink(unrelated,output);
  assert.equal(run([input,'-o',output,'--force']).status,0);
  assert.equal(await readFile(unrelated,'utf8'),'preserve');
  assert.match(await readFile(output,'utf8'),/<!doctype html>/);
  assert.equal((await stat(output)).mode & 0o777,0o600);
});

test('multi-file CLI preserves order, deduplicates, names conflicts and protects every input', async t => {
  const dir = await temp(t), a = join(dir,'a.json'), b = join(dir,'b.json'), output = join(dir,'report.html');
  const one = {id:'one',title:'First',mapping:{}}, two = {id:'two',title:'Second',mapping:{}};
  await writeFile(a,JSON.stringify([one])); await writeFile(b,JSON.stringify([one,two]));
  const result = run([a,b,'-o',output]); assert.equal(result.status,0,result.stderr);
  const html = await readFile(output,'utf8');
  const data = JSON.parse(html.match(/id="report-data">(.*?)<\/script>/s)[1]);
  assert.deepEqual(data.conversations.map(c => c.id),['one','two']);
  assert.equal(run([a,b,'-o',b,'--force']).status,1);
  await writeFile(b,JSON.stringify([{...one,title:'Conflict'}]));
  const conflict = run([a,b,'-o',output,'--force']);
  assert.equal(conflict.status,1); assert.ok(conflict.stderr.includes(a)); assert.ok(conflict.stderr.includes(b));
  assert.equal(await readFile(output,'utf8'),html);
});

test('CLI rejects oversized byte input and too many files before writing', async t => {
  const { open } = await import('node:fs/promises');
  const dir = await temp(t), input = join(dir,'large.json'), output = join(dir,'report.html');
  const file = await open(input,'w'); await file.truncate(128 * 1024 * 1024 + 1); await file.close();
  assert.match(run([input,'-o',output]).stderr,/byte limit/);
  assert.match(run([...Array(65).fill(fixture),'-o',output]).stderr,/file limit/);
  await assert.rejects(readFile(output),{code:'ENOENT'});
});
