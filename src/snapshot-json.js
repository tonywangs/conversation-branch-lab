// JSON.parse alone silently loses duplicate object keys. Validate tokens first.
export function parseSnapshotJSON(text, maxDepth = 64) {
  text = text.replace(/^\uFEFF/, '');
  let i = 0;
  const fail = detail => { throw new Error(`Snapshot JSON at offset ${i}: ${detail}`); };
  const space = () => { while (/^[\x20\t\r\n]$/.test(text[i] ?? '')) i++; };
  function string() {
    const start = i++;
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue; }
      if (text[i++] === '"') {
        try { return JSON.parse(text.slice(start, i)); } catch { fail('invalid string'); }
      }
    }
    fail('unterminated string');
  }
  function value(depth) {
    space();
    if (depth > maxDepth) fail(`nesting limit ${maxDepth} exceeded`);
    if (text[i] === '{' || text[i] === '[') {
      const object = text[i++] === '{', close = object ? '}' : ']', keys = new Set();
      space(); if (text[i] === close) { i++; return; }
      while (i < text.length) {
        if (object) {
          space(); if (text[i] !== '"') fail('expected object key');
          const key = string();
          if (keys.has(key)) fail(`duplicate object key ${JSON.stringify(key)}`);
          keys.add(key); space(); if (text[i++] !== ':') fail('expected colon');
        }
        value(depth + 1); space();
        if (text[i] === close) { i++; return; }
        if (text[i++] !== ',') fail('expected comma');
      }
      fail('unclosed container');
    }
    if (text[i] === '"') { string(); return; }
    const token = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(i));
    if (!token) fail('expected value');
    i += token[0].length;
    if (/^[-0-9]/.test(token[0])) {
      const number = Number(token[0]);
      if (!Number.isFinite(number) || (Number.isInteger(number) && !Number.isSafeInteger(number))) fail('number outside supported finite/safe-integer range');
    }
  }
  value(0); space(); if (i !== text.length) fail('trailing input');
  return JSON.parse(text);
}
