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

## What is not here

There is no HTTP surface yet, so no authorization decision has been made: the public catalog (#179) and the
metadata import (#181) expose it, and decide who may call `upsert` and `correct`. `spec/papers-app.ts` is a
throwaway server used only by the tests.
