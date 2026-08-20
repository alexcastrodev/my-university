---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Understand the two dials Cassandra hands you separately — the **replication factor**, set once per keyspace by the replication strategy, and the **consistency level**, chosen by the client on every single read and write — and learn how a coordinator node turns those two numbers into an actual quorum: which replicas get contacted, how many have to answer before the client hears "ok", and what happens to the ones that didn't.

## Use Cases

- Choosing a replication strategy at `CREATE KEYSPACE` time and defending the choice: the book's recommendation is `NetworkTopologyStrategy` "for keyspaces in production deployments, even those that are initially created with a single data center, since it is more straightforward to add an additional data center should the need arise."
- Picking a consistency level per query rather than per application — a session-write that must not be lost at `QUORUM`, an analytics scan of immutable event data at `ONE`, a cross-datacenter compliance write at `EACH_QUORUM`.
- Explaining to a team migrating from a single-node ACID database why `R + W > RF` is the closest thing Cassandra offers to "strong consistency," and where that guarantee stops.
- Debugging a `UnavailableException` or a read that returned a value someone swears they overwrote, by working backwards through RF, the consistency level actually used, and whether a replica was down long enough for hints to expire.
- Sizing a multi-datacenter deployment where `LOCAL_QUORUM` keeps reads inside one region but a subset of writes needs to be durable in every region before returning.
- Reviewing a client codebase where nobody ever set a consistency level, so every query silently ran at the driver's default rather than at a level anyone chose deliberately.

## Deep Dive

### Replication strategies: where the copies go

"A node serves as a replica for different ranges of data. If one node goes down, other replicas can respond to queries for that range of data." The **replication factor** is "the number of nodes in your cluster that will receive copies (replicas) of the same data. If your replication factor is 3, then three nodes in the ring will have copies of each row."

Placement splits into a fixed part and a pluggable part. **The first replica is always the node that claims the range in which the token falls** — that one is decided by the partitioner. Every remaining replica is placed by the **replication strategy** (also called the replica placement strategy), which the book notes is a textbook Gang of Four strategy pattern: `org.apache.cassandra.locator.AbstractReplicationStrategy` is the abstract class, and each placement algorithm is one subclass.

Two implementations ship out of the box:

| Strategy | What it does | Book's verdict |
|---|---|---|
| `SimpleStrategy` | "Places replicas at consecutive nodes around the ring, starting with the node indicated by the partitioner." | Topology-blind; fine for a test ring. |
| `NetworkTopologyStrategy` | "Allows you to specify a different replication factor for each data center. Within a data center, it allocates replicas to different racks in order to maximize availability." | **Recommended for production keyspaces — even single-datacenter ones.** |

The reasoning behind that recommendation is operational, not theoretical: starting on `NetworkTopologyStrategy` means adding a second datacenter later is a keyspace alter and a rebuild, not a strategy change on a live keyspace. (A third strategy, `OldNetworkTopologyStrategy`, exists only for backward compatibility. The book records the historical renames — `SimpleStrategy` was `RackUnawareStrategy`, `NetworkTopologyStrategy` was `DataCenterShardStrategy`, `OldNetworkTopologyStrategy` was `RackAwareStrategy` — all effective in the 0.7 release.)

**The strategy is set independently for each keyspace and is a required option when creating one.** That is the first half of the tuning story: replication is a schema decision, made once, by whoever owns the keyspace.

### Consistency levels: how many have to answer

The second half is per query. "Cassandra provides tuneable consistency levels that allow you to make these trade-offs at a fine-grained level. You specify a consistency level on each read or write query that indicates how much consistency you require. A higher consistency level means that more nodes need to respond to a read or write query, giving you more assurance that the values present on each replica are the same."

The two directions are symmetric but not identical:

- **Reads** — the level "specifies how many replica nodes must respond to a read request before returning the data."
- **Writes** — it "specifies how many replica nodes must respond for the write to be reported as successful to the client. Because Cassandra is eventually consistent, updates to other replica nodes may continue in the background."

