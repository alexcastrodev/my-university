---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Understand the two search engines MongoDB bolted onto the aggregation pipeline — full-text search through `$search` and semantic vector search through `$vectorSearch` — how both are served by a *separate process* (`mongot`, built on Apache Lucene) rather than by `mongod` and its B-tree indexes, what a search index definition actually declares (analyzers and mappings for text; `numDimensions`, `similarity`, and `quantization` for vectors), how the ANN/HNSW query path differs from an exact `IXSCAN`, and where this sits in a retrieval-augmented generation pipeline. This is a post-2019 capability: the 3rd edition of *MongoDB: The Definitive Guide* — the source for this batch's other MongoDB concepts — does not cover it at all, because at publication these stages did not exist in the product.

> **Naming, as of the current docs.** MongoDB has renamed both features: the documentation now says **MongoDB Search** and **MongoDB Vector Search** rather than *Atlas Search* and *Atlas Vector Search*, precisely because they are no longer Atlas-only (see Trade-offs). The stage names — `$search`, `$searchMeta`, `$vectorSearch` — are unchanged, and older URLs under `/docs/atlas/atlas-search/` and `/docs/atlas/atlas-vector-search/` still resolve to the renamed pages.

## Use Cases

- Replacing a bolt-on Elasticsearch cluster whose only job was to serve a product-catalog search box. MongoDB's pitch is exactly this: "embedded full-text search that gives you a seamless, scalable experience for building relevance-based app features and eliminates the need to run a separate search system alongside your database." One less system to sync, one less system to secure.
- Building a typo-tolerant, autocompleting search field — fuzzy matching, phrase matching, `autocomplete`, faceting, and highlighting are `$search` operators and options, not things you hand-roll with `$regex` and hope.
- Semantic retrieval where keyword matching structurally cannot work: a support-ticket search that should surface "card declined at checkout" for the query "payment keeps failing" even though the two share no terms. Vector search "returns results based on your data's semantic, or underlying, meaning… finds vectors that are close to your search query in multi-dimensional space."
- The retrieval half of a RAG chatbot over your own documents — embed and store chunks at write time, embed the user's question at read time, run `$vectorSearch` for the nearest chunks, then hand those chunks to an LLM as context.
- Recommendation and dedup work that is really nearest-neighbor search: "find products semantically like this one," or "is this new document a near-duplicate of something we already have," where the vector *is* the similarity function.
- Hybrid relevance: a single query that runs both a lexical `$search` and a semantic `$vectorSearch` over the same collection and fuses the two ranked lists with `$rankFusion` (reciprocal rank fusion) or `$scoreFusion` (relative score fusion), because pure-semantic retrieval quietly loses exact-token matches like SKUs and error codes.
- Filtered semantic search that stays correct: `$vectorSearch` accepts a `filter` document evaluated *before* the vector comparison, so "the ten most semantically similar documents **from this tenant, from 2024 onward**" is one stage rather than a vector search followed by a `$match` that throws away most of your `limit`.

### `$vectorSearch` in practice

```js
db.embedded_movies.aggregate([
  {
    $vectorSearch: {
      index: "vector_index",
      path: "plot_embedding",
      queryVector: [0.0123, -0.0456, /* … 2048 floats … */],
      numCandidates: 150,
      limit: 10,
      filter: { $and: [{ genres: "Action" }, { year: { $gte: 2000 } }] }
    }
  },
  {
    $project: {
      _id: 0,
      title: 1,
      score: { $meta: "vectorSearchScore" }
    }
  }
]);
```

## Deep Dive

### A second process, a second index type

The single most important structural fact — and the one that explains almost every trade-off below — is that neither of these features lives inside `mongod`. They are served by `mongot`:

> "`mongot` is the MongoDB Search and MongoDB Vector Search process that powers the `$search`, `$searchMeta`, and `$vectorSearch` aggregation stages. Built on Apache Lucene, `mongot` runs as a separate process from `mongod`."

Its three documented jobs are worth reading literally, because each one has a consequence:

