# Papers: the canonical record

A `Paper` is one shared bibliographic record, referenced by public pages and by many users' libraries. It has
no owner: ownership belongs to library entries and contributions, which live in their own tables. PDFs are not
part of it.

## Tables

| Table | Holds |
| --- | --- |
| `paper` | public id, title, abstract, DOI, venue, publication date, URL, research area, type, fingerprint, timestamps |
| `paper_author` | one row per author with a `position`, so order is kept and nothing is a comma-separated string |
| `paper_keyword` | one row per keyword, stored lowercase and unique per paper |
| `paper_source` | one row per write: which source, its id there, the record as received, and the conflicts it had |

`publicationDate` is `YYYY`, `YYYY-MM` or `YYYY-MM-DD`, because scholarly dates are often only a year.

## How a paper is addressed (public ids, #202)

A paper has two ids. The integer `id` is the internal key: every foreign key (authors, keywords, sources,
analysis, library entries, attachments) points at it, and it never leaves the server. `publicId` is what
everything outside uses: a UUIDv7 made by PostgreSQL 18's native `uuidv7()` (time-ordered, opaque, not
countable). It is what the URLs `/papers/:id` and `/library/:id`, the API (`/api/papers/:id`,
`/api/paper-library/:paperId`, `.../attachment`, `.../analysis`), the `id` of every response and the
discussion topic (`paper:<publicId>`) carry.

- **Resolving.** `PaperIds.resolve(publicId)` turns the param into the internal key in each handler. Malformed
  and unknown ids are the same 404, so a caller learns nothing by trying. It is a service rather than a route
  pipe on purpose: a pipe runs after the global `ValidationPipe`, which turns a param typed `number` into NaN.
- **Old links.** `GET /api/papers/<integer>` answers 301 to `/api/papers/<publicId>`, and the SSR server turns
  `/papers/<integer>` (and `/pt-BR/papers/<integer>`) into a 301 to the public page; the library page follows
  the same redirect client-side. Nothing else accepts an integer. The lookup must only ever resolve papers that
  were public before #202 (the whole catalog today): a paper that exists only in one reader's library (#203)
  has no old link and must not be reachable through it. Remove the redirect once no published link uses it.
- **Migration 023** adds the column with `DEFAULT uuidv7()`, which PostgreSQL evaluates for every existing row
  (so the backfill gives each paper its own id in the same statement) and keeps for later inserts. It also
  rewrites the discussion topic keys `paper:<integer>` to `paper:<publicId>`, so existing threads stay on
  their paper; `down` puts them back.
- **Tests that need the integer** (the old-link redirect) get it from the dev-only seed route
  (`POST /api/papers/_test`, `legacyId`), which does not exist in production.

## When two records are the same paper

1. **By DOI.** The DOI is normalized first (lowercase, no `https://doi.org/`, `dx.doi.org` or `doi:` prefix),
   and `paper.doi` is unique, so the same DOI can never create a second paper. Concurrent writes of the same
   DOI end in one paper: the loser of the race hits the unique index and runs again as a merge.
2. **By fingerprint, when the DOI is missing on either side.** The fingerprint is a hash of the normalized
   title (case, accents and punctuation ignored), the publication year, and the first author's family name
   ("Lovelace, Ada" and "Ada Lovelace" agree). Two DOI-less papers cannot share a fingerprint (partial unique
   index).
   - An incoming paper **without** a DOI matches any record with its fingerprint, including one that has a
     DOI, so a DOI-less copy never duplicates a paper we already know.
   - An incoming paper **with** a DOI only matches DOI-less records. A record with a *different* DOI is a
     different paper even when title, year and author agree (a preprint and its published version).
   - A match on a DOI-less record attaches the incoming DOI to it.
   - When several records match, the oldest wins.
3. A paper with no DOI needs a publication date or at least one author, otherwise the fingerprint is just a
   title and would merge unrelated papers called "Introduction". Without them the write is refused (400).

## Merging, conflicts and corrections

Every write goes through `PapersService.upsert` (a source describes a paper) or `PapersService.correct` (a
person fixes one).

- **Import (`upsert`, mode `fill`)** only completes what is empty. A value that differs from a stored one never
  overwrites it: the stored value stays and the disagreement is returned as a conflict and saved with that
  write's provenance. Spellings that differ only in case, accents or punctuation are not conflicts. Keywords
  are added, never removed. The same authors in another spelling are not a conflict, and only complete missing
  ORCID iDs; a different list of authors is a conflict.
- **Correction (`correct`, mode `overwrite`)** replaces the fields it is given, leaves the others, and records
  each replaced value as a conflict with `resolution: "replaced"`. Setting a DOI that belongs to another paper
  answers 409.
- **Provenance.** `paper_source` keeps every write in order with the payload as received, so a rejected value
  from an import can still be reviewed and applied later through a correction.

## Research Analysis

Every paper can have one **published** Research Analysis next to its abstract: six sections (Overview,
Contribution, Methodology, Findings, Critical Analysis, Further Research) written by Kurz, never presented as
the authors' own text.