That last clause is the one people skip. A write at `ONE` is not a write to one node; it is a write *sent to every replica* that returns as soon as one of them confirms. The rest keep going.

The levels the book introduces here:

| Level | Replicas that must respond |
|---|---|
| `ONE`, `TWO`, `THREE` | "An absolute number of replica nodes that must respond to a request." |
| `QUORUM` | "A response from a majority of the replica nodes." |
| `ALL` | "A response from all of the replicas." |
| `ANY` | A hint alone counts as a successful write (writes only; added in 0.6). |
| `LOCAL_QUORUM` | A majority within the local datacenter — named here as a recommended level, detailed in Chapter 9. |

Quorum has an exact formula:

```
Q = floor(RF / 2 + 1)
```

"In this equation, Q represents the number of nodes needed to achieve quorum for a replication factor RF. It may be simpler to illustrate this with a couple of examples: if RF is 3, Q is 2; if RF is 4, Q is 3; if RF is 5, Q is 3, and so on."

Read that table sideways and it explains a common sizing mistake: RF=3 needs 2 for quorum and so tolerates one dead replica; RF=4 needs 3 and *still* tolerates only one. The fourth copy bought storage and write amplification, not availability at `QUORUM`. Odd replication factors are the ones that pay for themselves.

The book's own sidebar names the confusion this section exists to prevent:

> **"The replication factor is set per keyspace. The consistency level is specified per query, by the client. The replication factor indicates how many nodes you want to use to store a value during each write operation. The consistency level specifies how many nodes the client has decided must respond in order to feel confident of a successful read or write operation. The confusion arises because the consistency level is based on the replication factor, not on the number of nodes in the system."**

That last sentence is load-bearing. `QUORUM` in a 100-node cluster with RF=3 means **2 nodes**, not 51.

### Tunable consistency: R + W > RF

"Consistency is tuneable in Cassandra because clients can specify the desired consistency level on both reads and writes." The formula the book gives for combining them:

```
R + W > RF  =>  strong consistency
```

"In this equation, R, W, and RF are the read replica count, the write replica count, and the replication factor, respectively; all client reads will see the most recent write in this scenario, and you will have strong consistency."

The mechanism is set overlap. With RF=3, writing at `QUORUM` (W=2) and reading at `QUORUM` (R=2) gives 2 + 2 = 4 > 3, so the read set and the write set must share at least one replica — and that replica has the newest value, which the coordinator resolves by timestamp. The book's practical recommendation: "the recommended way to achieve strong consistency in Cassandra is to write and read using the `QUORUM` or `LOCAL_QUORUM` consistency levels."

Some combinations that satisfy the inequality and some that don't, at RF=3:

| Write CL | Read CL | W + R | Strong? |
|---|---|---|---|
| `QUORUM` (2) | `QUORUM` (2) | 4 > 3 | Yes — the usual answer |
| `ALL` (3) | `ONE` (1) | 4 > 3 | Yes — cheap reads, brittle writes |
| `ONE` (1) | `ALL` (3) | 4 > 3 | Yes — cheap writes, brittle reads |
| `ONE` (1) | `QUORUM` (2) | 3 = 3 | **No** — no guaranteed overlap |
| `ONE` (1) | `ONE` (1) | 2 < 3 | **No** — eventual only |

### Queries and coordinator nodes

"A client may connect to any node in the cluster to initiate a read or write query. This node is known as the **coordinator node**. The coordinator identifies which nodes are replicas for the data that is being written or read and forwards the queries to them."

The coordinator is a per-query role, not a cluster-wide one — there is no master. What it does splits by operation:

- **Write** — "the coordinator node contacts *all* replicas, as determined by the consistency level and replication factor, and considers the write successful when a number of replicas commensurate with the consistency level acknowledge the write."
- **Read** — "the coordinator contacts enough replicas to ensure the required consistency level is met, and returns the data to the client."

