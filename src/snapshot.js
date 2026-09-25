import { createHash } from 'node:crypto';
export const SNAPSHOT_LIMITS = Object.freeze({ bytes: 128 * 1024 * 1024, files: 64, conversations: 10000, nodes: 250000, depth: 64, findings: 1000000, artifactBytes: 64 * 1024 * 1024 });
export const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (object(v)) return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
  return v;
}
export const encode = v => JSON.stringify(canonical(v));
const equal = (a, b) => encode(a) === encode(b);
const field = (o, k) => Object.hasOwn(o, k) ? { present: true, value: o[k] } : { present: false };
const omit = (o, keys) => Object.fromEntries(Object.entries(o).filter(([key]) => !keys.includes(key)));
const sorted = iterable => [...iterable].sort();
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function snapshot(sources, side, limits, limitations) {
  const records = new Map(); let count = 0, nodes = 0;
  const warn = (conversation, node, code) => limitations.push({ side, conversation, node, code });
  for (const source of sources) {
    if (!Array.isArray(source.input)) throw new Error(`${side}: expected a JSON array of conversations.`);
    for (const raw of source.input) {
      if (++count > limits.conversations) throw new Error(`${side}: conversation limit ${limits.conversations} exceeded.`);
      if (!object(raw) || typeof raw.id !== 'string') throw new Error(`${side}: every conversation requires a string id; positional matching is forbidden.`);
      if (records.has(raw.id)) throw new Error(`${side}: duplicate conversation id ${JSON.stringify(raw.id)} (including identical records).`);
      if (!object(raw.mapping)) throw new Error(`${side}: conversation ${JSON.stringify(raw.id)} requires a mapping object.`);
      const mapping = new Map(Object.entries(raw.mapping));
      nodes += mapping.size;
      if (nodes > limits.nodes) throw new Error(`${side}: node limit ${limits.nodes} exceeded.`);
      const messageIds = new Set(), children = new Map([...mapping.keys()].map(k => [k, new Set()]));
      for (const [id, entry] of mapping) {
        if (!object(entry)) throw new Error(`${side}: node ${JSON.stringify(id)} requires an object.`);
        if (Object.hasOwn(entry, 'id') && entry.id !== id) throw new Error(`${side}: node id disagrees with mapping key ${JSON.stringify(id)}.`);
        if (!Object.hasOwn(entry, 'parent') || (entry.parent !== null && typeof entry.parent !== 'string')) warn(raw.id, id, 'invalid-parent');
        else if (entry.parent !== null) {
          if (!mapping.has(entry.parent)) warn(raw.id, id, 'missing-parent');
          else children.get(entry.parent).add(id);
        }
        const message = entry.message;
        if (message === null || message === undefined) continue;
        if (!object(message)) { warn(raw.id, id, 'invalid-message'); continue; }
        if (typeof message.id === 'string') {
          if (messageIds.has(message.id)) warn(raw.id, null, 'duplicate-message-id');
          messageIds.add(message.id);
        }
        const content = message.content;
        if (!object(content) || !['text', 'multimodal_text'].includes(content.content_type) || !Array.isArray(content.parts) || content.parts.some(p => typeof p !== 'string') || Object.keys(content).some(k => !['content_type', 'parts'].includes(k))) warn(raw.id, id, 'unsupported-content');
        if (message.metadata?.attachments != null && (!Array.isArray(message.metadata.attachments) || message.metadata.attachments.length)) warn(raw.id, id, 'unavailable-attachments');
        for (const key of ['create_time', 'update_time']) if (message[key] != null && (typeof message[key] !== 'number' || !Number.isFinite(message[key]))) warn(raw.id, id, `invalid-${key}`);
      }
      for (const key of ['create_time', 'update_time']) if (raw[key] != null && (typeof raw[key] !== 'number' || !Number.isFinite(raw[key]))) warn(raw.id, null, `invalid-${key}`);
      for (const [id, entry] of mapping) {
        if (Object.hasOwn(entry, 'children')) {
          const declared = entry.children, expected = children.get(id);
          if (!Array.isArray(declared) || declared.length !== expected.size || new Set(declared).size !== declared.length || declared.some(k => !expected.has(k))) warn(raw.id, id, 'children-mismatch');
        }
      }
      // Validate the full graph in linear time, including disconnected cycles.
      const done = new Set();
      for (const start of sorted(mapping.keys())) {
        const visiting = new Set(); let id = start;
        while (typeof id === 'string' && mapping.has(id) && !done.has(id)) {
          if (visiting.has(id)) { warn(raw.id, id, 'cycle'); break; }
          visiting.add(id); id = mapping.get(id).parent;
        }
        for (const id of visiting) done.add(id);
      }
      const path = [], seen = new Set(); let current = raw.current_node;
      let valid = current === null || (typeof current === 'string' && mapping.has(current));
      if (!valid) warn(raw.id, null, 'invalid-current');
      while (typeof current === 'string' && mapping.has(current) && !seen.has(current)) {
        seen.add(current); path.push(current); current = mapping.get(current).parent;
      }
      if (current !== null) valid = false;
      if (!valid && path.length) warn(raw.id, null, 'invalid-active-path');
      records.set(raw.id, { raw, mapping, active: { endpoint: field(raw, 'current_node'), valid, path: path.reverse() } });
    }
  }
  return { records, counts: { conversations: count, nodes } };
}
function content(entry) {
  if (!Object.hasOwn(entry, 'message')) return { state: 'missing' };
  if (entry.message === null) return { state: 'structural' };
  if (!object(entry.message)) return { state: 'invalid', value: entry.message };
  return { state: 'message', content: field(entry.message, 'content') };
}
function messageMetadata(entry) { return object(entry.message) ? omit(entry.message, ['content']) : {}; }
function nodeView(entry) {
  return { parent: field(entry, 'parent'), message: content(entry), messageMetadata: messageMetadata(entry), nodeMetadata: omit(entry, ['id', 'parent', 'children', 'message']) };
}
export function compareSnapshots(beforeSources, afterSources, limits = SNAPSHOT_LIMITS) {
  if (!beforeSources.length || !afterSources.length) throw new Error('Both snapshots require at least one source.');
  if (beforeSources.length + afterSources.length > limits.files) throw new Error(`Input file limit ${limits.files} exceeded.`);
  const limitations = [], findings = [];
  const before = snapshot(beforeSources, 'before', limits, limitations), after = snapshot(afterSources, 'after', limits, limitations);
  const add = (kind, conversation, node, a, b) => {
    if (findings.length >= limits.findings) throw new Error(`Finding limit ${limits.findings} exceeded; no complete comparison can be written.`);
    findings.push({ kind, conversation, node, before: a, after: b });
  };
  for (const id of sorted(new Set([...before.records.keys(), ...after.records.keys()]))) {
    const a = before.records.get(id), b = after.records.get(id);
    if (!a || !b) add(a ? 'conversation-only-before' : 'conversation-only-after', id, null,
      a ? { metadata: omit(a.raw, ['id', 'mapping', 'current_node']), active: a.active, nodes: a.mapping.size } : null,
      b ? { metadata: omit(b.raw, ['id', 'mapping', 'current_node']), active: b.active, nodes: b.mapping.size } : null);
    else {
      const am = omit(a.raw, ['id', 'mapping', 'current_node']), bm = omit(b.raw, ['id', 'mapping', 'current_node']);
      if (!equal(am, bm)) add('conversation-metadata', id, null, am, bm);
      if (!equal(a.active, b.active)) add('active-path', id, null, a.active, b.active);
    }
    for (const node of sorted(new Set([...(a?.mapping.keys() ?? []), ...(b?.mapping.keys() ?? [])]))) {
      const an = a?.mapping.get(node), bn = b?.mapping.get(node);
      if (!an || !bn) add(an ? 'node-only-before' : 'node-only-after', id, node, an ? nodeView(an) : null, bn ? nodeView(bn) : null);
      else {
        for (const [kind, av, bv] of [
          ['parent', field(an, 'parent'), field(bn, 'parent')],
          ['message-content', content(an), content(bn)],
          ['message-metadata', messageMetadata(an), messageMetadata(bn)],
          ['node-metadata', omit(an, ['id', 'parent', 'children', 'message']), omit(bn, ['id', 'parent', 'children', 'message'])]
        ]) if (!equal(av, bv)) add(kind, id, node, av, bv);
      }
    }
  }
  // Never locale-sort: semantics use UTF-16 code unit ordering in every environment.
  findings.sort((a, b) => {
    for (const key of ['conversation', 'node', 'kind']) {
      if (a[key] === b[key]) continue;
      if (a[key] === null) return -1; if (b[key] === null) return 1;
      return a[key] < b[key] ? -1 : 1;
    }
    return 0;
  });
  const uniqueLimitations = [...new Map(limitations.map(l => [encode(l), l])).values()].sort((a,b) => encode(a) < encode(b) ? -1 : encode(a) > encode(b) ? 1 : 0);
  const sources = list => list.map(s => ({ sha256: s.sha256 ?? sha256(encode(s.input)), hashBasis: s.sha256 ? 'file-bytes' : 'canonical-json-utf8' })).sort((a,b) => a.sha256 < b.sha256 ? -1 : a.sha256 > b.sha256 ? 1 : 0);
  return canonical({ format: 'conversation-snapshot-comparison', version: 1,
    settings: { conversationIdentity: 'id', nodeIdentity: 'mapping-key', ordering: 'UTF-16-code-units', parentAuthority: 'parent', ignoredFields: ['node.id (validated alias)', 'node.children (validated unordered derived set)'], limits },
    sources: { before: sources(beforeSources), after: sources(afterSources) },
    summary: { before: before.counts, after: after.counts, findings: findings.length, analysis: uniqueLimitations.length ? 'incomplete' : 'complete', equivalence: uniqueLimitations.length ? 'undetermined' : findings.length ? 'different' : 'equivalent-under-v1' },
    limitations: uniqueLimitations, findings });
}
