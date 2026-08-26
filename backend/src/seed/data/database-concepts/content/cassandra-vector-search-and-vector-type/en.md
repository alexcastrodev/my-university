---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Understand Cassandra 5.0's native vector search: the `VECTOR<type, dimension>` CQL type that stores an embedding directly as a column value, and the `ORDER BY ... ANN OF ...` query that finds its approximate nearest neighbors. Neither piece is a separate subsystem bolted onto Cassandra — the vector column is an ordinary fixed-length CQL type, and the ANN query is answered by Storage-Attached Indexing (SAI), the same storage-engine-integrated index architecture that indexes text and numeric columns. Vector search is SAI's index type applied to vectors, not a parallel mechanism with its own storage engine, write path, or query planner.

## Use Cases

- Retrieval-augmented generation (RAG): embed document chunks into a `VECTOR` column at write time, embed the user's question at query time, and run `ORDER BY ... ANN OF [...]` to pull the nearest chunks as LLM context — without standing up a separate vector database next to Cassandra.
- Semantic search over content that keyword matching structurally misses — surfacing a support ticket about "card declined at checkout" for a search on "payment keeps failing," because the embeddings are close even though no terms match.
- Recommendation and near-duplicate detection: "products semantically similar to this one" or "is this new document close to something already stored" is exactly an ANN query once both sides are embedded.
- Adding vector search to a table that already has other SAI indexes and a normal partition key, so a single `SELECT` can restrict by tenant or partition first and then rank by embedding similarity within that narrowed set, instead of running a full-table vector scan.
- Keeping the embedding, its source text, and its metadata (author, timestamp, tenant ID) in the same row of the same table SAI already indexes, rather than syncing a document store to an external vector index.

## Deep Dive

### The `VECTOR` type is a normal CQL type, not a special case

Per the CQL type reference, a vector is "a fixed length non-null, flattened array of float values." The declared syntax is `vector<float, dimension>` (case-insensitive, commonly written `VECTOR<FLOAT, dimension>`), and only `float` elements are supported — there is no `vector<int, ...>` or `vector<double, ...>`. Values use the same bracketed literal syntax as a CQL list:

```sql
CREATE TABLE cycling.comments_vs (
  id uuid,
  comment text,
  comment_vector VECTOR<FLOAT, 5>,
  PRIMARY KEY (id)
);

INSERT INTO cycling.comments_vs (id, comment, comment_vector)
  VALUES (uuid(), 'Great climb!', [0.45, 0.09, 0.01, 0.2, 0.11]);
```

Two constraints follow directly from "fixed length": every value in a `VECTOR` column must have exactly the declared dimension count, and elements can't be updated individually — `UPDATE ... SET comment_vector = [...]` replaces the whole vector, there's no per-position write. A vector column can also be added to an existing table with `ALTER TABLE ... ADD comment_vector VECTOR<FLOAT, 5>`.

### Indexing it: this is SAI, not a separate engine

A `VECTOR` column is unqueryable by similarity until it has an index, and that index is created exactly the way any other SAI index is — `CREATE INDEX ... USING 'sai'` — because vector search *is* SAI's `VECTOR` support, using the same per-SSTable, storage-engine-attached index architecture documented for text and numeric SAI indexes:

```sql
CREATE INDEX ann_index ON cycling.comments_vs (comment_vector)
  USING 'sai'
  WITH OPTIONS = { 'similarity_function': 'DOT_PRODUCT' };
```

`similarity_function` accepts `DOT_PRODUCT`, `COSINE`, or `EUCLIDEAN`, and should match how the embedding model that produced the vectors expects distance to be measured — a model normalized for cosine similarity gives meaningless rankings under Euclidean distance and vice versa. Under the hood, SAI's vector index doesn't use the same on-disk structures it uses for text (tries) or numbers (k-d trees); per the official vector search concepts docs, "SAI uses JVector, an algorithm for Approximate Nearest Neighbor (ANN) search and close cousin to Hierarchical Navigable Small World (HNSW)." JVector "achieves this goal by creating a hierarchy of graphs, where each level of the hierarchy corresponds to a `small world` graph that is navigable," and "is inspired by DiskANN, a disk-backed ANN library, to store the graphs on disk" — a graph index built and compacted alongside the SSTable, the same attachment model the sibling SAI concept describes for text and numeric indexes, just with a different on-disk structure suited to nearest-neighbor graph traversal instead of range or prefix lookups.