The animation below is a single write at `QUORUM` with RF=3, on a keyspace using `NetworkTopologyStrategy`, with one replica down. Six circles: the client, the coordinator, the three replicas `R1`/`R2`/`R3` that own this partition, and — not a cluster node — the **hint** the coordinator stashes locally for the replica that never answered.

```viz
type: graph
node CLIENT Client 0 3
node COORD Coord 2 3
node R1 R1 4 1
node R2 R2 4 3
node R3 R3 4 5
node HINT Hint 2 6
edge CLIENT COORD
edge COORD R1
edge COORD R2
edge COORD R3
edge COORD HINT directed
---
visit CLIENT | One INSERT at CL=QUORUM. The keyspace has RF=3, so Q = floor(3/2 + 1) = 2 replicas must acknowledge. The client connects to whatever node it likes and knows nothing about which nodes own this partition.
traverse CLIENT COORD | Whichever node the client connected to becomes the coordinator for this query. It is a per-query role, not a fixed one -- the next query may be coordinated by a different node entirely.
visit COORD | The coordinator hashes the partition key to a token and asks the keyspace's replication strategy who owns that token range. NetworkTopologyStrategy answers R1, R2, R3 -- three replicas placed on three different racks.
traverse COORD R1 | For a write the coordinator contacts ALL replicas, not just the two that quorum needs. The consistency level decides how many must answer; it never decides how many get asked.
traverse COORD R2 | R2 receives the same mutation.
traverse COORD R3 | So does R3 -- except R3 is down, its rack switch having failed a minute ago. The coordinator does not know that yet; it finds out by not hearing back.
visit R1 | R1 applies the mutation and acknowledges. That is 1 of the 2 acks quorum requires. At CL=ONE the coordinator would already be returning success to the client right here, on this single ack.
visit R2 | R2 acknowledges. 2 of 2 -- quorum satisfied, and the write is reported successful to the client. R1 and R2 now form a set that must overlap with any later QUORUM read of this partition.
mark R3 | R3 never answers. At CL=ALL this identical write would have FAILED on that one silent replica, even though two thirds of the replica set took it without complaint. That is the availability price of the strongest level.
traverse COORD HINT | Because a replica that owns this data missed the write, the coordinator writes a hint: a small note recording the mutation plus the fact that it belongs to R3.
visit HINT | The hint is not a node in the ring -- it lives in the coordinator's own hints store. It does not count toward the consistency level (only CL=ANY treats a bare hint as a successful write) and it is discarded once max_hint_window passes, three hours by default.
visit CLIENT | Success returns to the client. The row is on 2 of 3 replicas. R3 converges later: by hint replay once gossip reports it back up, by read repair on the next quorum read that touches this partition, or by an operator-run repair.
```

Change one number and the whole story changes. At `ONE` the trace ends at step 7 — faster, and with a real window in which a subsequent `ONE` read routed to `R3` returns the old value. At `ALL` the trace never completes: `R3`'s silence fails the operation outright, and a single dead node has taken writes for this partition offline. `QUORUM` sits between them by construction: enough replicas to guarantee overlap with a `QUORUM` read, few enough to survive `floor((RF-1)/2)` failures.

The book is careful to label all of this the happy path: "These, of course, are the 'happy path' descriptions of how Cassandra works." The mechanisms below are what covers the rest.

### Hinted handoff

"Consider the following scenario: a write request is sent to Cassandra, but a replica node where the write properly belongs is not available due to network partition, hardware failure, or some other reason." The answer is a hint, and the book's metaphor for it is a Post-it Note: the coordinator writes down "I have the write information that is intended for node B. I'm going to hang on to this write, and I'll notice when node B comes back online; when it does, I'll send it the write request." Delivery is triggered by gossip detecting node B is back. **Cassandra holds a separate hint for each partition that is to be written.**

What this buys: "This allows Cassandra to be always available for writes, and generally enables a cluster to sustain the same write load even when some of the nodes are down. It also reduces the time that a failed node will be inconsistent after it does come back online."

