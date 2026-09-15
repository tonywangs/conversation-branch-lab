import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export async function renderReport(data) {
  const [style, app] = await Promise.all(['style.css', 'app.js'].map(file => readFile(new URL(`../web/${file}`, import.meta.url), 'utf8')));
  const json = JSON.stringify(data).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
  const hash = createHash('sha256').update(app).digest('base64');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>Conversation Branch Lab</title><style>${style}</style></head>
<body><header><div><p class="eyebrow">LOCAL EXPORT EXPLORER</p><h1>Conversation Branch Lab</h1></div><span class="badge">Offline · plain text</span></header>
<main><aside class="library"><label for="conversation">Conversation</label><select id="conversation"></select><p id="stats" class="muted"></p>
<label for="search">Search all messages</label><input id="search" type="search" placeholder="Search across conversations…"><p id="search-count" role="status"></p><div id="results"></div>
<details id="diagnostics"><summary id="diagnostic-count">Import diagnostics</summary><ul id="warnings"></ul></details>
<p class="privacy">This file contains the imported message text. Keep it as private as the original export.</p></aside>
<section class="workspace"><h2 id="title"></h2><p class="muted">Choose a node to read its path. Assign two endpoints to compare their branches.</p>
<div class="explorer"><nav aria-label="Conversation branches"><h3>Branch tree</h3><div id="tree"></div></nav><section aria-label="Selected branch"><h3 id="path-title">Selected path</h3><div class="actions"><button id="set-a">Use selected as A</button><button id="set-b">Use selected as B</button><button id="parent">Go to parent</button></div><div id="path"></div></section></div>
<section class="comparison" aria-label="Branch comparison"><h2>Compare branches</h2><div class="selectors"><label>Endpoint A<select id="endpoint-a"></select></label><label>Endpoint B<select id="endpoint-b"></select></label></div><p id="comparison-status" role="status"></p><details open><summary>Shared context</summary><div id="shared"></div></details><div class="columns"><section><h3>Branch A</h3><div id="branch-a"></div></section><section><h3>Branch B</h3><div id="branch-b"></div></section></div></section>
</section></main><script type="application/json" id="report-data">${json}</script><script>${app}</script></body></html>`;
}
