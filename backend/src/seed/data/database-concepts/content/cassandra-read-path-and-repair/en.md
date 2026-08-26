---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Understand what actually happens between a CQL `SELECT` and the row that comes back: how a coordinator picks which replicas to ask, why it asks one of them for the data and the rest for only a *hash* of the data, how it reconciles disagreeing replicas by timestamp ("last write wins"), and how a stale replica gets corrected **during that same read** by read repair rather than by a separate maintenance job. Then the query-shape rules that fall out of the storage layout — `WHERE`, `ORDER BY`, `ALLOW FILTERING`, `IN` — and how paging keeps a large result set from taking down the client or the cluster.

## Use Cases

- Explaining to a team why a read at `ONE` just returned a value they overwrote a second ago, and why the *next* read of the same row returns the new value without anyone doing anything.
- Choosing read and write consistency levels together for a given table, using the `R + W > RF` rule rather than setting both to `QUORUM` out of habit.
- Diagnosing a "the data is wrong on one node" incident and deciding whether it is a read-repair-will-fix-it situation or a run-`nodetool repair`-now situation.
- Reviewing a query that someone made work by appending `ALLOW FILTERING`, and turning it back into a data-modeling question.
- Sizing pages for a large scan in the DataStax Java Driver, including prefetching the next page so the user never feels the pause, and persisting paging state in a stateless web service.
- Writing a runbook item for NTP/clock health, once you understand that clock skew in Cassandra is a *correctness* problem, not a monitoring nicety.

## Deep Dive

Two properties frame everything else. First, reads are easy to *route*: "clients can connect to any node in the cluster to perform reads, without having to know whether a particular node acts as a replica for that data." If the node you hit isn't a replica, it becomes the **coordinator** and reads from a node that is, "identified by token ranges."

Second, reads are the expensive side of Cassandra: "In Cassandra, reads are generally slower than writes due to file I/O from reading SSTables." Fulfilling a read typically means seeks, waiting on other nodes synchronously (how many depends on consistency level and replication factor), "and then perform read repairs as necessary." Everything below is the machinery behind that sentence.

### Read consistency levels

The read levels look like the write levels but behave differently behind the scenes. The sibling concept on Cassandra's consistency levels covers the tunable-consistency model itself — what `QUORUM` means, how `LOCAL_*` interacts with data centers, why the model is per-query rather than per-cluster — so what matters here is only what each level implies *for a read*:

| Level | Read behavior |
|---|---|
| `ONE`, `TWO`, `THREE` | Return the record held by the first node(s) that respond. The record is checked against the same record on other replicas; if any are out of date, a read repair syncs them to the most recent value. |
| `LOCAL_ONE` | Like `ONE`, with the extra requirement that the responding node is in the local data center. |
| `QUORUM` | Query all nodes. Once `(replication factor / 2) + 1` respond, return the value with the most recent timestamp, then read-repair the remaining replicas if necessary. |
| `LOCAL_QUORUM` | Like `QUORUM`, restricted to the local data center. |
| `EACH_QUORUM` | A quorum must respond *in each* data center. |
| `ALL` | Query all nodes, wait for all of them, return the record with the most recent timestamp, then repair if necessary. If any node fails to respond, the read fails. |

Three details that trip people up:

- **`ANY` is not supported for reads.** It exists only on the write side (where a hint counts as a write).
- **`ONE` means "first responder wins," stale or not.** "The read repair operation is performed *after* the record is returned, so any subsequent reads will all have a consistent value, regardless of the responding node." The stale value still went to the client once.
- **`ALL` converts one slow node into a failed query.** "A node is considered unresponsive if it does not respond to a query before the value specified by `read_request_timeout_in_ms` in the configuration file. The default is 5 seconds."

