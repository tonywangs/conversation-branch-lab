// Shared verbatim by Node and the offline report. No filesystem or DOM dependencies.
export function selectPaths(conversation, endpoints) {
  if (!Array.isArray(endpoints) || endpoints.length < 1 || endpoints.length > 2) throw new Error('Select one or two endpoints.');
  const paths = endpoints.map(endpoint => {
    if (typeof endpoint !== 'string' || !Object.hasOwn(conversation.nodes, endpoint)) throw new Error('Endpoint not found in selected conversation.');
    const path = [], seen = new Set();
    for (let id = endpoint; id !== null; id = conversation.nodes[id].parent) {
      if (!Object.hasOwn(conversation.nodes, id) || seen.has(id)) throw new Error('Invalid normalized parent graph.');
      seen.add(id); path.push(id);
    }
    return path.reverse();
  });
  let shared = 0;
  if (paths.length === 2) while (shared < Math.min(paths[0].length, paths[1].length) && paths[0][shared] === paths[1][shared]) shared++;
  return paths.length === 1 ? { path: paths[0] } : { shared: paths[0].slice(0, shared), a: paths[0].slice(shared), b: paths[1].slice(shared) };
}
export async function sha256(text) {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
export const serializeSidecar = value => JSON.stringify(value, null, 2) + '\n';
// Fence all user-controlled strings: Markdown remains readable, with no active HTML,
// links, images, or accidental fence closure in a Markdown renderer.
function literal(text) {
  let longest = 2;
  for (const match of text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  const fence = '`'.repeat(longest + 1);
  return `${fence}text\n${text}${text.endsWith('\n') ? '' : '\n'}${fence}\n`;
}
export async function exportSelection(data, conversationIndex, endpoints) {
  if (!Number.isInteger(conversationIndex) || !data.conversations[conversationIndex]) throw new Error('Conversation not found.');
  const conversation = data.conversations[conversationIndex];
  const paths = selectPaths(conversation, endpoints);
  const ids = Object.values(paths).flat(), selected = new Set(ids);
  const omissions = [{ code: 'unselected-content', detail: 'Only selected paths are included; other branches and conversations are excluded.' },
    { code: 'unexported-fields', detail: 'Only documented normalized fields are included. Other source fields and attachment bytes are not exported or fetched.' }];
  const included = ids.map(id => {
    const node = conversation.nodes[id];
    for (const code of node.omissions ?? []) omissions.push({ nodeId: id, code });
    return { nodeId: id, role: node.role, kind: node.kind, timestamp: node.timestamp ?? null, structural: node.structural ?? node.kind === 'null' };
  });
  // Diagnostic details may mention excluded node IDs/payloads. Export only codes
  // associated with selected nodes, never the archive-wide diagnostic strings.
  for (const d of data.diagnostics) if (d.conversation === conversationIndex && selected.has(d.node)) omissions.push({ nodeId: d.node, code: d.code });
  let markdown = '# Conversation branch export\n\n' + literal(conversation.title) + '\n';
  markdown += 'Selected content is not anonymized. Other paths, undocumented fields, and unavailable attachments are omitted. Message bodies are literal text; embedded Markdown and code fences are preserved inside text fences.\n\n';
  for (const [section, nodes] of Object.entries(paths)) {
    markdown += `## ${{path:'Selected path', shared:'Shared context', a:'Branch A', b:'Branch B'}[section]}\n\n`;
    if (!nodes.length) markdown += '_No nodes in this section._\n\n';
    for (const id of nodes) {
      const n = conversation.nodes[id];
      markdown += '### Node\n\n' + literal(`ID: ${JSON.stringify(id)}\nRole: ${JSON.stringify(n.role)}\nTimestamp (Unix seconds): ${n.timestamp ?? 'unavailable'}\nContent type: ${JSON.stringify(n.kind)}`) + '\n';
      markdown += (n.structural ?? n.kind === 'null') ? '_Structural node; no message._\n\n' : n.text === '' ? '_Empty message._\n\n' : literal(n.text) + '\n';
    }
  }
  markdown += '## Omissions and normalization\n\n' + literal(JSON.stringify(omissions, null, 2));
  const metadata = {
    format: 'conversation-branch-lab.selection', version: 1,
    conversation: { id: conversation.id, title: conversation.title },
    provenance: conversation.provenance ?? null,
    settings: { mode: endpoints.length === 1 ? 'path' : 'comparison', endpoints: [...endpoints], body: 'literal-fenced-text', timestamps: 'unix-seconds-or-null', graph: 'normalized-parent-links' },
    paths, included, omissions,
    artifacts: { markdown: { sha256: await sha256(markdown), bytes: new TextEncoder().encode(markdown).length }, sidecar: { sha256: null, hashBasis: 'UTF-8 sidecar with artifacts.sidecar.sha256 set to null' } }
  };
  metadata.artifacts.sidecar.sha256 = await sha256(serializeSidecar(metadata));
  return { markdown, sidecar: serializeSidecar(metadata) };
}