> - "Synchronizes index data from `mongod` over a permanent connection driven by change streams."
> - "Maintains search indexes on dedicated storage."
> - "Serves search queries proxied through `mongod`. Clients never connect to `mongot` directly."

Change-stream-driven synchronization means search indexes are **eventually consistent** with the collection — a write is durable in `mongod` before `mongot` has necessarily indexed it. Dedicated storage means a search index is not a B-tree in your WiredTiger files; it is a Lucene index with its own disk and its own memory budget. And "proxied through `mongod`" is why this still looks like ordinary aggregation from the driver's point of view: you never open a second connection or learn a second query language.

The query path, per the deployment docs: the query reaches `mongod` (or `mongos`), `mongod` routes it to a `mongot`, "the `mongot` process performs the search and scoring and returns the document IDs and other search metadata for the matching results to its corresponding `mongod` process. The `mongod` process then performs a full document lookup implicitly for the matching results and returns the results to the client." That final implicit lookup is a real cost, and it is why both stages support `returnStoredSource: true` — serve a projection straight out of `mongot` and skip the round trip to `mongod` entirely.

A search index is therefore a genuinely different object from a regular index, not a variant of one. MongoDB draws the distinction like this:

> "While both MongoDB Search indexes and MongoDB Indexes make data retrieval faster, they differ. Like the index in the back of a book, a search index is a mapping between terms and the documents that contain those terms. Search indexes also contain other relevant metadata, such as the positions of terms in documents."

They are managed by their own helpers — `createSearchIndex`, `updateSearchIndex`, `dropSearchIndex`, `getSearchIndexes`, and the `$listSearchIndexes` aggregation stage — never by `createIndex`, and `getIndexes()` will not show them.

### `$search`: full-text, and the analyzer decision

`$search` "performs a full-text search on the specified field or fields. The field or fields must be covered by a MongoDB Search index." Its shape is one operator (or one collector) plus options:

```js
db.movies.aggregate([
  {
    $search: {
      index: "default",
      compound: {
        must:   [{ text: { query: "sci-fi thriller", path: "plot" } }],
        should: [{ text: { query: "blade runner", path: "title", score: { boost: { value: 3 } } } }]
      },
      highlight: { path: "plot" },
      scoreDetails: true
    }
  },
  { $limit: 10 },
  { $project: { title: 1, score: { $meta: "searchScore" }, highlights: { $meta: "searchHighlights" } } }
]);
```

Three details in that stage repay attention. `index` is *optional and defaults to `"default"`* — and MongoDB warns that it "doesn't return results if you misspell the index name or if the specified index doesn't already exist," which is the number-one cause of a `$search` that silently returns nothing. `scoreDetails: true` gives a per-document breakdown of how the Lucene score was assembled, the fastest way to answer "why is this result ranked third." And metadata does not come back in the result documents: `$search` "returns only the results of your query. The metadata results… are saved in the `$$SEARCH_META` aggregation variable" — with the restriction that `$$SEARCH_META` "can't be used after the `$lookup` or `$unionWith` stage in any pipeline."

Indexing text is where the real design work is, because it is a tokenization decision, not a field-list decision:

> "When you create a search index, Atlas Search transforms your data into a sequence of *tokens* or *terms*. An *analyzer* facilitates this process… The specifics of tokenization are language-specific and can require making additional choices. Which analyzer to use depends on your data and application."

Mappings can be **dynamic** (index every dynamically indexable field, convenient and expensive) or **static** (name the fields and their types yourself). Built-in analyzers cover the common languages; custom analyzers exist for everything else. Getting the analyzer wrong is not a performance bug — it is a *relevance* bug, and it shows up as "search for 'running' doesn't match 'ran'" rather than as slow queries.

### `$vectorSearch`: embeddings, HNSW, and the two search modes

Vector search asks a different question. Rather than matching terms, it compares positions in a high-dimensional space:

> "Vector embeddings are vectors you use to represent your data. These embeddings capture meaningful relationships in your data and enable tasks like semantic search and retrieval. You create vector embeddings by passing your data through an embedding model."