The book's sidebar on aligning levels is the practical rule: strong consistency comes from read and write levels *whose sum exceeds the replication factor*. At `RF=3`, `QUORUM` reads plus `QUORUM` writes gives `2 + 2 > 3` — strong. `QUORUM` writes plus `ONE` reads gives `2 + 1`, which is merely *equal* to 3, so it is not strong: "if you are only guaranteed writes to two out of three replicas, there is certainly a chance that one of the replicas did not receive the write and has not yet been repaired, and a read at consistency level `ONE` could go to that very node."

### The read path, between nodes

The read path begins when the client sends a query to the coordinator. Like the write path, the coordinator "uses the partitioner to determine the replicas, and checks that there are enough replicas up to satisfy the requested consistency level," and a remote coordinator is chosen per data center for multi-DC reads.

Then the part that is specific to reads:

> If the coordinator is not itself a replica, the coordinator sends a **read request to the fastest replica, as determined by the dynamic snitch**. The coordinator node also sends a **digest request** to the other replicas. "A digest request is similar to a standard read request, except the replicas return a digest, or hash, of the requested data."

The coordinator computes the digest of the data it got from the fastest replica and compares it against the digests from the others. **If the digests agree and the consistency level is met, the data from the fastest replica is returned.** If they disagree, the coordinator must perform a read repair.

This is the cost-control trick worth internalizing: only *one* replica ships actual row data over the network. The consistency check itself costs a hash per extra replica, not a row per extra replica.

### The read path, inside one replica

When a replica receives the read request it works down a ladder, each rung existing to avoid the rung below it:

1. **Row cache.** If the row is there, return immediately. Helps frequently accessed rows.
2. **Memtable + SSTables.** There is exactly one memtable per table, so that part is trivial. But there may be many SSTables on disk, each potentially holding a portion of the requested data.
3. **Bloom filter**, per SSTable — "the first step in searching SSTables on disk is to use a Bloom filter to determine whether the requested partition *does not* exist in a given SSTable, which would make it unnecessary to search that SSTable."
4. **Key cache** — a map from `(SSTable file descriptor, partition key)` to an offset location in the SSTable file. A hit eliminates seeks entirely.
5. **Partition summary → partition index.** On a key-cache miss, a two-level on-disk index: the first-level *partition summary* gives an offset into the second-level *partition index*, which holds the actual SSTable offset for the partition key.
6. **SSTable read at that offset**, with the **chunk cache** (added in the 3.6 release) holding frequently accessed SSTable chunks.

Then the reconciliation that makes the rest of the model work: "Once data has been obtained from all of the SSTables, Cassandra **merges the SSTable data and memtable data by selecting the value with the latest timestamp for each requested column**." Last write wins is not a distributed-systems-only rule — it is already how a single node assembles a row out of its own immutable files. A digest request is handled identically, "with the additional step that a digest is calculated on the result data and returned instead of the data itself."

### Read repair

When the digests disagree, the coordinator escalates:

1. It makes a **full read request from all of the replica nodes**.
2. It **merges the data by selecting a value for each requested column** — the value with the latest timestamp. If two values carry the *same* timestamp, "it will compare the values lexicographically and choose the one that has the greater value. This case should be exceedingly rare."
3. The merged data is what goes back to the client.
4. **Asynchronously, the coordinator identifies any replicas that returned obsolete data and issues a read-repair request to each of them to update their data based on the merged data.**

Step 4 is the whole point: the stale replica is corrected *as a side effect of a normal application read*. Nobody scheduled it. This is distinct from full anti-entropy repair (`nodetool repair`), which is a deliberate, cluster-wide, operator-run process.

Ordering relative to the client matters and depends on the level. "If you are using one of the two stronger consistency levels (`QUORUM` or `ALL`), then the read repair happens **before** data is returned to the client. If the client specifies a weak consistency level (such as `ONE`), then the read repair is optionally performed in the background **after** returning to the client."

The animation below walks a single `QUORUM` read at `RF=3` where exactly one replica is behind:

