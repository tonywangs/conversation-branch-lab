# Offline snapshot comparison, version 1

Compare two snapshots of the mapping-based export format. A snapshot can consist
of one or several extracted JSON files, each an array of conversations. ZIPs,
directories, flat transcripts, and other export schemas are not accepted.

```sh
conversation-branch-lab --compare before.json after.json -o comparison.html
conversation-branch-lab --compare --before before-1.json --before before-2.json --after after.json -o comparison.html
```

This writes `comparison.html` and `comparison.html.json`. Open the HTML locally;
no server or external resources are needed. `--compare` must be the first option.
Use `--force` to replace existing outputs; use `./` for filenames beginning with
`-`. Sources are read only. Both output paths are checked against every input,
including inode aliases through symlinks and hard links. Forced writes replace
each output atomically without following output symlinks. The pair is **not an
atomic transaction**: a disk or permission failure during the second write can
leave the first artifact. Output directories must exist. POSIX outputs use 0600.

Exit codes: **0** means complete analysis, whether differences exist or not;
**2** means artifacts were written with incomplete analysis; **1** means failure.
`--strict` converts any analysis limitation into a failure before writing either
artifact. Identity ambiguity, invalid JSON, invalid shapes and resource limits
always fail. Do not interpret exit 0 as equality; inspect `summary.equivalence`.

## Identity and matching

- Conversations match by exact string `id`, across all files in each snapshot.
  Missing/non-string IDs and all duplicates, even identical copies, fail.
  No positional, title, message-text or timestamp fallback is used. This is
  deliberately stricter than the existing browsing importer, which deduplicates.
- Nodes match by the exact mapping key **within a matched conversation**. A node
  without an `id` property is valid: the key is its identity. If `node.id` is
  present, it must equal the key; disagreement fails. Empty strings, prototype
  names, numeric-looking strings, and unusual Unicode are valid identities.
- `message.id` is metadata, not the node identity. Duplicate string message IDs
  within a conversation cause an incomplete-analysis limitation. They do not
  merge nodes or conversations.
- The CLI rejects duplicate JSON object keys anywhere, including escaped aliases
  such as `id` and `\u0069d`, before JSON.parse can silently discard a value.
  Invalid UTF-8 is rejected. An initial UTF-8 BOM is accepted.

Only-before/only-after findings describe **presence**, not a deletion event,
creation event, or chronology. A snapshot may be partial, filtered, or older than
its filename suggests. The caller assigns “before” and “after”; timestamps do not
reorder them. Different IDs with identical text remain different records.

## Compared fields and findings

| Finding | Compared values |
| --- | --- |
| `conversation-only-before/after` | Supported metadata, node count and active path of the present conversation |
| `node-only-before/after` | Parent, message content/state, message metadata and node metadata; emitted even for one-sided conversations |
| `conversation-metadata` | Every conversation field except `id`, `mapping`, `current_node` |
| `active-path` | Presence/value of `current_node`, validity, and root-to-endpoint sequence of mapping keys |
| `parent` | Presence and exact raw value of the parent field |
| `message-content` | Missing message, structural null, invalid message, or message content with field presence |
| `message-metadata` | Every message field except `content`, including author/role/name, IDs, timestamps and metadata |
| `node-metadata` | Every node field except `id`, `parent`, `children`, `message` |

Missing and null are distinct. A null message is structural; it participates in
identity, parent/path comparison and presence findings. A missing message is also
non-textual but is recorded as a distinct state. Tool messages follow the same
rules as other roles; text-format tool responses are analyzed, and their author,
recipient and other fields are compared as metadata. Metadata comparison means
exact JSON structure/value comparison, not interpretation of vendor-specific
fields. Unknown conversation, node and message fields are included as metadata.

Supported content has type `text` or `multimodal_text`, an ordered `parts` array
containing only strings, and no additional content properties. Content type,
part boundaries, whitespace, newlines, code, and empty text are significant.
`["a", "b"]` differs from `["a\nb"]`. Unicode is compared as decoded JavaScript
UTF-16 strings without normalization, case folding or locale rules. Escaping
style in source JSON is not significant. Lone escaped surrogates are preserved in
JSON (a browser may display a replacement glyph).

All other content is compared as opaque JSON and causes `unsupported-content`,
even if equal in both files. Invalid messages and unavailable attachments also
cause limitations. Images/audio/video/assets are never fetched or interpreted.
An unchanged opaque payload therefore cannot establish equivalence. This tool
compares the supplied representation, not external file contents or truthfulness.

Timestamps are compared as supplied numeric values, without rounding to dates or
timezone conversion. Non-null nonnumeric `create_time` / `update_time` fields on
messages and conversations cause limitations. JSON numbers use IEEE-754 binary64
semantics; lexical differences such as `1`, `1.0`, `1e0`, and signed zero are not
changes. Non-finite numbers and integers outside JavaScript's safe integer range
are rejected by the CLI. Fractional decimal values have ordinary binary64 rounding.

## Branches and malformed references

Raw parent links are authoritative and **are not repaired** for comparison.
A parent change is reported even when both values are malformed. Missing parents,
invalid/missing parent fields and cycles anywhere in the graph cause limitations.
Graph validation and path walking are iterative, including deep chains. Findings
never depend on whichever cycle edge a browsing importer might repair.

The current endpoint is explicit: null means no active path; a missing field or
non-null endpoint not present in the mapping causes a limitation. There is no
fallback to a leaf. Active paths include structural nodes. A changed ancestor
relationship on the active path produces an `active-path` finding even if the
endpoint remains the same. An invalid path records the traversable portion and
`valid: false`; it is not presented as a complete branch. Branch alternatives
are represented by node presence and parent changes, with endpoint/path changes
reported separately.