Note where the work happens: *you* pass the data through an embedding model. MongoDB stores and searches the resulting arrays; producing them is a separate concern (see Trade-offs). The one exception is the preview **Automated Embedding** feature, where an `autoEmbed`-typed index field has `mongot` call a Voyage AI model for you — the only path where MongoDB generates the vectors itself.

A vector index is declared with `type: "vectorSearch"` and a `fields` array. The verbatim syntax:

```js
{
  "fields": [
    {
      "type": "vector",
      "path": "<field-to-index>",
      "numDimensions": <number-of-dimensions>,
      "similarity": "euclidean | cosine | dotProduct",
      "quantization": "none | scalar | binary",
      "indexingMethod": "flat | hnsw",
      "hnswOptions": {
        "maxEdges": <number-of-connected-neighbors>,
        "numEdgeCandidates": <number-of-nearest-neighbors>
      }
    },
    { "type": "filter", "path": "<field-to-index>" }
  ],
  "nestedRoot": "<embedded-document-field-name>",
  "storedSource": { "include|exclude": ["<field-name>"] }
}
```

The verified specifics:

| Option | Allowed values | Notes |
|---|---|---|
| `similarity` | `euclidean`, `cosine`, `dotProduct` | Exactly three — required for a `vector` field. `euclidean` is the only one that also supports `binData(int1)` vectors. |
| `numDimensions` | `1` to `8192` | Hard cap: embeddings must be "less than and equal to 8192 dimensions in length." Binary quantization requires a multiple of 8. |
| `quantization` | `none` (default), `scalar`, `binary` | `scalar` cuts index RAM roughly 3.75×; `binary` roughly 24×. |
| `indexingMethod` | `hnsw` (default), `flat` | |
| `hnswOptions.maxEdges` | `16`–`64` (default `16`) | Edges per HNSW graph node. |
| `hnswOptions.numEdgeCandidates` | `100`–`3200` (default `100`) | Nodes evaluated when finding neighbors. |
| vector BSON type | `double` array, or `BinData` with vector subtype `float32`, `int8`, or `int1` | `binData` cuts on-disk vector storage in `mongod` by 66%. |
| `type: "filter"` fields | any indexed scalar path | Only these paths are usable in `$vectorSearch`'s `filter`. |

Querying is one stage that must come first in the pipeline. `index`, `path`, `queryVector`, and `limit` are required; then you pick a mode:

- **ANN** — the default. MongoDB "supports approximate nearest neighbor (ANN) search with the Hierarchical Navigable Small Worlds algorithm." It requires `numCandidates`, capped at **10,000**, which is the size of the priority queue HNSW traverses. The guidance is blunt: "We recommend that you specify a `numCandidates` number at least 20 times higher than the number of documents to return (`limit`) to increase accuracy and reduce discrepancies between your ENN and ANN query results." Expected recall at a well-chosen `numCandidates` is roughly 90–95% overlap with exact results.
- **ENN** — `exact: true`, and `numCandidates` is then forbidden. It "exhaustively searches all indexed embeddings," which the docs recommend only for accuracy benchmarking, collections under about 10,000 documents, or a pre-filter selective enough to leave under ~5% of the data.

That ANN default is the conceptual break from everything in the indexing concept: an `IXSCAN` is *exact*, and a plan either finds the matching keys or it doesn't. An HNSW traversal is *approximate by construction* — it can miss a true nearest neighbor, and `numCandidates` is the dial that trades latency for recall. "Correct" is a tuning parameter here, not a guarantee.

Results carry a similarity score between 0 and 1 (0 = low, 1 = high), computed per the index's `similarity` function and read via `{ $meta: "vectorSearchScore" }`. Pre-filtering happens inside the stage; post-filtering with a `$match` on the score afterward is legal but throws away work you already paid for. `filter` supports only a fixed operator set — `$eq`, `$ne`, `$gt`, `$lt`, `$gte`, `$lte`, `$in`, `$nin`, `$exists`, `$not`, `$nor`, `$and`, `$or` — and the docs warn that an over-narrow pre-filter "may be too restrictive," excluding semantically relevant results before they can compete.

