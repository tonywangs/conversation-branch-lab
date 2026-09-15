'use strict';
(() => {
  const data = JSON.parse(document.getElementById('report-data').textContent);
  const $ = id => document.getElementById(id);
  const element = (tag, text, className) => {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  };
  let conversationIndex = 0, selected = null;
  const current = () => data.conversations[conversationIndex];
  const label = node => `${node.role} · ${node.text.slice(0, 75) || '(empty node)'} [${node.id}]`;
  const pathTo = id => {
    const path = [];
    while (id !== null) { path.push(current().nodes[id]); id = current().nodes[id].parent; }
    return path.reverse();
  };
  function messages(container, nodes, emptyText) {
    container.replaceChildren();
    if (!nodes.length) { container.append(element('p', emptyText, 'muted')); return; }
    for (const node of nodes) {
      const card = element('article', undefined, `message ${node.kind === 'null' ? 'structural' : ''}`);
      card.dataset.nodeId = node.id;
      card.append(element('div', `${node.role} · ${node.id}`, 'message-meta'), element('pre', node.text || '(empty structural or text node)'));
      container.append(card);
    }
  }
  function selectNode(id) {
    selected = id;
    for (const button of $('tree').querySelectorAll('button[data-node-id]')) {
      button.setAttribute('aria-pressed', String(button.dataset.nodeId === id));
    }
    $('parent').disabled = id === null || current().nodes[id].parent === null;
    $('set-a').disabled = $('set-b').disabled = id === null;
    $('path-title').textContent = id === null ? 'Selected path' : `Path to ${id}`;
    messages($('path'), id === null ? [] : pathTo(id), 'This conversation has no nodes.');
  }
  function compare() {
    const c = current();
    if (!c || !Object.keys(c.nodes).length) {
      $('comparison-status').textContent = 'No endpoints to compare.';
      for (const id of ['shared', 'branch-a', 'branch-b']) $(id).replaceChildren();
      return;
    }
    const a = pathTo($('endpoint-a').value), b = pathTo($('endpoint-b').value);
    let shared = 0;
    while (shared < a.length && shared < b.length && a[shared].id === b[shared].id) shared++;
    const same = a.at(-1).id === b.at(-1).id;
    $('comparison-status').textContent = same ? `Same endpoint selected. Shared ancestor: ${a.at(-1).id}.` : shared ? `Shared ancestor: ${a[shared - 1].id}. ${a.length - shared} node(s) in A; ${b.length - shared} in B after divergence.` : 'No shared ancestor: these endpoints belong to separate roots.';
    messages($('shared'), a.slice(0, shared), 'No shared context.');
    messages($('branch-a'), a.slice(shared), 'No further messages after the shared ancestor.');
    messages($('branch-b'), b.slice(shared), 'No further messages after the shared ancestor.');
  }
  function loadConversation(index, focusNode) {
    conversationIndex = index;
    const c = current();
    $('conversation').value = String(index);
    $('title').textContent = c.title;
    const nodes = Object.values(c.nodes);
    $('stats').textContent = `${nodes.length} nodes · ${nodes.filter(n => n.children.length > 1).length} branch points · ${c.roots.length} roots`;
    const tree = $('tree'); tree.replaceChildren();
    const stack = c.roots.slice().reverse().map(id => [id, 0]);
    // Flat DOM with explicit depth keeps very deep input from nesting the browser DOM.
    while (stack.length) {
      const [id, depth] = stack.pop(), node = c.nodes[id];
      const row = element('div', undefined, 'tree-row');
      row.style.paddingLeft = `${Math.min(depth, 12) * 14}px`;
      const button = element('button', `${node.children.length > 1 ? `[${node.children.length} branches] ` : '↳ '}${label(node)}`);
      button.dataset.nodeId = id;
      button.title = `Depth ${depth}; ${node.children.length} children; parent ${node.parent ?? '(root)'}`;
      button.addEventListener('click', () => selectNode(id));
      row.append(button); tree.append(row);
      for (let i = node.children.length - 1; i >= 0; i--) stack.push([node.children[i], depth + 1]);
    }
    for (const endpoint of ['endpoint-a', 'endpoint-b']) {
      $(endpoint).replaceChildren();
      for (const node of nodes) {
        const option = element('option', label(node)); option.value = node.id; $(endpoint).append(option);
      }
      $(endpoint).disabled = !nodes.length;
    }
    const initial = focusNode ?? c.current;
    if (initial !== null) {
      $('endpoint-a').value = initial;
      $('endpoint-b').value = nodes.find(n => n.children.length === 0 && n.id !== initial)?.id ?? initial;
    }
    selectNode(initial); compare();
  }
  for (let index = 0; index < data.conversations.length; index++) {
    const option = element('option', data.conversations[index].title); option.value = String(index); $('conversation').append(option);
  }
  $('conversation').addEventListener('change', () => loadConversation(Number($('conversation').value)));
  $('parent').addEventListener('click', () => { if (selected !== null && current().nodes[selected].parent !== null) selectNode(current().nodes[selected].parent); });
  for (const side of ['a', 'b']) {
    $(`set-${side}`).addEventListener('click', () => { if (selected !== null) { $(`endpoint-${side}`).value = selected; compare(); } });
    $(`endpoint-${side}`).addEventListener('change', compare);
  }
  $('search').addEventListener('input', () => {
    const query = $('search').value.toLocaleLowerCase().trim();
    $('results').replaceChildren();
    if (!query) { $('search-count').textContent = ''; return; }
    let count = 0;
    data.conversations.forEach((c, index) => {
      for (const node of Object.values(c.nodes)) {
        const position = node.text.toLocaleLowerCase().indexOf(query);
        if (position === -1) continue;
        count++;
        if (count > 100) continue;
        const result = element('button', `${c.title} · ${node.role}: ${node.text.slice(Math.max(0, position - 35), position + query.length + 75)}`, 'result');
        result.addEventListener('click', () => { loadConversation(index, node.id); $('path-title').scrollIntoView({ block: 'nearest' }); });
        $('results').append(result);
      }
    });
    $('search-count').textContent = `${count} matching message(s)${count > 100 ? ' · showing first 100; refine your search' : ''}`;
  });
  $('diagnostic-count').textContent = `Import diagnostics (${data.diagnostics.length})`;
  for (const warning of data.diagnostics) $('warnings').append(element('li', `Conversation ${warning.conversation + 1}${warning.node === null ? '' : `, node ${warning.node}`}: [${warning.code}] ${warning.detail}`));
  if (!data.diagnostics.length) $('warnings').append(element('li', 'No structural or content diagnostics.'));
  if (data.conversations.length) loadConversation(0);
  else {
    $('title').textContent = 'No conversations in this export';
    $('stats').textContent = 'The input array is empty.';
    $('conversation').disabled = true;
    for (const id of ['set-a', 'set-b', 'parent', 'endpoint-a', 'endpoint-b']) $(id).disabled = true;
    compare();
  }
})();
