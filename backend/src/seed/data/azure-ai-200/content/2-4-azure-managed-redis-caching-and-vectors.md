---
version: 1.0
updatedAt: 2026-11-14
---
# Azure Managed Redis: Caching, Expiration and Vector Indexing

> Exam domain: **Develop AI solutions by using Azure data management services (25-30%)**, skill group *Integrate Azure Managed Redis in AI solutions*.

---

## Two jobs for Redis in an AI solution

1. **Cache and short-lived state** in front of a slower store or an expensive model call.
2. **Vector store** with similarity search, for semantic caching, recommendations and LLM conversation memory.

---

## Caching data

### The cache-aside pattern

```python
import json, os, redis

# Host, port and credential come from configuration, never from source code.
r = redis.Redis(
    host=os.environ["REDIS_HOST"],
    port=int(os.environ["REDIS_PORT"]),
    ssl=True,                                      # TLS for every client connection
    password=os.environ["REDIS_ACCESS_TOKEN"],
)

def get_product(product_id: str) -> dict:
    key = f"product:{product_id}"
    if (cached := r.get(key)) is not None:
        return json.loads(cached)                  # cache hit

    product = db.fetch_product(product_id)         # cache miss: go to the source of truth
    r.set(key, json.dumps(product), ex=300)        # store with a 300 second time to live
    return product

def update_product(product_id: str, data: dict) -> None:
    db.save_product(product_id, data)
    r.delete(f"product:{product_id}")              # invalidate on write
```

| Need | Redis feature |
|------|---------------|
| Expire a key automatically | `SET key value EX 300` or `EXPIRE key 300`. Inspect with `TTL key` |
| Invalidate after a change | `DEL key`, or write the new value, or let a **short TTL** bound staleness |
| Avoid thundering herd on popular keys | Add **jitter** to TTLs so many keys do not expire together |
| Find keys by pattern in production | `SCAN` (incremental). **Do not use `KEYS`**, it blocks the server |

Rules of thumb:

- A TTL is the simplest invalidation strategy and the safety net for every other one.
- Cache-aside keeps the database as the source of truth. A cache loss only costs latency.
- Use a **namespaced key** (`product:123`) so you can reason about and delete groups of keys.
- Do not cache what must be exactly current (stock at checkout, balances).

---

## Vector indexing and similarity search

Vector search in Redis comes from the **RediSearch** module, and several facts about it are exam favorites.

| Fact | Detail |
|------|--------|
| Module | **RediSearch** must be **enabled when you create** the Azure Managed Redis instance. **You cannot add modules afterwards.** |
| Tiers | Memory Optimized, Balanced and Compute Optimized support it. **Flash Optimized does not.** |
| Clustering policy | Use **Enterprise** (`EnterpriseCluster`) or **Non-clustered** (`NoCluster`). **`OSSCluster` is not supported** with RediSearch |
| Storage | Vectors live in **hashes** or **JSON** documents, with metadata next to them |
| Index algorithms | **FLAT** (exact brute force) and **HNSW** (approximate graph) |
| Distance metrics | `L2`, `COSINE`, `IP` (inner product) |
| Queries | Top-K **KNN**, vector **range** queries, and **hybrid** search with numeric, text, tag and geo filters |
| Modules and versions | Managed by the service. You cannot load a module or update its version yourself |

### Create an index and run a KNN query

```text
FT.CREATE idx:docs ON HASH PREFIX 1 doc: SCHEMA
    title TEXT
    category TAG
    embedding VECTOR HNSW 6 TYPE FLOAT32 DIM 1536 DISTANCE_METRIC COSINE

# store a document: the vector is raw FLOAT32 bytes
HSET doc:1 title "Return policy" category "returns" embedding <bytes>

# 5 nearest neighbors among documents whose category is "returns"
FT.SEARCH idx:docs "(@category:{returns})=>[KNN 5 @embedding $vec AS score]"
    PARAMS 2 vec <query-bytes> SORTBY score DIALECT 2
```

```python
import numpy as np
from redis.commands.search.query import Query

vec_bytes = np.array(embedding, dtype=np.float32).tobytes()
res = r.ft("idx:docs").search(
    Query("(@category:{returns})=>[KNN 5 @embedding $vec AS score]")
        .sort_by("score").return_fields("title", "score").dialect(2),
    query_params={"vec": vec_bytes},
)
```

Design points:

- `DIM` and the distance metric must match the embedding model. Use **one embedding model per index**.
- Store metadata (document id, tenant, source URL, timestamp) with the vector so you can **filter** and return **citations**.
- **FLAT** for small sets or when you need exhaustive results, **HNSW** for large sets where latency matters more than perfect recall.
- Size the cache for vectors **plus index overhead**. Vector workloads are memory hungry.
- Use TLS, and Microsoft Entra authentication where your client supports it.

### Semantic caching

A **semantic cache** stores LLM answers keyed by the *embedding* of the prompt. For a new prompt you do a KNN search. If the nearest cached prompt is closer than a threshold, return its answer and skip the model call. That cuts cost and latency for repeated questions phrased differently.

---

## Choosing the right store

| If you need | Consider |
|-------------|----------|
| Sub-millisecond vector lookup next to cache, sessions, semantic cache, agent memory | **Azure Managed Redis** |
| Vectors beside operational NoSQL documents | **Azure Cosmos DB for NoSQL** |
| Vectors beside relational data and SQL joins | **Azure Database for PostgreSQL with pgvector** |
| Search-first retrieval with hybrid relevance tuning | **Azure AI Search** |

---

## Quick check

1. You provisioned Managed Redis and now need vector search. **Provision a new instance with RediSearch enabled. Modules cannot be added later.**
2. Which clustering policy breaks RediSearch? **OSSCluster.**
3. Cached product price must refresh within five minutes at the latest. **Set a 300 second TTL, and delete the key on writes if you can.**

---

## Official documentation

- [Vector embeddings and vector search in Azure Managed Redis](https://learn.microsoft.com/en-us/azure/redis/overview-vector-similarity)
- [Azure Managed Redis](https://learn.microsoft.com/en-us/azure/redis/)
- [RediSearch vector queries](https://redis.io/docs/latest/develop/interact/search-and-query/advanced-concepts/vectors/)