```viz
type: graph
node CLIENT Client 0 2
node COORD Coordinator 2 2
node RA ReplicaA 4 0
node RB ReplicaB 4 2
node RC ReplicaC 4 4
edge CLIENT COORD
edge COORD RA
edge COORD RB
edge COORD RC
---
visit CLIENT | SELECT start_date FROM reservations_by_confirmation WHERE confirm_number = 'RS2G0Z' at consistency level QUORUM. The client connects to whichever node its driver picked. It does not need to know which nodes are replicas.
traverse CLIENT COORD | That node becomes the coordinator for this read. It is not necessarily a replica for this partition.
visit COORD | The coordinator hashes the partition key with the partitioner to get a token, maps the token to the three replicas, and confirms enough of them are up to satisfy QUORUM, which at RF=3 is two.
traverse COORD RA | The dynamic snitch says Replica A is currently the fastest, so A alone gets a full read request for the actual row data.
visit RA | A misses the row cache, merges its memtable with the SSTables that survived the Bloom filter, and returns start_date = 2016-01-06 written at timestamp 1567886623298243.
traverse COORD RB | B gets a digest request instead: a hash of the same data, not the data. One row crosses the network for this read, no matter how many replicas are consulted.
visit RB | B has the same value at the same timestamp 1567886623298243, so its digest matches the hash the coordinator computed over A's response. Two agreeing replicas already satisfy QUORUM.
traverse COORD RC | C is queried too, also with a digest request. QUORUM was reachable without it, but querying the third replica is the only way staleness on that replica is ever noticed.
mark RC | Digest mismatch. C still holds start_date = 2016-01-05 at timestamp 1567876680189474. It was down when the update landed and the hint expired before it came back. Older timestamp means obsolete, not merely different.
traverse RC COORD | The mismatch escalates the digest request into a full read: the coordinator now asks C for its real data, because it has to know what to overwrite.
visit COORD | Column by column, the coordinator merges and the latest timestamp wins. 1567886623298243 beats 1567876680189474, so 2016-01-06 is the answer. That is last-write-wins, decided entirely by the timestamp on the cell.
traverse COORD RC | Read repair: the coordinator issues a read-repair mutation carrying the merged value to the one replica that was behind. Same request, same round trip, no scheduled job and no operator involved.
visit RC | C now holds 2016-01-06 at timestamp 1567886623298243. The staleness was fixed because somebody happened to read this row, which is exactly why a row nobody reads can stay stale indefinitely.
traverse COORD CLIENT | The client gets 2016-01-06. Because the level was QUORUM, the repair completed before this return; at ONE the same repair would have run in the background after the client already had its answer.
mark RA | A needed no repair. It held the newest timestamp all along and was never written to during this read.
mark RB | Neither did B. Read repair touches only the replicas that answered with an older timestamp, which is why its cost scales with how inconsistent the cluster actually is, not with how many replicas there are.
```

> **Book vs. today: the "chance"-based background read repair the book describes was removed in Cassandra 4.0.** The chapter says the percentage of reads that result in background repairs "is determined by the `read_repair_chance` and `dc_local_read_repair_chance` options for the table." Those table options no longer exist — CASSANDRA-13910 removed probabilistic background read repair in 4.0, and on upgrade the settings are simply ignored and disappear. What replaced them is a table option literally named `read_repair`, with two values: `BLOCKING` (the default), where "the read will block on writes sent to other replicas until the CL is reached by the writes," and `NONE`, where "the coordinator will reconcile any differences between replicas, but will not attempt to repair them." The mechanism the animation shows is unchanged; only the knob changed. Two consequences worth knowing: `BLOCKING` is what provides **monotonic quorum reads** (successive quorum reads will not go backwards in time, even after a failed write reached only a minority of replicas), and read repair is now triggered at levels `TWO`, `THREE`, `LOCAL_QUORUM`, and `QUORUM` — but **not** at `ONE` or `LOCAL_ONE`. So the book's "at `ONE` the repair happens in the background afterwards" is the pre-4.0 behavior; today a read at `ONE` simply does not repair.

