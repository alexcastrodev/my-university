---
version: 1.0
updatedAt: 2026-11-20
---
## Objective

Azure Cosmos DB for NoSQL stores JSON items in containers, and the .NET SDK (`Microsoft.Azure.Cosmos`, "v3") is a thin client over a service whose rules decide everything: a partition key you cannot change, request units (RU) as the bill, five consistency levels, a change feed that is the main built-in way to react to writes. This lesson goes through the SDK in the order the mistakes happen: one `CosmosClient`, the serializer, the partition key, point read against query, errors and 429, consistency, optimistic concurrency, batch and bulk, the change feed processor, authentication, TTL. I ran everything I could against the Cosmos DB Linux emulator (vNext) in a container on arm64, with a fake `TokenCredential` and an HTTP handler that injects 429s. What the emulator does not implement (real RU charges, composite indexes, Entra ID enforcement, multiple regions, partition splits, the account consistency setting) is marked "docs only" and comes from Microsoft Learn pages dated in the text. The EF Core provider is another lesson: [EF Core for NoSQL](/dotnet-concepts/ef-core-nosql-cosmos-db-and-mongodb).

Related: credentials and `ClientOptions` are in [Azure SDK Clients and DefaultAzureCredential](/azure-dotnet-concepts/azure-sdk-clients-and-defaultazurecredential); an Azure Functions trigger on the change feed is in [Azure Functions Isolated Worker](/azure-dotnet-concepts/azure-functions-isolated-worker).

Versions: `Microsoft.Azure.Cosmos` 3.64.0 (released 2026-11-06; 3.65.0-preview.0 also exists), `Newtonsoft.Json` 13.0.4 (must be referenced explicitly, see below), `Azure.Core` 1.44.1 (transitive), TFM `net10.0` (the package targets netstandard2.0), SDK 10.0.100, runtime 10.0.0, emulator image `mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator` tags `vnext-preview` and `vnext-latest` (same digest, version EN20261019, arm64), Docker 29.9.2, Apple M4 Max with macOS 27.2.1. Timings are from that machine, against localhost.

## Use Cases

- Choosing a partition key for a new container and knowing what it locks in.
- Reading a `CosmosException` (404, 409, 412, 429) and deciding whether to retry.
- Reacting to writes with the change feed processor (projections, notifications, search sync) without losing events.
- Explaining why a test passes on the emulator and fails against a real account.
- Moving from account keys to `TokenCredential` and data-plane roles.

## Deep Dive

### The emulator, and what it can and cannot measure

I started it with `docker run -d --rm -p 127.0.0.1:7060:7060 <image>:vnext-preview --port 7060 --protocol https`; it was ready in under 20 s (health probe on 8080). Per the emulator page (checked 2026-11-20): gateway mode only, no authentication enforcement, "Request Units: not yet implemented", composite indexes "planned", stored procedures and triggers "not planned", change feed, batch and bulk supported. The .NET SDK needs HTTPS, so I used `--protocol https`, the public development key from the docs, `ConnectionMode.Gateway`, and an `HttpClientFactory` that accepts the emulator's self-signed certificate (test client only). Measured: default `ConnectionMode.Direct` against it fails with `CosmosException` 400 in 54 ms; `account.Consistency.DefaultConsistencyLevel` is `Eventual` (real accounts default to Session, per the manage-consistency page); `GetFeedRangesAsync()` returns 1 range, so there is no fan-out to observe; and on my first emulator instance `DELETE` of a container returned 500 (Postgres `E58P01`), while on a fresh instance with the same calls it worked, so the lab uses new container names (cause not investigated).

### One CosmosClient per account

The docs (performance tips, 2026-04-27) say one thread-safe `CosmosClient` per account for the life of the application, because it owns connections, the address cache and the account metadata. Registered in DI it is a singleton (see [Azure SDK clients](/azure-dotnet-concepts/azure-sdk-clients-and-defaultazurecredential) for `AddAzureClients`). Measured on the wire, 20 point reads:

```text
new CosmosClient per read    60 HTTP requests (20 x GET /, 20 x GET /dbs/f5/colls/{c}, 20 x GET .../docs/o1)
one shared CosmosClient      22 HTTP requests (1 x GET /, 1 x GET /dbs/f5/colls/{c}, 20 reads)
```
Every new client re-reads account and container metadata; against a real account that is network round trips and, in Direct mode, new TCP connections (docs only). `CosmosClient.CreateAndInitializeAsync(endpoint, key, containers, options)` warms those caches at startup. `Container` objects are cheap proxies: get them once from `client.GetContainer(db, name)`.

