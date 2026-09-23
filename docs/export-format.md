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
- Mapping keys are the authoritative node IDs. An embedded node `id` or message `id` is ignored. Empty strings, `__proto__`, and `constructor` work as IDs. The import layer deduplicates identical whole records and rejects conflicting string conversation IDs, including within one file. The low-level `parseExport` helper alone retains all input records; the CLI uses `importExports`.
- Missing or non-string titles receive a fallback. Missing or non-string conversation IDs receive a generated ID. These optional display-field fallbacks are not diagnostics.
- `parent` is a string node ID or null. An absent parent means root. Parent links determine the tree; `children` is optional and only checked for consistency. Siblings follow mapping enumeration order (including JavaScript's ordering of integer-like keys).
- Null or absent `message` is a visible structural node. Other messages should have an object `author` with a string `role`, and an object `content`. Missing/non-string roles display as `unknown`; arbitrary string roles remain literal text.
- `content_type` values `text` and `multimodal_text` support an array `parts`. String parts are joined with newlines, including empty strings. Non-string parts become `[Unsupported non-text content]`. Other content types become `[Unsupported content: TYPE]`; raw unsupported payloads and attachment bytes are not embedded.
- A valid `current_node` is initially selected, even if it is not a leaf. Otherwise the first leaf is selected. A conversation with no nodes has no selection.

## Diagnostics

Diagnostics carry a zero-based conversation index in the parsed model; the CLI and browser show one-based conversation numbers. They also carry a node ID when applicable, a code, and a detail string. The multi-file import layer adds the original source filename and record position, and remaps the conversation index after deduplication.

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

## Selected Markdown export, version 1

`--markdown --conversation-index N --endpoint ID [--endpoint ID]` selects a
zero-based conversation in the deduplicated import order. Endpoint values are exact
strings (including empty strings and values beginning with `-`); quote them for your
shell. The immediately following argument is always consumed as the endpoint.
One endpoint exports its complete normalized root-to-node path, including the endpoint.
Two endpoints export shared context once, then A and B suffixes in that order. Selection
is by node identity, not text equality. Ancestor endpoints, identical endpoints and
separate roots are valid. Empty conversations and missing endpoints fail without
writing artifacts. An explicit conversation index avoids ambiguous generated IDs.

The browser's **Prepare selected path** and **Prepare comparison A/B** use the same
module as the CLI, independently of visible pages. Preparation creates two keyboard
accessible download links and moves focus to the Markdown link. Download each file.
Changing selections removes stale links; an asynchronous preparation for an old
selection cannot replace current downloads. Nothing is uploaded or fetched.

### Text and omissions

The document has fixed headings, a literal conversation title, and one entry per
selected node. Structural nodes and empty messages have distinct explicit markers.
All roles, including system, developer, tool and unknown/custom roles, are retained.
Messages flagged hidden in source metadata are still included when on a selected
path; this is an ancestry export, not a recreation of ChatGPT visibility filters.
Only finite numeric message `create_time` values are retained, as Unix seconds without
rounding or timezone conversion; missing/invalid values are null in JSON and
`unavailable` in Markdown. Invalid non-null values get an omission code.

String parts are joined with LF, with their Unicode, internal newlines, Markdown and
code blocks preserved. Each body is wrapped in a `text` fence longer than every
backtick run in the body. One boundary newline is added if needed. This deliberately
shows embedded Markdown literally: it does not activate source HTML, links or remote
images. Empty text remains distinguishable from a structural node. The format does
not reconstruct attachments, execute tools or infer missing text. Non-string parts
and unsupported content use the parser's explicit placeholders. Attachment metadata
gets an `unavailable-attachments` code; non-text parts get `unsupported-part`. Most
other metadata is excluded, with a general notice and, when present, a
`message-metadata` code. The sidecar is not a lossless copy of the source record.

Both artifacts state that unselected paths and undocumented fields are excluded.
They never list excluded node IDs, titles, filenames, attachment names or payloads.
Only selected-node diagnostic codes are retained: their original detail strings
could disclose excluded IDs. Parent repairs are therefore visible without copying
archive-wide diagnostics. `--strict` still checks the entire import, and stderr and
the full HTML report still contain archive-wide diagnostics. Only the downloaded
selection artifacts have this narrower boundary.

**Selection does not anonymize included content.** Included text, conversation title,
IDs, roles and timestamps can be identifying. Source/record hashes can link exports
from the same archive. The full HTML report contains all imported conversations.

### JSON sidecar and determinism

`-o selection.md` writes `selection.md` and `selection.md.json`. Browser downloads use
these fixed names. Sidecar `format` is `conversation-branch-lab.selection`, `version`
is `1`. It records conversation ID/title, source and canonical record SHA-256,
zero-based source record index, settings, ordered section paths, ordered included
node/message descriptors (including structural nodes), omissions and artifact hashes.
Shared messages occur once in `included`; order is path, or shared/A/B.

The source hash covers original file bytes, including BOM/whitespace; source filenames
are excluded. The canonical record hash uses the import duplicate comparison:
recursively sorted object keys, array order retained, JavaScript JSON serialization.
Only the first retained source is recorded for a deduplicated conversation. When
calling `importExports` directly without a byte digest, the hash instead covers
UTF-8 `JSON.stringify(input)`, explicitly labeled in `sourceHashBasis`. CLI and its
HTML reports always use the original byte digest.

Markdown hashes cover exact UTF-8 bytes. The sidecar's hash covers UTF-8 serialization
with **only `artifacts.sidecar.sha256` replaced with null**, preventing self-reference.
To verify, parse JSON, save that hash, replace the field with null, serialize using
`JSON.stringify(value, null, 2) + '\n'`, and compute SHA-256. It is a normalized
self-hash, not a hash of the final sidecar bytes. These hashes detect mismatch; they
are not signatures or proof of authenticity. JSON formatting, field insertion order,
LF separators, fixed settings and absence of export-clock timestamps make both
artifacts deterministic across Node and Chromium for identical inputs/selections.

Both output paths are checked before writing. Existing files require `--force`;
input aliases are protected for both outputs. Each forced file replacement is atomic,
but the pair is **not a filesystem transaction**: interruption or an I/O failure can
leave an incomplete/mismatched pair. Re-run with `--force` and verify hashes. The
browser similarly requires two separate downloads. Export holds the selected artifacts
in memory; import limits still apply to the entire source. No streaming is promised.
