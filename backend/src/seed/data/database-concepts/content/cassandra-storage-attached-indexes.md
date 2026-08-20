---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Understand what Storage-Attached Indexing (SAI) actually changed when it shipped as a headline feature of Apache Cassandra 5.0: a secondary index that is built into the storage engine itself, indexing memtables and SSTables directly instead of writing to a hidden shadow table. Learn what specifically it fixes about the two older ways of querying on a non-partition-key column — the legacy built-in secondary index (2i) and the materialized view — and where its own limits still push you back toward query-first table design.

## Use Cases

- Filtering on a column that isn't part of the partition key — `country`, `status`, an `age` range — without hand-building and maintaining a second, query-shaped table for it.
- Replacing a legacy `CREATE INDEX` (2i) that has become slow or is throwing tombstone-limit failures, on a column whose cardinality doesn't fit 2i's narrow sweet spot.
- Indexing several columns on the same table cheaply: SAI shares on-disk index structures per SSTable, so a second and third indexed column cost much less than the first, unlike 2i where every indexed column is its own hidden table.
- Serving text search with case-insensitivity, Unicode normalization, or basic tokenization via a built-in or custom analyzer, without standing up a separate search system for it.
- Adding approximate nearest-neighbor (ANN) vector search — `ORDER BY ... ANN OF [...]` — for embeddings stored in a native `VECTOR` column, for RAG and similarity-search workloads.
- Trimming the long tail of low-traffic query variants in an existing data model, while the high-traffic queries still get their own purpose-built table — SAI narrows the margin, it doesn't replace query-first modeling.

## Deep Dive

### The old way, and what was actually wrong with it

Cassandra's data model is partition-first: `SELECT ... WHERE` is efficient exactly when it restricts the partition key, because that's the only predicate the coordinator can use to route the query to the handful of nodes that own the data. Filtering on anything else has always needed help, and Cassandra offered two kinds before SAI, each with real, documented costs.

**Legacy secondary indexes (2i)** are Cassandra's original built-in `CREATE INDEX`. The official docs are blunt about their sweet spot and its edges: "Built-in indexes are best on a table having many rows that contain the indexed value." Push past that sweet spot in either direction and it breaks down. On a high-cardinality column — closer to unique per row — "a query between the fields incurs many seeks for very few results," because the index still has to fan out and check replicas across the cluster for a handful of matches. On a low-cardinality column, it's the opposite failure: "Creating an index on an extremely low-cardinality column, such as a boolean column, does not make sense," since one index value now maps to a huge fraction of the table, producing oversized, hot index partitions. There's also a hard operational trap: "the database stores tombstones in the index until the tombstone limit reaches 100K cells" — after that, "the query that uses the indexed value will fail" outright, which is exactly what happens to a 2i index on a column that gets updated or deleted frequently. Each 2i index is also, mechanically, its own hidden table that duplicates data and consistency work per indexed column, so a table with three legacy indexes pays that storage and write cost three times over.

**Materialized views** are the other pre-SAI answer: a server-managed, denormalized copy of the base table, keyed differently so a query that couldn't hit the base partition key can hit the view's instead. They solve the query-shape problem, but at the cost of a second table Cassandra keeps in sync for you — and "for you" turned out to be the catch. Materialized views remain marked experimental years after their 3.0 introduction and are disabled by default from Cassandra 4.0 onward (`materialized_views_enabled: false` in `cassandra.yaml`), because keeping a denormalized copy consistent with base-table writes, deletes, and repairs is genuinely hard to get right at the engine level. The practical fallback most teams reach for instead — hand-rolled denormalized tables, written to manually on every base-table write — solves the same problem without the experimental label, but makes consistency across tables entirely your own application's job: no foreign keys, no cascading delete, nothing that detects a write that updated one table and missed another.

Both paths share the same root cause: a `WHERE` clause on a non-partition-key column had no efficient, engine-native answer. You either paid 2i's cardinality and tombstone costs, or you paid the operational cost of keeping a second table in sync yourself.

### What SAI is, mechanically

