---
version: 1.0
updatedAt: 2026-11-14
---
# Cosmos DB Vector Search and the Change Feed

> Exam domain: **Develop AI solutions by using Azure data management services (25-30%)**, skill group *Azure Cosmos DB for NoSQL* (embeddings, vector similarity search, change feed processor).

---

## Why store vectors next to the data

An **embedding** is a list of numbers produced by a model (for example an Azure OpenAI embeddings deployment) so that **semantically similar text lands close together**. Cosmos DB for NoSQL stores the vector as a normal property of the item, so the vector and its source data live in one document with one consistency model, with no second database to synchronize.

```json
{
  "id": "doc-17",
  "tenantId": "contoso",
  "title": "Return policy",
  "text": "Items can be returned within 30 days...",
  "contentVector": [0.0132, -0.0451, 0.0087]
}
```

---

## Step 1: enable the feature

Vector search is a per-account capability:

```bash
az cosmosdb update --resource-group rg-ai --name shop-cosmos \
  --capabilities EnableNoSQLVectorSearch
```

It is auto-approved but can take about 15 minutes. Once enabled on a container it **cannot be disabled**, and it is **not supported on accounts with shared throughput**.

## Step 2: container vector policy

The vector embedding policy tells the engine what the vectors look like. One policy per path.

| Property | Meaning | Values |
|----------|---------|--------|
| `path` | Where the vector is | Required, for example `/contentVector` |
| `dataType` | Element type | `float32`, `float16`, `int8`, `uint8` |
| `dimensions` | Length of every vector | Default **1536**. Must match your embedding model |
| `distanceFunction` | How "close" is measured | `cosine` (default), `dotproduct`, `euclidean` |

Using `float16` instead of `float32` roughly **halves storage** at a small accuracy cost.

## Step 3: vector index

| Index type | Search | Max dimensions | Use it when |
|------------|--------|----------------|-------------|
| `flat` | Exact brute force, **100% recall** | **505** | Small, filtered searches |
| `quantizedFlat` | Brute force over compressed vectors | 4096 | Roughly **50,000 vectors or fewer** per search scope |
| `diskANN` | **Approximate** nearest neighbor | 4096 | More than ~50,000 vectors, large scale, lowest latency and RU |

- `quantizedFlat` and `diskANN` need **at least 1,000 vectors** indexed to quantize accurately. With fewer, the engine falls back to a full scan and RU charges can be higher.
- You **cannot change** a vector embedding policy or vector index settings in place. You drop the policy or index and add it again with the new configuration.
- Add the vector path to `excludedPaths` (as `/contentVector/*`) so the vector is only indexed by the vector index and not also as an ordinary array property. The reference examples do this.
- Wildcards and vector paths nested inside arrays are not supported.

```python
from azure.cosmos import PartitionKey

vector_policy = {
    "vectorEmbeddings": [{
        "path": "/contentVector",
        "dataType": "float32",
        "distanceFunction": "cosine",
        "dimensions": 1536,
    }]
}
indexing_policy = {
    "indexingMode": "consistent",
    "includedPaths": [{"path": "/*"}],
    "excludedPaths": [{"path": "/_etag/?"}, {"path": "/contentVector/*"}],
    "vectorIndexes": [{"path": "/contentVector", "type": "diskANN"}],
}

container = database.create_container_if_not_exists(
    id="docs",
    partition_key=PartitionKey(path="/tenantId"),
    indexing_policy=indexing_policy,
    vector_embedding_policy=vector_policy,
)
```

## Step 4: query with `VectorDistance`

```python
query = """
SELECT TOP 5 c.id, c.title,
       VectorDistance(c.contentVector, @embedding) AS SimilarityScore
FROM c
WHERE c.tenantId = @tenant
ORDER BY VectorDistance(c.contentVector, @embedding)
"""
results = container.query_items(
    query=query,
    parameters=[
        {"name": "@embedding", "value": question_embedding},  # same model as the stored vectors
        {"name": "@tenant", "value": "contoso"},
    ],
    partition_key="contoso",
)
```

