---
name: java-concepts
description: Use when adding, editing, or reviewing an entry in the Java Concepts feature (backend/src/seed/data/java-concepts) — the concepts.json index, a concept's markdown content, or its references. Answers "what sections does a concept need?", "where do the references live?", and "how should the Trade-offs section be written?".
---

# Java Concepts

## Overview

"Java Concepts" is a small CMS-like feature: a JSON index (`concepts.json`) lists
each concept's metadata, and a matching Markdown file per concept holds the actual
content, split into fixed sections by `##` headers. The service
(`backend/src/java-concepts/java-concepts.service.ts`) reads both and merges them —
it does not validate section names, so section titles are a *content convention*,
not an enforced schema. Follow it anyway; the API contract (tested in
`backend/spec/java-concepts.spec.ts`) assumes it.

## File Layout

```
backend/src/seed/data/java-concepts/
├── concepts.json                  ← index: one object per concept
└── content/
    └── <slug>.md                  ← full content for that concept
```

Adding a concept means touching both: an entry in `concepts.json` **and** a
`content/<slug>.md` file with the same slug.

## `concepts.json` entry shape

```json
{
  "slug": "kebab-case-slug",
  "id": 2,
  "title": "Human Title",
  "summary": "One sentence shown in the list view, no markdown.",
  "publishedAt": "YYYY-MM-DD",
  "references": [
    { "label": "Descriptive label — source", "url": "https://...", "type": "doc" }
  ]
}
```

- `id` is a plain integer, highest-first ordering in the list endpoint (`findAll`
  sorts by `id` descending) — the next concept gets the next unused integer, it is
  not derived from anything external (unlike Java Minute episode ids, which mirror
  the Coding Tip number — see `[[project_java_minute_episode_ids]]`, a different
  feature, don't confuse the two).
- `references` here is the **structured** list returned by the API
  (`JavaConceptReference[]`); `type` is `'doc'` or `'video'`.
- `slug` must exactly match the markdown filename in `content/`.

## `content/<slug>.md` structure

Frontmatter, then fixed `##` sections:

```markdown
---
version: 1.0
updatedAt: YYYY-MM-DD
---
## Objective

One paragraph: what the concept is, in plain terms.

## Use Cases

- Bullet list of concrete situations where this applies.

## Deep Dive

### Sub-topic one

Prose + code fences demonstrating the mechanic.

### Sub-topic two

...

## Trade-offs

- **Short bold label** — the trade-off, in prose.

## Documentation Links

- [Label](https://...) — doc
```

`splitSections()` in the service splits the body on `^## `, so headers must be
exactly `##` (not `###`) and in this order for the section list the frontend
expects: `Objective`, `Use Cases`, `Deep Dive`, `Trade-offs`, `Documentation Links`.
The closing `## Documentation Links` section is prose/list only — it's separate
from the structured `references` array in `concepts.json`, kept in sync manually
(same links, human-readable list form here).

## Deep Dive section

Each `###` sub-topic should show the mechanic with a runnable-looking code snippet,
not just describe it — prefer "here's the code, here's what happens" over prose
alone. When a mechanic has a broken/fixed pair (e.g. a compile error and its fix),
show both snippets rather than describing the error in words.

## Trade-offs section — keep it, but demo what's demonstrable

Keep `## Trade-offs` as a bullet list — don't dissolve it into more Deep Dive
subsections. For each bullet, add a **small inline code snippet right under it**
demonstrating the claim, but only when a concrete, reproducible thing exists to
show (a compile error, a runtime exception, a scope rule). Skip the snippet for
bullets that are genuinely subjective/judgment calls with nothing to compile or
run (e.g. "reads unfamiliar to developers used to the old idiom") — leave those
as plain prose and move on. See `content/pattern-matching.md` for the reference
shape: three bullets with a small fenced snippet, one without.

This mirrors the fuller demonstrations already in Deep Dive — the Trade-offs
snippet should be *smaller*, just enough to back the specific claim, not a repeat
of the full Deep Dive example.

## Checklist for a new concept

- [ ] Pick the next unused integer `id` and a kebab-case `slug`.
- [ ] Add the entry to `concepts.json` (summary, publishedAt, structured `references`).
- [ ] Create `content/<slug>.md` with frontmatter + the five `##` sections in order.
- [ ] Deep Dive: one `###` per sub-topic, code-first.
- [ ] Trade-offs: prose bullets, small demo snippet only where one makes sense.
- [ ] Documentation Links: human-readable mirror of `references` from `concepts.json`.
