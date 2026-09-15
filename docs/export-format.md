# Export format and recovery rules

This documents the implemented subset of an observed export format, not an official schema contract. The parser is `src/parser.js` and the executable examples are in `fixtures/synthetic-conversations.json` and `test/parser.test.js`.

## Minimal input

```json
[
  {
    "id": "synthetic-example",
    "title": "Synthetic example",
    "current_node": "reply-b",
    "mapping": {
      "root": {"parent": null, "message": null, "children": ["question"]},
      "question": {
        "parent": "root",
        "children": ["reply-a", "reply-b"],
        "message": {"author": {"role": "user"}, "content": {"content_type": "text", "parts": ["Choose a color."]}}
      },
      "reply-a": {
        "parent": "question",
        "message": {"author": {"role": "assistant"}, "content": {"content_type": "text", "parts": ["Green."]}}
      },
      "reply-b": {
        "parent": "question",
        "message": {"author": {"role": "assistant"}, "content": {"content_type": "text", "parts": ["Blue."]}}
      }
    }
  }
]
```

## Normalization

- The top level must be an array. Each entry must be an object with an object-valued `mapping`; every mapping value must be a node object. Failure rejects the entire conversion. Empty arrays and empty mappings are valid and receive empty-state UI.
- Mapping keys are the authoritative node IDs. An embedded node `id` or message `id` is ignored. Empty strings, `__proto__`, and `constructor` work as IDs. Conversations are selected by their array index, so duplicate conversation IDs do not collapse records.
- Missing or non-string titles receive a fallback. Missing or non-string conversation IDs receive a generated ID. These optional display-field fallbacks are not diagnostics.
- `parent` is a string node ID or null. An absent parent means root. Parent links determine the tree; `children` is optional and only checked for consistency. Siblings follow mapping enumeration order (including JavaScript's ordering of integer-like keys).
- Null or absent `message` is a visible structural node. Other messages should have an object `author` with a string `role`, and an object `content`. Missing/non-string roles display as `unknown`; arbitrary string roles remain literal text.
- `content_type` values `text` and `multimodal_text` support an array `parts`. String parts are joined with newlines, including empty strings. Non-string parts become `[Unsupported non-text content]`. Other content types become `[Unsupported content: TYPE]`; raw unsupported payloads and attachment bytes are not embedded.
- A valid `current_node` is initially selected, even if it is not a leaf. Otherwise the first leaf is selected. A conversation with no nodes has no selection.

## Diagnostics

Diagnostics carry a zero-based conversation index in the parsed model; the CLI and browser show one-based conversation numbers. They also carry a node ID when applicable, a code, and a detail string.

| Code | Recovery |
| --- | --- |
| `invalid-parent` | Non-string/non-null parent is replaced with null. |
| `missing-parent` | Node referencing an absent parent is promoted to a root. |
| `cycle` | Iterative parent traversal breaks one edge per cycle by promoting the revisited node to a root. The break depends on mapping enumeration order. No nodes are discarded. |
| `children-mismatch` | Non-array, duplicate, missing, or extra declared children are ignored in favor of repaired parent links. This can also arise after breaking a cycle. |
| `invalid-message` | Non-object message becomes an unsupported-message placeholder. |
| `unsupported-content` | Missing/malformed content or an unsupported content type becomes a placeholder. |
| `unsupported-part` | Each non-string part becomes a placeholder; supported string parts are retained. |
| `missing-current` | Supplied current node is not a known string key; first leaf is selected. |

Ordinary mode includes these diagnostics in the report. `--strict` rejects all of them, including unsupported media. Repairs describe the graph that can be recovered from the supplied data; they do not reconstruct missing messages or infer the author's intended branch.

## Rendering boundary

The converter serializes normalized data into an inert JSON script element, escaping `<`, `>`, and `&` so message text cannot close the element. Browser code constructs elements and assigns untrusted text through `textContent`, never `innerHTML`. The content security policy permits only the bundled application script's SHA-256 hash, permits inline styling, and disallows network connections, images, base URLs, and forms. No source export text is interpolated into executable JavaScript, CSS, or event handlers.
