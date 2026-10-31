# Papers: the canonical record

A `Paper` is one shared bibliographic record, referenced by public pages and by many users' libraries. It has
no owner: ownership belongs to library entries and contributions, which live in their own tables. PDFs are not
part of it.

## Tables

| Table | Holds |
| --- | --- |
| `paper` | title, abstract, DOI, venue, publication date, URL, research area, type, fingerprint, timestamps |
| `paper_author` | one row per author with a `position`, so order is kept and nothing is a comma-separated string |
| `paper_keyword` | one row per keyword, stored lowercase and unique per paper |
| `paper_source` | one row per write: which source, its id there, the record as received, and the conflicts it had |

`publicationDate` is `YYYY`, `YYYY-MM` or `YYYY-MM-DD`, because scholarly dates are often only a year.

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

## What is not here

Nothing changes a paper that already exists over HTTP. `PapersService.correct` (which keeps the replaced values
in the provenance) has no route yet, because deciding who may correct a paper needs the staff roles of #180.
`spec/papers-app.ts` is a throwaway server used only by the service tests.
