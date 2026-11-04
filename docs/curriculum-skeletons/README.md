# Curriculum skeletons

Planned lessons for the content gaps in issue #245, one JSON file per destination, written before any lesson so the scope, ids, and study order can be reviewed cheaply.

These files live here, and not in `backend/src/seed/data/curriculum/`, on purpose. `CurriculumService` reads `content/<slug>/en.md` for every entry in a `concepts.json` and does not tolerate a missing file, so one entry without its markdown turns the whole discipline's list endpoint into a 500. An entry in `curriculum.data.ts` without lessons brings back the dead cards removed in #244.

## Delivering a skeleton

The PR that delivers a phase does all of this at once, then deletes the skeleton from this folder:

1. Write `content/<slug>/en.md` and `pt-BR.md` for every lesson.
2. Move the entries into the discipline's `concepts.json`, adding `publishedAt` and `references`.
3. For `kind: new`, add the `registry` block to `curriculum.data.ts` and its `pt-BR` strings to `messages.pt-BR.json`. If `achievements` is true, add a manifest entry and run `pnpm achievements snapshot`.
4. Apply any `backlinks`: add a `related` entry to the existing lesson named in `from` and `lesson`. This edits only `concepts.json`, so that lesson's `version` does not change.

## Rules the checker enforces

Run it with:

```
node --experimental-strip-types --no-warnings scripts/check-curriculum-skeletons.mjs --order
```

- `requires` holds slugs of the same discipline. All 800 existing lessons follow this, and `sortByPrerequisites` ignores any other slug, so a link to another discipline belongs in `related`.
- `related` entries are objects, `{label, slug, feature?}`, even inside the same discipline, and `label` must equal the target's title.
- `related` runs from the newer or more advanced lesson to the more foundational one, because the `/map` graph reads it as a prerequisite edge. There are no cycles between disciplines today. When the natural link would create one, it goes in `backlinks` instead, stored on the advanced lesson. A back-link from an existing lesson to `distributed-systems-iii` would create the first cycle, so the Paxos lesson does not get one.
- A new discipline is a chain: each lesson requires the previous one, or the highest-id-first tiebreak would list it backwards.
- Lessons added to an existing discipline keep the existing lessons in their current relative order and stay ahead of its capstone.