Storage-Attached Indexing shipped as a **GA feature of Apache Cassandra 5.0** (currently at the 5.0.8 patch release). The name is the design: the index is *attached to storage* rather than living in a separate hidden table. Per the official docs, "SAI is deeply integrated with the storage engine and indexes the in-memory memtables and the on-disk SSTables as they are written." Concretely: as data lands in a memtable, indexed column values go into an in-memory index alongside it; when that memtable flushes to an SSTable, SAI writes index components — for string columns, on-disk postings referenced through a byte-ordered trie; for numeric columns, a balanced k-d tree — that live next to, and get compacted alongside, the SSTable's own data. There is no second table, no separate write path, no separate compaction schedule to fall out of sync.

That per-SSTable attachment is what fixes 2i's cost-per-column problem. The docs describe it directly: "SAI disk usage grows only marginally as more columns are indexed on a table/SSTable" because it "shares index elements common to an SSTable." Three SAI indexes on one table are not three hidden tables — they share the underlying SSTable-level bookkeeping.

Syntax is a normal `CREATE INDEX`:

```sql
CREATE TABLE cycling.cyclist_semi_pro (
  id int,
  firstname text,
  lastname text,
  age int,
  country text,
  registration date,
  PRIMARY KEY (id)
);

CREATE INDEX lastname_sai_idx ON cycling.cyclist_semi_pro (lastname)
  USING 'sai'
  WITH OPTIONS = {'case_sensitive': 'false', 'normalize': 'true', 'ascii': 'true'};

CREATE INDEX age_sai_idx ON cycling.cyclist_semi_pro (age) USING 'sai';
```

(`USING 'sai'` and `USING 'StorageAttachedIndex'` are the same implementation — the short name and the fully qualified custom-index class name.) With those indexes in place, queries that used to need `ALLOW FILTERING` or a whole extra table run directly:

```sql
SELECT * FROM cycling.cyclist_semi_pro WHERE lastname = 'Eppinger';
SELECT * FROM cycling.cyclist_semi_pro WHERE age <= 23;
SELECT * FROM cycling.cyclist_semi_pro
  WHERE registration > '2010-01-01' AND registration < '2015-12-31' LIMIT 10;
```

At read time, per the SAI concepts docs, the coordinator picks "the most selective index" to narrow the search first, then — unlike 2i, which uses "at most one column index... per query" — SAI can combine multiple indexes in a single query through what the docs call a Query Plan, iterating and merging streams from more than one index before falling back to post-filtering. There are still real edges: SAI "will process up to two SAI indexes" combined by `AND` before it starts post-filtering the rest, it only works with `Murmur3Partitioner`, it caps at (by default) 10 indexes per table (`sai_indexes_per_table_failure_threshold`), it can't be defined on a single-column partition key, and — same physics as 2i — a query on a genuinely high-cardinality column with a `LIMIT` larger than the number of matching rows can still force a scan across replicas. SAI makes non-partition-key filtering efficient; it does not repeal the fact that only the partition key routes a query to a small set of nodes.

### Text analysis and vector search: SAI's two newer angles

Two capabilities build directly on the same per-SSTable index engine and are worth naming because they're specifically things 2i and materialized views never offered at all, not just did worse.

**Text analysis.** SAI text indexes can go past exact-match equality using the Lucene Java Analyzer API: setting an `index_analyzer` option (a built-in name, or a JSON spec combining a tokenizer with optional filters and char filters) lets a text index tokenize, case-fold, and normalize values for both indexing and query-time matching. It's explicitly scoped, though — SAI "provides basic text analysis, not full-text search"; for a genuine search engine's feature set, the docs point you elsewhere.

**Vector search.** Cassandra 5.0 also introduced a native `VECTOR<type, dimension>` column type, and SAI is what indexes it for approximate nearest-neighbor (ANN) queries:

