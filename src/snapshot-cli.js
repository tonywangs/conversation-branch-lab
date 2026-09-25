import { readFile, writeFile, stat, lstat, rename, rm } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { compareSnapshots, SNAPSHOT_LIMITS, sha256 } from './snapshot.js';
import { parseSnapshotJSON } from './snapshot-json.js';
import { snapshotArtifacts } from './snapshot-report.js';
export const snapshotUsage = `Snapshot comparison:
  conversation-branch-lab --compare BEFORE.json AFTER.json -o comparison.html
  conversation-branch-lab --compare --before A.json --before B.json --after C.json -o comparison.html
Writes self-contained HTML and OUTPUT.html.json. --force replaces outputs.
--strict fails on analysis limitations. Without it, incomplete analysis exits 2 after writing.
Exit 0: complete analysis (with or without differences); exit 1: failure; exit 2: incomplete.
`;
export async function snapshotMain(args) {
  let output = 'snapshot-comparison.html', force = false, strict = false;
  const before = [], after = [], positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') { console.log(snapshotUsage); return; }
    if (['--before','--after','-o','--output'].includes(arg)) {
      if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error(`${arg} requires a filename.`);
      const value = args[++i];
      if (arg === '--before') before.push(value); else if (arg === '--after') after.push(value); else output = value;
    } else if (arg === '--force') force = true;
    else if (arg === '--strict') strict = true;
    else if (arg.startsWith('-')) throw new Error(`Unknown comparison option: ${arg}`);
    else positional.push(arg);
  }
  if (positional.length) {
    if (positional.length !== 2 || before.length || after.length) throw new Error('Use two positional snapshots OR repeated --before/--after files.');
    before.push(positional[0]); after.push(positional[1]);
  }
  if (!before.length || !after.length) throw new Error(snapshotUsage);
  const inputs = [...before, ...after], outputs = [output, output + '.json'];
  if (inputs.length > SNAPSHOT_LIMITS.files) throw new Error(`Input file limit ${SNAPSHOT_LIMITS.files} exceeded.`);
  const outputStats = await Promise.all(outputs.map(file => stat(file).catch(e => { if (e.code === 'ENOENT') return null; throw e; })));
  if (outputStats.some(info => info && !info.isFile())) throw new Error('Output must be a regular file.');
  for (const file of outputs) {
    const entry = await lstat(file).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (entry && !force) throw new Error('Output already exists; use --force.');
  }
  let totalBytes = 0;
  const inputStats = [];
  for (const input of inputs) {
    if (outputs.some(file => resolve(input) === resolve(file))) throw new Error('Input and output must be different files.');
    const info = await stat(input); inputStats.push(info);
    if (!info.isFile()) throw new Error(`${input}: expected a regular file.`);
    if (outputStats.some(out => out && info.dev === out.dev && info.ino === out.ino)) throw new Error('Input and output refer to the same file.');
    totalBytes += info.size;
    if (totalBytes > SNAPSHOT_LIMITS.bytes) throw new Error(`Input byte limit ${SNAPSHOT_LIMITS.bytes} exceeded.`);
  }
  const sources = [];
  for (const [index, input] of inputs.entries()) {
    const bytes = await readFile(input);
    if (bytes.length !== inputStats[index].size) throw new Error(`${input}: input changed while reading.`);
    let parsed;
    try { parsed = parseSnapshotJSON(new TextDecoder('utf-8', { fatal: true }).decode(bytes), SNAPSHOT_LIMITS.depth); }
    catch (e) { throw new Error(`${input}: ${e.message}`); }
    sources.push({ input: parsed, sha256: sha256(bytes) });
  }
  const data = compareSnapshots(sources.slice(0, before.length), sources.slice(before.length));
  if (strict && data.limitations.length) throw new Error(`Strict mode: ${data.limitations.length} analysis limitations; no report written.`);
  const contents = await snapshotArtifacts(data, SNAPSHOT_LIMITS.artifactBytes);
  for (const [index, content] of contents.entries()) {
    if (force) {
      const temporary = join(dirname(resolve(outputs[index])), `.snapshot-${randomUUID()}.tmp`);
      try { await writeFile(temporary, content, { flag: 'wx', mode: 0o600 }); await rename(temporary, outputs[index]); }
      finally { await rm(temporary, { force: true }); }
    } else await writeFile(outputs[index], content, { flag: 'wx', mode: 0o600 });
  }
  console.log(`Wrote ${outputs.join(' and ')}: ${data.findings.length} findings; analysis ${data.summary.analysis}; ${data.summary.equivalence}.`);
  if (data.limitations.length) process.exitCode = 2;
}
