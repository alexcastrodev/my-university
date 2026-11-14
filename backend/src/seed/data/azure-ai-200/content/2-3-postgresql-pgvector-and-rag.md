---
version: 1.0
updatedAt: 2026-11-14
---
# Azure Database for PostgreSQL: Schemas, pgvector Indexing and RAG

> Exam domain: **Develop AI solutions by using Azure data management services (25-30%)**, skill group *Azure Database for PostgreSQL*.

---

## Connect with a SDK and Microsoft Entra ID

Azure Database for PostgreSQL flexible server speaks the normal PostgreSQL protocol, so you use a normal driver such as `psycopg`. With Microsoft Entra authentication the **password is a short-lived access token**:

```python
import psycopg
from azure.identity import DefaultAzureCredential

token = DefaultAzureCredential().get_token("https://ossrdbms-aad.database.windows.net/.default").token

conn = psycopg.connect(
    host="shop-pg.postgres.database.azure.com",
    dbname="shop", user="orders-api-identity",
    password=token, sslmode="require",
)
```

Tokens expire, so a long-lived pool must get a fresh token when it opens a new connection.

---

## Model the schema

```sql
CREATE TABLE docs (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id  integer      NOT NULL,
    title      text         NOT NULL,
    body       text         NOT NULL,
    metadata   jsonb        NOT NULL DEFAULT '{}',
    embedding  vector(1536),
    created_at timestamptz  NOT NULL DEFAULT now()
);
```

Choosing types is part of the skill:

| Need | Type |
|------|------|
| Surrogate key | `bigint GENERATED ALWAYS AS IDENTITY` or `uuid` |
| Timestamps | `timestamptz` (never store local time without a zone) |
| Flexible attributes | `jsonb` (indexed with **GIN**) |
| Money | `numeric(p,s)`, never `float` |
| Embeddings | `vector(n)` from **pgvector** |

---

## Enable pgvector

The community calls it *pgvector*, but the extension and binary are named **`vector`**. On Azure you first **allowlist** it, then create it **in every database** where you need it:

```sql
SHOW azure.extensions;          -- is it allowlisted? (set the azure.extensions server parameter)
CREATE EXTENSION vector;
```

---

## Store and query vectors

```sql
-- three distance operators, each with a matching operator class
SELECT id, title FROM docs ORDER BY embedding <->  '[0.1, 0.2, ...]' LIMIT 5;  -- L2 (Euclidean)
SELECT id, title FROM docs ORDER BY embedding <=>  '[0.1, 0.2, ...]' LIMIT 5;  -- cosine distance
SELECT id, title FROM docs ORDER BY embedding <#>  '[0.1, 0.2, ...]' LIMIT 5;  -- negative inner product
```

| Operator | Distance | Operator class for the index |
|----------|----------|------------------------------|
| `<->` | Euclidean (L2) | `vector_l2_ops` |
| `<=>` | Cosine | `vector_cosine_ops` |
| `<#>` | Negative inner product | `vector_ip_ops` |

**The index only helps when the query's operator matches the index's operator class.** A `vector_cosine_ops` index will not accelerate an `ORDER BY embedding <-> ...` query.

Dimension limits: a `vector` column can store up to **16,000** dimensions but can be **indexed** up to **2,000**. Models with more dimensions need `halfvec` (indexable up to 4,000) or a model that supports shorter embeddings.

---

## Index strategies: exact, IVFFlat, HNSW

Without a vector index, PostgreSQL does an **exact** scan: perfect recall, slow on big tables. **Approximate** indexes trade a little recall for speed.

