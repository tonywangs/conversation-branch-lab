# Conversation Branch Lab

Convert a mapping-based ChatGPT `conversations.json` export into a **single, offline HTML file** for exploring alternative replies. Select conversations, follow any node's path, search message text across the export, and compare two endpoints with their shared context shown once.

The CLI uses only Node.js built-ins. The generated report needs a browser with JavaScript enabled, but no server, network, account, inference API, or GPU. All supplied conversations are **synthetic**, including the deliberately malformed and hostile-markup examples.

## Install and run

Requires **Node.js 22 or later** and npm. From this private checkout:

```sh
npm install --global . --omit=dev --ignore-scripts
conversation-branch-lab /path/to/conversations.json /path/to/more.json -o /path/to/report.html
```

Alternatively, run directly without installing anything:

```sh
node src/cli.js /path/to/conversations.json -o /path/to/report.html
```

To install a standalone package that does not depend on retaining this checkout, run `npm pack`, then `npm install --global ./conversation-branch-lab-0.1.0.tgz --omit=dev --ignore-scripts`. The package is marked private to prevent accidental registry publication.

Open `report.html` in your browser using its file menu or by double-clicking it. The input must be extracted JSON, not a ZIP archive. Quote paths containing spaces. Output defaults to `report.html` in the current directory; its parent directory must already exist.

Existing output files are protected. Use `--force` to replace a report. Input and output cannot refer to the same file, including through a symlink or hard link. A forced replacement is atomic and does not write through an output symlink. New reports use owner-only file permissions on POSIX systems.

```sh
conversation-branch-lab conversations.json -o report.html --force
conversation-branch-lab conversations.json -o report.html --strict
conversation-branch-lab --help
```

`--strict` fails on any diagnostic and writes no report. Ordinary mode repairs malformed links and displays diagnostics both on stderr and inside the report. Invalid JSON or invalid conversation/mapping/node shapes always exit with code 1. A successful conversion exits with code 0, even when recovery diagnostics are present.

## Multiple files and large reports

Files are imported in command-line order; conversations retain array order. Identical records are retained once, at their first occurrence. Equality compares the entire JSON record with object keys sorted; arrays remain ordered. Records with the same string ID but different content fail with both filenames and record positions. Without a string ID, only identical whole records deduplicate. Re-exported records with changed metadata count as conflicts, even if their displayed text is unchanged. No version is silently preferred. Single-file input follows the same duplicate policy.

Conversation selectors and the branch tree show 100 entries per page. Use **Previous/Next conversations** or tree **Previous/Next** to reach more. Each path and comparison panel shows at most 100 message cards, initially the last page; **Previous** reveals earlier context. The four message panels therefore render at most 400 cards in total. Diagnostics are also paged. Search always scans the whole archive and clicking a result opens its conversation and matching node, even outside the visible pages.

Endpoint dropdowns contain the first 100 nodes plus selected endpoints. To compare any other node, select it in the paged tree, find it through search, or enter its exact ID in **Go to node ID**, then use **Use selected as A/B**. Buttons, selectors, and the node-ID form support keyboard access. Native Enter submits the node-ID form locally. Paging bounds element counts, not the length of one message or total browser memory. Browser printing includes only the currently rendered pages; keep the HTML report to retain the whole archive.

## Reproducible demonstration

```sh
node src/cli.js fixtures/synthetic-conversations.json -o demo.html --force
```

The supplied fixture creates three conversations and exactly two diagnostics: `unsupported-part` and `missing-parent`. These are intentional examples, not unexpected failures.

1. Open `demo.html`. **Synthetic · Two weekend ideas** starts on the gardening branch.
2. Click a birdwatching node in **Branch tree**. The selected path changes; **Go to parent** moves one step toward the root.
3. Use **Use selected as A/B**, or choose endpoints directly. Compare `end-a` with `end-b`: the shared ancestor is `prompt`, with three nodes after it in A and two in B. Shared context appears once, above the two columns.
4. Search for `saffron`. Click the result to open the matching message in the Unicode conversation. Search is case-insensitive and spans all conversations.
5. Select **Synthetic · Recovery examples** to inspect the repaired orphan and unsupported attachment placeholder. Open **Import diagnostics** for details.

