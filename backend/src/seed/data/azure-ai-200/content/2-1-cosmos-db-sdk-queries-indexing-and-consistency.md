---
version: 1.0
updatedAt: 2026-11-14
---
# Azure Cosmos DB for NoSQL: SDK, Queries, Request Units, Indexing and Consistency

> Exam domain: **Develop AI solutions by using Azure data management services (25-30%)**, skill group *Azure Cosmos DB for NoSQL*.

---

## Connect with the SDK

Use Microsoft Entra ID (a managed identity or developer sign-in) instead of account keys whenever the question mentions secrets or least privilege.

```python
from azure.cosmos import CosmosClient
from azure.identity import DefaultAzureCredential

client = CosmosClient(
    url="https://shop-cosmos.documents.azure.com:443/",
    credential=DefaultAzureCredential(),
)
container = client.get_database_client("shop").get_container_client("orders")
```

Create **one** `CosmosClient` for the lifetime of the app and reuse it. It manages connections and caches the account metadata.

### Reads: point read first, query second

```python
# Point read: needs the id AND the partition key value. The cheapest and fastest read.
order = container.read_item(item="order-1001", partition_key="customer-42")

# Parameterized query, scoped to one partition key
items = container.query_items(
    query="SELECT c.id, c.total FROM c WHERE c.status = @status AND c.total > @min",
    parameters=[{"name": "@status", "value": "open"}, {"name": "@min", "value": 100}],
    partition_key="customer-42",
)

# No partition key: the query fans out to every partition, so you must say so
items = container.query_items(
    query="SELECT VALUE COUNT(1) FROM c WHERE c.status = 'open'",
    enable_cross_partition_query=True,
)
```

- A **point read** of a 1 KB item costs **1 RU**. A query that returns the same item costs more.
- Always use **parameters**, never string concatenation.
- A **cross-partition query** costs more RUs and latency than one filtered by the partition key. Pick a partition key that appears in your most common filters and spreads data evenly.

---

## Request Units (RUs)

An RU is the normalized currency for the CPU, memory and IO of an operation. Every response reports its charge in the `x-ms-request-charge` header.

| Throughput mode | Use it when |
|-----------------|-------------|
| **Provisioned (manual)** | Predictable steady traffic |
| **Provisioned (autoscale)** | Variable traffic, scales between 10% and 100% of a maximum |
| **Serverless** | Spiky or small, infrequent workloads |

When a request exceeds the RUs available, the service returns **HTTP 429 (request rate too large)** with a retry-after hint. The SDKs retry automatically a limited number of times. Persistent 429s mean: raise throughput, fix a **hot partition**, or make queries cheaper.

### Ways to lower RU cost

1. Prefer point reads over queries.
2. Filter on the partition key.
3. Project only the properties you need (`SELECT c.id, c.total`, not `SELECT *`).
4. Make sure the filter and `ORDER BY` properties are **indexed**.
5. Use a **composite index** for `ORDER BY` on more than one property.
6. Exclude paths you never query from the index to cut write cost.

---

## Indexing policy

By default Cosmos DB indexes **every property** of every item (`indexingMode: consistent`). You tune that with a JSON policy:

```json
{
  "indexingMode": "consistent",
  "automatic": true,
  "includedPaths": [{ "path": "/*" }],
  "excludedPaths": [
    { "path": "/payload/*" },
    { "path": "/_etag/?" }
  ],
  "compositeIndexes": [
    [
      { "path": "/status", "order": "ascending" },
      { "path": "/createdAt", "order": "descending" }
    ]
  ]
}
```

| Setting | Meaning |
|---------|---------|
| `indexingMode: consistent` | The index updates synchronously with each write (default) |
| `indexingMode: none` | No index. Only point reads by id and partition key work |
| `includedPaths` / `excludedPaths` | What to index. Excluding large, never-queried blobs lowers RUs and storage |
| `compositeIndexes` | Required for `ORDER BY a, b` and helps multi-property filters |

The more you index, the more each **write** costs. The less you index, the more each unindexed query costs, or the query fails when it needs a missing composite index.

---

## Consistency levels

From strongest to weakest: **Strong, Bounded staleness, Session, Consistent prefix, Eventual**.

| Level | Guarantee | Read cost and notes |
|-------|-----------|---------------------|
| **Strong** | Linearizable. Reads see the latest committed write | Reads use a local minority quorum (two replicas), so **half the read throughput per RU** |
| **Bounded staleness** | Reads lag writes by at most **K** versions or **T** time, whichever comes first | Same 2-replica read cost as Strong. Best in single write region accounts |
| **Session** | Read-your-writes and monotonic reads **within one client session** (uses a **session token**) | Single replica reads. **Default** and the most widely used |
| **Consistent prefix** | Reads never see out-of-order writes. A transaction's writes are visible together | Single replica reads |
| **Eventual** | No ordering guarantee | Single replica reads, lowest latency |

Facts to memorize:

- You set a **default** level on the account. A client or request can **relax** it (use a weaker level) but cannot ask for a stronger one than the account default.
- Strong and bounded staleness reads cost about **twice the RUs** of the other three because they read from two replicas. Write RU cost is the same for all levels.
- Session consistency is **per client** and tracked with a **session token**. If you scale out and different instances must see each other's writes, pass the token along. A client with no token behaves like eventual for that partition.
- Bounded staleness minimum K and T: single-region accounts **10 write operations or 5 seconds**, multi-region accounts **100,000 operations or 300 seconds**.
- **Strong consistency cannot be used with multiple write regions.**
- Changing the account default means you should **recreate the SDK client** (restart the app) so it picks up the new default.

```python
# Relax consistency for a single read (cannot be stronger than the account default)
container.read_item("order-1001", partition_key="customer-42",
                    consistency_level="Eventual")
```

---

## Quick check

1. Cheapest way to fetch one known order? **`read_item` with id and partition key.**
2. Queries with `ORDER BY status, createdAt` fail. **Add a composite index.**
3. Users must always read their own latest write but cross-region ordering does not matter. **Session.**
4. You switched the account to Bounded staleness and clients still behave the old way. **Restart or recreate the SDK client.**

---

## Official documentation

- [Azure Cosmos DB for NoSQL](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/)
- [Consistency level choices](https://learn.microsoft.com/en-us/azure/cosmos-db/consistency-levels)
- [Indexing policies](https://learn.microsoft.com/en-us/azure/cosmos-db/index-policy)