Defaults read from a new `CosmosClientOptions`: `ConnectionMode` is `Direct` (TCP; `Gateway` is HTTPS only), `RequestTimeout` 6 s (with my gateway `HttpClientFactory` a 2.5 s response was not cut by a 1 s value, not investigated), `MaxRetryAttemptsOnRateLimitedRequests` and `MaxRetryWaitTimeOnRateLimitedRequests` are `null` (docs: effective 9 retries and 30 s), `AllowBulkExecution` is `false`, and a `ConsistencyLevel` override can only weaken the account level.

Regions (docs only): pass the global endpoint and use `ApplicationRegion` or `ApplicationPreferredRegions`; the change feed processor creates leases scoped to the endpoint, so a regional endpoint creates a second, independent set of leases.

### The serializer, and the Newtonsoft dependency

`Microsoft.Azure.Cosmos` 3.64.0 does not build until you reference `Newtonsoft.Json` yourself (`error : The Newtonsoft.Json package must be explicitly referenced with version >= 10.0.2 ...`, with the escape hatch `AzureCosmosDisableNewtonsoftJsonCheck`). The docs say to use 13.0.3 or newer (the SDK compiles against 10.x, which has a known advisory) and that the reference stays required even with System.Text.Json, because the SDK uses Newtonsoft for its own types. The default serializer is still Newtonsoft; `UseSystemTextJsonSerializerWithOptions` (added in 3.43.0, 2024-09-04 per the changelog) switches user types to System.Text.Json. What happens with a record `Order(Id, TenantId, ...)` (container path `/tenantId`):

```text
default serializer + [JsonPropertyName("id")] (System.Text.Json attribute)  400 "Document does not contain an id field"
default + Newtonsoft [JsonProperty("id")], TenantId unattributed              400 sub=1001 "PartitionKey extracted from document doesn't match the one specified in the header."
SerializerOptions { PropertyNamingPolicy = CamelCase } (Newtonsoft)           stored {"id":"n2","tenantId":"acme",...}
UseSystemTextJsonSerializerWithOptions(CamelCase), record with no attributes  stored {"id":"s1","tenantId":"acme","note":"hello",...}
UseSystemTextJsonSerializerWithOptions(new JsonSerializerOptions())           400 "Document does not contain an id field" (Pascal case Id)
STJ together with SerializerOptions                                           ArgumentException "...Only one can be set."
```
The item must serialize to a lowercase `id` and to the partition key path. With System.Text.Json set a camel case policy once and every type is right; see the [System.Text.Json lesson](/csharp-concepts/system-text-json-serialization-and-options).

### The partition key is the decision

Every item has a partition key value; items with the same value form a logical partition, and the service hashes it to place the partition on a physical partition (partitioning overview, 2026-05-21; limits, 2026-04-27). Limits read from those pages: 20 GB per logical partition, 10,000 RU/s per partition (and therefore per logical partition), 50 GB per physical partition, 2 MB per item, 100 operations per transactional batch, 2 MB per request, partition key value up to 2,048 bytes. Provisioned throughput is divided evenly across physical partitions, so one hot key throttles at its partition's share while the container looks idle. A physical partition splits as data or throughput grows and the logical partitions keep their mapping (docs only: I could not split anything). Rules from the docs: the value should be immutable (moving an item means create new plus delete old, not atomic across partitions), high cardinality, evenly loaded, and match the equality filters of your queries. The key path cannot be changed in place: you copy to a new container (container copy jobs) or add a global secondary index. A query that omits it fans out and costs about 2 to 3 RU extra per physical partition (docs; one range here, so not visible).

Anti-patterns the page lists: `/id` as key for mixed workloads (every non-id query is cross-partition; right for point reads and writes), a low-cardinality field such as `status` (hot partitions), a random GUID your queries never filter on. When one key can exceed 20 GB, a hierarchical partition key allows up to three levels. Measured on the emulator with `new ContainerProperties("hpk", new List<string> { "/tenantId", "/userId" })` and `new PartitionKeyBuilder().Add("acme").Add("u1").Build()`: create and point read with the full key worked, and a query with only the first level (`.Add("acme")`) returned the 1 item.

