# Notes and PDF annotations

A reader keeps private notes on a paper of their library, and marks their own PDF: highlights, comments,
questions and bookmarks (#186). Everything is private: no route reads, counts or lists another reader's
annotations. Only an explicit act, one annotation at a time, publishes a copy of one (#187, below).

## Endpoints

All need a session. Every call starts from the signed-in reader's own library entry, so an annotation of someone
else is the same 404 as one that does not exist, and so is a paper that is not in the library.

| Route | What it does |
| --- | --- |
| `GET /api/paper-library/:paperId/annotations` | `{ version, items }`: the PDF version being served (null without a PDF) and every note and annotation, oldest first, each with `stale`. |
| `POST /api/paper-library/:paperId/annotations` | Creates one. 201 with the record. |
| `PATCH /api/paper-library/:paperId/annotations/:id` | Changes the text (`body`), or turns a stale annotation into a note (`kind: "note"`). |
| `DELETE /api/paper-library/:paperId/annotations/:id` | Deletes it. 204. |
| `PUT /api/paper-library/:paperId/annotations/:id/share` | Shares it, or shares it again to change the audience and refresh the copy. 200 with the share. |
| `DELETE /api/paper-library/:paperId/annotations/:id/share` | Takes the share back. 204, also when there was none. |
| `GET /api/papers/:slug/shared-annotations` | What readers shared on a public paper that the viewer may see. Needs no session. |

`:paperId` is what the rest of the library uses: the slug of a public paper or the UUIDv7 of a private one.

Errors carry `{ statusCode, code, message }`. `code` is stable: `note_empty`, `note_has_no_place`,
`anchor_required`, `highlight_needs_text`, `body_required`, `bookmark_is_a_page`, `label_too_long`, `not_stale`
(400) and `no_pdf`, `stale_version`, `annotations_limit` (409). Sharing adds `private_paper`, `not_shareable`,
`recipients_required`, `recipients_only_for_users`, `recipient_not_found`, `recipient_is_you` (400) and
`shares_limit` (409).

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

## Sharing (#187)

Nothing is shared until the reader asks, one annotation at a time. A share is a **copy** in its own table
(`paper_annotation_share`), made when the reader presses Share; the private annotation gets no new column and is
never read to answer a request about shares.

| What | Rule |
| --- | --- |
| What can be shared | A note, highlight, comment or question on a **public** paper. A bookmark cannot, and neither can anything on a private paper (`private_paper`): its existence is its owner's. |
| What the copy holds | `kind`, `body`, `page` and `quote`. The quote is cut to 500 characters (with an ellipsis, never inside a character). No rectangles, no `prefix` or `suffix`, no PDF version or checksum, no way back to the library entry or the file. So a share never carries the PDF's bytes and only a few lines of its text. |
| Who sees it | `public`: anyone who opens the paper, signed in or not. `users`: only the readers named (up to 20), and the author. A reader is named by their public profile: the vanity slug, the profile id, or the `/u/...` link. A reader whose profile is not public cannot be named and gets the same `recipient_not_found` as a name nobody has, so asking tells nothing. |
| Attribution | The page shows the author's display name and avatar, and a link to `/u/<slug or id>` only when their profile is public. |
| The PDF | Never reachable through a share. A recipient has no access to the author's attachment (the attachment routes stay the owner's alone). |
| Editing the annotation | The copy does not follow: readers see what was shared until the author shares again ("Update the shared copy"). `GET .../annotations` carries `share.updatedAt`, so the app can say the copy is older. |
| Revoking | `DELETE .../share` removes the copy for everyone at once. `GET /api/papers/:slug/shared-annotations` answers `Cache-Control: no-store`. |
| The source goes | Deleting the annotation, removing the paper from the library or deleting the account deletes the copy (foreign key cascade): that is the unpublishing. A recipient's account going only removes them from the audience. |
| The PDF is replaced or removed | The copy stays. It never depended on the file, and `page` says where the author's copy had it (another edition may paginate differently). |
| Sharing again | Replaces the copy and the audience (one share per annotation). |
| Limits | `PAPER_SHARES_MAX_PER_USER` (default 200) shared annotations per reader; the paper page lists the first 200 by page. |

The paper page reads shares in the browser, never during server rendering: the answer depends on who is
looking, and it must not end up in a page cached for everyone. Not done: telling a recipient that something was
shared with them (they find it on the paper's page), reporting and moderating public shares (#189), and paging
past 200 shares of one paper.
