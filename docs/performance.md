# Synthetic large-report measurements

Run `PLAYWRIGHT_BROWSERS_PATH=/tmp/conversation-playwright npm run test:large` after installing Chromium at that path (or omit the variable for a default installation). GNU `/usr/bin/time` and the baseline tree in local Git history are required. The script generates fixtures in temporary storage; large fixtures and HTML reports are not tracked. The small raw measurements are in [performance.json](../results/performance.json).

## Inputs and methods

Seed 20260922 drives the LCG in `scripts/synthetic.js`. The wide input has 1,000 conversations, each with 50 text-message nodes (50,000 total). The separate deep input has 5,000 nodes: a 4,500-node chain with 500 additional seeded branches. Both contain Latin text, accented text, Japanese, and emoji. Updated reports import two explicitly supplied JSON shards; baseline reports import the identical concatenated records from one file, since the baseline only supports one file. No private data or paid inference is used.

The baseline is the pre-milestone implementation at catalog tree `67b0d2170feddde9378c7bfe1f017d21cb9d7f39` (local starting commit `cff0a74e81056a96c566e20cb50beeec061a33c0`, catalog remote commit `05e41d8fd38e48a9d7a52a6423ddaecef8814f0f`). The tree identity allows reproduction from either history without depending on a controller-local commit ID. Its file blobs match the supplied project catalog manifest. The verifier extracts only its package, CLI, parser, report, and browser assets into temporary storage. It does not access a remote repository. Measurements compare that snapshot with the current working files.

Generation time is wall-clock time around spawning the CLI through GNU time, including process startup and file I/O. Peak CLI memory is GNU time's maximum resident set size in KiB. Report size is the actual UTF-8 output byte count. One generation is measured per dataset/version; these numbers are observations, not confidence intervals.

Chromium runs headlessly in an offline context, with HTTP(S) routes rejected. Load time runs from navigation to an initialized title. DOM counts include all element nodes (including options); message counts include all four `.message` panels. Recorded maxima are sampled after load, navigation, comparison, and paging, not a continuous heap profile. The implementation enforces at most 100 cards in each of four message panels (400 total), below the required 500 ceiling. Tree entries, conversation options, diagnostics, and search results are separately bounded at 100; endpoint selectors allow 100 initial nodes plus two selections.

Each interaction is repeated five times on the same loaded report. Search timing includes clearing and filling the field and checking the matching count. Navigation timing includes clicking the search result and checking the selected node. Comparison timing includes assigning both endpoints and checking branch IDs against an independent raw-parent ancestor-set reference. Baseline uses two dropdown selections; updated uses two node-ID submissions and assignment buttons so off-window selection is exercised. Consequently comparison timings are **workflow timings with different numbers of browser actions**, not isolated algorithm benchmarks. Playwright round trips, automatic waits, browser layout, and validation contribute to the timings. Execution order is baseline then updated, wide then deep; caches and shared-host scheduling can affect results. There is no statistical significance claim.

The raw JSON records Node/Chromium versions, OS kernel, host-reported CPU model, logical CPU count, and visible RAM. Virtualized CPU identity and RAM do not imply exclusive host resources. Search remains a synchronous scan; paging bounds DOM growth but does not stream or bound archive memory. Long individual messages can still be costly.

## Observations

The table below is generated from the retained run. Re-run results may differ. All timing values are milliseconds; interaction values are medians of the five retained samples.

| Input / version | Report bytes | Generation ms | Peak CLI KiB | Load ms | Max DOM | Max cards | Search median ms | Navigation median ms | Comparison median ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| wide / baseline | 7200361 | 1076.9 | 203856 | 937.7 | 1304 | 14 | 123.9 | 173.1 | 108.4 |
| wide / updated | 7203629 | 1517.9 | 177892 | 1028.8 | 512 | 14 | 117.0 | 117.0 | 252.8 |
| deep / baseline | 774062 | 239.5 | 77548 | 5579.5 | 47066 | 9001 | 377.9 | 7311.0 | 5325.9 |
| deep / updated | 777330 | 513.9 | 90192 | 447.3 | 1193 | 201 | 100.6 | 252.5 | 460.3 |

## Interpretation and limits

The deep case demonstrates the intended benefit: far fewer DOM elements and message cards, and much faster navigation/comparison. The wide case already rendered short paths in the baseline, so the main DOM saving comes from paging the conversation selector. Canonical duplicate checking and multi-file import add generation work; small-report and CLI memory regressions are acceptable tradeoffs for deterministic conflict detection and bounded browser rendering. Report size increases slightly due to additional UI code.

These fixtures contain short messages and no large attachments. They do not establish performance on Tony's exports, screen-reader usability, other browsers, low-memory devices, or the full 128 MiB import ceiling. The import ceilings are explicit safety limits, not guarantees of interactive performance. Raw results retain regressions as well as improvements.