### Point read, query and request units

`ReadItemAsync(id, partitionKey)` needs both values and goes straight to one partition; `GetItemQueryIterator` runs SQL. The docs: a point read of a 1 KB item costs 1 RU, "point reads cost fewer RUs than queries", and strong or bounded staleness reads cost about twice as much. I could not measure it: the emulator returns `x-ms-request-charge: 1` for everything.

```text
create RU=1  point read RU=1  query RU=1  replace RU=1  delete RU=1    (also 1 for a 5 KB write over raw HTTP, and 1 for a 404)
```
So `RequestCharge` (on every `Response`, `FeedResponse` and `CosmosException`) is flat 1 here and meaningful only against a real account: log it there. Queries, with a parameter and a partition key, and a paged read resumed from a token (measured, 120 items over 3 partition keys of 40):

```csharp
var q = new QueryDefinition("SELECT * FROM c WHERE c.status = @s AND c.total > @min").WithParameter("@s", "paid").WithParameter("@min", 30);
var opts = new QueryRequestOptions { PartitionKey = new PartitionKey("acme"), MaxItemCount = 15 };
using var it = container.GetItemQueryIterator<Order>(q, continuationToken, opts);   // continuationToken is null on the first page
var page = await it.ReadNextAsync();   // page.ContinuationToken: opaque string, null when finished
```

```text
single partition: 10 items; requests: GET pkranges, POST .../docs x-ms-documentdb-partitionkey=["acme"]
no partition key: 30 items; requests: POST .../docs (query plan), POST .../docs x-ms-documentdb-partitionkeyrangeid=0
MaxItemCount=15, token saved between calls: pages of 15, 15, 10; a second CosmosClient resumed from the page-1 token at globex-15
concatenated "... = 'x' OR '1'='1'": 40 items      parameter @s = "x' OR '1'='1": 0 items
```
Always use `WithParameter`: the concatenated version was injectable. The token is a JSON string that holds ranges, so store it as an opaque value, never parse it. An `ORDER BY c.status, c.total DESC` ran fine on the emulator, but the indexing docs say an `ORDER BY` on two or more properties requires a composite index (the emulator has none), so that query returns an error in the cloud. Also on the emulator `MaxItemCount` was ignored when the query had `ORDER BY` (one page of 40). In v3 cross-partition queries run without any switch (the v2 `EnableCrossPartitionQuery` was removed, per the migration page), so forgetting the partition key is silent.

### Errors and the 429

`CosmosException` carries `StatusCode`, `SubStatusCode`, `RetryAfter`, `RequestCharge`, `ActivityId` and `Diagnostics`. Measured on the emulator (a container with `/tenantId`):

```text
read missing id                      404 NotFound, sub 0       read right id with the wrong partition key   404 NotFound, sub 0
create duplicate id (same key)       409 Conflict              create, header key differs from the item     400 BadRequest, sub 1001
create without id                    400 BadRequest            query "SELEKT * FROM c"                      400 "Syntax error, incorrect syntax near 'SELEKT'" (SC1001)
create item of 2 MiB + 10 bytes      413 RequestEntityTooLarge, RU 0   container that does not exist                404 NotFound, sub 1003
stale ETag on replace                412 PreconditionFailed
```
A wrong partition key looks exactly like a missing item, so 404 from a point read means "check both values". The 429s need a real account to occur, so I injected them with a delegating `HttpMessageHandler` (a response with `x-ms-retry-after-ms: 100`, `x-ms-substatus: 3200`) and counted attempts:

```text
2 x 429 then success, defaults        3 attempts, 0.42 s     (waited the 200 ms the header asked for, twice)
always 429, defaults                  10 attempts, 0.93 s, CosmosException 429 sub=3200 RetryAfter=100ms
always 429, MaxRetryAttempts=3        4 attempts, 0.31 s     MaxRetryAttempts=0: 1 attempt, thrown at once
429 retry-after 1500 ms, MaxRetryWaitTime=2 s   2 attempts, thrown at 1.5 s (the next wait would pass the 2 s budget)
```
The SDK retries 429 by itself and honors the server's wait; you see the exception only when retries run out, and `RetryAfter` is the hint for your own backoff (docs: 9 retries and 30 s by default; 408 and 503 are retried for reads, a 412 never). The docs add that SDKs do not retry a write that timed out (it may have reached the service), so a retried create can come back 409. A 429 means the partition is above its RU/s: raise throughput, fix the hot key, or lower concurrency. Do not stack your own retry on top (see [Resilience](/dotnet-concepts/resilience-retries-timeouts-and-circuit-breakers)).

