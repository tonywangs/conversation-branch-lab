# Conversation Branch Lab

Convert a mapping-based ChatGPT `conversations.json` export into a **single, offline HTML file** for exploring alternative replies. Select conversations, follow any node's path, search message text across the export, and compare two endpoints with their shared context shown once.

The CLI uses only Node.js built-ins. The generated report needs a browser with JavaScript enabled, but no server, network, account, inference API, or GPU. All supplied conversations are **synthetic**, including the deliberately malformed and hostile-markup examples.

## Install and run

Requires **Node.js 22 or later** and npm. From this private checkout:

```sh
npm install --global . --omit=dev --ignore-scripts
conversation-branch-lab /path/to/conversations.json -o /path/to/report.html
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

- Only a JSON array of conversations with `mapping` objects is accepted. Other vendors, flat transcript formats, ZIP files, and automatic discovery/merging of split exports are unsupported.
- String parts of `text` and `multimodal_text` messages are displayed. Attachments and other content types become explicit placeholders; images, audio, video, tool payloads in unsupported formats, timestamps, and most metadata are not rendered.
- Markdown, HTML, URLs, and code are displayed as literal text. No active links, rendered Markdown, external fonts, analytics, or network resources are included.
- **Compatibility with Tony's actual exports remains unverified until they are supplied.** Tests use synthetic data and an observed community export structure, not a guaranteed stable schema.
- Input and output are held in memory. There is no streaming, pagination, or virtualized tree. A parser test covers a 20,000-node chain, but large real exports and large browser reports have not been performance-tested. Search displays the first 100 matching messages and reports the total. Unicode normalization and locale-specific equivalences are not guaranteed.
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
```

`npm run check` runs all three checks. Browser installation may also require your platform's Chromium system libraries. It is a one-time development setup download; tests themselves use an offline browser context with HTTP(S) requests intercepted and rejected.

For environments whose default npm/browser caches are not writable:

```sh
npm ci --cache /tmp/conversation-npm-cache
PLAYWRIGHT_BROWSERS_PATH=/tmp/conversation-playwright npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=/tmp/conversation-playwright npm run check
```

`test:install` packs the actual package, installs that tarball into a temporary isolated prefix using npm's offline mode, invokes the installed CLI from outside the repository, and generates a report using the packaged fixture. It removes temporary artifacts afterward. Browser tests import JSON through the CLI and open the resulting `file://` report; they cover navigation, comparison, search, empty/malformed graphs, narrow layout, and script-injection resistance with and without CSP.

See [validation scope](docs/validation.md). No website or package registry publication is needed.

## Existing work

This is not a novel category. [ChatGPT JSON Tree Viewer](https://github.com/akivacp/chatgpt-json-tree-viewer) already provides tree navigation and search; [chatgpt-exporter](https://github.com/pionxzh/chatgpt-exporter) includes export tooling and mapping-based conversation examples. Their primary project documentation was reviewed to understand the landscape and observed structure. This implementation was written for a narrower workflow: an installable, runtime-dependency-free converter with explicit recovery diagnostics and shared-ancestor comparison in a self-contained report.