### Querying: `ORDER BY ... ANN OF ...`

The query replaces an equality or range predicate with a similarity ordering:

```sql
SELECT * FROM cycling.comments_vs
  ORDER BY comment_vector ANN OF [0.15, 0.1, 0.1, 0.35, 0.55]
  LIMIT 3;
```

`LIMIT` is not optional — a query without one fails outright — and it's capped: the docs state "the limit must be 1,000 or fewer." "ANN" is the operative word: the docs are explicit that this returns an approximation, "in most cases yields results almost as good as the exact match," and that "least-similar searches are not supported" — you can only ask for the nearest neighbors, never the farthest.

To retrieve the actual similarity score rather than just an implicit ranking, SAI exposes matching scalar functions — `similarity_dot_product`, `similarity_cosine`, `similarity_euclidean` — callable against the same column and query vector used in the `ORDER BY`:

```sql
SELECT id, comment, similarity_cosine(comment_vector, [0.2, 0.15, 0.3, 0.2, 0.05]) AS score
FROM cycling.comments_vs
ORDER BY comment_vector ANN OF [0.2, 0.15, 0.3, 0.2, 0.05]
LIMIT 3;
```

### Hybrid search: combining `ANN OF` with other predicates

Because the vector index is an SAI index like any other, a query can restrict on a partition key or another SAI-indexed column and rank by similarity within that narrowed set in the same statement — the SAI query planner behavior the sibling concept describes (picking the most selective index, combining more than one via a Query Plan) applies here too. Apache's CEP-30 design document for ANN vector search gives the shape of it:

```sql
SELECT id, v FROM keyspace.table
  WHERE tenant_id = 1
  ORDER BY v ANN OF [0.2, 0.2]
  LIMIT 4
  ALLOW FILTERING;
```

SAI applies the non-vector filter before or after the vector search depending on estimated selectivity — a highly selective filter (say, a specific partition key) narrows the candidate set before the graph search runs, which is both faster and more accurate than scanning the whole table's vector index and filtering afterward. As with any SAI query, restricting the partition key first is the fast path; a global `ORDER BY ... ANN OF` with no partition restriction has to reach further across the cluster's vector index, same physics as any other non-partition-key SAI query.

### Data modeling: the part that isn't index syntax

The official vector search data-modeling guidance is really about the embeddings themselves, not Cassandra mechanics: "a vector search only works when the vectors have the same dimensions" since cosine and dot-product comparisons require matching dimensionality, and mixing embeddings from different models is explicitly called out as risky — "comparing Word2Vec embeddings with BERT embeddings could be problematic because these models have different architectures." The recommended pattern is to keep the embedding's source material and metadata in the same row: "store relevant metadata about a vector in other columns in your table... if your vector is an image, store the original image in the same table" — which is a natural fit for Cassandra's wide-row model, and is exactly what the CQL example tables above already do by keeping `comment` next to `comment_vector`.

### The same need, a different product's native answer

Every major database in this NoSQL-expansion project added roughly the same capability around the same time, for the same reason — RAG and semantic search became a mainstream workload — but each shipped it as a natural extension of its own storage model rather than adopting a common design. MongoDB's answer (see `mongodb-atlas-search-and-vector-search`) is `$vectorSearch`, an aggregation stage served by a *separate* Lucene-based process (`mongot`) alongside `mongod`, with index options like `numDimensions` and `similarity` declared in a search index definition and a `filter` document evaluated before the vector comparison. Cassandra's answer keeps everything inside the same engine that already stores and compacts the row: the vector is a native CQL type sitting in an ordinary column, and the ANN index is just another SAI index sharing SAI's per-SSTable attachment, query planner, and `WHERE`-combination behavior — there's no second process and no separate index-definition document to keep in sync with the schema.