### Consistency levels

Docs (consistency levels page, 2026-04-27). Reads apply to one logical partition; writes always commit to a local majority (3 of 4 replicas) except Strong:

| Level | Guarantee on reads | Replicas read | RPO, single write region, more than one region |
|---|---|---|---|
| Strong | linearizable, latest committed write | 2 (about 2x read RU) | 0 |
| Bounded staleness | lags by at most K versions or T time | 2 (about 2x read RU) | K and T (minimum 10 writes or 5 s single region; 100,000 or 300 s multi-region) |
| Session | read-your-writes and write-follows-reads inside a session | 1, using the token | under 15 minutes |
| Consistent prefix | never out of order; batch writes are seen together | 1 | under 15 minutes |
| Eventual | may be stale or out of order | 1 | under 15 minutes |

Strong is blocked by default for regions more than 5,000 miles apart and cannot be used with multiple write regions; Strong write latency is two round trips between the farthest regions plus 10 ms at p99. Session is the default for new accounts. After each write the service returns a session token, the client caches it per partition and sends it on reads; a different `CosmosClient` (another web node) has no token, so until it writes its reads behave like Eventual, and you flow the token yourself (`response.Headers.Session` into `ItemRequestOptions.SessionToken`; never edit it). A stale token is only a lower bound.

What the emulator let me check (account level Eventual):

```text
write: response.Headers.Session = 0:0#4395; SDK sent no session header by itself on later reads (the account is not Session)
ItemRequestOptions { SessionToken = w.Headers.Session }   wire: x-ms-session-token=0:0#4395
client or request option ConsistencyLevel=Strong or BoundedStaleness   ArgumentException "... is invalid when service is configured with consistency level Eventual" (0 HTTP requests for the request-level one)
client option Session or ConsistentPrefix                   accepted, wire: x-ms-consistency-level=Session  (stronger than the account level; the SDK did not object, not investigated)
```
The docs say a client or request override can only weaken the account level, and that `ReadConsistencyStrategy` (since 3.46; the enum has `Eventual, Session, LatestCommitted, GlobalStrong, LastCommittedSingleWriteRegion` in 3.64.0) allows a stronger read per request. Staleness, replication lag and token behavior across regions are docs only: the emulator has one replica, so no level can be told from another here. Recreate the client after changing the account level.

### Optimistic concurrency, batch and bulk

Each item has an `_etag` that changes on every write; send it back as `IfMatchEtag`. Two writers read the same version (measured):

```text
writer A, IfMatchEtag = its etag     OK, etag changed          writer B, stale etag    412 PreconditionFailed (stored: paid)
writer B WITHOUT IfMatchEtag         OK, silently overwrote 'paid' with 'cancelled'
ReadItemStreamAsync with IfNoneMatchEtag = current           304 NotModified
PatchItemAsync(Increment "/total", 5) with FilterPredicate    OK, total 10 to 15
```
On a 412, re-read, reapply, resend (see [transactions and optimistic concurrency](/dotnet-concepts/transactions-and-optimistic-concurrency)). `TransactionalBatch` is atomic inside one partition key (snapshot isolation, docs):

```csharp
using var r = await container.CreateTransactionalBatch(new PartitionKey("acme"))
    .CreateItem(new Order("b3", "acme", "new", 3)).CreateItem(new Order("b1", "acme", "dup", 0)).CreateItem(new Order("b4", "acme", "new", 4))
    .ExecuteAsync();      // r.IsSuccessStatusCode, r.StatusCode, one OperationResult per operation
```

```text
3 operations, all fine         200 OK, per operation 201,201,200
b1 already exists              batch 409 Conflict, per operation 424,409,424; b3 afterwards: 404 (rolled back)
item of tenant "globex" in a batch for "acme"    400 BadRequest
101 operations                 400 "Request contains too many operations. The maximum number of operations allowed in a single transaction is 100."   (100 operations: 200 OK)
```
A failed batch does not throw: check `IsSuccessStatusCode`, and the culprit is the operation with a code other than 424. Bulk is the other direction, throughput over atomicity: `AllowBulkExecution = true` and many concurrent calls that you `Task.WhenAll`. 600 creates took 1.17 to 1.34 s with sequential awaits and 0.54 to 0.57 s in bulk (two runs, localhost, no throttling); 50 concurrent creates became 1 HTTP request (a batch per partition). A duplicate failed alone with its own 409, on its own task. The docs warn that bulk can add latency, so it is for loaders, not for the request path.