Both stages carry the same pipeline restrictions: first stage only, and unusable in a view definition or a `$facet` sub-pipeline (`$vectorSearch` additionally cannot appear in a `$lookup` sub-pipeline, though `$lookup` can consume its results).

### The RAG pattern, as MongoDB documents it

MongoDB's own RAG tutorial names three stages, and the split between them is the pattern worth memorizing.

**1. Ingestion.** "Load, process, and chunk your data to prepare it for your RAG application. Chunking involves splitting your data into smaller parts for optimal retrieval." Then "convert your data into vector embeddings by using an embedding model," and store each embedding "as a field alongside other data in your collection." Embeddings sit next to the document they describe — that adjacency is the entire pitch for using an operational database as a vector store.

```python
docs_to_insert = [
    {"text": doc.page_content, "embedding": get_embedding(doc.page_content)}
    for doc in documents
]
collection.insert_many(docs_to_insert)
```

**2. Retrieval.** "To retrieve relevant documents with MongoDB Vector Search, you convert the user's question into vector embeddings and run a vector search query against the data in your MongoDB collection to find documents with the most similar embeddings." The critical invariant: the query must be embedded by the *same model, at the same dimensionality* as the stored documents. Change embedding models and every vector in the collection is now meaningless relative to your queries — a full re-embed and re-index, not a migration.

**3. Generation.** "After you perform a vector search to retrieve relevant documents, you provide the user's question along with the relevant documents as context to the LLM so that it can generate a more accurate response." MongoDB's role ends at step 2; step 3 is your LLM call.

For hybrid retrieval, `$rankFusion` (MongoDB 8.0+) combines ranked lists by reciprocal rank fusion — `reciprocal_rank = 1 / (r + rank_constant)` with `rank_constant` fixed at `60` — while `$scoreFusion` (8.3+) fuses the actual scores after normalization (`none`, `sigmoid`, or `minMaxScaler`). Sub-pipelines may contain only `$search`, `$vectorSearch`, `$match`, `$sort`, or `$geoNear`; they run serially, not in parallel; they must target one collection; and neither stage supports pagination or `$project`. `$rerank`, which reorders results by relevance with a cross-encoder, is **Atlas-only**.

### Memory is the sizing constraint

One line governs capacity planning: "MongoDB Vector Search holds the entire index in memory." Not "prefers to" — holds. The documented per-vector footprint makes the arithmetic concrete: a 1536-dimension OpenAI `text-embedding-ada-002` vector costs 6 kB at full precision; a 2048-dimension Voyage `voyage_3_large` vector costs 8 kB as `float`, 2.14 kB as `int8`, 0.334 kB as `int1`. "The required space scales linearly with the number of vectors that you are indexing and with the vector dimensionality." Ten million 1536-dimension vectors is therefore on the order of 60 GB of RAM before metadata — which is why quantization is not a micro-optimization but the difference between one search tier and four.

Quantization moves the compressed vectors into RAM and keeps full-fidelity copies on disk for rescoring and for ENN, so it changes the *ratio* you must provision: MongoDB recommends "roughly a 4:1 ratio of storage to RAM for scalar quantization or a 24:1 ratio of storage to RAM for binary quantization," plus free disk equal to 125% of the estimated index size. On Atlas, the recommendation for dedicated search nodes is RAM "at least 10% larger than the total size of your MongoDB Vector Search indexes."

## Trade-offs

