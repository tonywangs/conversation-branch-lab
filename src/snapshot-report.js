import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export async function renderSnapshotReport(data) {
  const app = await readFile(new URL('../web/snapshot.js', import.meta.url), 'utf8');
  const style = await readFile(new URL('../web/snapshot.css', import.meta.url), 'utf8');
  const hash = createHash('sha256').update(app).digest('base64');
  const json = JSON.stringify(data).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>Snapshot comparison · Conversation Branch Lab</title><style>${style}</style></head><body>
<a href="#findings" class="skip">Skip to findings</a><header><p>CONVERSATION BRANCH LAB · OFFLINE</p><h1>Snapshot comparison</h1><p>Presence in two snapshots, not proof of deletion. All imported content is literal text.</p></header>
<main><section aria-label="Comparison summary"><h2>Analysis</h2><p id="summary"></p><p id="counts"></p><p>Version 1 · Conversation IDs and mapping keys · Parent links determine branches.</p>
<details><summary>Source hashes and settings</summary><pre id="provenance"></pre></details>
<details><summary id="limitations-title">Analysis limitations</summary><p>Unsupported payloads are compared as JSON only; their meaning and external assets are not analyzed.</p><p id="limitations-position" role="status"></p><button id="limitations-previous">Previous limitations</button><button id="limitations-next">Next limitations</button><ul id="limitations"></ul></details></section>
<section aria-label="Filter findings"><h2>Find changes</h2><div class="filters"><label>Change type<select id="kind"><option value="">All types</option></select></label><label>Exact conversation ID<input id="conversation" type="text"></label><label class="checkbox"><input id="exact-conversation" type="checkbox">Apply conversation ID filter (including empty ID)</label><label>Search IDs and before/after values<input id="search" type="search"></label></div><p>Search is literal and case-insensitive. Each page has up to 50 findings; displayed values are limited to 12,000 characters. Full values remain in the companion JSON.</p><button id="reset">Clear filters</button></section>
<section id="findings" tabindex="-1" aria-label="Snapshot findings"><h2>Findings</h2><p id="position" role="status" aria-live="polite"></p><nav aria-label="Finding pages"><button id="previous">Previous findings</button><button id="next">Next findings</button></nav><div id="changes"></div></section>
</main><footer>Contains private imported data. Keep this report and its JSON as private as the source exports.</footer>
<noscript>This report requires JavaScript. Read the companion JSON for the complete findings.</noscript><script type="application/json" id="snapshot-data">${json}</script><script>${app}</script></body></html>`;
}

// Both artifacts are fully validated before the CLI opens either output file.
export async function snapshotArtifacts(data, maxBytes) {
  const json = JSON.stringify(data) + '\n';
  if (Buffer.byteLength(json) > maxBytes) throw new Error('JSON artifact byte limit exceeded; no report written.');
  const html = await renderSnapshotReport(data);
  if (Buffer.byteLength(html) > maxBytes) throw new Error('HTML artifact byte limit exceeded; no report written.');
  return [html, json];
}
