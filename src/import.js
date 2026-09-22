import { createHash } from 'node:crypto';
import { parseExport } from './parser.js';
export const LIMITS = { bytes: 128 * 1024 * 1024, conversations: 10000, nodes: 250000, files: 64 };
// JSON object key order is immaterial; array order and all field values are significant.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export function importExports(sources, limits = LIMITS) {
  const records = [], origins = [], seen = new Map();
  let nodes = 0, count = 0;
  if (sources.length > limits.files) throw new Error(`Input file limit ${limits.files} exceeded.`);
  for (const { source, input } of sources) {
    if (!Array.isArray(input)) throw new Error(`${source}: Export must be a JSON array of conversations.`);
    for (const [index, raw] of input.entries()) {
      const origin = `${source}: conversation ${index + 1}`;
      if (++count > limits.conversations) throw new Error(`${origin}: conversation limit ${limits.conversations} exceeded.`);
      nodes += raw?.mapping && typeof raw.mapping === 'object' ? Object.keys(raw.mapping).length : 0;
      if (nodes > limits.nodes) throw new Error(`${origin}: node limit ${limits.nodes} exceeded.`);
      let digest;
      try { digest = createHash('sha256').update(JSON.stringify(canonical(raw))).digest('hex'); }
      catch (error) { throw new Error(`${origin}: cannot canonicalize record: ${error.message}`); }
      const key = typeof raw?.id === 'string' ? `id:${raw.id}` : `content:${digest}`;
      const previous = seen.get(key);
      if (previous) {
        if (previous.digest !== digest) throw new Error(`${origin}: conflicting duplicate ID ${JSON.stringify(raw.id)}; first seen at ${previous.origin}.`);
        continue;
      }
      seen.set(key, { digest, origin });
      records.push(raw); origins.push(origin);
    }
  }
  // Parse individually so even fatal shape errors carry a source filename.
  const data = { conversations: [], diagnostics: [] };
  records.forEach((raw, index) => {
    let parsed;
    try { parsed = parseExport([raw]); } catch (error) { throw new Error(`${origins[index]}: ${error.message}`); }
    if (typeof raw.id !== 'string') parsed.conversations[0].id = `conversation-${index + 1}`;
    if (typeof raw.title !== 'string') parsed.conversations[0].title = `Untitled conversation ${index + 1}`;
    data.conversations.push(parsed.conversations[0]);
    for (const diagnostic of parsed.diagnostics) data.diagnostics.push({ ...diagnostic, conversation: index, source: origins[index] });
  });
  return data;
}