Two rules that catch people out:

1. **"In general, hints do not count as writes for the purposes of consistency level."** The single exception is `ANY`, "which was added in 0.6. This consistency level means that a hinted handoff alone will count as sufficient toward the success of a write operation." Note the asterisk on that: "the write is considered durable, but the data may not be readable until the hint is delivered to the target replica." A durable write you cannot read is a strange guarantee, and it is exactly what `ANY` promises.
2. **Hints expire.** "If a node is offline for some time, the hints can build up considerably on other nodes. Then, when the other nodes notice that the failed node has come back online, they tend to flood that node with requests, just at the moment it is most vulnerable." So Cassandra "limits the storage of hints to a configurable time window," and hinted handoff can be disabled entirely. The class is `org.apache.cassandra.hints.HintsService`.

Hence the book's own conclusion: "Although hinted handoff helps increase Cassandra's availability, due to the limitations mentioned it is not sufficient on its own to ensure consistency of data across replicas." Availability mechanism, not a consistency mechanism.

### Anti-entropy, repair, and Merkle trees

The safety net under everything else. Anti-entropy protocols "are a type of gossip protocol for repairing replicated data. They work by comparing replicas of data and reconciling differences observed between the replicas" — modeled on Section 4.7 of the Dynamo paper. Replica synchronization comes in two modes:

- **Read repair** — "synchronization of replicas as data is read. Cassandra reads data from multiple replicas in order to achieve the requested consistency level, and detects if any replicas have out-of-date values. If an insufficient number of nodes have the latest value, a read repair is performed immediately to update the out-of-date replicas."
- **Anti-entropy repair** (manual repair) — "a manually initiated operation performed on nodes as part of a regular maintenance process," run with `nodetool repair`. It triggers a validation compaction, during which "the server initiates a TreeRequest/TreeReponse conversation to exchange **Merkle trees** with neighboring replicas. The Merkle tree is a hash representing the data in that table. If the trees from the different nodes don't match, they have to be reconciled (or 'repaired')."

A Merkle tree is "a data structure represented as a binary tree… the leaves are the data blocks to be summarized. Every parent node in the tree is a hash of its direct child nodes, which tightly compacts the summary." Cassandra's differs from Dynamo's in scope: **each table has its own tree, created as a snapshot during validation compaction and kept only as long as is needed to send it to neighboring nodes** — which "reduces network I/O." Implementation: `org.apache.cassandra.utils.MerkleTree`.

The operational shape of repair belongs to a maintenance topic, not this one. What matters here is the chain: consistency level covers the request, hinted handoff covers a short outage, repair covers everything hints missed.

### Book vs today

> **`SimpleStrategy` went from "not recommended" to actively fenced off.** The book's recommendation is now the official one, more bluntly worded: the Apache docs say `SimpleStrategy` "is useful only for testing clusters where you do not yet know the datacenter layout of the cluster" and that "all production deployments should use the `NetworkTopologyStrategy`"; the CQL reference calls it "generally not a wise choice for production, as it does not respect datacenter layouts and can lead to wildly varying query latency." Since Cassandra 4.1 an operator can enforce that with the `simplestrategy_enabled` guardrail in `cassandra.yaml` (default `true`, i.e. still allowed), alongside `minimum_replication_factor_warn_threshold`/`_fail_threshold` and their `maximum_` counterparts (all `-1`, disabled, by default). There is also `default_keyspace_rf`, whose shipped default is `1` with a comment recommending `3` in production. This is a recommendation hardening into tooling, not a deprecation.

