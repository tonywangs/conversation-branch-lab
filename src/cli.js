#!/usr/bin/env node
import { readFile, writeFile, stat, rename, rm } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseExport } from './parser.js';
import { renderReport } from './report.js';
const usage = `Usage: conversation-branch-lab <conversations.json> [-o report.html] [--strict] [--force]

Creates a self-contained offline HTML report. Default output: report.html
--strict  Fail on any diagnostic instead of repairing malformed links.
--force   Replace an existing output file (never the input file).
-h, --help  Show this help.
`;
async function main(args) {
  if (args.includes('--help') || args.includes('-h')) { console.log(usage); return; }
  let input, output = 'report.html', strict = false, force = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-o' || arg === '--output') {
      if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error(`${arg} requires a filename.`);
      output = args[++i];
    } else if (arg === '--strict') strict = true;
    else if (arg === '--force') force = true;
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else if (input) throw new Error('Expected one input file.');
    else input = arg;
  }
  if (!input) throw new Error(usage);
  if (resolve(input) === resolve(output)) throw new Error('Input and output must be different files.');
  const inputStat = await stat(input);
  const outputStat = await stat(output).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (outputStat && inputStat.dev === outputStat.dev && inputStat.ino === outputStat.ino) {
    throw new Error('Input and output refer to the same file.');
  }
  let raw;
  try { raw = JSON.parse((await readFile(input, 'utf8')).replace(/^\uFEFF/, '')); }
  catch (error) { throw new Error(`Cannot read JSON input: ${error.message}`); }
  const data = parseExport(raw);
  for (const d of data.diagnostics) console.error(`[${d.code}] conversation ${d.conversation + 1}${d.node === null ? '' : `, node ${d.node}`}: ${d.detail}`);
  if (strict && data.diagnostics.length) throw new Error(`Strict mode: ${data.diagnostics.length} diagnostic(s); no report written.`);
  const html = await renderReport(data);
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
  console.log(`Wrote ${output}: ${data.conversations.length} conversation(s), ${data.diagnostics.length} diagnostic(s).`);
}
main(process.argv.slice(2)).catch(error => { console.error(`Error: ${error.message}`); process.exitCode = 1; });