- **This is no longer Atlas-only — but "self-managed" means you now operate a second daemon.** The honest 2026 answer, verified against the current docs, is that `$search`, `$searchMeta`, and `$vectorSearch` are "available in… MongoDB Atlas; MongoDB Enterprise deployments running version 8.2 or later with the Kubernetes Operator; MongoDB Community deployments running version 8.2 or later." Community gets a Linux tarball or a container image for `mongot`; Enterprise gets it via the Kubernetes Operator, and "MongoDB Enterprise doesn't support standalone tarball or container deployments of `mongot`." So the old vendor-lock-in objection has genuinely weakened — but read what you are signing up for. `mongot` is Linux `x86_64`/`aarch64` only (no native Windows or macOS binaries, no ppc64le, no s390x); there is no `apt`/`yum` package and the tarball ships no `systemd` unit; upgrades, config changes, and both X.509 and SCRAM credential rotation all "require a `mongot` restart"; `mongot` "doesn't provide native application-level encryption at rest," leaving you to encrypt the filesystem yourself; FIPS-validated TLS is unsupported; you configure `mongod`-to-`mongot` TLS and authentication by hand; a multi-`mongot` replica set needs an **L7** load balancer because "an L4 balancer cannot distribute traffic at the gRPC stream level"; and sharded topologies are supported only through the Kubernetes Operator on Enterprise — "the MongoDB Controllers for Kubernetes Operator doesn't support sharded architectures with Community Edition." Atlas remains the low-friction path; self-hosting is now *possible* rather than *equivalent*.
- **The feature sets are close but not identical.** MongoDB's own comparison says query behavior, "Lucene-based scoring and ranking," analyzers, synonyms, and quantization options are "same on Atlas and self-managed." The gaps: `$rerank` is "available only on Atlas"; the `nestedRoot` index option is "not supported on self-managed `mongot`"; `$listSearchIndexes` output differs in shape; the Search Metrics UI, managed alerts, dashboards, and FTDC/log retention do not exist self-managed (you wire up Prometheus against `mongot`'s `/metrics` endpoint); and Automated Embedding is Preview on both platforms. Also note the version floor cuts *both* ways: `mongot` 1.70.1 supports MongoDB Server 8.2 and 8.3 but explicitly **not** 8.0 — so adopting self-managed search can force a server upgrade rather than the reverse.
- **MongoDB does not solve embedding generation for you.** With the exception of the preview `autoEmbed` path (which is Voyage AI models only, text modality only, with a 32,000-token auto-truncation limit and immutable `path`/`model`/`numDimensions` after creation), you supply the embedding model and pay for every call, at ingestion *and* on every query. That is a second vendor, a second latency budget, a second rate limit, and a second failure mode in your read path. It is also a versioning hazard: swapping models invalidates every stored vector, because a query embedded by model B cannot be compared against documents embedded by model A. Budget a full re-embed plus index rebuild as the cost of ever changing your mind — the docs make this irreversible-by-design for `autoEmbed` fields, where `model` and `numDimensions` cannot be edited at all.
- **Index rebuilds are a scaling event, not a background detail.** Because `mongot` keeps the whole vector index in memory on dedicated storage, capacity changes are expensive: "Scaling your cluster by adding search nodes or by changing the search tier triggers a rebuild of the full MongoDB Search index." Atlas softens this on AWS and Azure by restoring "a recent copy of your index in S3 or Azure Blob Storage instead of rebuilding," retaining index files for up to 14 days — but that optimization is unavailable on Google Cloud and unavailable when customer-managed encryption at rest is enabled on the search nodes. Migrating to dedicated search nodes has the same shape: Atlas "doesn't serve queries on the nodes until it successfully builds all the indexes." Self-managed, there is no such shortcut at all, and a major-version `mongot` downgrade "requires a re-sync between `mongod` and `mongot`." Search indexes are also not in your backups in any usable sense: on both platforms, "search indexes in `mongot` can be rebuilt from data restored from MongoDB database snapshots" — rebuilt, not restored.
- **Running search on your database nodes is explicitly a non-production choice.** By default Atlas starts `mongot` "on the same node that runs the `mongod` process when you create your first MongoDB Vector Search index," and shares the RAM: on `M10`/`M20`/`M30` only 75% is left for everything other than the database, giving an `M10` about 1 GB for the vector index. MongoDB's own verdict on that topology: "You might experience resource contention between the database `mongod` and the search `mongot` processes… We recommend this deployment model for only testing and prototyping environments." Production means `M10`-or-higher plus `S30`-or-higher dedicated search nodes — a second bill line — and on AWS and Azure those nodes exist only in a subset of regions, which can constrain where you deploy the cluster itself.
- **Versus a dedicated vector database, "already on MongoDB" is the whole argument — and it is often enough.** The real advantage is not ANN quality; it is that the embedding lives in the same document as the data, so `filter` on tenant/date/status, the full document lookup, transactions, and your existing driver and access control all come for free, with no dual-write pipeline to keep two systems consistent. Pinecone, Weaviate, Qdrant, and friends will generally give you more knobs, more index algorithms, and more aggressive recall/latency tuning; pgvector gives you the same colocation argument if your system of record is Postgres instead. MongoDB's exposed surface here is deliberately narrow — three similarity metrics, HNSW or flat, two HNSW parameters, three quantization modes, 8192 dimensions max, `numCandidates` capped at 10,000. For most application workloads that is sufficient and the operational savings dominate; for a retrieval-quality-critical workload at very large scale, benchmark before assuming parity. Choosing MongoDB here should be a colocation decision, not a "best ANN engine" decision.
- **Eventual consistency and approximate results are both real semantic changes.** `mongot` indexes via change streams, so a document you just wrote may not appear in a `$search` or `$vectorSearch` result yet — read-your-own-writes does not hold for search the way it does for `find()`. And ANN is approximate: the same query can return a slightly different set as the HNSW graph evolves, with roughly 90–95% recall against exact results at recommended settings. Neither is a defect, but both break assumptions carried over from ordinary indexed queries, and neither belongs in a code path that needs an exact, complete answer — for that, use a regular index and `find()`, or accept ENN's cost.
- **Index count and tier limits bite early on small deployments.** Free clusters allow "maximum 3 indexes (search or vector combined)," Flex clusters 10, with a hard ceiling of 2,500 per cluster. Combined with the constraints that you "cannot mix `vector` and `autoEmbed` types in same index definition," cannot index the same embedding field twice, and cannot index embeddings nested inside arrays of documents, a multi-model or multi-tenant-per-index design can run out of index slots on a free or Flex tier well before it runs out of data.

