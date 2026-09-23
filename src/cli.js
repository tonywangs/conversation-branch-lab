#!/usr/bin/env node
import { readFile, writeFile, stat, lstat, rename, rm } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { importExports, LIMITS } from './import.js';
import { renderReport } from './report.js';
import { exportSelection } from './export.js';
const usage = `Usage: conversation-branch-lab <conversations.json> [more.json ...] [-o report.html] [--strict] [--force]

Creates a self-contained offline HTML report. Default output: report.html
--markdown --conversation-index N --endpoint ID [--endpoint ID]\n          Export selected path(s) to -o FILE and FILE.json (zero-based conversation index).\n--strict  Fail on any diagnostic instead of repairing malformed links.
--force   Replace an existing output file (never the input file).
-h, --help  Show this help.
`;
async function main(args) {
  const inputs = [];
  let output, strict = false, force = false, markdown = false, conversationIndex;
  const endpoints = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') { console.log(usage); return; }
    if (arg === '-o' || arg === '--output') {
      if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error(`${arg} requires a filename.`);
      output = args[++i];
    } else if (arg === '--markdown') markdown = true;
    else if (arg === '--conversation-index' || arg === '--endpoint') {
      if (i + 1 >= args.length) throw new Error(`${arg} requires a value.`);
      const value = args[++i];
      if (arg === '--endpoint') endpoints.push(value);
      else {
        if (!/^(0|[1-9][0-9]*)$/.test(value) || conversationIndex !== undefined) throw new Error('Invalid conversation index.');
        conversationIndex = Number(value);
      }
    } else if (arg === '--strict') strict = true;
    else if (arg === '--force') force = true;
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else inputs.push(arg);
  }
  if (!inputs.length) throw new Error(usage);
  if (markdown ? conversationIndex === undefined || endpoints.length < 1 || endpoints.length > 2 : conversationIndex !== undefined || endpoints.length) throw new Error('Markdown export requires --conversation-index and one or two --endpoint values.');
  output ??= markdown ? 'selection.md' : 'report.html';
  const outputs = markdown ? [output, output + '.json'] : [output];
  const outputStats = await Promise.all(outputs.map(file => stat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; })));
  if (outputStats.some(info => info && !info.isFile())) throw new Error('Output must be a regular file.');
  const outputEntries = await Promise.all(outputs.map(file => lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; })));
  if (!force && outputEntries.some(Boolean)) throw new Error('Output already exists; use --force.');
  if (inputs.length > LIMITS.files) throw new Error(`Input file limit ${LIMITS.files} exceeded.`);
  const sources = [];
  let totalBytes = 0;
  for (const input of inputs) {
    if (outputs.some(file => resolve(input) === resolve(file))) throw new Error('Input and output must be different files.');
    const inputStat = await stat(input);
    if (!inputStat.isFile()) throw new Error(`${input}: expected a regular file.`);
    if (outputStats.some(outputStat => outputStat && inputStat.dev === outputStat.dev && inputStat.ino === outputStat.ino)) throw new Error('Input and output refer to the same file.');
    totalBytes += inputStat.size;
    if (totalBytes > LIMITS.bytes) throw new Error(`Input byte limit ${LIMITS.bytes} exceeded at ${input}.`);
    let raw, sha256;
    try {
      const bytes = await readFile(input);
      if (bytes.length !== inputStat.size) throw new Error('Input changed while reading.');
      raw = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
      sha256 = createHash('sha256').update(bytes).digest('hex');
    } catch (error) { throw new Error(`${input}: Cannot read JSON input: ${error.message}`); }
    sources.push({ source: input, input: raw, sha256 });
  }
  const data = importExports(sources);
  for (const d of data.diagnostics) console.error(`${d.source} [${d.code}] conversation ${d.conversation + 1}${d.node === null ? '' : `, node ${d.node}`}: ${d.detail}`);
  if (strict && data.diagnostics.length) throw new Error(`Strict mode: ${data.diagnostics.length} diagnostic(s); no report written.`);
  const artifacts = markdown ? await exportSelection(data, conversationIndex, endpoints) : null;
  const contents = artifacts ? [artifacts.markdown, artifacts.sidecar] : [await renderReport(data)];
  for (const [index, output] of outputs.entries()) {
    const html = contents[index];
    // A forced replacement is atomic and never follows an output symlink.
    if (force) {
      const temporary = join(dirname(resolve(output)), `.branch-report-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, html, { flag: 'wx', mode: 0o600 });
        await rename(temporary, output);
      } finally { await rm(temporary, { force: true }); }
    } else {
      // Exclusive creation protects an existing report, including symlinks.
      await writeFile(output, html, { flag: 'wx', mode: 0o600 });
    }
  }
  console.log(`Wrote ${outputs.join(' and ')}: ${data.conversations.length} conversation(s), ${data.diagnostics.length} diagnostic(s).`);
}
main(process.argv.slice(2)).catch(error => { console.error(`Error: ${error.message}`); process.exitCode = 1; });