## Trade-offs

- **The vector index shares SAI's architecture, but not its on-disk structures.** Text SAI indexes use tries, numeric SAI indexes use k-d trees, and vector SAI indexes use a JVector graph — three different physical layouts under one `CREATE INDEX ... USING 'sai'` syntax and one storage-attachment model. Understanding SAI generally (the sibling `cassandra-storage-attached-indexes` concept) explains the query planner and attachment behavior here, but not the graph-search internals.
- **`similarity_function` must match how the embeddings were produced, and Cassandra can't check that for you.** Picking `EUCLIDEAN` for vectors an embedding model expects to be compared with `COSINE` produces a ranking that runs without error and is simply wrong — this is an application-level contract, not something the schema enforces.
- **ANN means approximate, and the API only goes one direction.** Results are "almost as good as" exact nearest-neighbor, not exact, and "least-similar" queries aren't supported at all — there's no `ORDER BY ... ANN OF ... DESC` for finding the most dissimilar rows.
- **`LIMIT` is mandatory and capped at 1,000.** A vector query with no `LIMIT` fails outright rather than defaulting to some large number, and no `LIMIT` above 1,000 is accepted — this rules out "just fetch everything sorted by similarity" as a pattern.
- **Frequent overwrites or deletes on the vector column degrade search quality, not just speed.** The docs are explicit that vector search "works optimally on tables with no overwrites or deletions" of the vector column, and that a column under churn should expect slower results — a graph index handles steady-state append-and-query workloads better than one with a high update rate on the indexed column itself.
- **Hybrid filtering needs `ALLOW FILTERING` and is still a filter, not a free combination.** Combining `ANN OF` with a `WHERE` clause on a column that isn't the full partition key still asks Cassandra to evaluate a predicate outside its partition-first fast path; a `WHERE` that restricts the partition key first is materially faster than a global vector scan followed by post-filtering, same rule as every other SAI query.
- **This is "good enough to skip standing up a second system" for common RAG and semantic-search workloads, not a purpose-built vector database's tuning surface.** JVector is a real, competitive ANN engine (the same one behind DataStax Astra DB), but Cassandra's vector search exposes one similarity-function choice at index time and no further tuning knobs in CQL itself — comparable in spirit to SAI's text analysis being "basic text analysis, not full-text search."

## Documentation Links

- [Apache Cassandra Documentation — Vector Search Overview](https://cassandra.apache.org/doc/latest/cassandra/vector-search/overview.html) — doc
- [Apache Cassandra Documentation — Vector Search Concepts](https://cassandra.apache.org/doc/latest/cassandra/vector-search/concepts.html) — doc
- [Apache Cassandra Documentation — Working with Vector Search](https://cassandra.apache.org/doc/latest/cassandra/vector-search/vector-search-working-with.html) — doc
- [Apache Cassandra Documentation — Vector Search Data Modeling](https://cassandra.apache.org/doc/latest/cassandra/vector-search/data-modeling.html) — doc
- [Apache Cassandra Documentation — Vector Search Quickstart](https://cassandra.apache.org/doc/latest/cassandra/getting-started/vector-search-quickstart.html) — doc
- [Apache Cassandra Documentation — CQL Data Types (VECTOR)](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/types.html) — doc
- [Apache Cassandra Documentation — Storage-Attached Indexing (SAI) Overview](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/indexing/sai/sai-overview.html) — doc
- [Apache Cassandra Wiki — CEP-30: Approximate Nearest Neighbor (ANN) Vector Search via Storage-Attached Indexes](https://cwiki.apache.org/confluence/pages/viewpage.action?pageId=255069753) — doc