`node.id` is an ignored redundant alias after validation. `node.children` is an
ignored derived set **after checking consistency with parent links**. Ordering of
that array is irrelevant; duplicate/missing/extra/non-string children or a wrong
shape cause limitations. Omission of the entire derived field is allowed. No
other data fields are ignored. Conversation array order, mapping order and JSON
object key order do not change findings. All other array orders matter.

## Deterministic JSON and report

The JSON has format `conversation-snapshot-comparison`, `version: 1`, comparison
settings/limits, source hashes, counts, findings and limitations. Findings sort by
conversation ID, node ID (null sorts before all strings), then kind, using UTF-16
code units. Limitations are deduplicated and sorted by their canonical encoding.
Object keys are inserted in sorted order; JavaScript enumerates integer-like keys
numerically. No locale, wall-clock time, source filenames or absolute paths enter
the artifacts. Same file bytes and program version produce byte-identical output.

Each source gets SHA-256 over its **original file bytes**, including BOM/whitespace;
hash lists are sorted within each side. Reordering files does not change output.
Reformatting, reordering records inside a file, or changing file boundaries changes
provenance hashes even when findings stay identical. The in-process helper used
by unit tests can instead hash canonical JSON and labels that hash basis; CLI
outputs always use `file-bytes`.

`summary.analysis` is `complete` or `incomplete`. Equivalence is
`equivalent-under-v1`, `different`, or `undetermined`. Any limitation makes it
undetermined, even if known differences also exist. Zero findings with incomplete
analysis is **not** equivalence. “Equivalent” means equality under these versioned
semantics, not byte identity, factual correctness or complete media equivalence.

HTML embeds the same data, with a restrictive CSP and text-only rendering. Type,
exact conversation ID (including an empty ID), and case-insensitive literal text
filters combine. Search scans full JSON-encoded findings, including values outside
visible pages; escaped quotation marks/newlines appear in that representation.
Native inputs, buttons, labels, headings, a skip link and live pagination status
support keyboard navigation. Before/after values are formatted JSON, preserving
part boundaries and metadata. These are snapshot field views, not word-level
diffs. Input content never becomes HTML, links or executable code.

## Resource limits

| Resource | Limit / outcome |
| --- | --- |
| Input bytes | 128 MiB combined across both sides; failure |
| Input files | 64 combined; failure |
| Conversation records | 10,000 per snapshot; failure |
| Mapping nodes | 250,000 per snapshot; failure |
| JSON nesting | Maximum value depth 64, root at zero; failure |
| Findings | 1,000,000; failure |
| Each output artifact | 64 MiB UTF-8, checked before any output is opened; failure |
| Findings and limitations in DOM | 50 of each per page |
| Message elements | At most 100 (two per finding); existing explorer remains below 500 |
| Displayed field length | First 12,000 UTF-16 units plus explicit truncation notice; complete JSON retained |

Limits are fixed CLI safety boundaries, not guaranteed performance targets. Input,
findings and HTML are memory-resident. Large text can still be expensive to parse,
serialize or filter; report limits are enforced after building the corresponding
in-memory string. Search runs synchronously. Browser printing includes only the
current pages and displayed value portions; use JSON for all findings and values.
The browser itself, extensions and the local filesystem are outside the privacy
boundary. Reports and companion JSON may contain sensitive source metadata.

## Reproduction and existing work

With development dependencies and Playwright Chromium installed, one command
runs unit/CLI/oracle checks, both browser suites, offline isolated installation,
existing large-fixture regressions, and paired-snapshot measurements:

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/conversation-playwright VERIFY_INSTALL_BROWSER=1 npm run verify
```

Use `npm ci` and `PLAYWRIGHT_BROWSERS_PATH=/tmp/conversation-playwright npx playwright install chromium`
for one-time setup. These setup operations may download packages; runtime
comparisons never do. Tests use offline browser contexts and intercept HTTP(S).
The installed CLI check uses an offline npm tarball installation, no runtime
packages and synthetic data, from outside the checkout.

The 250-seed mutation-ledger test constructs disjoint known changes and checks all
finding identities, with an independent parent-pointer walk for active paths.
Other checks cover unchanged/reordered input, ambiguity, malformed references,
unsupported payloads, unusual IDs, safe HTML without CSP, depth/count/byte limits,
long display values and 20,000-node parent chains. Large fixtures derive from seed
20260925 and use unchanged, sparse and dense mutation cases on pairs of
50,000-message archives and 5,000-node conversations. Actual measurements and input
hashes are in [snapshot-performance.json](../results/snapshot-performance.json).
These are single-run synthetic observations, not statistical benchmarks. The old
explorer's measurements remain in [performance.json](../results/performance.json).

Primary implementation documentation reviewed for this milestone:
[jsondiffpatch](https://github.com/benjamine/jsondiffpatch) provides object/array
diffs, configurable object identity and HTML formatters;
[ChatGPT JSON Tree Viewer](https://github.com/akivacp/chatgpt-json-tree-viewer)
provides offline tree exploration. These are established capabilities; no novelty
claim is made. This implementation targets explicit export identity, graph changes,
incomplete-analysis accounting, and deterministic dependency-free CLI artifacts.

Tony's actual exports, Node.js 22, other browser engines and assistive-technology
sessions remain unverified. Synthetic Chromium keyboard checks are not a full
accessibility audit. No paid data, inference, GPU or personal-account access is
required or used.