> **Two configuration names in this section have since been renamed.** `read_request_timeout_in_ms: 5000` is now `read_request_timeout: 5000ms` — Cassandra 4.1 moved `cassandra.yaml` to typed duration values, so the `_in_ms` suffix is gone from the property name and the unit lives in the value. The default is unchanged at 5 seconds. Similarly `cross_node_timeout`, which the book notes defaults to `false`, both defaults to `true` and is named `internode_timeout` in current releases. These are renames and a default flip, not behavior changes.

### Transient replication, briefly

The chapter introduces **transient replication**, where a transient replica "only stores data when regular or full replicas are unavailable" and later discards its copy once incremental repair moves the data to the full replicas — expressed in the replication factor as e.g. `'replication_factor' : '5/2'` (five total replicas: three full, two transient). On reads, "at least one full replica is required, but beyond that, any replicas, including full or transient, may be used to achieve the requested consistency level." The reason it belongs in a read-repair discussion is the restriction: in the 4.0 release, **read repair, batches, lightweight transactions, and counters cannot be used within keyspaces that have transient replication set**. It was experimental and disabled by default when the book shipped, and it still is — this is not a feature to design a read path around.

### Range queries, ordering, and filtering

The `WHERE` clause reads ranges *within a partition*, sometimes called slices. Against `available_rooms_by_hotel_date` with `PRIMARY KEY (hotel_id, date, room_number)` — `hotel_id` the partition key, `date` and `room_number` clustering columns:

```sql
SELECT * FROM available_rooms_by_hotel_date
  WHERE hotel_id='AZ123' AND date>'2016-01-05' AND date<'2016-01-12';
```

That works: the partition key is pinned, and the range is on the *first* clustering column. This does not:

```sql
SELECT * FROM available_rooms_by_hotel_date
  WHERE hotel_id='AZ123' AND room_number=101;

InvalidRequest: code=2200 [Invalid query] message="PRIMARY KEY column
  "room_number" cannot be restricted as preceding column "date" is not restricted"
```

Two rules govern the clause: **all elements of the partition key must be identified**, and **a given clustering key may only be restricted if all previous clustering keys are restricted by equality**. This is not arbitrary — "these restrictions are based on how Cassandra stores data on disk," and "the conditions on the clustering column are restricted to those that allow Cassandra to select a contiguous ordering of rows." A legal query is one the storage engine can answer as a contiguous scan.

The escape hatch is `ALLOW FILTERING`, which lets you omit a partition key element (`WHERE date='2016-01-25' ALLOW FILTERING` searches across every hotel). The book's verdict: "Usage of `ALLOW FILTERING` is not recommended, however, as it has the potential to result in very expensive queries. If you find yourself needing such a query, you will want to revisit your data model to make sure you have designed tables that support your queries."

`IN` tests equality against multiple values, and carries a cost on each of its two uses. On a clustering column it "can result in slower performance on queries, as the specified column values may correspond to noncontiguous areas within the row." On the *partition* key it "would cause the coordinator node to have to talk to a greater number of nodes to support your query" — and the book's suggested alternative is worth remembering, because it converts a coordinator fan-out into direct replica hits: "you might consider kicking off separate requests for the different partitions in parallel threads in your application so that the driver can directly contact a replica as the coordinator for each query."

`ORDER BY` can only override the sort order already specified on the clustering columns at `CREATE TABLE` time — `ORDER BY date DESC` reverses the on-disk order, it does not sort by something the table isn't clustered on.

### Paging

"In early releases of Cassandra, clients had to make sure to carefully limit the amount of data requested at a time. For a large result set, it is possible to overwhelm both nodes and clients even to the point of running out of memory."