**Product decision (#180): curator-authored, reviewer-published.** The analyses are written by a small group
of staff, not contributed anonymously. Nothing in this module lets a reader edit an analysis.

| Who | Can |
| --- | --- |
| Anyone | Read the published analysis (`GET /api/papers/:id/analysis`) |
| `paper-curator` | Create and edit the draft (`PUT .../analysis/draft`), read the history |
| `paper-reviewer` | Publish the draft, withdraw the published analysis, read the history |

Holding both roles lets one person do the whole cycle. That is allowed on purpose (the project may start with
one maintainer), and the page then credits the same person as author and as reviewer, so it is visible. To make
review a real second pair of eyes, give the roles to different people.

Roles are the `user.roles` column (`auth/roles.ts`), checked in `PaperAnalysisService` so no route can forget
it. They are granted by whoever has the database, for example:

```sql
UPDATE "user" SET roles = array_append(roles, 'paper-curator') WHERE "githubLogin" = '<login>' AND NOT 'paper-curator' = ANY(roles);
```

There is no HTTP route that grants a role (only the dev-only `_test/roles`). The role is on the user id, not
on an environment list of logins, because a GitHub login can be renamed and then claimed by someone else.

### Content model

`paper_analysis` has one row per revision with `sections` as `jsonb`. Each section is `{ state, text }`:

- `present`: `text` is required (plain text, paragraphs split by a blank line, at most 6000 characters).
- `not_applicable` (the paper has nothing of that kind, such as experiments in a theory paper), `not_reported`
  (the paper does not say) or `unable_to_determine`: no text. Nothing forces an unsupported claim.

A draft may leave sections out (undecided). Publishing needs all six decided, otherwise 422 names the missing ones.
The text is shown as text, never as markup.

### Revisions and history

- A paper has at most one `draft` and one `published` revision (partial unique indexes), so it has zero or one
  current published analysis.
- A published revision is never edited. Changing it means saving a new draft (revision n+1); publishing that
  draft turns the old one into `superseded`. Withdrawing marks it `withdrawn`; publishing again needs a new draft.
- `paper_analysis_event` is the audit trail: `draft_created`, `draft_edited`, `published`, `withdrawn`, each with
  the actor and the time. `GET .../analysis/history` (curators and reviewers) lists every revision with its sections
  and the events. Writers of one paper are serialized by a row lock on `paper`, so two curators saving at the same
  moment end in one draft.
- Drafts are never in a public response. The public analysis names the author and the publisher (display name,
  and a link only when that person made the profile public), nothing else about them.

The server keeps a rendered page per URL for five minutes (`app/src/server.ts`), so a newly published or
withdrawn analysis can take up to that long to show on `/papers/:id`.

## Adding a paper (DOI import and by hand)

A signed-in reader can bring a paper into the catalog in two ways. Both need a session; the catalog itself stays
readable by anyone.

| Route | What it does |
| --- | --- |
| `POST /api/papers/import/preview` `{ doi }` | Looks the DOI up at Crossref and says what importing would do. Changes nothing. |
| `POST /api/papers/import` `{ doi }` | Imports it (201) or matches the paper already there (200). |
| `POST /api/papers` | Adds a paper typed in by hand (201), or 409 `already_exists` with its `paperId`. |

- **Provider: Crossref** (`crossref.client.ts`), free and without a key. `CROSSREF_MAILTO` (optional, server side
  only) puts requests in Crossref's polite pool and goes in the user agent; `CROSSREF_BASE_URL` points tests at a
  stub. Nothing of the reader is ever sent to Crossref. OpenAlex or another source can be added as enrichment if
  Crossref turns out to be thin, but nothing needs it yet.
- **The metadata comes from the server, never from the request.** `import` fetches the DOI itself, so a client
  cannot import text it made up under a Crossref label. A lookup is kept five minutes, so the preview and the
  import that follows it cost one request and show the same record.
- **Mapping**: JATS markup in titles and abstracts becomes plain text with blank-line paragraphs; names become
  authors (ORCID kept when well formed, at most 500 authors); `issued` becomes a `YYYY`, `YYYY-MM` or `YYYY-MM-DD`
  date; Crossref's `type` maps to the paper types (`proceedings-article` to `conference-paper`, `posted-content`
  to `preprint`...); journal subjects become keywords. The publisher's full-text `link` entries are ignored on
  purpose: importing metadata never fetches or points at a publisher PDF.
- **Matching, not duplicating**: an import goes through `PapersService.upsert` (same DOI, or same fingerprint with
  a DOI-less record), mode `fill`. It only completes what is empty; where Crossref disagrees the stored value stays,
  the disagreement is returned as a conflict and saved in `paper_source` with the DOI as `externalId` and the
  retrieval time. A preview shows the match and the conflicts by running the same merge inside a transaction it
  rolls back.
- **By hand never merges**: a hand-made record that matches an existing paper is refused with 409 instead of
  filling its empty fields, so a reader cannot alter a paper that already exists. A paper can still be created by
  hand when Crossref is down or does not know the DOI.
- **Failures** are answered with a stable `code`: `invalid_doi` (400, before any request to Crossref),
  `not_found` (404), `rate_limited` (429, the provider's `Retry-After` in `retryAfter`), `provider_unavailable`
  and `provider_invalid` (502), and `too_many_requests` (429, ours: 20 lookups and 20 creations per reader per
  ten minutes, per process).

## A reader's library (`/api/paper-library`)

A `paper_library_entry` says "this user keeps this paper": reading status (`to-read`, `reading`, `read`), an
optional rating from 1 to 5, the day it was finished, and the reader's own tags. The paper stays shared;
the entry is the only thing that is private.

- **One entry per user and paper** (unique constraint). Adding what is already there answers 200 and changes
  nothing, so a double click cannot reset a status. This is a product decision: one paper is one entry, not
  one per context. Grouping (folders and collections) belongs to #188 and does not need a second entry.
- **Privacy is by construction.** Every route takes the user id from the session cookie and addresses an
  entry by paper id, so there is no entry id of someone else's to guess. Another reader's paper is
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

- There is no editor screen for the analysis yet: curators and reviewers use the API. The endpoints return
  everything an editor needs.
- Nothing changes a paper that already exists over HTTP. `PapersService.correct` (which keeps the replaced values
  in the provenance) has no route yet; the staff roles of #180 now exist, so deciding who may correct a paper
  can build on them.
- `spec/papers-app.ts` is a throwaway server used only by the service tests.