```sql
CREATE TABLE cycling.comments_vs (
  id uuid,
  comment text,
  comment_vector VECTOR<FLOAT, 5>,
  PRIMARY KEY (id)
);

CREATE INDEX ann_index ON cycling.comments_vs (comment_vector)
  USING 'sai'
  WITH OPTIONS = { 'similarity_function': 'DOT_PRODUCT' };

SELECT * FROM cycling.comments_vs
  ORDER BY comment_vector ANN OF [0.15, 0.1, 0.1, 0.35, 0.55]
  LIMIT 3;
```

`similarity_function` takes `DOT_PRODUCT`, `COSINE`, or `EUCLIDEAN`. This is the feature that put Cassandra 5.0 in the same conversation as dedicated vector databases for embedding-backed RAG workloads — and it exists specifically because SAI's storage-engine-level index architecture had somewhere to attach a k-d-tree-style structure to, which neither 2i's hidden-table model nor a materialized view's denormalization model could have supported.

## Trade-offs

- **SAI is a strictly better secondary index, not a repeal of partition-first modeling.** It fixes 2i's cardinality cliffs and per-column storage cost, and it fixes materialized views' operational fragility by not needing a second table at all — but a query that doesn't restrict the partition key still has to reach out to more of the cluster than a query that does. If a query pattern is genuinely hot, a query-shaped table with the right partition key is still the right answer; SAI is for trimming the long tail of secondary access patterns, not for skipping data-model design.
- **Combining more than two SAI-indexed predicates degrades gracefully, not for free.** `AND` across two SAI indexes stays index-driven; a third predicate onward falls back to post-filtering — still correct, but no longer getting the full benefit of every index involved. A query with four `WHERE` clauses across four SAI indexes is not four times as selective as it looks.
- **The cardinality extremes that hurt 2i can still hurt SAI's *latency*, even though it no longer fails outright.** A `LIMIT` larger than the number of matching rows on a low-selectivity predicate, or an equality match on a near-unique high-cardinality column, can still require touching a large share of the cluster — SAI makes that scan efficient rather than pathological, but it's still a scan.
- **A 1-to-1 column-to-index mapping means SAI doesn't do composite indexing.** Each SAI index covers exactly one column; multiple indexed columns on a table are multiple separate indexes that the query planner combines at read time, not one composite index the way a relational database might offer.
- **Text analysis and vector search are real capabilities, not full replacements for their dedicated counterparts.** SAI's analyzer support is explicitly "basic text analysis, not full-text search," and its ANN vector search is a genuinely useful in-database capability for RAG-style lookups but doesn't carry the tuning surface of a purpose-built vector database. Treat both as "good enough to avoid a second system for common cases," not as a drop-in replacement for Elasticsearch or a dedicated vector store at serious scale.
- **`Murmur3Partitioner`-only and a per-table index cap are real deployment constraints.** A cluster on a different partitioner can't use SAI at all, and the default 10-index-per-table ceiling (`sai_indexes_per_table_failure_threshold`) is a guardrail worth knowing about before a schema migration adds a fifth or sixth index and starts failing.

## Documentation Links

- [Apache Cassandra Documentation — Storage-Attached Indexing (SAI) Overview](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/indexing/sai/sai-overview.html) — doc
- [Apache Cassandra Documentation — Storage-Attached Indexing (SAI) Concepts](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/indexing/sai/sai-concepts.html) — doc
- [Apache Cassandra Documentation — Storage-Attached Indexing (SAI) Quickstart](https://cassandra.apache.org/doc/latest/cassandra/getting-started/sai-quickstart.html) — doc
- [Apache Cassandra Documentation — SAI FAQ](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/indexing/sai/sai-faq.html) — doc
- [Apache Cassandra Documentation — When to Use an Index (legacy secondary indexes, 2i)](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/indexing/2i/2i-when-to-use.html) — doc
- [Apache Cassandra Documentation — Vector Search Quickstart](https://cassandra.apache.org/doc/latest/cassandra/getting-started/vector-search-quickstart.html) — doc
- [Apache Cassandra Blog — Apache Cassandra 5.0 Features: Storage Attached Indexes](https://cassandra.apache.org/_/blog/Apache-Cassandra-5.0-Features-Storage-Attached-Indexes.html) — doc