`LIMIT 10` caps a result set, but "the limitation of the `LIMIT` keyword (pun intended) is that there's no way to obtain additional pages containing the additional rows beyond the requested quantity."

**Automatic paging**, added in the 2.0 release, is the real mechanism: the client requests a subset, and "the server breaks the result into pages that are returned as the client requests them." In `cqlsh`, `PAGING` shows status and page size (default 100), `PAGING 1000` changes it, `PAGING OFF` disables it.

In the DataStax Java Driver, the default fetch size for a `CqlSession` is `basic.request.page-size`, **defaulting to 5000**, overridable per statement with `statement.setPageSize(2000)`. "The page size is not necessarily exact; the driver might return slightly more or slightly fewer rows than requested." Iterating a `ResultSet` in a plain `for` loop is enough — when the driver "detects that there are no more items remaining on the current page, it requests the next page."

The pause at a page boundary is visible to users, so the driver exposes prefetching:

```java
for (Row row : resultSet) {
  if (resultSet.getAvailableWithoutFetching() < 100 && !resultSet.isFullyFetched())
    resultSet.fetchMoreResults();
  // process the row
}
```

Fewer than 100 rows left on the current page and more pages to come triggers an asynchronous fetch, so the next page is in flight while the current one is still being consumed.

For a stateless web service that cannot hold a session across invocations, the **paging state** can be extracted and handed back later:

```java
ByteBuffer nextPage = resultSet.getExecutionInfo().getPagingState();
// ... later, on a different request:
statement.setPagingState(pagingState);
```

With one hard warning: "in either string or byte array form, the state is not something you should try to manipulate or reuse with a different statement since it is not guaranteed to have the same format between different Cassandra versions. Doing so could result in an exception." Treat it as an opaque token bound to one statement and one cluster version.

## Trade-offs