> **The consistency levels themselves have not changed — but they can now be forbidden centrally.** `ONE`, `TWO`, `THREE`, `QUORUM`, `ALL`, `LOCAL_ONE`, `LOCAL_QUORUM`, `EACH_QUORUM`, and `ANY` (writes only) are all still current, and `R + W > N` is still how the Apache docs describe tunable consistency. What is new since 4.1 is that consistency level is no longer purely the client's call: `read_consistency_levels_warned`/`read_consistency_levels_disallowed` and `write_consistency_levels_warned`/`write_consistency_levels_disallowed` are guardrails in `cassandra.yaml`, empty by default (all levels allowed), that let an operator warn on or reject `ONE` and `ANY` cluster-wide. There is also `ideal_consistency_level` (commented out, with `EACH_QUORUM` as the example), which tracks a per-keyspace metric of whether writes *would* have met a stronger level than the one requested — a way to measure the cost of raising a level before actually raising it.

> **`EACH_QUORUM` is no longer write-only.** Older Cassandra rejected `SELECT` at `EACH_QUORUM` outright; read support landed in 3.0.0-rc2 (CASSANDRA-9602, closing the older CASSANDRA-6970 as a duplicate). It is still rare in practice for reads, because requiring a quorum *in every datacenter* means the slowest region sets your read latency and any single region being down fails the read — which is precisely why `LOCAL_QUORUM` is the level the book steers you toward.

> **Background read repair was removed in Cassandra 4.0.** The book's read-repair description says that when enough nodes already have the latest value, "the repairs can be performed in the background after the read returns." That describes pre-4.0 behavior. Cassandra 4.0's release notes are explicit: "Background repair has been removed. `dclocal_read_repair_chance` and `read_repair_chance` table options have been removed and are now rejected" (CASSANDRA-13910). Today read repair is *blocking* only, and happens on the read path when replicas disagree during a read at a consistency level above `ONE`. The practical consequence is that reads at `ONE` no longer repair anything probabilistically in the background — convergence for those partitions now rests entirely on hints and scheduled repair.

> **Transient replication changes what "RF=3" means, where it is enabled.** Cassandra 4.0 added transient replication, in which some replicas store only unrepaired data; the CQL syntax writes RF as `'<total_replicas>/<transient_replicas>'`, e.g. `'DC1' : '3/1'`. It is not in this part of the book, and the docs still label it "an experimental feature that is not ready for production use" with significant limitations around read repair, LWTs, logged batches, and counters. Worth recognizing in a keyspace definition; not worth enabling.

## Trade-offs

