// Seeded LCG: no external data or dependencies. Fixtures are generated, never tracked.
export function archives(seed = 20260922) {
  let state = seed >>> 0;
  const random = () => ((state = (Math.imul(1664525, state) + 1013904223) >>> 0) / 2 ** 32);
  function conversation(id, count, deep = false) {
    const mapping = {};
    for (let i = 0; i < count; i++) {
      const parent = i === 0 ? null : `n${deep ? (i < 4500 ? i - 1 : Math.floor(random() * 4500)) : Math.floor(random() * i)}`;
      mapping[`n${i}`] = { parent, message: { author: { role: i % 2 ? 'assistant' : 'user' }, content: { content_type: 'text', parts: [`${id} message ${i} token${Math.floor(random() * 32)} café こんにちは 🌍`] } } };
    }
    return { id, title: `Synthetic ${id}`, current_node: `n${count - 1}`, mapping };
  }
  return { wide: Array.from({ length: 1000 }, (_, i) => conversation(`c${i}`, 50)), deep: [conversation('deep', 5000, true)] };
}
