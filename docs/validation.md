# Validation scope

The automated suite exercises synthetic exports. It does not establish compatibility with any private user's full export.

## Checks

- **Parser and CLI:** branches, null messages, missing parents, cycles/self-links, Unicode, unsupported content, invalid structures, inconsistent children, special object keys, duplicate conversation IDs, empty data, strict mode, overwrite behavior, input protection through hard links and symlinks, and safe JSON embedding. A 20,000-node chain checks that parsing does not recurse through the JavaScript call stack; this is not a performance benchmark.
- **Isolated installation:** the actual npm tarball is installed in a temporary prefix with `--offline --omit=dev --ignore-scripts`. The installed executable generates a report using the fixture shipped in the tarball, from a working directory outside the checkout.
- **Browser:** Chromium opens reports produced by the CLI via `file://` in an offline context, with HTTP(S) interception. Assertions cover conversation selection, tree navigation, parent navigation, endpoint assignment, shared-ancestor comparison, ancestor/same-endpoint cases, disconnected roots, global search and result navigation, empty states, malformed graphs, and a 390-pixel-wide layout.
- **Markup injection:** synthetic script-closing tags, script elements, an image with a network URL and event handler, and SVG event markup must remain literal text. The test checks that injected elements and sentinel side effects are absent, both with the report's CSP and after removing CSP from a test copy. The browser suite fails if the monitored page raises a runtime error or requests HTTP(S) resources.

## Observed environment

The suite was developed and run with Node.js 24.20.0 and Playwright's Chromium on Linux. The current checks include 23 parser/import/export/CLI tests, six browser regression tests, the isolated-install check, and the generated large-archive verifier. See the measured evidence in `results/performance.json` and [measurement methods](performance.md). Other operating systems and browsers are not yet verified. Node.js 22 is the declared minimum; it has not been separately exercised here.

Dependencies and browser binaries must be installed before running the browser tests. Conversion, parser/CLI tests, and the isolated package test do not require browser binaries. The test commands are in the README and `package.json`; no test suite silently skips unavailable browsers.

## Remaining limits

Real-export compatibility, screen-reader usability, and cross-browser behavior remain unverified. Large-report checks use modest synthetic text; their timings do not predict attachment-heavy, long-message, or private real exports. Plain-text rendering deliberately omits active media, Markdown formatting, most metadata, and unsupported payloads. No correctness, security, or performance claims extend beyond the described implementation and checks.

## Large-archive verification

`npm run test:large` generates seed 20260922 fixtures in a temporary directory, builds the baseline from catalog Git tree `67b0d2170feddde9378c7bfe1f017d21cb9d7f39`, and compares it with the working implementation. It needs that tree in local history, GNU `/usr/bin/time`, and installed Chromium. No GitHub access is used. The updated CLI receives two shards for each dataset. Independent checks use raw message text for search and ancestor-set intersection for comparison, including off-window endpoints, Unicode, and shared context. Browser contexts are offline with HTTP(S) interception; runtime errors fail the check. Five interaction repetitions are retained per dataset/version. Generated fixtures and reports are deleted; only small measured JSON results are retained.


## Selected export verification

The export suite checks 250 LCG seeds (1–250), with 100 nodes per graph, using an
independent forward traversal from roots. It verifies selected paths and shared
prefixes against the exporter's backward parent walk. Fixtures include disconnected
roots, empty/special IDs, nonleaf endpoints and empty messages. A separate 12,000-node
chain checks export traversal depth. Malformed selections, repaired cycles/orphans,
Unicode/code fences, tool roles, timestamps, metadata/attachment omissions and
artifact hashes have explicit assertions. A 300,000-character text case checks many
backtick runs without argument-stack overflow.

Distinct sentinel strings in sibling messages, unrelated conversation IDs/titles/text,
attachment payloads and source filenames must be absent from selected artifacts.
Keyboard-operated Chromium downloads are compared byte-for-byte with actual CLI
outputs for single, paired, ancestor and same-node selections. Selection changes
clear stale links. Existing injection-defense and import-limit regressions remain.
The isolated installed CLI exercises both documented export commands offline.
Large-fixture checks download and compare both artifacts for path and comparison
exports, check independent ancestry and retain actual times/sizes and DOM maxima.