## Documentation Links

- [MongoDB Documentation — MongoDB Search (formerly Atlas Search) Overview](https://www.mongodb.com/docs/search/) — doc
- [MongoDB Documentation — MongoDB Vector Search Overview](https://www.mongodb.com/docs/vector-search/) — doc
- [MongoDB Documentation — $vectorSearch Aggregation Stage](https://www.mongodb.com/docs/vector-search/query/aggregation-stages/vector-search-stage/) — doc
- [MongoDB Documentation — $search Aggregation Stage](https://www.mongodb.com/docs/search/query/aggregation-stages/search/) — doc
- [MongoDB Documentation — How to Index Fields for Vector Search](https://www.mongodb.com/docs/vector-search/index/vector-search-type/) — doc
- [MongoDB Documentation — Retrieval-Augmented Generation (RAG) with MongoDB](https://www.mongodb.com/docs/vector-search/tutorials/rag/) — doc
- [MongoDB Documentation — How to Perform Hybrid Search](https://www.mongodb.com/docs/vector-search/hybrid-search/hybrid-search-overview/) — doc
- [MongoDB Documentation — Review Deployment Options for Vector Search](https://www.mongodb.com/docs/vector-search/deployment/deployment-options/) — doc
- [MongoDB Documentation — MongoDB Search and Vector Search on Self-Managed Deployments](https://www.mongodb.com/docs/search/self-managed/current/) — doc
- [MongoDB Documentation — Known Limitations for Self-Managed mongot](https://www.mongodb.com/docs/search/self-managed/current/limitations/) — doc
- [MongoDB Documentation — Compatibility and Requirements for mongot](https://www.mongodb.com/docs/search/self-managed/current/deployment/compatibility-requirements/) — doc
- [MongoDB Documentation — Vector Quantization](https://www.mongodb.com/docs/vector-search/about/vector-quantization/) — doc
