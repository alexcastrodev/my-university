# Papers

There are two kinds of paper, and they live in different places:

- A **public paper** is an authored file, like a concept (#213). `seed/data/papers/papers.json` is the index and
  `content/<slug>/en.md` plus `pt-BR.md` carry our Research Analysis. There is no table behind it: adding,
  editing or removing a public paper is a change to those files, reviewed like any other change. Nobody writes
  to it over HTTP, neither a reader nor staff.
- A **private paper** (#203, #212) is a row in `paper` that one reader keeps in their own library. It has an
  owner, a UUIDv7 public id, and is reachable only by that reader.

PDFs are not part of either: they are attachments (#183) of the reader that uploaded them.
The reader's notes, highlights and bookmarks on a paper are theirs alone too (#186): see
`../paper-annotations/README.md`, which also says how one can be shared on purpose (#187).

## The public papers (files)

```
seed/data/papers/
  papers.json                 the index: one entry per paper
  content/<slug>/en.md        the Research Analysis in English (required)
  content/<slug>/pt-BR.md     the Portuguese one (optional; the API falls back to English)
```

An entry of `papers.json` has `slug`, `title`, `authors` (`[{ name, orcid? }]`, at least one) and `type`, and
optionally `venue`, `publicationDate` (`YYYY`, `YYYY-MM` or `YYYY-MM-DD`), `doi` (lowercase, no resolver prefix),
`url` (http or https), `researchArea`, `keywords` and `abstract`. The abstract is the authors' own text, so it goes
in only where the publisher lets it be reproduced (open licence); otherwise the page shows the link to it.

The markdown is the concepts' format: frontmatter with `title`, `summary`, `version` and `updatedAt`, then six
`## ` sections in this order (Overview, Contribution, Methodology, Findings, Critical Analysis, Further Research;
in Portuguese Visão geral, Contribuição, Metodologia, Resultados, Análise crítica, Pesquisas futuras). The
analysis is ours and says so on the page; it is never presented as the authors' text. Editing a file bumps
`version` and `updatedAt` in both languages (CLAUDE.md).

- **Checked at boot.** `PapersCatalogService` reads the index once and stops the API with a message that names
  the paper (`papers.json, <slug>: <why>`) for a bad or repeated slug, a missing title, author or `en.md`, a
  malformed date, URL or DOI, or a DOI used twice. A mistake in the files never reaches a reader.
- **The slug is the id.** Lowercase words joined by hyphens, at most 100 characters and never shaped like a
  UUID (`paper-ref.ts`). It is what the URLs `/papers/:slug`, `/library/:slug`, the API (`/api/papers/:slug`,
  `/api/paper-library/:paperId`, `.../attachment`), the sitemap and the discussion topic (`paper:<slug>`) carry.
  A slug is permanent: renaming one orphans the library entries, PDFs and discussion that point at it.
- **Routes.** Only `GET /api/papers`, `GET /api/papers/facets` and `GET /api/papers/:slug?lang=` exist for the
  public papers. The list takes `q`, `author`, `doi`, `keyword`, `area`, `type`, `stage`, `year`, `sort`, `page`
  and `limit`, filters and sorts in memory (a few hundred papers at most), and titles come in `lang`.
- **Detail** answers the record plus `language`, `availableLanguages`, `summary`, `version`, `updatedAt` and
  `sections` (`[{ title, content }]`, the markdown of each section).
- **Tests** point `PAPERS_DATA_DIR` at a folder of fixtures (`spec/papers-fixtures.ts`); with the variable unset
  the real seed is read. `spec/papers-seed.spec.ts` runs against the live stack and checks every seed paper:
  it loads in both languages with six sections, and neither language has an em dash or an en dash.
- **When a slug leaves the files**, the library entries and PDFs that point at it stay in their tables but are
  hidden everywhere (the list, the facets, the entry, the attachment). If the slug comes back, so do they.

## How a private paper is addressed (public ids, #202)

A private paper has two ids. The integer `id` is the internal key: every foreign key (authors, keywords, sources,
library entries, attachments) points at it, and it never leaves the server. `publicId` is what everything
outside uses: a UUIDv7 made by PostgreSQL 18's native `uuidv7()` (time-ordered, opaque, not countable).

- **Resolving.** `PaperIds.resolve(id)` accepts a public paper's slug only; `PaperIds.resolveFor(userId, id)`
  also accepts the caller's own private paper by UUID. Malformed, unknown and someone else's ids are the same
  404, so a caller learns nothing by trying. It is a service rather than a route pipe on purpose: a pipe runs
  after the global `ValidationPipe`.
- **A library entry or a PDF points at a public paper by `paperSlug` and at a private one by `paperId`,** exactly
  one of the two (a check constraint). `paper-ref.ts` is the type (`PaperRef`) every service passes around.
- **No old links.** The integer ids of before #202 are gone with the public rows (see the migration below).

## Migration 025: public papers become files

`1764000000025-PublicPapersAreFiles` is a product decision, not only a refactor: the public rows readers created
before it are **discarded**, together with the library entries, PDFs and discussion boards that pointed at them.
A private paper, its PDF and its entry are untouched. The same migration drops the Research Analysis tables
(`paper_analysis`, `paper_analysis_event`), the staff roles that only served the curator workflow (`user.roles`)
and the unique indexes that only made sense for shared rows (`UQ_paper_doi`, the fingerprint one), and makes
`paper.ownerId` required, because every row left is a reader's own paper. It is irreversible (`down` throws):
take a database backup before deploying it.

## When two private papers are the same paper

Only within one reader's papers (the public papers are files, a DOI is unique among them by the boot check):

1. **By DOI.** The DOI is normalized first (lowercase, no `https://doi.org/`, `dx.doi.org` or `doi:` prefix).
2. **By fingerprint, when the DOI is missing on either side.** The fingerprint is a hash of the normalized
   title (case, accents and punctuation ignored), the publication year, and the first author's family name
   ("Lovelace, Ada" and "Ada Lovelace" agree). A record with a *different* DOI is a different paper even when
   title, year and author agree (a preprint and its published version).
3. A paper with no DOI needs a publication date or at least one author, otherwise the fingerprint is just a
   title and would merge unrelated papers called "Introduction". Without them the write is refused (400).

`PapersService.addPrivate` looks only at the reader's own papers and takes a per-reader advisory lock, since no
unique index covers private papers: two adds at once cannot both miss the other. It records Crossref (or
`manual`) and the DOI as the paper's provenance in `paper_source`, which no public route selects.

## Adding a paper (DOI import and by hand, #212)

Adding a paper is only for the reader's own library. Nothing a reader does writes to the public papers: they are
files (#213), and what a reader adds is a private paper only they can reach
(see "Private papers" below). Every route needs a session.

| Route | What it does |
| --- | --- |
| `POST /api/paper-library/import/preview` `{ doi }` | Looks the DOI up at Crossref and says what adding it would do. Changes nothing. |
| `POST /api/paper-library/import` `{ doi }` | Adds it to the library: 201 when it joined, 200 when it was already there. |
| `POST /api/paper-library/manual` | Adds a paper typed in by hand (201), or 409 `already_exists` with the `paperId` the reader already has. |

The answer of `import` and `manual` is `{ paperId, private, matched, created, library }`, the same as a PDF drop
without the attachment. `preview` answers `{ doi, source, candidate, match }`, where `match` is
`{ paperId, title, private, inLibrary }` or null.

- **Provider: Crossref** (`crossref.client.ts`), free and without a key. `CROSSREF_MAILTO` (optional, server side
  only) puts requests in Crossref's polite pool and goes in the user agent; `CROSSREF_BASE_URL` points tests at a
  stub. Nothing of the reader is ever sent to Crossref. OpenAlex or another source can be added as enrichment if
  Crossref turns out to be thin, but nothing needs it yet.
- **The metadata comes from the server, never from the request.** `import` fetches the DOI itself, so a client
  cannot add text it made up under a Crossref label. A lookup is kept five minutes, so the preview and the
  import that follows it cost one request and show the same record.
- **Mapping**: JATS markup in titles and abstracts becomes plain text with blank-line paragraphs; names become
  authors (ORCID kept when well formed, at most 500 authors); `issued` becomes a `YYYY`, `YYYY-MM` or `YYYY-MM-DD`
  date; Crossref's `type` maps to the paper types (`proceedings-article` to `conference-paper`, `posted-content`
  to `preprint`...); journal subjects become keywords. The publisher's full-text `link` entries are ignored on
  purpose: adding metadata never fetches or points at a publisher PDF.
- **Nothing merges.** A DOI that is a public paper (`PapersCatalogService.slugOfDoi`) puts that paper in the
  library (`matched: true`, nothing is copied). Otherwise a new private paper is created, with Crossref and the
  DOI as its provenance in `paper_source`. Two readers adding the same DOI each get their own paper.
- **By hand** refuses a paper the reader already has with 409 `already_exists` instead of repeating it, and
  works when Crossref is down or does not know the DOI. A hand-typed DOI that is a public paper uses that
  paper and ignores what was typed.
- **Failures** are answered with a stable `code`: `invalid_doi` (400, before any request to Crossref),
  `not_found` (404), `rate_limited` (429, the provider's `Retry-After` in `retryAfter`), `provider_unavailable`
  and `provider_invalid` (502), `private_papers_limit` (409, see the limit below), and `too_many_requests` (429,
  ours: 20 lookups and 20 creations per reader per ten minutes, per process).

## A reader's library (`/api/paper-library`)

A `paper_library_entry` says "this user keeps this paper": reading status (`to-read`, `reading`, `read`), an
optional rating from 1 to 5, the day it was finished, and the reader's own tags. The paper stays shared;
the entry is the only thing that is private. An entry of a public paper is hidden while its slug is not in the
files (see above).

- **One entry per user and paper** (unique constraint). Adding what is already there answers 200 and changes
  nothing, so a double click cannot reset a status. This is a product decision: one paper is one entry, not
  one per context. Grouping (folders and collections) belongs to #188 and does not need a second entry.
- **Privacy is by construction.** Every route takes the user id from the session cookie and addresses an
  entry by the paper's public id (a slug or a UUID), so there is no entry id of someone else's to guess. Another reader's paper is
  indistinguishable from one that is not in your library (404), and deleting it is a no-op (204).
- **Dates.** `addedAt` is set on insert. `completedAt` is a calendar day (no time zone) and exists only while
  the status is `read` (a check constraint). Moving to `read` without a day dates it today; the reader may
  give a past day, or clear it; moving away from `read` clears it. A future day is refused.
- **Tags** are the reader's own labels, not the paper's keywords: lowercase, trimmed, no repeats, at most 20
  of 40 characters, no control characters. A change replaces the whole list.
- **List.** `GET /api/paper-library` takes the catalog filters (`q`, `author`, `doi`, `keyword`, `area`,
  `type`, `year`) plus `status`, `tag` and `sort` (`added`, `title`, `completed`, `rating`). `GET
  /api/paper-library/facets` counts the reader's papers per status and per tag for the filter controls.
- A paper does not need a PDF to be in a library; the private PDF upload (#183) attaches to the paper later.
- A paper that exists only in one reader's library (#203) is covered in its own section below.

## Private papers (a reader drops a PDF, #203)

A reader can keep a paper that is not one of the public ones. `paper.ownerId` is the owner's user id (deleted
with the user). A private paper is a real `paper` row, so its library entry, attachment, tags and status work
exactly as for a public one; what changes is who can reach it.

- **Adding one.** `POST /api/paper-library/private?title=...&doi=...` with the PDF as the raw body (like the
  attachment upload) and its name in `X-Filename`. The title is required (plain text, up to 300 characters);
  the DOI is optional. The PDF goes through the same upload as an attachment: size limit, content scan, the
  per-reader quota. 201 when the paper joined the library, 200 when it was already there (the PDF only gained a
  version).
- **A DOI that is a public paper** adds that paper to the library with the PDF attached, and creates nothing
  (`matched: true`, `private: false`).
- **A DOI that is not** is kept on the private paper (normalized).
- **The other two ways in** are the DOI and the form (see "Adding a paper" above); all three make the same kind
  of private paper and share the limit and the library entry.
- **Excluded from everything public.** The public routes only know slugs, so a private paper's UUID is a 404
  there, the same as an id that does not exist, and no discussion, notification or sitemap entry exists for it.
- **Read through the library.** `GET /api/paper-library/:paperId/paper` returns the paper for an entry in the
  reader's library (a public or their own private one), so the library page never needs the public route.
- **Limits.** The PDF rules and quota of #183, and `PAPER_PRIVATE_MAX_PER_USER` private papers per reader
  (default 100, 409 `private_papers_limit`) for all three ways in (the cap is read on each add, so a test can set
  it). The count is not locked, so two adds at the same instant can pass the cap by one.
- **Deleting.** `DELETE /api/paper-library/:paperId` on a private paper deletes the paper itself: the library
  entry and the attachment go by cascade, and the trigger of #183 queues the stored PDF for deletion (storage
  catches up within the maintenance interval). A failed drop (a PDF that is refused) leaves no paper behind.
  Removing a public paper from the library only removes the entry.

## Where a paper stands (publication stage, #201)

**Product rule: every surface that shows a paper says where it stands.** A reader who has never read a paper
does not know that a preprint was shared before other experts checked it, and must not take "a study said so"
for the truth. The API returns `stage` next to `type` (in the list, in the full record and in the write
results), and every screen that shows a paper (catalog, library, the public page, the library page of a paper)
shows it. A new surface (annotations, shared notes, reading groups) carries it too.

| `type` | `stage` | What the reader is told |
| --- | --- | --- |
| `preprint` | `preprint` | Not reviewed yet: results may change or be wrong, so it is work in progress. |
| `journal-article`, `conference-paper`, `book-chapter`, `book` | `published` | Appeared in a venue that normally reviews before accepting; one study is never the final word. |
| `thesis` | `thesis` | Examined by a university committee, which is not a journal review. |
| `report` | `report` | Published by an institution or a company; independent review is not implied. |
| `other` | `unknown` | We do not know whether anyone reviewed it. |

- It follows from the type alone (`paper-stage.ts`), so there is one place to change it and no column to fall out
  of date. It says what kind of venue the paper appeared in, never that a review of this particular paper took
  place, and nothing is styled as a "verified" badge. Preprints and unknown papers are flagged in amber.
- `GET /api/papers?stage=published` filters by it (a stage is the set of types that make it up).
- Not done yet: linking a preprint to its published version (Crossref `relation`) and retraction notices.

## What is not here

- No editor and no HTTP write for the public papers: a paper is added by a change to the files.
- Linking a preprint to its published version and retraction notices (see the stage section).
- Publishing a private paper to the public ones: it needs a decision about rights.