| | **IVFFlat** | **HNSW** |
|---|-------------|----------|
| Idea | Clusters the vectors into **lists**, searches the nearest lists | Multi-layer proximity graph |
| Build parameter | `lists` (rows/1000 up to 1M rows, `sqrt(rows)` above) | `m` (default **16**), `ef_construction` (default **64**) |
| Query parameter | `ivfflat.probes` (default **1**, start near `sqrt(lists)`) | `hnsw.ef_search` (default **40**) |
| Build cost | Fast, small | Slower, more memory |
| Quality and speed | Good, needs data before building | Better recall-speed trade-off |
| Needs data first? | **Yes**, create it **after** loading, because clusters come from the data | No |

```sql
CREATE INDEX ON docs USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX ON docs USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

SET hnsw.ef_search = 100;       -- higher recall, higher latency (per session)
SET ivfflat.probes = 10;
```

### Reducing compute and latency

- Raise **`maintenance_work_mem`** for the session that builds the index. HNSW builds are much faster when the graph fits in it. Do not set it so high that the server runs out of memory.
- Keep the working set (table and index) in memory by choosing a **Memory Optimized** compute tier for vector-heavy workloads. Storage size and tier also decide the IOPS ceiling.
- Lower `ef_search` or `probes` to reduce latency, raise them to reduce missed neighbors.
- Do not build indexes you do not query with. Each one costs write time and space.

---

## RAG with metadata filters

A **retrieval-augmented generation (RAG)** pipeline embeds the question, fetches the closest chunks, and passes them to the model as context. In multi-tenant or permissioned data you **must filter**:

```python
rows = conn.execute(
    """
    SELECT id, title, body
    FROM docs
    WHERE tenant_id = %s AND metadata @> %s::jsonb
    ORDER BY embedding <=> %s::vector
    LIMIT 5
    """,
    (tenant_id, '{"category": "returns"}', str(question_embedding)),
).fetchall()
```

**Filtering caveat.** With an approximate index the filter is applied **after** the index scan. If a condition matches 10% of the rows and `hnsw.ef_search` is 40, you get about 4 matching rows on average, which can be fewer than your `LIMIT`. Fixes:

1. Add a regular index (for example a B-tree on `tenant_id`) when the filter is very selective, so PostgreSQL can filter first and scan exactly.
2. Use **partial indexes** or partition by tenant for a few large tenants.
3. Use **iterative index scans** (`hnsw.iterative_scan`, `ivfflat.iterative_scan`), available from pgvector 0.8.0, which keep scanning until enough filtered rows are found.
4. Raise `ef_search`.

Check the installed version: `SELECT extversion FROM pg_extension WHERE extname = 'vector';`

---

## Connection optimization

Every PostgreSQL connection is a **process**, so thousands of short connections hurt throughput.

| Technique | Effect |
|-----------|--------|
| **Client-side pool** (for example `psycopg_pool.ConnectionPool`) | Reuses connections inside one app instance |
| **Built-in PgBouncer** on flexible server (enable the `pgbouncer.enabled` parameter, connect on port **6432**) | Pools across many app instances and serverless or short-lived clients |
| Keep the app and database in the **same region** | Removes network latency from every query |
| Fewer round trips (batch inserts, `executemany`, `COPY`) | Higher ingestion throughput |
| Reuse prepared statements where the pool mode allows | Less parse and plan work |

Use `EXPLAIN (ANALYZE, BUFFERS)` to confirm the planner used your vector index, not a sequential scan.

---

## Quick check

1. Cosine similarity search should use the index. **Create it with `vector_cosine_ops` and query with `<=>`.**
2. IVFFlat index built on an empty table gives poor results. **Build it after loading data.**
3. Filtered search returns only 3 rows when you asked for 10. **Post-filtering with an approximate index: raise `ef_search`, add iterative scan, or index the filter column.**
4. The extension name to allowlist and create. **`vector`.**

---

## Official documentation

- [Vector search in Azure Database for PostgreSQL](https://learn.microsoft.com/en-us/azure/postgresql/extensions/how-to-use-pgvector)
- [pgvector project](https://github.com/pgvector/pgvector)
- [Azure Database for PostgreSQL](https://learn.microsoft.com/en-us/azure/postgresql/)