### The change feed processor

The change feed is the ordered log of creates and updates per container. The processor reads it for you: a monitored container, a lease container (state, one lease per physical partition range), a delegate, and an instance name. The lease container may be in another account.

```csharp
var leases = (await db.CreateContainerIfNotExistsAsync("leases", "/id")).Container;
ChangeFeedProcessor processor = orders.GetChangeFeedProcessorBuilder<Order>("billing", HandleAsync)   // processorName: one deployment unit
    .WithInstanceName(Environment.MachineName)          // unique per replica
    .WithLeaseContainer(leases)
    .WithErrorNotification((leaseToken, ex) => { Console.WriteLine(ex is ChangeFeedProcessorUserException ? "handler threw" : "processor error"); return Task.CompletedTask; })
    .Build();
await processor.StartAsync();                           // ... StopAsync() on shutdown
static Task HandleAsync(ChangeFeedProcessorContext ctx, IReadOnlyCollection<Order> changes, CancellationToken ct) { /* ... */ }
```
Measured (poll interval 500 ms, one lease because the emulator has one range):

```text
5 items written, 'billing' started 8 s later (default start)   0 delivered; 3 new items: one call [n1,n2,n3]
n1 updated twice before the next poll                          one call [n1:v3]; v2 never seen
n2 deleted                                                      no call at all
f1 created, handler throws after its side effect               call #3 [f1] -> ChangeFeedProcessorUserException in the error notification -> ~3 s later call #4 [f1]: 2 side effects for 1 change
stopped, s1 and s2 written, new processor with the same name    exactly one call [s1,s2] (resumed from the lease)
new name 'analytics', WithStartTime(DateTime.MinValue.ToUniversalTime())   one call with all 10 current items (n1 once, as v3; n2 absent)
```
Consequences. Delivery is at-least-once (docs, and measured above): the lease advances only after the delegate returns, a thrown exception makes the same batch come again, so the handler must be idempotent: upsert by a deterministic key, or record the id plus version in an inbox in the same transaction as the effect ([Transactional Outbox, Inbox and Idempotent Consumers](/dotnet-concepts/transactional-outbox-inbox-and-idempotent-consumers), [Idempotency](/system-design/system-design-concepts/idempotency)). A batch that always throws is retried forever, so the docs tell you to write failures to an errored-items store and move on. Latest version mode shows only the final state, never deletes and never intermediate versions; the docs suggest a soft delete flag plus TTL to see deletes. The docs also warn that asynchronous work inside the delegate may be checkpointed before it completes (not reproduced). Lease container: one document per range, id built from the processor name, the endpoint host and two resource ids, with `FeedRange`, `Owner` (empty once stopped), `ContinuationToken`, `timestamp`, `Mode` and a `.info` document; it costs RU too, shared by deployment units with different processor names (docs: acquire every 17 s, renew every 13 s, expire after 60 s).

Start time: the default is "now", but an item written within about 1 s before the first start was still delivered (written 0 s before: delivered; 1, 2, 4 s: not), which fits the "implicit StartTime back-off" the 3.60.0 changelog mentions (the window is not documented). The start options only matter when the lease container is first initialized. The estimator (`GetChangeFeedEstimator`) reported lag 0 with 2 pending items on the emulator, so it is docs only. The pull model (`GetChangeFeedIterator<T>(ChangeFeedStartFrom.Beginning(), ChangeFeedMode.Incremental, ...)`) worked: pages of 3, 3, 1, then `304 NotModified` with a continuation token, and a new iterator from that token returned only the later item. Instances with the same processor name and lease container but different instance names share the leases (docs: never more instances than leases, which follow the physical partitions; not measurable with one range).

