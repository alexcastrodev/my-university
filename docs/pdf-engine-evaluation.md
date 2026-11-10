# PDF engine evaluation (issue #184)

Spike for the Papers & Research Library epic (#177). It compares PDF.js with WASM and native alternatives for the in-browser reader (#185), anchored annotations (#186) and server-side validation of uploads (#183, #189).

**Nothing in this change adds a dependency to `app/`, `backend/` or `packages/`.** The harness lives in `spikes/pdf-engines` (a standalone package, not part of the pnpm workspace). The decision below needs approval before any engine becomes a production dependency.

## Recommendation

| Where | Engine | Why |
|---|---|---|
| Reader and annotations (#185, #186) | **PDF.js** (`pdfjs-dist`, Apache-2.0), pinned to an exact patched version | Ships the pieces the reader needs (text layer, annotation layer, annotation editors). Smallest download. Parses in its own worker, so the page stays responsive without extra plumbing. |
| Upload validation and text extraction on the server (#183, #189) | **PDF.js legacy build in Node**, inside a worker thread with a timeout and memory cap | Same engine, same parsing behavior as the reader, no second dependency. Rejects truncated and garbage files with an error. |
| OCR | **Not now.** Detect "no text layer" at upload and keep the PDF readable | See [OCR decision](#ocr-decision). |

WASM engines (MuPDF.js, PDFium bindings) are not recommended for the first version. They render about twice as fast in this run, but they cost 4 to 10 times more bytes, block the main thread unless we add our own worker, need `'wasm-unsafe-eval'` in the CSP (which the repo's CI guard rejects today), and leave us to build the text layer and selection ourselves. Revisit if rendering speed or a PDF.js limitation becomes a real problem. Whatever the engine, store annotations in an engine-neutral shape (page index, normalized quads, text-quote selector) so swapping later does not invalidate user data.

## Results at a glance

Machine: Apple M4 Max, macOS arm64. Node 24.22.1. Chromium 153 (headless shell). Single machine, so read the ratios, not the absolute milliseconds.

| Criterion | PDF.js 6.4.299 | MuPDF.js 1.28.1 | PDFium `@hyzyla/pdfium` 3.0.0 | PDFium `@embedpdf/pdfium` 2.15.1 | LiteParse 2.17.0 |
|---|---|---|---|---|---|
| Runs in browser | yes | yes | yes | yes | no (native Node addon) |
| License | Apache-2.0 | AGPL-3.0-or-later | MIT | MIT | Apache-2.0 |
| Download, gzip (JS + wasm/worker, without on-demand fonts and cmaps) | 0.48 MB | 4.56 MB | 2.40 MB | 2.09 MB | n/a |
| Render 15 pages, browser, ms (main / in our worker) | 471 / 389 | 220 / 225 | 296 / 305 | 218 / 222 | n/a |
| Longest main-thread stall while rendering 15 pages, ms (main / in our worker) | 30 / 8 | 211 / 8 | 208 / 8 | 203 / 8 | n/a |
| Page-1 pixel difference vs poppler (mean abs, 0 to 255) | 5.5 | 4.8 | 3.1 | 6.3 | n/a |
| Text extraction on synthetic fixtures (word accuracy) | 100% | 100% | 100% | 100% | 96.9% to 100%, but 18.4% on two columns |
| Agreement with `pdftotext` on a real 15-page paper | 88.8% | 88.4% | 88.9% | 88.9% | 86.1% |
| 800-page file, extract all text: time / peak RSS | 1263 ms / 307 MB | 1086 ms / 122 MB | 906 ms / 180 MB | 848 ms / 111 MB | 907 ms / 257 MB |
| Truncated file | error | opens with 0 pages, no error | error | error | error |
| Ready-made text layer and annotation UI | yes (`TextLayer`, `AnnotationLayer`, `AnnotationEditorLayer`) | no, raw API | no | no | no |
| Char and quad coordinates | text items with transforms | `StructuredText` and `search()` return quads | raw `FPDFText_*` calls only (high-level wrapper has `getText`, `render`) | raw `FPDFText_*` calls | n/a |
| Annotation read/write API | yes (editor layer, `saveDocument`) | yes (`createAnnotation`, `getAnnotations`) | raw `FPDFAnnot_*` calls | raw `FPDFAnnot_*` and `EPDFAnnot_*` calls | no |
| OCR | no | no | no | no | yes (see below) |
| Known advisories (GitHub) | 3 high on npm, latest 2026-08-06 (fixed in 6.2.108) | 1 low on the C library (CVE-2026-112036), not mapped to the npm package, no fixed npm release | none | none | none |

Fidelity numbers measure agreement with another renderer at one width on one page, mostly anti-aliasing and hinting differences (under 3.5% of pixels differ by more than 64 levels for every engine). They are not an accuracy ranking, and the result depends on render flags.

### Browser run

Median of 5 cold runs per case (new browser context each time), 900 px wide, rendering to an `OffscreenCanvas` or a raw bitmap. `wall` includes loading the module and instantiating WASM.

| Engine | Mode | First page, wall ms | 15 pages, wall ms | Longest main-thread stall, ms |
|---|---|---|---|---|
| PDF.js | main | 79 | 471 | 30 |
| PDF.js | our worker | 84 | 389 | 8 |
| MuPDF.js | main | 53 | 220 | 211 |
| MuPDF.js | our worker | 58 | 225 | 8 |
| PDFium (hyzyla) | main | 121 | 296 | 208 |
| PDFium (hyzyla) | our worker | 127 | 305 | 8 |
| PDFium (embedpdf) | main | 48 | 218 | 203 |
| PDFium (embedpdf) | our worker | 52 | 222 | 8 |

The stall is the longest gap between two 4 ms timer ticks while the engine works. The WASM engines render synchronously, so on the main thread they hold it for the whole render; in a worker the stall disappears. PDF.js already parses in its own worker, which is why it stays low in both modes. The browser's `longtask` API was tried first and discarded: it missed stalls that the timer gap clearly showed.

### Node run

Median of 5 fresh processes (3 for `large`). Full tables are in the harness output (`results/node.md`).

| Fixture | Notes |
|---|---|
| `text-single`, `equations`, `malformed-xref` | All engines read them; accuracy 100% except LiteParse on equations (96.9% words). |
| `two-column` | PDF.js, MuPDF, PDFium: 100%. LiteParse: 18.4% words, because spatial layout output interleaves the columns line by line. |
| `scanned` | No engine extracts text (expected). LiteParse with OCR on: 100% words, 3151 ms for one page, 188 MB peak RSS. |
| `malformed-truncated`, `malformed-garbage` | All reject garbage. For truncated, MuPDF returns an open document with 0 pages and no error, so validation must also require `pages > 0`. |
| `large` (800 pages) | 848 to 1263 ms. PDF.js uses the most memory (307 MB peak RSS against 111 to 257 MB). |

## License review

Metadata-level review of `package.json` license fields and upstream projects. It is not legal advice and does not audit every bundled third-party file.

| Package | License | Notes |
|---|---|---|
| `pdfjs-dist` | Apache-2.0 | No obligation beyond notices. |
| `mupdf` | AGPL-3.0-or-later | Compatible with this repository's AGPL-3.0, so embedding is allowed today. It would tie any future relicensing or a commercial build to Artifex's commercial license. This is the main reason not to pick it by default. |
| `@hyzyla/pdfium`, `@embedpdf/pdfium` | MIT | The WASM binaries embed PDFium (BSD-3-Clause and Apache-2.0 upstream) and its third-party libraries; not checked file by file. |
| `@llamaindex/liteparse` | Apache-2.0 | Native dependencies and OCR models not audited. |

## Security

### Advisories

`pnpm audit` on the spike's dependencies reports no known vulnerabilities, and GitHub's npm advisory list is empty for both PDFium bindings, LiteParse and MuPDF.js. For `pdfjs-dist` it lists three, all high severity and all "arbitrary JavaScript execution when opening a malicious PDF":

| Advisory | Published | Vulnerable | Fixed |
|---|---|---|---|
| GHSA-7jg2-jgv3-fmr4 | 2022-05-14 | 2.0.0 up to 2.0.549 | 2.0.550 |
| GHSA-wgrm-67xf-hhpq | 2024-05-07 | up to 4.1.392 | 4.2.67 |
| GHSA-hq66-cqwq-w95j | 2026-08-06 | 5.6.83 up to 6.2.107 | 6.2.108 |

The evaluated version (6.4.299) is past all three. The class recurs roughly every two years, so we should plan for it.

MuPDF has one open item that `pnpm audit` cannot see. GHSA-pv37-v42r-g3rq (CVE-2026-112036, low, CVSS 4.3, published 2026-10-19) is a double free in `free_char_list` (`source/pdf/pdf-xref.c`, signature locking) of the MuPDF C library, "up to 1.28.5", with a public exploit and an upstream patch. The advisory has no npm package mapping, the latest `mupdf` on npm is 1.28.1, and I did not verify whether the binding reaches that code path. In WASM a heap corruption stays inside the module's sandbox, but it is one more reason not to default to MuPDF. More generally, an empty advisory list for the WASM engines says less than it seems: they are small projects and native parsers in WASM still have memory-safety bugs. Advisories filed against the upstream C library (PDFium, MuPDF) are not visible through npm tooling, so the update process below includes watching upstream.

### Update process

Existing CI already helps: `security-audit.yml` runs `pnpm audit --audit-level low` on the root and `backend`, and the dependency-review job inspects PRs. For the PDF engine specifically:

1. Pin the engine to an exact version (no caret) so upgrades are deliberate PRs.
2. Let the existing `audit` job fail the build when an advisory lands. Treat a high or critical engine advisory as urgent.
3. Consider enabling Dependabot security updates for the engine package (a repository setting; not verified here). If a WASM engine is ever adopted, also watch the upstream C library's advisories, because npm tooling does not report them.
4. After each engine bump, re-run the malformed-file fixtures from the harness.

### Containment (for #185 and #189)

- Pass `isEvalSupported: false` and keep PDF scripting off (`enableScripting` is off in the API by default). The benchmark builds use `isEvalSupported: false`.
- Because the repeated PDF.js bug class is script execution in the viewer's origin, render in a sandboxed iframe with an opaque origin (no `allow-same-origin`), so a bug cannot read the session cookie or call the API as the user. This was not built or tested here.
- On the server, parse uploads in a worker thread with a time limit and a memory cap, never in the API request path.
- The current CSP is `script-src 'self' 'nonce-...'`, `worker-src 'self' blob:`, `connect-src 'self' ...`. Workers are already allowed. Loading PDFs from the object store needs a `connect-src` entry or an API proxy. WASM engines need `'wasm-unsafe-eval'` in `script-src`, and the CI step "Scripts stay nonce-only in the CSP" matches the substring `unsafe-eval`, so it would fail until reworded. PDF.js ships JS fallbacks for its JPX and JBIG2 WASM decoders; whether the reader runs cleanly under the current CSP was not tested.

## OCR decision

Only LiteParse performs OCR. On one clean synthetic scanned page it recovered all the words in 3.2 s and 188 MB of RSS. That is one easy page, so it says nothing about real scans. It is a native addon and server-only.

Decision: do not ship OCR with the reader. At upload, count extractable characters; zero means "no text layer". Mark the paper and keep it readable (page-level notes and bookmarks work; text selection does not). If OCR is wanted later, run it as a separate background job with its own limits and approval, never inside the API process.

## What this does not establish

- Fixtures are synthetic apart from one real paper, and the real-paper numbers measure agreement with `pdftotext`, not absolute accuracy.
- One machine (macOS arm64). No Linux, no CI runner, no mobile device.
- Accessibility, keyboard navigation, mobile browser support, memory in the browser and annotation round-trips come from documentation and the API surface, not from measurements.
- Render quality was compared on one page with one set of flags.
- The browser benchmark used a local static server without compression or network latency, and an `OffscreenCanvas`, not a visible canvas with a text layer.
- The OCR source and any model download were not traced.

## Reproduce

The harness is in `spikes/pdf-engines`, which `.gitignore` lists, so it stays local unless force-added.

```bash
cd spikes/pdf-engines
pnpm install
python3 fixtures/make_fixtures.py        # needs reportlab and poppler
sh fixtures/fetch_real.sh                # real paper, pinned by sha256
node bench/run.mjs && node bench/report.mjs && node bench/real.mjs
node browser/build.mjs && node browser/run.mjs
```