- **Last-write-wins is trivially simple and makes clock skew a correctness bug, not a performance one.** Conflict resolution in Cassandra is one comparison — the cell with the greater timestamp wins, with a lexicographic comparison of the values as the tiebreaker for the "exceedingly rare" identical-timestamp case. There is no vector clock, no sibling, no merge callback: the loser's write is silently gone. That is cheap and predictable, and it means a node or client whose clock runs behind can write a value that is *newer in reality but older by timestamp*, so the database discards it and no error is ever raised. The book's mitigation is entirely operational: "The clocks on all nodes and clients should be synchronized using the Network Time Protocol (NTP) or other methods. Remember that Cassandra only overwrites columns if the timestamp for the new value is more recent than the timestamp of the existing value. **Without synchronized clocks, writes from nodes or clients that lag behind can be lost.**" That is the whole defense. Anything requiring genuine read-modify-write correctness — a uniqueness check, a compare-and-set — needs lightweight transactions, not LWW. And since `USING TIMESTAMP` lets an application supply its own timestamps, a well-meaning "let's use our own clock" can hand you the same failure mode with none of the NTP guardrails. `WRITETIME(column)` is the debugging tool for all of this; note it cannot be applied to primary key columns.
- **Read repair only repairs what someone reads.** The mechanism is opportunistic by construction: the coordinator learns a replica is stale because a query happened to touch that partition on that replica. A hot row self-heals almost immediately; a cold row can stay wrong for as long as nobody asks for it. That is why read repair is a supplement to, not a substitute for, scheduled anti-entropy repair (`nodetool repair`), and the deadline is not aesthetic — `gc_grace_seconds` defaults to 10 days, after which tombstones are garbage-collected on compaction, and a replica that missed a delete and never got repaired within that window can resurrect deleted data. "The assumption is that 10 days is plenty of time for you to bring a failed node back online before compaction runs." Read repair does not extend that window.
- **Digest reads cut bandwidth, not round trips.** Asking `n-1` replicas for a hash instead of a row is a genuine and large saving on network and serialization cost — one row crosses the wire regardless of replication factor. What it does *not* save is the fan-out itself: those replicas still do the full row-cache/Bloom-filter/SSTable work to compute the digest, and the coordinator still waits on them per the consistency level. And the saving inverts on mismatch: a digest disagreement escalates into a full read from *all* replicas plus repair mutations, so a cluster that is chronically inconsistent pays both the digest round and the full round.
- **The `ONE` / `QUORUM` choice is a choice about who eats the staleness.** At `ONE` the first responder wins even if it is stale, and — in Cassandra 4.0 and later — no read repair runs at all for that level, so the row does not even get fixed on the way past. At `QUORUM`, blocking read repair gives you monotonic quorum reads, but every read now potentially waits on repair writes to other replicas before returning. Latency for correctness, and the exchange rate is set per query, not per cluster.
- **`ALL` turns availability into a liability.** Requiring every replica to answer means one slow or restarting node fails the query outright after `read_request_timeout` (5 seconds by default). On a database chosen specifically for staying up when nodes are down, `ALL` opts out of the property you bought. `QUORUM` plus `QUORUM` writes gets strong consistency at `RF=3` without that fragility.
- **`ALLOW FILTERING` makes an illegal query legal without making it affordable.** The `WHERE` restrictions exist because the storage engine can only cheaply answer queries that map to a contiguous range of rows. Bypassing them does not create an index; it creates a scan that reads and discards rows, and its cost grows with the data, not the result. It is a diagnostic that your table doesn't match your query — the right response is another table, not another keyword.
- **Paging protects the cluster and adds a state-management problem.** Automatic paging is what stops a large result set from OOM-ing a node or a client, and the driver hides it well enough that a plain `for` loop over a `ResultSet` just works. The costs are real but bounded: a latency hiccup at every page boundary unless you prefetch with `getAvailableWithoutFetching()`/`fetchMoreResults()`, a page size that is approximate rather than exact, and — if you persist paging state to survive a stateless request — an opaque token with no format guarantee across Cassandra versions, which will throw if it is reused with a different statement or replayed across an upgrade. Do not put it in a long-lived URL.
- **Reads are structurally the slower side, and the fix costs money rather than cleverness.** "In Cassandra, reads are generally slower than writes due to file I/O from reading SSTables." The remedies the book names — adding nodes, using compute instances with more memory, enabling the row/key/chunk caches — are all "keep more of it in memory," i.e. hardware and cache-tuning decisions with their own trade-offs (the row cache in particular is a poor fit for wide partitions or write-heavy tables, since any write to a cached partition invalidates it). Cassandra's read speed is a property of the data model and the cache budget, not of the query.

## Documentation Links

- [Jeff Carpenter and Eben Hewitt, "Cassandra: The Definitive Guide", Revised 3rd Edition (O'Reilly, 2022) — Chapter 9, "Writing and Reading Data" (Reading), p. 305-328](https://www.oreilly.com/library/view/cassandra-the-definitive/9781492097143/) — doc
- [Apache Cassandra Documentation — Reads](https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html#reads) — doc
- [Apache Cassandra Documentation — Read Repair](https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html#read-repair) — doc
- [Apache Cassandra Documentation — Read Repair (table read_repair option, monotonic quorum reads)](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/read_repair.html) — doc
- [Apache Cassandra Documentation — cassandra.yaml configuration (read_request_timeout)](https://cassandra.apache.org/doc/latest/cassandra/managing/configuration/cass_yaml_file.html) — doc
- [Apache Cassandra Documentation — CQL SELECT statement and WHERE restrictions](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/dml.html#select-statement) — doc
- [DataStax Java Driver — Paging](https://docs.datastax.com/en/developer/java-driver/latest/manual/core/paging/) — doc
- [CASSANDRA-13910 — Remove read_repair_chance / dclocal_read_repair_chance](https://issues.apache.org/jira/browse/CASSANDRA-13910) — doc