All versions and deletes mode (docs): `GetChangeFeedProcessorBuilderWithAllVersionsAndDeletes<T>` hands you `ChangeFeedItem<T>` with `Metadata.OperationType` (create, replace, delete, and `timeToLiveExpired`). The account needs continuous backup and the feature turned on, changes are readable only inside the backup retention, you cannot start from the beginning or a past time, and there is no previous version. The state is contradictory in the sources: the processor page (2026-05-18) still calls it preview, while the SDK changelog says 3.60.0 "promotes AllVersionsAndDeletes APIs to GA". The emulator answers `400 "All versions and deletes requires an enabled changeFeedPolicy"`, so nothing past that is measured. The Azure Functions Cosmos DB trigger runs on this same processor and lease container, with the same guarantees (docs only; see the [Functions lesson](/azure-dotnet-concepts/azure-functions-isolated-worker)).

### Authentication: key against Microsoft Entra ID

`new CosmosClient(endpoint, key)` uses the account key, a shared secret with full data access. `new CosmosClient(endpoint, TokenCredential, options)` uses Entra ID. With a hand-written fake `TokenCredential` (no real credential was constructed):

```text
credential asked for scope https://localhost/.default (built from the endpoint host), called once for 6 reads (cached)
request header: Authorization: type=aad&ver=1.0&sig=<token>
all-zero key on the emulator: read OK (the emulator does not validate keys or tokens)
credential that throws: its own exception reaches the caller
```
Docs only: in production pass `DefaultAzureCredential` from the [first lesson](/azure-dotnet-concepts/azure-sdk-clients-and-defaultazurecredential) (or a managed identity credential), and grant data-plane access with Cosmos DB's native RBAC, `Cosmos DB Built-in Data Reader` and `Cosmos DB Built-in Data Contributor` or a custom role. Control-plane Azure roles manage the account and do not read data (the page shows `Cosmos DB Operator` with `listKeys` excluded). The change feed processor needs `readMetadata` and `readChangeFeed` on the monitored container and `items/read`, `create`, `replace`, `delete` and `executeQuery` on the lease container. Setting `disableLocalAuth` to true on the account turns keys off for good; the docs describe `az resource update` and Bicep for it. Keep any key out of `appsettings.json`: [Key Vault and App Configuration](/azure-dotnet-concepts/key-vault-and-app-configuration-in-dotnet).

### Time to live

`DefaultTimeToLive = -1` turns TTL on without expiring anything; an item's `ttl` (seconds since last modified) then applies. Measured: `ttl: 3` item present at 0 s and `NotFound` by 5 s; the item without `ttl` stayed. Docs: an expired item disappears from queries at once but is purged in the background with spare RU, and the latest version change feed does not report it.

### What not to do

- Cross-partition queries by default: a hot read path without a partition key in the filter (about 2 to 3 RU per physical partition extra, docs).
- `ORDER BY` on several properties with no composite index: it passes locally and fails in the cloud.
- A new `CosmosClient` per request (measured above), and sequential awaits in a loader.
- Big items: 2 MB is a hard limit (measured 413) and item size drives RU; split blobs out, store them in Blob Storage and keep the URL.
- SQL built by string concatenation, a status or country as partition key, and a non-idempotent change feed handler.

### Cosmos DB against PostgreSQL JSONB and MongoDB

| | Cosmos DB for NoSQL | PostgreSQL `jsonb` | MongoDB |
|---|---|---|---|
| Atomic scope | one logical partition key (batch, stored procedures) | any rows in a transaction | multi-document transactions across collections, databases and shards |
| JSON indexes | all paths indexed by default, tunable policy | opt-in GIN index on a `jsonb` column | explicit indexes |
| Distribution key | chosen at creation, immutable, copy to change | none in the pages read (single table) | shard key, changeable by resharding |

Sources: the Cosmos partitioning, transactional batch and index policy pages; the PostgreSQL `datatype-json` (8.14.4) and transactions pages; the MongoDB transactions and reshard-a-collection pages. I ran no PostgreSQL or MongoDB here. For the MongoDB side see [Choosing a Shard Key in MongoDB](/databases/database-concepts/mongodb-choosing-a-shard-key) and [multi-document transactions](/databases/database-concepts/mongodb-multi-document-transactions).

### Book vs today