Comparison uses node identity and ancestry, not textual similarity. Selecting an ancestor as an endpoint leaves that side empty after the shared context. Separate roots have no shared ancestor. Selecting the same endpoint shows only shared context. On narrow screens, the comparison columns stack vertically.

## Supported structure and limitations

See [export format and recovery rules](docs/export-format.md) for the precise supported subset.

- Only a JSON array of conversations with `mapping` objects is accepted. Supply one or more JSON files explicitly; directories, ZIP files, other vendors, flat transcript formats, and automatic discovery are unsupported.
- String parts of `text` and `multimodal_text` messages are displayed. Attachments and other content types become explicit placeholders; images, audio, video, tool payloads in unsupported formats, timestamps, and most metadata are not rendered.
- Markdown, HTML, URLs, and code are displayed as literal text. No active links, rendered Markdown, external fonts, analytics, or network resources are included.
- **Compatibility with Tony's actual exports remains unverified until they are supplied.** Tests use synthetic data and an observed community export structure, not a guaranteed stable schema.
- Input and output are held in memory, not streamed. Import limits are 64 files, 128 MiB combined input bytes, 10,000 input conversation records, and 250,000 input nodes (including duplicates). These are rejection limits, not responsiveness guarantees. Synthetic checks cover 1,000 conversations / 50,000 messages and a separate 5,000-node deeply branched conversation. See [performance measurements](docs/performance.md). Search scans all messages synchronously, displays the first 100 matches, and reports the total. Search uses Unicode lowercase, without normalization or locale-specific equivalences.
- Node order follows JSON mapping enumeration, not timestamps or the declared `children` order. Visual indentation is capped at 12 levels; every node remains selectable and its actual depth is available in its tooltip.
- The report contains a copy of supported message text, titles, roles, node identifiers, and diagnostics. Treat it as private data. No encryption is provided, and local browser extensions or other software are outside the application's protection.

## Development and verification

Only browser tests need third-party development dependencies. The lockfile pins them; conversion and the parser/CLI tests have no external dependencies.

```sh
npm ci
npx playwright install chromium
npm test
npm run test:install
npm run test:browser
npm run test:large
```

`npm run check` runs all three checks. Browser installation may also require your platform's Chromium system libraries. It is a one-time development setup download; tests themselves use an offline browser context with HTTP(S) requests intercepted and rejected.

For environments whose default npm/browser caches are not writable:

```sh
npm ci --cache /tmp/conversation-npm-cache
PLAYWRIGHT_BROWSERS_PATH=/tmp/conversation-playwright npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=/tmp/conversation-playwright npm run check
```

`test:install` packs the actual package, installs that tarball into a temporary isolated prefix using npm's offline mode, invokes the installed CLI from outside the repository, and imports the packaged fixture plus a second file with one duplicate and one new record to verify multi-file ordering and deduplication. Set `VERIFY_INSTALL_BROWSER=1` to also open and search the installed report in offline Chromium. It removes temporary artifacts afterward. Browser tests import JSON through the CLI and open the resulting `file://` report; they cover navigation, comparison, search, empty/malformed graphs, narrow layout, and script-injection resistance with and without CSP.

See [validation scope](docs/validation.md). No website or package registry publication is needed.

## Existing work

This is not a novel category. [ChatGPT JSON Tree Viewer](https://github.com/akivacp/chatgpt-json-tree-viewer) already provides tree navigation and search; [chatgpt-exporter](https://github.com/pionxzh/chatgpt-exporter) includes export tooling and mapping-based conversation examples. Their primary project documentation was reviewed to understand the landscape and observed structure. This implementation was written for a narrower workflow: an installable, runtime-dependency-free converter with explicit recovery diagnostics and shared-ancestor comparison in a self-contained report.
