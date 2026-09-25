'use strict';
(() => {
  const data = JSON.parse(document.querySelector('#snapshot-data').textContent);
  const $ = id => document.getElementById(id);
  const text = (tag, value, className) => {
    const el = document.createElement(tag); el.textContent = value;
    if (className) el.className = className;
    return el;
  };
  const PAGE = 50, DISPLAY = 12000;
  let page = 0, limitationPage = 0, filtered = data.findings;
  const show = value => {
    if (value === null) return 'Absent from this snapshot';
    const encoded = JSON.stringify(value, null, 2);
    return encoded.length <= DISPLAY ? encoded : encoded.slice(0, DISPLAY) + '\n[Display truncated; full value in companion JSON]';
  };
  $('summary').textContent = `Analysis: ${data.summary.analysis}. Equivalence: ${data.summary.equivalence}.`;
  $('counts').textContent = `${data.summary.before.conversations} conversations / ${data.summary.before.nodes} nodes before; ${data.summary.after.conversations} conversations / ${data.summary.after.nodes} nodes after. ${data.summary.findings} findings.`;
  $('provenance').textContent = JSON.stringify({format:data.format, version:data.version, sources:data.sources, settings:data.settings}, null, 2);
  $('limitations-title').textContent = `Analysis limitations (${data.limitations.length})`;
  function renderLimitations() {
    const start = limitationPage * PAGE;
    $('limitations').replaceChildren(...data.limitations.slice(start, start + PAGE).map(l => text('li', show(l))));
    $('limitations-position').textContent = `${data.limitations.length ? start + 1 : 0}–${Math.min(start + PAGE, data.limitations.length)} of ${data.limitations.length}`;
    $('limitations-previous').disabled = !limitationPage;
    $('limitations-next').disabled = start + PAGE >= data.limitations.length;
  }
  $('limitations-previous').onclick = () => { limitationPage--; renderLimitations(); };
  $('limitations-next').onclick = () => { limitationPage++; renderLimitations(); };
  for (const kind of [...new Set(data.findings.map(f => f.kind))].sort()) {
    const option = text('option', kind); option.value = kind; $('kind').append(option);
  }
  function render() {
    const start = page * PAGE;
    $('position').textContent = `${filtered.length ? start + 1 : 0}–${Math.min(start + PAGE, filtered.length)} of ${filtered.length} matching findings (${data.findings.length} total)`;
    $('previous').disabled = !page;
    $('next').disabled = start + PAGE >= filtered.length;
    $('changes').replaceChildren(...filtered.slice(start, start + PAGE).map(f => {
      const article = document.createElement('article'); article.className = 'finding';
      article.append(text('h3', f.kind), text('p', `Conversation: ${JSON.stringify(f.conversation)}${f.node === null ? '' : ` · Node: ${JSON.stringify(f.node)}`}`, 'identity'));
      const columns = document.createElement('div'); columns.className = 'columns';
      for (const side of ['before', 'after']) {
        const section = document.createElement('section');
        section.setAttribute('aria-label', side === 'before' ? 'Before' : 'After');
        section.append(text('h4', side === 'before' ? 'Before' : 'After'), text('pre', show(f[side]), 'message'));
        columns.append(section);
      }
      article.append(columns); return article;
    }));
    if (!filtered.length) $('changes').append(text('p', data.summary.analysis === 'incomplete' ? 'No matching findings. Analysis is incomplete; this does not establish equivalence.' : 'No matching findings. Check filters and the analysis summary.'));
  }
  function filter() {
    const query = $('search').value.toLowerCase(), conversation = $('conversation').value, kind = $('kind').value;
    filtered = data.findings.filter(f => (!kind || f.kind === kind) && (!$('exact-conversation').checked || f.conversation === conversation) && (!query || JSON.stringify(f).toLowerCase().includes(query)));
    page = 0; render();
  }
  for (const id of ['search','conversation','exact-conversation','kind']) $(id).addEventListener('input', filter);
  $('reset').onclick = () => { for (const id of ['search','conversation','kind']) $(id).value = ''; $('exact-conversation').checked = false; filter(); };
  $('previous').onclick = () => { page--; render(); };
  $('next').onclick = () => { page++; render(); };
  renderLimitations(); render();
})();