Older books and posts use `Microsoft.Azure.DocumentDB` and `DocumentClient`. Measured from the NuGet registry (2026-11-20): `Microsoft.Azure.DocumentDB` and `Microsoft.Azure.DocumentDB.Core` 2.22.0 (published 2024-03-21) and `Microsoft.Azure.DocumentDB.ChangeFeedProcessor` 2.5.0 (2023-05-16) are deprecated as "Legacy", "obsolete as of 3/31/2023", with `Microsoft.Azure.Cosmos` as replacement; `Microsoft.Azure.CosmosDB.BulkExecutor` last shipped 2.5.1-preview in 2020. The migration page (checked 2026-11-20) says v2 is in maintenance mode, renames `DocumentClient` to `CosmosClient`, Collection to Container and Document to Item, and folds the change feed processor and bulk executor libraries into v3. `FeedOptions.EnableCrossPartitionQuery` is gone, so fan-out is implicit. The serializer moved too: v3 started on Newtonsoft only; System.Text.Json is an opt-in since 3.43.0 and the Newtonsoft reference is still mandatory (measured build error above).

## Trade-offs

- **The partition key trades query shape for scale.** A key that matches your filters keeps queries on one partition and reads cheap, and a wrong choice means a copy to a new container.
- **Latest version change feed is lossy by design.** Intermediate updates and deletes vanish, so it suits "sync the current state", not auditing. All versions and deletes adds them at the price of continuous backup and a preview-or-GA ambiguity.
- **At-least-once pushes work to you.** Every handler needs an idempotency key or an inbox, and a poison batch needs a dead-letter store, or the lease stops moving.
- **Stronger consistency costs RU and latency.** Strong and bounded staleness read from two replicas (about twice the read RU) and Strong adds cross-region write latency. Session is the default and only needs the token passed between nodes.
- **Bulk is throughput, batch is atomicity.** Bulk fails per item and can add latency, a batch is all or nothing but one partition key and 100 operations.
- **The emulator is a smoke test.** It returned RU 1 for everything, ran `ORDER BY` without a composite index, has no Entra ID, one range and Eventual consistency: RU budgets, indexing, RBAC and 429 behavior need a real account.
- **Keys are simple and dangerous.** An account key is full data access in a string. Entra ID with data-plane roles is the production shape and can be enforced with `disableLocalAuth` (docs only).

## Documentation Links

- [Change feed processor in Azure Cosmos DB, Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/change-feed-processor) (doc)
- [Change feed modes in Azure Cosmos DB, Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/change-feed-modes) (doc)
- [Partitioning and horizontal scaling in Azure Cosmos DB, Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/partitioning-overview) (doc)
- [Hierarchical partition keys, Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/hierarchical-partition-keys) (doc)
- [Azure Cosmos DB service quotas, Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/concepts-limits) (doc)
- [Consistency levels in Azure Cosmos DB, Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/consistency-levels) (doc)
- [Request units in Azure Cosmos DB, Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/request-units) (doc)
- [Indexing policies in Azure Cosmos DB, Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/index-policy) (doc)
- [Performance tips for the .NET SDK v3, Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/performance-tips-dotnet-sdk-v3) (doc)
- [Designing resilient applications with the Azure Cosmos DB SDKs, Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/conceptual-resilient-sdk-applications) (doc)
- [Transactional batch operations, Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/transactional-batch) (doc)
- [Optimistic concurrency control, Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/database-transactions-optimistic-concurrency) (doc)
- [Time to live in Azure Cosmos DB, Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/time-to-live) (doc)
- [Connect with role-based access control and Microsoft Entra ID, Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-connect-role-based-access-control) (doc)
- [Azure Cosmos DB Linux emulator (vNext), Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/emulator-linux) (doc)
- [CosmosClientOptions class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.azure.cosmos.cosmosclientoptions) (doc)
- [Migrate to the Azure Cosmos DB .NET SDK v3, Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/migrate-dotnet-v3) (doc)
- [Azure Cosmos DB .NET SDK v3 changelog, GitHub](https://github.com/Azure/azure-cosmos-dotnet-v3/blob/master/changelog.md) (doc)
- [Azure Cosmos DB trigger for Azure Functions, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-cosmosdb-v2-trigger) (doc)
- [JSON types in PostgreSQL, PostgreSQL documentation](https://www.postgresql.org/docs/current/datatype-json.html) (doc)
- [Transactions in MongoDB, MongoDB documentation](https://www.mongodb.com/docs/manual/core/transactions/) (doc)
- [Reshard a collection in MongoDB, MongoDB documentation](https://www.mongodb.com/docs/manual/core/sharding-reshard-a-collection/) (doc)