- **Always use `TOP N`.** Without it the query tries to return many more results and costs more RUs and latency.
- The `WHERE` clause can combine ordinary filters with the vector search (for example a tenant or category filter), which is the base of a **RAG** retrieval step.
- Use the **same embedding model** and the same dimensions for the stored vectors and the query vector.
- `diskANN` is approximate: the same query can return a slightly different order or set. If you need exact results, use `flat`. The `VectorDistance` option `searchListSizeMultiplier` trades latency and RUs for recall.
- Indexed vectors work best with **real embeddings**, not random numbers.

---

## The change feed

The **change feed** is a persistent, ordered record of inserts and updates in a container (ordered per partition key). In the default **latest version mode** it shows the latest state of each changed item and does **not** include deletes. **All versions and deletes mode** (preview) also surfaces deletes and intermediate versions.

Typical uses: keep a search index or vector store in sync, trigger downstream work, materialize views, audit.

### The change feed processor

The processor library is a distributed, fault-tolerant consumer. It has four parts:

| Part | Role |
|------|------|
| **Monitored container** | The container whose changes you read |
| **Lease container** | State storage that records progress and coordinates workers. One **lease document per partition range** |
| **Compute instance** | A VM, pod or App Service instance hosting the processor, identified by a unique **instance name** |
| **Delegate** | Your code, called with each batch of changes |

Guarantees and behavior:

- **At-least-once** delivery. If your delegate throws, the same batch is retried from the last checkpoint, so make handlers **idempotent**.
- To avoid being stuck on a poison batch, catch exceptions and write the failed documents to an error queue or container, then continue.
- To **scale out**, run more instances with the **same processor name** and the **same lease container**, but a **different instance name** each. Leases are spread equally across instances. Do not run more instances than there are leases.
- A deployment unit is identified by the processor name plus lease container. Different business flows use different processor names and can share a lease container.
- By default a new processor reads only changes made **after** it first starts. In latest version mode you can set a start time, or read from the beginning.
- A **global** account endpoint with `ApplicationRegion` or `ApplicationPreferredRegions` is the right way to pick a region. A regional endpoint creates region-scoped leases.
- Read operations on both the monitored and lease containers **consume RUs**, so throttling there delays processing.

### Python: use the pull model or Azure Functions

The change feed **processor library exists only for .NET and Java**. In Python and Node.js you either:

1. Use the **change feed pull model**, which gives direct access but leaves **checkpointing (the continuation token) to you**, or
2. Host the processor through an **Azure Functions Cosmos DB trigger**, which runs the processor for you.

```python
# Pull model: you own the continuation token
for change in container.query_items_change_feed(is_start_from_beginning=True):
    handle(change)
```

```python
# Functions Cosmos DB trigger (Python v2 model): the lease container is managed by the trigger
@app.cosmos_db_trigger(
    arg_name="documents",
    database_name="shop",
    container_name="orders",
    connection="CosmosDbConnection",
    lease_container_name="leases",
    create_lease_container_if_not_exists=True,
)
def sync_orders(documents: func.DocumentList):
    for doc in documents:
        upsert_into_search_index(doc)
```

---

## Quick check

1. Vector search returns too much and costs too many RUs. **Add `TOP N`.**
2. 100% recall on a few thousand vectors with at most 500 dimensions. **`flat`.**
3. 2 million vectors, lowest latency. **`diskANN`.**
4. You must change `dimensions` after the container exists. **Drop and recreate the vector policy and index.**
5. A Python app needs a change feed processor. **Functions trigger, or the pull model with your own checkpoints.**

---

## Official documentation

- [Vector search in Azure Cosmos DB for NoSQL](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/vector-search)
- [Change feed processor](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/change-feed-processor)
- [Change feed pull model](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/change-feed-pull-model)
