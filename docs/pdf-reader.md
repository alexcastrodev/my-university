# PDF reader

How the reader of a paper's own PDF works (#185), what it does not do yet, and what to open by hand before trusting a change to it. The engine was chosen in [pdf-engine-evaluation.md](pdf-engine-evaluation.md).

## How it works

- Route `/library/:paperId/read`, client-rendered only (the PDF is the reader's own, the server renders the shell and nothing else). The paper page links to it from the "My PDF" panel.
- The bytes come from `GET /api/papers/:id/attachment/file`, the same authorized route as the download. The reader never holds a URL to the file, so there is no link to leak. Another reader's paper answers 404 and the reader says it is not in the library.
- `pages/papers/pdf-engine.ts` is the only file that knows pdf.js. It loads the engine with a dynamic import (its own lazy chunk, fetched on first use), runs the parsing in a worker, and draws a page to a canvas with a transparent text layer over it for selecting and searching.
- `pages/papers/paper-reader.ts` is the page. Pages are placeholders of the right size, drawn one at a time while they are within one screen of the viewport, and given back (canvas emptied) when they are more than three pages away. A forty page document never holds forty canvases.
- A canvas never holds more than 16 million pixels, whatever the zoom, and the engine decodes no image larger than that.

## Where the engine's files come from

`angular.json` copies the worker, the character maps, the standard fonts, the colour profiles and the decoders from `node_modules/pdfjs-dist` to `/pdfjs/` (and `/pt-BR/pdfjs/`, one copy per locale, because the engine resolves them next to the page).

`nginx.conf` has a `location` for them that does two things the default one does not:

- `.mjs` is served as JavaScript. The stock MIME table does not know it, and a browser refuses a module worker served as anything else.
- They are revalidated (`no-cache`) instead of cached for a year. Their URLs are fixed, and the worker has to be the same version as the engine in the page's bundle: a stale worker after an upgrade stops with a version mismatch.

## Security

- No script in the PDF runs: this version of pdf.js has no eval path, scripting is off, XFA forms are off, and the annotation layer (links, form fields) is not created at all.
- The CSP stays as it is (`script-src 'self'`, no `unsafe-eval`, no WebAssembly compilation). With it, the JPEG 2000 and JBIG2 decoders fall back to their plain JavaScript versions, which are slower but work. `worker-src 'self' blob:` already covered the worker.
- Hardening that goes beyond this (serving the file from another origin, #189) is not part of this reader.

## What it does not do yet

- The search finds text only. A scanned PDF with no text layer has nothing to find (there is no OCR).
- A match marks the whole text piece that holds the term, not only the word, and stepping through matches goes to the page, not to the exact spot.
- Links inside the PDF and its form fields are not active.
- Zoom returns to the top of the current page, not to the exact spot that was on screen.
- Notes, highlights and bookmarks are #186.

## Keyboard

`n` / `p` next and previous page, `Home` / `End` first and last, `+` / `-` zoom, `0` fit width, `f` search. `/` is not used: it opens the search of the whole site.

## Test corpus (by hand)

The automated suite draws a PDF it generates (text, Helvetica, a few pages). Real documents break engines in ways a generated one cannot. Before an engine upgrade, or a change to how pages are drawn, open each of these through the reader on a desktop and on a phone, and watch the console:

| File | What to check |
| --- | --- |
| A two column arXiv paper with equations | Text is selectable in reading order, search finds a word inside a column, fit width is readable on a phone |
| A scanned book chapter (images only, 50+ pages) | Opens, scrolls without freezing, memory stays flat (open the Memory tab and scroll to the end), search says no matches |
| A PDF with embedded TrueType and OpenType fonts | Glyphs are the right ones, no boxes |
| A PDF that relies on the standard 14 fonts and embeds nothing | Text shows (the engine fetches `/pdfjs/standard_fonts/`) |
| A Chinese, Japanese or Korean paper | Text shows (the engine fetches `/pdfjs/cmaps/`) |
| A PDF with JPEG 2000 images | Images show, nothing in the console but a slower first draw (the JavaScript decoder is in use) |
| A PDF with a large page (A0 poster) and a very small one | Fit width works for both, deep zoom does not blank the page |
| A password protected PDF | "This PDF is password protected and cannot be opened here." with the download link |
| A truncated copy of any PDF | "This file is not a readable PDF." |
| A 25 MB PDF | Opens, and the server upload limit and the reader agree |

## Upgrading pdf.js

1. Bump the exact version in `app/package.json` (pinned on purpose, no range) and check its advisories first.
2. `pnpm audit --prod`, and read the release notes for changes to `getDocument` options and to the assets folders copied in `angular.json`.
3. Run `tests/paper-reader.spec.js` on `chromium` and `Mobile Chrome`, then go through the corpus above.
4. The worker is revalidated by nginx, so browsers pick up the new one without clearing a cache.
