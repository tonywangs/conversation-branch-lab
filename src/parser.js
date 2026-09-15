/** Parse the observed mapping-based export structure. Parent links are authoritative. */
export function parseExport(input) {
  if (!Array.isArray(input)) throw new Error('Export must be a JSON array of conversations.');
  const diagnostics = [];
  const warn = (conversation, node, code, detail) => diagnostics.push({ conversation, node, code, detail });
  const conversations = input.map((raw, index) => {
    if (!isObject(raw) || !isObject(raw.mapping)) {
      throw new Error(`Conversation ${index + 1}: expected an object with a mapping object.`);
    }
    const nodes = Object.create(null);
    for (const [id, entry] of Object.entries(raw.mapping)) {
      if (!isObject(entry)) throw new Error(`Conversation ${index + 1}, node ${id}: expected an object.`);
      let parent = entry.parent ?? null;
      if (parent !== null && typeof parent !== 'string') {
        warn(index, id, 'invalid-parent', 'Non-string parent replaced with a root.');
        parent = null;
      }
      const message = entry.message;
      let role = 'structural', text = '', kind = 'null';
      if (message !== null && message !== undefined) {
        if (!isObject(message)) {
          warn(index, id, 'invalid-message', 'Message is not an object; displayed as unsupported.');
          text = '[Unsupported message]'; kind = 'unsupported';
        } else {
          role = typeof message.author?.role === 'string' ? message.author.role : 'unknown';
          const content = message.content;
          kind = typeof content?.content_type === 'string' ? content.content_type : 'unknown';
          if (isObject(content) && (kind === 'text' || kind === 'multimodal_text') && Array.isArray(content.parts)) {
            text = content.parts.map((part) => {
              if (typeof part === 'string') return part;
              warn(index, id, 'unsupported-part', 'Non-text content part replaced with a placeholder.');
              return '[Unsupported non-text content]';
            }).join('\n');
          } else {
            warn(index, id, 'unsupported-content', `Unsupported content type: ${kind}.`);
            text = `[Unsupported content: ${kind}]`;
          }
        }
      }
      nodes[id] = { id, parent, children: [], role, text, kind };
    }
    for (const node of Object.values(nodes)) {
      if (node.parent !== null && !Object.hasOwn(nodes, node.parent)) {
        warn(index, node.id, 'missing-parent', `Parent ${node.parent} is absent; node promoted to root.`);
        node.parent = null;
      }
    }
    // Iterative traversal avoids stack overflow on deeply nested or cyclic exports.
    const done = new Set();
    for (const start of Object.keys(nodes)) {
      const visiting = new Set();
      let id = start;
      while (id !== null && !done.has(id)) {
        if (visiting.has(id)) {
          warn(index, id, 'cycle', 'Parent cycle broken here; node promoted to root.');
          nodes[id].parent = null;
          break;
        }
        visiting.add(id);
        id = nodes[id].parent;
      }
      for (const visited of visiting) done.add(visited);
    }
    const roots = [];
    for (const node of Object.values(nodes)) {
      if (node.parent === null) roots.push(node.id);
      else nodes[node.parent].children.push(node.id);
    }
    for (const [id, entry] of Object.entries(raw.mapping)) {
      if (entry.children !== undefined) {
        const expected = nodes[id].children;
        const expectedSet = new Set(expected);
        if (!Array.isArray(entry.children) || entry.children.length !== expected.length ||
            new Set(entry.children).size !== expected.length || entry.children.some(child => !expectedSet.has(child))) {
          warn(index, id, 'children-mismatch', 'Declared children disagree with repaired parent links; parent links used.');
        }
      }
    }
    let current = typeof raw.current_node === 'string' && Object.hasOwn(nodes, raw.current_node) ? raw.current_node : null;
    if (raw.current_node != null && current === null) warn(index, null, 'missing-current', 'Current node is absent; first leaf selected.');
    current ??= Object.values(nodes).find(node => node.children.length === 0)?.id ?? null;
    return { id: typeof raw.id === 'string' ? raw.id : `conversation-${index + 1}`, title: typeof raw.title === 'string' ? raw.title : `Untitled conversation ${index + 1}`, nodes, roots, current };
  });
  return { conversations, diagnostics };
}
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
