# Validation scope

The automated suite exercises synthetic exports. It does not establish compatibility with any private user's full export.

## Checks

- **Parser and CLI:** branches, null messages, missing parents, cycles/self-links, Unicode, unsupported content, invalid structures, inconsistent children, special object keys, duplicate conversation IDs, empty data, strict mode, overwrite behavior, input protection through hard links and symlinks, and safe JSON embedding. A 20,000-node chain checks that parsing does not recurse through the JavaScript call stack; this is not a performance benchmark.
- **Isolated installation:** the actual npm tarball is installed in a temporary prefix with `--offline --omit=dev --ignore-scripts`. The installed executable generates a report using the fixture shipped in the tarball, from a working directory outside the checkout.
- **Browser:** Chromium opens reports produced by the CLI via `file://` in an offline context, with HTTP(S) interception. Assertions cover conversation selection, tree navigation, parent navigation, endpoint assignment, shared-ancestor comparison, ancestor/same-endpoint cases, disconnected roots, global search and result navigation, empty states, malformed graphs, and a 390-pixel-wide layout.
- **Markup injection:** synthetic script-closing tags, script elements, an image with a network URL and event handler, and SVG event markup must remain literal text. The test checks that injected elements and sentinel side effects are absent, both with the report's CSP and after removing CSP from a test copy. The browser suite fails if the monitored page raises a runtime error or requests HTTP(S) resources.

## Observed environment

The suite was developed and run with Node.js 24.20.0 and Playwright's Chromium on Linux. All 14 parser/CLI tests, five browser tests, and the isolated-install check passed. Other operating systems and browsers are not yet verified. Node.js 22 is the declared minimum; it has not been separately exercised here.

Dependencies and browser binaries must be installed before running the browser tests. Conversion, parser/CLI tests, and the isolated package test do not require browser binaries. The test commands are in the README and `package.json`; no test suite silently skips unavailable browsers.

## Remaining limits

Real-export compatibility, large-report browser responsiveness, screen-reader usability, and cross-browser behavior remain unverified. Plain-text rendering deliberately omits active media, Markdown formatting, most metadata, and unsupported payloads. No correctness, security, or performance claims extend beyond the described implementation and checks.