- **`R + W > RF` guarantees set overlap, not the consistency model a single-node ACID database gives you.** What the inequality actually buys is that the replicas answering your read must include at least one that answered your write, so the newest timestamp is in the merge and the coordinator returns it. What it does *not* buy: linearizability across a read-then-write sequence, isolation between concurrent clients, or any guarantee about a *different* client's in-flight write. The book is explicit a few pages later that "strong consistency is not enough to prevent race conditions in cases where clients need to read, then write data" — that requires lightweight transactions and Paxos, at four round-trips instead of one. Treat `QUORUM`/`QUORUM` as "my reads will not go backwards," not as "the database is now ACID."
- **Consistency level is a per-query client decision, which means it is also a per-developer decision.** The dial is genuinely fine-grained — that is its whole appeal — but nothing in the schema enforces it. One service reading at `ONE` from a keyspace everyone else writes at `QUORUM` breaks `R + W > RF` for that path only, silently, and the symptom appears in a different team's bug report as an occasional stale read. The 4.1 consistency-level guardrails exist precisely because "the client decides" turned out to need an operator override; before that, the only enforcement was code review.
- **`ONE` is the fastest level and a real correctness risk, not a theoretical one.** It returns on the first ack, tolerates RF-1 failures, and is the right call for genuinely idempotent or append-only data — logs, metrics, immutable events. But between the write and convergence, any read at `ONE` routed to a replica that missed it returns the old value, with no error and no warning. Since 4.0 removed background read repair, that window closes only via hint replay or a scheduled repair — and hints expire after `max_hint_window` (3h default) and can be disabled entirely. `ONE`/`ONE` on mutable data is a bug that reproduces once a month.
- **`ALL` gives the strongest guarantee by giving up availability entirely.** Every replica must answer, so with RF=3 a single node in maintenance, a single rack switch reboot, or one slow GC pause fails the operation. It also makes your latency the slowest replica's latency, always. This is the dial the book is teaching: `ALL` is not "`QUORUM` but safer," it is a different point on the CAP trade-off where you have chosen consistency over availability for that query. Most workloads that reach for `ALL` actually wanted `QUORUM` plus a repair schedule.
- **`LOCAL_QUORUM` versus `EACH_QUORUM` is the multi-datacenter cost that surprises people.** `LOCAL_QUORUM` keeps the whole operation inside one datacenter: no cross-region round-trip in the critical path, and a remote datacenter being unreachable does not fail the write, because replication to it continues asynchronously. `EACH_QUORUM` requires a majority in *every* datacenter before the write returns — so your write latency becomes the WAN round-trip to the furthest region, and any one region being down fails writes for the whole cluster. The honest positioning is that `EACH_QUORUM` is for the small set of writes where cross-region durability is a hard requirement, and `LOCAL_QUORUM` is for everything else; using `EACH_QUORUM` broadly converts a multi-region deployment from "more available" into "less available than a single region."
- **Raising RF is not the same as raising availability, and quorum math punishes even numbers.** `Q = floor(RF/2 + 1)` gives Q=2 at RF=3 and Q=3 at RF=4: both tolerate exactly one replica failure at `QUORUM`, but RF=4 costs a third more storage, a third more write traffic, and one more node that must answer on every quorum read. Going to RF=5 (Q=3) does buy a second tolerated failure, at a correspondingly higher steady-state cost. Pick odd replication factors, and size RF against how many simultaneous failures you actually need to survive, not against cluster size.
- **Hinted handoff improves availability and can make recovery worse.** It is what lets writes succeed while a replica is down, and it shortens the inconsistency window when that replica returns. But the book names the failure mode plainly: hints accumulate on the surviving nodes and "they tend to flood that node with requests, just at the moment it is most vulnerable." Cassandra's mitigations — a bounded hint window, delivery throttling, the ability to turn hints off — are all *partial*, and every one of them trades away some of the consistency benefit to protect the recovering node. A node down longer than `max_hint_window` has permanently missed writes that only repair can restore, which is why "we have hinted handoff" is never a substitute for a repair schedule.
- **Tunable consistency moves a decision from the database to your design, permanently.** A relational database makes this choice once, in its engine. Cassandra makes you make it per query, forever — which is genuinely more powerful and genuinely more work: every new access pattern is another judgment call, every one of those calls can be wrong in a way that only shows up under partition, and none of them are visible in the schema. The upside is that a single keyspace can serve a `QUORUM` account-balance read and an `ONE` telemetry scan without compromise. The cost is that "what consistency does this system provide?" stops having one answer.

## Documentation Links

- [Jeff Carpenter and Eben Hewitt, "Cassandra: The Definitive Guide", Revised 3rd Edition (O'Reilly, 2022) — Chapter 6, "The Cassandra Architecture" (Replication Strategies through Anti-Entropy/Repair), p. 174-185](https://www.oreilly.com/library/view/cassandra-the-definitive/9781492097143/) — doc
- [Apache Cassandra Documentation — Consistency (tunable consistency and consistency levels)](https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html#tunable-consistency) — doc
- [Apache Cassandra Documentation — Data Replication (SimpleStrategy vs NetworkTopologyStrategy)](https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html#replication-strategy) — doc
- [Apache Cassandra Documentation — CQL Data Definition (CREATE KEYSPACE replication options)](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/ddl.html) — doc
- [Apache Cassandra Documentation — cassandra.yaml Configuration Reference (max_hint_window, guardrails, ideal_consistency_level)](https://cassandra.apache.org/doc/latest/cassandra/managing/configuration/cass_yaml_file.html) — doc
- [Apache Cassandra Documentation — Hints](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/hints.html) — doc
- [Apache Cassandra Documentation — Repair](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/repair.html) — doc
- [Apache Cassandra Documentation — Transient Replication (experimental)](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/transientreplication.html) — doc
