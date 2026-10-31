# Notes and PDF annotations

A reader keeps private notes on a paper of their library, and marks their own PDF: highlights, comments,
questions and bookmarks (#186). Everything is private: there is no way to read, share or count another reader's
annotations. Sharing a selection of them is a later, separate decision (#187).

## Endpoints

All need a session. Every call starts from the signed-in reader's own library entry, so an annotation of someone
else is the same 404 as one that does not exist, and so is a paper that is not in the library.

| Route | What it does |
| --- | --- |
| `GET /api/paper-library/:paperId/annotations` | `{ version, items }`: the PDF version being served (null without a PDF) and every note and annotation, oldest first, each with `stale`. |
| `POST /api/paper-library/:paperId/annotations` | Creates one. 201 with the record. |
| `PATCH /api/paper-library/:paperId/annotations/:id` | Changes the text (`body`), or turns a stale annotation into a note (`kind: "note"`). |
| `DELETE /api/paper-library/:paperId/annotations/:id` | Deletes it. 204. |

`:paperId` is what the rest of the library uses: the slug of a public paper or the UUIDv7 of a private one.

Errors carry `{ statusCode, code, message }`. `code` is stable: `note_empty`, `note_has_no_place`,
`anchor_required`, `highlight_needs_text`, `body_required`, `bookmark_is_a_page`, `label_too_long`, `not_stale`
(400) and `no_pdf`, `stale_version`, `annotations_limit` (409).

## What each kind needs

| Kind | Text (`body`) | Where it sits |
| --- | --- | --- |
| `note` | required | nowhere: a note belongs to the library entry, not to a PDF |
| `highlight` | none | `page`, `quote`, `rects` |
| `comment`, `question` | required | `page`, `quote`, `rects` |
| `bookmark` | optional label, up to 200 characters | `page` only |

Anything but a note also sends `version`, the PDF version the reader had open. The server refuses it with
`409 stale_version` (carrying the current `version`) when that is no longer the PDF of the paper, and with
`409 no_pdf` when there is none, so a mark is never saved on a file other than the one it was made on.

## Anchoring, and what happens when the PDF changes

The anchor follows the W3C Web Annotation model without storing JSON-LD:

- `quote`, `prefix`, `suffix` are a TextQuoteSelector: the selected text and up to 200 characters around it.
- `page` is the FragmentSelector.
- `rects` is the geometry: one `{ x, y, w, h }` per line, as fractions (0 to 1) of the page from its top left
  corner, so the same rectangles hold at any zoom.
- `pdfVersion` and `pdfSha256` say which file it was made on. The identity is the checksum: putting back the
  same bytes revives the annotations, other bytes mark them `stale`.

**An annotation is never moved onto a new file.** After a replacement (or when the PDF is removed) the
annotations of the old file stay in the list with `stale: true`. The reader draws none of them on the new PDF, the
paper page lists them under "Needs review", and the reader chooses: keep what they said as a note (the body
becomes `> quote` followed by the text, the anchor is dropped) or delete it. Notes are never stale. Re-anchoring
by `prefix` and `suffix` is possible later, as a suggestion the reader confirms.

## Limits and safety

- `body` up to 5000 characters, `quote` up to 2000, `prefix` and `suffix` up to 200, up to 100 `rects`, and up to
  `PAPER_ANNOTATIONS_MAX_PER_ENTRY` (default 2000) per library entry. NUL is refused.
- The text is stored as typed and escaped where it is shown: the app renders it with `renderNoteMarkdown`
  (`app/src/app/shared/safe-markdown.ts`), which escapes raw HTML, loads no images, and only links http, https
  and mailto. A stored `<script>` is just text.
- The table cascades from `paper_library_entry`, so removing a paper from the library, or deleting a private
  paper, takes its notes with it. Changing the public page or its discussion touches nothing here.
