---
version: 1.0
updatedAt: 2026-09-07
---
## Learning Objectives

- Compare hash indexes and B+Trees on the exact axis that separates them: support for range queries and ordering.
- Apply a concrete decision procedure to choose between the two for a given workload.
- Explain why a real system often maintains both kinds of index on different columns of the same table.
- Connect this decision to a real production system's documented indexing default.

## Context & Motivation

The previous four concepts built two complete, independent index structures answering the same underlying question — "find the tuple(s) matching this key without scanning every page" — using genuinely different strategies with genuinely different strengths. This concept doesn't introduce new mechanics; it closes the indexing cluster by making the choice between them explicit, concrete, and decision-procedure-shaped, exactly the kind of judgment call a real schema designer has to make for every column considered for indexing.

## Core Theory

### The one axis that actually decides it

Every other performance characteristic of hash indexes and B+Trees is close enough in practice to not be the deciding factor — the real, structural difference is **whether the index preserves any ordering relationship between keys**:

- A **hash index** deliberately destroys ordering: a good hash function scatters keys so that two numerically adjacent keys are, with high probability, nowhere near each other in bucket order. This buys O(1) expected-time equality lookups (`hash-indexes`), but makes it impossible to answer a range predicate, an `ORDER BY` on the indexed column, or a prefix match — any query needing "everything between X and Y" or "in sorted order" gets no benefit at all and must fall back to a full scan.
- A **B+Tree** preserves ordering by construction: every leaf holds a sorted run of keys, and leaves are linked in sorted order (`b-plus-trees-structure-and-search`). This costs a slightly higher O(logₘ n) for a single equality lookup compared to a hash index's O(1) — but answers range queries, ordered iteration, and prefix matches directly, by finding the starting point once and then walking the leaf chain.

### A concrete decision procedure

Given a column being considered for an index, ask: will queries against it ever need anything other than exact-match equality? If genuinely never (a surrogate ID looked up one value at a time, for instance), a hash index's O(1) lookup is strictly better with no real downside. If range queries, sorting, or prefix matching appear anywhere in the expected query workload — even occasionally — a B+Tree is the only one of the two that can serve them at all, and its equality-lookup cost (a small constant number of extra page fetches versus a hash index) is a modest, predictable price for that flexibility. This is exactly why B+Trees, not hash indexes, are the default index type in essentially every general-purpose relational DBMS: most real workloads mix equality and range predicates unpredictably, and a B+Tree handles both reasonably well, while a hash index handles only one of the two at all.

### Real systems often build both

Nothing prevents a table from having a B+Tree index on one column and a hash index on another — they are independent, per-column structures. A table might have a B+Tree on `created_at` (supporting "orders from the last 7 days" range queries) and a hash index on `session_token` (a pure equality lookup with no conceivable range use), each chosen by exactly the decision procedure above, applied separately to each indexed column based on how that specific column is actually queried.

## Worked Examples

### Example 1 — an equality-only workload favoring a hash index

A `Sessions` table is looked up exclusively by `WHERE session_token = ?` — no range query on session tokens is ever meaningful (tokens are opaque random strings with no ordering semantics an application cares about). A hash index on `session_token` gives O(1) expected lookups with no downside, since the ordering a B+Tree would preserve is never used by any query against this column.

### Example 2 — a range-heavy workload requiring a B+Tree

An `Orders` table is frequently queried with `WHERE order_date BETWEEN ? AND ?` and `ORDER BY order_date`. A hash index on `order_date` would be actively useless for both — the query processor would have no way to use it and would fall back to a full scan of the heap file. A B+Tree on `order_date`, by contrast, answers the range query directly by finding the leaf holding the range's start and walking the leaf chain forward, and answers the `ORDER BY` for free (the leaf chain already returns rows in sorted key order), at the modest cost of O(logₘ n) instead of O(1) for the rare case a query does need an exact single-date match.

### Example 3 — MongoDB's real documented default, cross-checked

`database-concepts`'s `mongodb-indexing-fundamentals` documents that MongoDB's default index type is a B+Tree, used for both single-field and compound indexes, with the query planner choosing among available indexes based on the query's shape — the exact same structural family (and the identical underlying reasoning: most real query workloads eventually need range or sorted access on at least some indexed field) built from scratch in this discipline's previous four concepts. Hash indexes exist in MongoDB too, but as a narrower, opt-in choice for genuinely equality-only fields (notably used internally for sharding on a hashed shard key specifically to spread writes evenly) — a real production system independently arriving at the identical default this concept's decision procedure predicts.

## Common Misconceptions & Pitfalls

- **"A B+Tree is just a strictly better hash index, so why does anyone use hash indexes at all?"** A B+Tree is not strictly better — its equality lookup, while still fast, costs more page I/Os in the worst case than a hash index's O(1), and for a genuinely equality-only, high-throughput workload (the `Sessions` example above), that difference is real and worth taking, not a rounding error; the two structures make a genuine trade-off, not a strict dominance.
- **"Once you index a column with one type, you can't index it with the other too."** A single column can have both a hash index and a B+Tree index simultaneously if the workload genuinely benefits from both access patterns — the query optimizer, several concepts ahead, is exactly the component responsible for choosing which available index (if any) best serves a specific query at execution time.
- **"Choosing an index type is a one-time decision that never needs revisiting."** The right index type is a property of the *query workload*, not the data itself — a column indexed as hash-only because it was believed equality-only can later need range support once a new feature introduces a range query against it, at which point the index type genuinely needs to change, not just be tuned.

## Summary

The choice between a hash index and a B+Tree comes down to exactly one structural fact: a hash index destroys key ordering to buy O(1) equality lookups, while a B+Tree preserves ordering (at a modest O(logₘ n) equality-lookup cost) to support range queries, sorted output, and prefix matching that a hash index cannot serve at all. An equality-only workload should use a hash index; anything else needs a B+Tree — a decision `database-concepts`'s `mongodb-indexing-fundamentals` shows a real production system reaching independently by defaulting to B+Trees and treating hash indexes as a narrow, opt-in choice for genuinely equality-only fields.

## Documentation Links

- [CMU 15-445/645 — Indexes & Filters I Slides](https://15445.courses.cs.cmu.edu/fall2025/slides/08-indexes1.pdf) — covers both index structures side by side, backing this concept's claim that ordering preservation, not raw lookup speed, is the deciding factor between them.
- [Berkeley CS186 — Course Notes (B+Trees, Hashing)](https://cs186berkeley.net/notes/) — the course notes' comparison of B+Tree and hash-index trade-offs, supporting the decision procedure and the equality-vs-range workload examples in this concept.
