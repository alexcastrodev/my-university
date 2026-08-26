---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Understand what actually happens when a write lands in Cassandra — the coordinator/replica round trip, then the commit-log-then-memtable sequence inside each replica that makes writes fast without giving up durability — and learn the two mechanisms Cassandra offers when a plain write is not enough: lightweight transactions (Paxos-backed compare-and-set via `IF NOT EXISTS` / `IF <conditions>`) and batches (logged and unlogged), including precisely what each one guarantees and what it does not.

## Use Cases

- Choosing a write consistency level for a specific statement and knowing what the level buys on the *write* side in particular — that `ONE` means "commit log **and** memtable on one node", which is what makes it durable, and that `ANY` is the one level where a hint counts as a successful write.
- Explaining why Cassandra writes are fast to someone coming from a B-tree database: "writing data is very fast in Cassandra, because its design does not require performing disk reads or seeks... All writes to disk in Cassandra are append only."
- Enforcing uniqueness on a primary key — creating a user account, claiming a reservation confirmation number — where a read-then-write in application code would race, and `IF NOT EXISTS` is the correct tool.
- Guarding an update against a value you expect not to have changed (the book's inventory-count example) with `UPDATE ... IF <column> = <expected>`, and handling the returned current values on failure.
- Keeping denormalized tables in sync — writing the same reservation into `reservations_by_confirmation` and `reservations_by_hotel_date` — which is the batch use case the book actually endorses.
- Diagnosing a `Batch too large` error, or a team that reached for batches as a bulk-loading shortcut and made throughput worse.
- Reading a node's data directory during an incident and knowing what each SSTable component file is for before deciding what to copy.

## Deep Dive

### Write consistency levels, specifically on writes

The tunable consistency levels themselves are covered in the companion concept on Cassandra consistency; what matters here is how they behave on the write path. "A higher consistency level means that more replica nodes need to respond, indicating that the write has completed. Higher consistency levels also come with a reduction in availability, as more nodes must be operational for the write to succeed."

Two levels have write-specific meaning worth memorizing:

**`ANY` is the odd one out.** It "ensure[s] that the value is written to a minimum of one replica node before returning to the client, **allowing hints to count as a write**." If the target node is down, the coordinator "will make a note to itself, called a hint, which it will store until that node comes back up, or until the stored hint passes the expiration window specified by the `max_hint_window_in_ms` property." Once the node returns, the stored hint is replayed to it. In every other level, a hint does *not* count toward the consistency level — so `ANY` is the only setting where a "successful" write can exist on zero replicas.

**`ONE` is the durability floor.** "Using the consistency level of `ONE` on writes means that the write operation will be written to both the commit log and the memtable. That means that writes at `ONE` are durable, so this level is the minimum level to use to achieve fast performance and durability. If this node goes down immediately after the write operation and before the memtable has been flushed to disk, the value will have been written to the commit log, which can be replayed when the server is brought back up."

The rest follow the shape you would expect: `TWO`/`THREE` are the same guarantee on more nodes, `LOCAL_ONE` adds "the responding node is in the local data center", `QUORUM` is `(replication factor / 2) + 1`, `LOCAL_QUORUM` restricts that majority to the local DC, `EACH_QUORUM` demands a quorum in *every* DC, and `ALL` requires every replica — "If even one replica is unresponsive to the write operation, fail the operation."

Defaults are set per client. In `cqlsh`, `CONSISTENCY;` reports the current level and `CONSISTENCY LOCAL_ONE;` sets it. In the DataStax Java Driver it is the `basic.request.consistency` configuration option — "If you do not configure this, it will be set to `LOCAL_ONE`" — overridable per statement with `statement.setConsistencyLevel(ConsistencyLevel.LOCAL_QUORUM)`.

### The write path, between nodes and inside one node

The path begins "when a client initiates a write query to a Cassandra node that serves as the coordinator for this request. The coordinator node uses the partitioner to identify which nodes in the cluster are replicas, according to the replication factor for the keyspace." Two details are easy to miss and both matter operationally:

- **The coordinator may itself be a replica**, "especially if the client is using a token-aware load balancing policy."
- **The consistency check happens before anything is written.** "If the coordinator knows that there are not enough replicas up to satisfy the requested consistency level, it returns an error immediately."

Then: "the coordinator node sends simultaneous write requests to **all** local replicas for the data being written." Not a quorum's worth — all of them. The consistency level governs how many must *answer*, never how many are *asked*. In a multi-DC cluster, "the local coordinator node selects a remote coordinator in each of the other data centers to forward the write to the replicas in that data center. Each of the remote replicas acknowledges the write directly to the original coordinator node."

"The coordinator waits for the replicas to respond. Once a sufficient number of replicas have responded to satisfy the consistency level, the coordinator acknowledges the write to the client. If a replica doesn't respond within the timeout, it is presumed to be down, and a hint is stored for the write." Nodes that miss the write "will be repaired via one of the anti-entropy mechanisms: hinted handoff, read repair, or anti-entropy repair."

Inside each replica, the sequence is the classic log-structured merge tree design:

1. "the replica node receives the write request and **immediately writes the data to the commit log**."
2. "Next, the replica node writes the data to a memtable. If row caching is used and the row is in the cache, the row is invalidated."
3. "If the write causes either the commit log or memtable to pass its maximum thresholds, a flush is **scheduled** to run."
4. "At this point, the write is considered to have succeeded and the node can reply to the coordinator node or client."
5. "**After returning**, the node executes a flush if one was scheduled. The contents of each memtable are stored as SSTables on disk, and the commit log is cleared."
6. Then compaction is checked for and performed if needed.

Step 4 is the whole trick: acknowledgment happens after two in-memory-and-append operations, never after a disk seek, and the flush is deliberately pushed past the reply.

The animation below walks that exact sequence for a `QUORUM` write with replication factor 3 — the coordinator hop, the fan-out to all three replicas, the commit-log-then-memtable work inside one of them, the acks coming back, and the flush that happens only after the client has already been told the write succeeded.

```viz
type: graph
node CLIENT Client 0 2
node COORD Coord 2 2
node REPA RepA 4 0
node REPB RepB 4 2
node REPC RepC 4 4
node CLOG CommitLog 6 1
node MEM Memtable 6 3
node SST SSTable 8 2
edge CLIENT COORD
edge COORD REPA
edge COORD REPB
edge COORD REPC
edge REPB CLOG
edge CLOG MEM
edge MEM SST
---
visit CLIENT | The client sends an INSERT at consistency level QUORUM. Replication factor is 3, so QUORUM is (3 / 2) + 1 = 2 replicas that must respond.
traverse CLIENT COORD | A client can connect to any node. Whichever node it reaches serves as the coordinator for this request -- and may itself be one of the replicas, especially under a token-aware load balancing policy.
visit COORD | The coordinator uses the partitioner to identify which nodes are replicas for this partition. If it already knows too few are up to satisfy QUORUM, it returns an error here -- before a single byte is written anywhere.
traverse COORD REPA | The coordinator sends simultaneous write requests to ALL local replicas.
traverse COORD REPB | All three, not two. The consistency level decides how many must answer, never how many are asked.
traverse COORD REPC | The third replica is unresponsive in this run. The write is still sent to it.
visit REPB | Zoom inside one replica. This is the log-structured merge tree write path, and it never performs a disk read or a seek.
traverse REPB CLOG | First action on arrival: the data is written immediately to the commit log.
visit CLOG | An append-only binary file under data/commitlog, named CommitLog-<version>-<timestamp>.log. This append is the entire durability guarantee at this instant.
traverse CLOG MEM | Next, the same data is written to a memtable. If row caching is on and this row is cached, the cached row is invalidated.
visit MEM | The write is now considered to have succeeded and the node may reply. Nothing has been written to an SSTable. If a threshold was crossed, a flush has been SCHEDULED, not run.
traverse REPB COORD | Replica B acknowledges the write directly to the coordinator. That is ack 1 of the 2 QUORUM needs.
visit REPA | Replica A did exactly the same two steps -- commit log, then memtable -- on its own copy.
traverse REPA COORD | Ack 2. Quorum reached.
mark COORD | Two of three have answered, which satisfies QUORUM. The coordinator does not wait for the third.
traverse COORD CLIENT | The coordinator acknowledges the write to the client. From the client's point of view the write is done, right here.
mark CLIENT | Note what is true at this moment: two replicas hold the data in memory plus commit log, one replica does not hold it at all, and no SSTable has been touched.
mark REPC | Replica C never responded within the timeout, so it is presumed down and a hint is stored for the write. A hint does NOT count as a successful replica write unless the consistency level is ANY. It will be reconciled by hinted handoff, read repair, or anti-entropy repair.
traverse MEM SST | Only after replying does the node execute the flush that was scheduled earlier.
visit SST | The memtable contents are written as SSTable component files -- Data.db, Index.db, Filter.db and friends -- and the commit log is cleared. The client was told "success" several steps ago; this step is what turns that into on-disk permanence without the client ever waiting for it.
```

### Writing files to disk

Commit logs are binary files under `$CASSANDRA_HOME/data/commitlog`, named `CommitLog-<version>-<timestamp>.log` (the book's example: `CommitLog-7-1566780133999.log`). "The version is an integer representing the commit log format. For example, the version for the 4.0 release is 7."

SSTables live under `$CASSANDRA_HOME/data/data`, one directory per keyspace, then one per table named `<table>-<UUID>` — "The purpose of the UUID is to distinguish between multiple schema versions", e.g. `hotel/hotels-3677bbb0155811e5899aa9fac1d00bce`. Each SSTable is **several files**, named `<version>-<generation>-<implementation>-<component>.db`:

- **version** — two characters for the SSTable format's major/minor version; `na` for the 4.0 release.
- **generation** — "an index number that is incremented every time a new SSTable is created for a table."
- **implementation** — the `SSTableWriter` implementation; as of 4.0 the value is `big`, the "Bigtable format".

And the components:

| Component | Purpose |
|---|---|
| `Data.db` | The actual data — and "the only files that are preserved by Cassandra's backup mechanisms" |
| `Index.db` | Row and column offsets into `Data.db`; read into memory so Cassandra knows exactly where to look |
| `Summary.db` | A sample of the index, for faster reads |
| `Filter.db` | The Bloom filter for this SSTable |
| `CompressionInfo.db` | Metadata about the compression of `Data.db` |
| `Digest.crc32` | A CRC32 checksum for `Data.db` |
| `Statistics.db` | Statistics used by `nodetool tablehistograms` |
| `TOC.txt` | Lists the file components for this SSTable |

Note the `Data.db` line if you ever hand-roll a backup: it is the only component the built-in backup mechanisms preserve. Releases prior to 2.2 prefixed each filename with the keyspace and table name; 2.2 and later drop that, since it is inferable from the directory.

If you are experimenting on a real node and no SSTables have appeared yet, `nodetool flush` forces the flush rather than waiting for a threshold.

### Lightweight transactions: Paxos, and what "expensive" means concretely

Cassandra "does not support transactions with full ACID semantics", but it "does provide two mechanisms that offer some transactional behavior: lightweight transactions and batches." The LWT mechanism, introduced in 2.0, exists to solve a specific problem that consistency levels alone cannot: "strong consistency is not enough to prevent race conditions in cases where clients need to read, then write data." Read-then-write in application code has a window; an LWT closes it. The property it provides is **linearizable consistency** — "we'd like to guarantee that no other client can come in between our read and write queries with their own modification."

The semantics:

- On `INSERT`, `IF NOT EXISTS` "will ensure that you do not overwrite an existing row with the same primary key" — the uniqueness case: user identity, accounts, reservation records. `IF EXISTS` is the mirror image, "effectively limiting Cassandra's upsert behavior."
- On `UPDATE`, `IF <conditions>` checks one or more conditions joined by `AND`, each a check on a column using `=`, `!=`, `>`, `>=`, `<`, `<=`, or `IN`. "This is frequently used to make sure that a row has an expected value that cannot change before a write occurs" — the inventory-count case.

```sql
INSERT INTO reservation.reservations_by_confirmation (confirm_number,
  hotel_id, start_date, end_date, room_number, guest_id) VALUES (
  'RS2G0Z', 'NY456', '2020-06-08', '2020-06-10', 111,
  1b4d86f4-ccff-4256-a63d-45c905df2677) IF NOT EXISTS;

 [applied]
-----------
      True
```

Run it a second time and `[applied]` comes back `False` — **along with the row that blocked it**. That echo is a deliberate feature: "If a transaction fails because the existing values did not match the ones you expected, Cassandra will include the current values so you can decide whether to retry or abort without needing to make an extra request." The `UPDATE` form behaves the same way:

```sql
UPDATE reservation.reservations_by_confirmation SET end_date='2020-06-12'
  WHERE confirm_number='RS2G0Z' IF end_date='2020-06-10';
```

Because Cassandra's normal model is upsert, "the `IF NOT EXISTS` syntax available on `INSERT`, and the `IF x=y` syntax on `UPDATE` represent the main semantic difference between these two operations." CQL also accepts `IF NOT EXISTS` on `CREATE KEYSPACE` / `CREATE TABLE`, which is useful when scripting schema updates.

From the Java driver, a conditional statement is built with `.ifNotExists()`, and the result carries a single row with a boolean `applied` column, also reachable through `resultSet.wasApplied()`.

**The cost is structural, not incidental.** Paxos "is a consensus algorithm that allows distributed peer nodes to agree on a proposal, without requiring a leader to coordinate a transaction" — an alternative to two-phase commit. Basic Paxos has two stages, prepare/promise and propose/accept: "a coordinator node can propose a new value to the replica nodes, taking on the role of leader. Other nodes may act as leaders simultaneously for other modifications. Each replica node checks the proposal, and if the proposal is the latest it has seen, it promises to not accept proposals associated with any prior proposals... If the proposal is approved by a majority of replicas, the leader commits the proposal, but with the caveat that it must first commit any in-progress proposals that preceded its own proposal."

Cassandra extends that to get read-before-write (check-and-set) semantics and to reset state between transactions, "by inserting two additional phases into the algorithm":

1. Prepare/Promise
2. Read/Results
3. Propose/Accept
4. Commit/Ack

"Thus, a successful transaction requires **four round-trips** between the coordinator node and replicas. This is more expensive than a regular write, which is why you should think carefully about your use case before using LWTs."

Conditional writes also carry a second consistency level: "Conditional write statements use a **serial consistency level** in addition to the regular consistency level. The serial consistency level determines the number of nodes that must reply in the Paxos phase of the write, when the participating nodes are negotiating about the proposed write." `SERIAL` (the default) means a quorum of nodes must respond; `LOCAL_SERIAL` restricts the transaction to the local data center. It applies on reads too: "If Cassandra detects that a query is reading data that is part of an uncommitted transaction, it commits the transaction as part of the read, according to the specified serial consistency level." Set it with `SERIAL CONSISTENCY` in `cqlsh`, the `serial-consistency` driver option, or `Statement.setSerialConsistencyLevel()` per statement.

Finally, the scope limit: "Cassandra's lightweight transactions are limited to a single partition. Internally, Cassandra stores a Paxos state for each partition. This ensures that transactions on different partitions cannot interfere with each other."

The second animation traces those four phases. Compare it directly against the first one: the plain `QUORUM` write above was **one** coordinator-to-replica round trip and provided no protection against a concurrent client writing the same key in between your read and your write. This one pays four round trips and buys exactly that protection.

```viz
type: graph
node CLIENT Client 0 2
node LEAD Leader 2 2
node PA RepA 4 0
node PB RepB 4 2
node PC RepC 4 4
node BALLOT PaxosState 6 1
node ROW Row 6 3
edge CLIENT LEAD
edge LEAD PA
edge LEAD PB
edge LEAD PC
edge PB BALLOT
edge PC ROW
---
visit CLIENT | The client sends INSERT ... IF NOT EXISTS. That IF clause is the whole difference: it turns an ordinary write into a lightweight transaction with read-before-write, check-and-set semantics.
traverse CLIENT LEAD | The coordinator takes on the role of Paxos leader for this proposal. Paxos needs no elected leader -- other nodes may lead other proposals at the same time. The transaction is scoped to a single partition.
visit LEAD | ROUND TRIP 1 of 4 -- Prepare/Promise. The leader proposes a ballot to the replicas of this one partition.
traverse LEAD PA | prepare(ballot)
traverse LEAD PB | prepare(ballot)
traverse LEAD PC | prepare(ballot). The serial consistency level, SERIAL by default, decides how many must reply during this negotiation. LOCAL_SERIAL restricts it to the local data center.
visit PB | Each replica checks the proposal. If it is the latest ballot that replica has seen, it promises not to accept any earlier proposal -- and returns the last proposal it received that is still in progress.
traverse PB BALLOT | That promise is durable, not just in flight: Cassandra keeps a Paxos state per partition, in the system.paxos table.
visit BALLOT | One Paxos state per partition is precisely why LWTs cannot span partitions -- and why transactions on different partitions cannot interfere with each other.
traverse PB LEAD | promise
traverse PA LEAD | A second promise. A quorum has promised, so phase 1 is complete -- and still nothing at all has been written.
mark LEAD | ROUND TRIP 2 of 4 -- Read/Results. This phase is Cassandra's addition to basic Paxos: read the current value so the IF condition can actually be evaluated.
traverse LEAD PC | The leader reads the current state of the row from the replicas.
visit PC | This node holds the partition being written.
traverse PC ROW | Read the row with primary key confirm_number = 'RS2G0Z'.
visit ROW | The condition is evaluated here. If a row already existed, the statement returns [applied] = False together with the existing values, so the client can retry or abort without a second request. In this run no row exists, so IF NOT EXISTS holds.
traverse PC LEAD | results
mark LEAD | ROUND TRIP 3 of 4 -- Propose/Accept. Only now does the leader propose the actual value.
traverse LEAD PA | propose(value)
visit PA | A replica accepts, provided it has not since promised a newer ballot. If a quorum accepts, the value is decided -- with the caveat that the leader must first commit any in-progress proposal that preceded its own.
traverse PA LEAD | accept
mark LEAD | ROUND TRIP 4 of 4 -- Commit/Ack. The decided value is finally applied through the ordinary write path -- commit log then memtable on each replica -- at the statement's regular consistency level.
traverse LEAD PB | commit
traverse LEAD PC | commit
traverse CLIENT LEAD | The client gets back a single row with a boolean applied column. Four coordinator-to-replica round trips have bought linearizability on one partition; the plain QUORUM write in the previous animation did the same job in one round trip and offered none of it.
mark CLIENT | Use this where a race would actually corrupt data -- claiming a unique account name, a reservation number, a decrementing inventory count -- and not as a default write mode.
```

### Batches: what they are and what they are not

"While lightweight transactions are limited to a single partition, Cassandra provides a batch mechanism that allows you to group multiple modifications into a single statement, whether they address the same partition or different partitions."

The rules:

- Only `INSERT`, `UPDATE`, or `DELETE` may appear in a batch.
- Batches are logged or unlogged; logged batches "have more safeguards."
- "**Batches are not a transaction mechanism**, but you can include lightweight transaction statements in a batch. Multiple lightweight transactions in a batch must apply to the same partition."
- Counter modifications only go in a *counter batch*, which can contain nothing else. The DataStax drivers do not have a separate counter-batch type — "you must simply remember to create batches that include only counter modifications or only non-counter modifications."

A logged batch is `BEGIN BATCH ... APPLY BATCH` in CQL, or `BatchStatement` (or `BatchStatementBuilder`) in the Java driver. The endorsed use case is narrow and specific: "making multiple updates to a single partition, or keeping multiple tables in sync. A good example is making modifications to denormalized tables that store the same data for different access patterns" — writing the same reservation to both `reservations_by_confirmation` and `reservations_by_hotel_date`.

**What "logged" actually guarantees.** "Logged batches are atomic — that is, if the batch is accepted, all of the statements in a batch will succeed eventually." But read the qualifier carefully: "this is not the same definition of atomicity you might be used to if you have a relational database background. While all updates in a batch belonging to a given partition key are performed atomically, **there is no guarantee across partitions. This means that modifications to different partitions may be read before the batch completes.**" So it is eventual-all-or-nothing, with no isolation: no rollback, and readers can see a half-applied batch.

Mechanically: "the coordinator sends a copy of the batch called a batchlog to two other nodes, where it is stored in the `system.batchlog` table. The coordinator then executes all of the statements in the batch, and deletes the batchlog from the other nodes after the statements are completed." If the coordinator dies mid-batch, those nodes replay it. "Each node checks its batchlog once a minute to see if there are any batches that should have completed", using a grace period "equal to twice the value of the `write_request_timeout_in_ms` property"; anything older is replayed and then deleted. The second batchlog copy is redundancy for the mechanism itself.

**Unlogged batches skip all of that.** "In an unlogged batch, the steps involving the batchlog are skipped, allowing the write to complete more quickly. Users who are trying to rapidly insert a lot of data are often tempted to use unlogged batches. The trade-off you'll want to consider is that there is no guarantee that all of the writes to different partitions will complete successfully, which could leave the database in an inconsistent state. **This risk does not exist when a batch contains mutations to a single partition.**" That last sentence has a nice consequence: "if you request a logged batch with mutations to a single partition, Cassandra actually executes it as an unlogged batch to give you an extra boost of speed." Single-partition logged batches are free.

**Batches are not bulk loading.** "First-time users often confuse batches for a way to get faster performance for bulk updates. This is definitely not the case — batches actually decrease performance and can cause garbage collection pressure."

Size is capped in bytes, not statement count: `batch_size_warn_threshold_in_kb` logs a WARN, and any batch above `batch_size_fail_threshold_in_kb` "will be rejected and result in error notification to the client." Defaults are 5 KB and 50 KB. "For simple statements, the size is the length of each CQL query, but the size will be lower for prepared statements since only the statement ID and parameter values are sent" — another reason to prepare.

### Book vs today

The write path, the LWT semantics, the batch guarantees, and the SSTable components are all still accurate in Cassandra 5.0. Four things have moved since the Revised 3rd Edition (which targets 4.0):

> **Paxos v2 halves the round trips — but it is still opt-in.** Cassandra 4.1 shipped a reworked Paxos implementation (CEP-14), selected with the `paxos_variant` setting. The `cassandra.yaml` comments state the cost explicitly: `v1` (still the default in 5.0) is "Legacy Paxos. Expect 4RTs for a write and 3RTs for a read" — exactly the four round trips the book describes — while `v2` is "Optimized Paxos. Expect 2RTs for a write, and either 1RT or 2RT for a read", and is marked "(recommended)". Switching is a documented rolling procedure (all nodes on 4.1+, `nodetool repair --full -pr` on each node, then set `paxos_variant: v2` and rolling restart) and rollback needs no data migration. The book's "think carefully before using LWTs" advice still stands; the price on a modern, correctly configured cluster is roughly half of what the book quotes.

> **The `cassandra.yaml` properties in this chapter were renamed in 4.1.** CASSANDRA-15234 separated parameter names from their units. `max_hint_window_in_ms` is now `max_hint_window: 3h`, `write_request_timeout_in_ms` is now `write_request_timeout: 2000ms`, and the batch thresholds are `batch_size_warn_threshold: 5KiB` and `batch_size_fail_threshold: 50KiB` — same defaults, new names and explicit units. Old names remain supported through a backward-compatibility layer, so the book's names still work; they are simply no longer what you will see in a current `cassandra.yaml`.

> **SSTable generation numbers are no longer necessarily numbers.** The book describes `generation` as "an index number that is incremented every time a new SSTable is created for a table". Cassandra 4.1 added globally unique, lexicographically sortable ULID-style identifiers to avoid filename collisions across backups and after truncate/restart cycles, enabled with `uuid_sstable_identifiers_enabled: true` (off by default). The sequential integer is still what you get out of the box.

> **`big` is no longer the only SSTable format.** The book states the implementation component is `big`, "the 'Bigtable format'". Cassandra 5.0 added a trie-indexed `bti` format, selected via `sstable: selected_format:`. The default is still `big`, and the docs note that with the BIG format large collation indexes cannot be cached efficiently, recommending BTI for very large partitions. This is an addition, not a deprecation.

## Trade-offs

- **A lightweight transaction is roughly four times the network cost of a normal write, and the book says so plainly.** "A successful transaction requires four round-trips between the coordinator node and replicas. This is more expensive than a regular write, which is why you should think carefully about your use case before using LWTs." That is not a micro-optimization concern: on a cross-region cluster, four coordinator-to-replica round trips at `SERIAL` (rather than `LOCAL_SERIAL`) means four WAN latencies serialized into one statement. The correct posture is to identify the small set of writes where a race genuinely corrupts data — claiming a unique username, a confirmation number, decrementing inventory — and use LWTs exactly there. Sprinkling `IF NOT EXISTS` on every insert "to be safe" converts your fast write path into your slowest one. Paxos v2 on 4.1+ improves this to about two round trips, which changes the magnitude but not the shape of the decision.
- **LWTs are also a contention trap, not just a latency trap.** Paxos state is per partition, which is the property that keeps transactions on different partitions independent — but it means concurrent LWTs on the *same* partition contend directly, with proposals invalidating each other and retrying. A hot partition under LWT load degrades much worse than the same partition under plain writes. Design the partition key so contending transactions are naturally spread, rather than treating LWT throughput as a tuning problem.
- **`ANY` is the one consistency level that can report success with the data on no replica at all.** Every other level requires an actual commit-log-plus-memtable write on at least one node; `ANY` accepts a hint as the write. If every replica is down, the hint sits on the coordinator, and it expires after `max_hint_window` (3h by default) if the node never comes back. The write is then simply gone, having been acknowledged as successful. `ANY` buys availability during a partial outage and pays for it with an acknowledgment that does not mean what an acknowledgment normally means.
- **The commit-log-then-memtable path is durable and fast, but its durability is entirely the commit log's.** At the instant a replica acknowledges, the data exists in that node's memtable (volatile) and in its commit log (on disk, append-only). Nothing is in an SSTable. A crash before flush is fully recoverable — the commit log is replayed on restart — but only to the extent the commit log itself was on stable storage. That means commit log sync settings, filesystem behavior, and disk-level write caching are the real durability surface, not the memtable. And the flush is scheduled *after* the reply, so throughput cliffs and GC pressure from a large flush show up as latency on writes that already succeeded.
- **Unlogged batches are the easiest way to accidentally build a fake multi-row transaction.** They look transactional (`BEGIN BATCH ... APPLY BATCH`), skip the batchlog entirely, and offer "no guarantee that all of the writes to different partitions will complete successfully, which could leave the database in an inconsistent state." The failure mode is silent: it works fine in testing, and then one coordinator failure leaves two denormalized tables permanently disagreeing with no record that a batch was ever in flight. If a batch spans partitions and you care about all of it landing, it must be logged. If it does not span partitions, logging is free anyway — Cassandra downgrades it to unlogged for you.
- **Even a logged batch is not a relational transaction.** "All updates in a batch belonging to a given partition key are performed atomically" but "there is no guarantee across partitions... modifications to different partitions may be read before the batch completes." There is no isolation and no rollback: readers can observe a partially applied batch, and a batch that has been accepted will eventually complete whether you want it to or not. Logged batches give you eventual completion, not a transaction boundary.
- **Batching for throughput is actively counterproductive.** "Batches actually decrease performance and can cause garbage collection pressure", and the logged variant "places additional work on the coordinator to orchestrate the execution of the various statements" plus two extra batchlog writes. The size limits (`5KiB` warn, `50KiB` fail) exist precisely to stop this pattern before it destabilizes a node. The genuine benefit — "saves back-and-forth traffic between the client and the coordinator node" — is real but small next to concurrent individual async writes, which is what a bulk load should use instead.
- **Sending the write to all replicas while waiting for only a quorum is a deliberate asymmetry with a cost.** Every write consumes replication-factor's worth of network and CPU regardless of consistency level; only the *wait* is shortened. Lowering the consistency level therefore improves latency and availability without reducing cluster load at all. It also means a slow replica does not slow your write, but it does keep accumulating hints — which is a deferred cost that lands later, at hint replay time, on a node that has just come back and is already catching up.

## Documentation Links

- [Jeff Carpenter and Eben Hewitt, "Cassandra: The Definitive Guide", Revised 3rd Edition (O'Reilly, 2022) — Chapter 9, "Writing and Reading Data" (Writing), p. 285-304](https://www.oreilly.com/library/view/cassandra-the-definitive/9781492097143/) — doc
- [Apache Cassandra Documentation — Dynamo: Writes](https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html#writes) — doc
- [Apache Cassandra Documentation — Lightweight Transactions](https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html#lightweight-transactions) — doc
- [Apache Cassandra Documentation — Storage Engine (commit log, memtables, SSTables)](https://cassandra.apache.org/doc/latest/cassandra/architecture/storage-engine.html) — doc
- [Apache Cassandra Documentation — cassandra.yaml File Configuration](https://cassandra.apache.org/doc/latest/cassandra/managing/configuration/cass_yaml_file.html) — doc
- [Apache Cassandra Documentation — Liberating cassandra.yaml Parameters' Names from Their Units](https://cassandra.apache.org/doc/4.1/cassandra/configuration/configuration.html) — doc
- [Apache Cassandra Blog — Apache Cassandra 4.1: New SSTable Identifiers](https://cassandra.apache.org/_/blog/Apache-Cassandra-4.1-New-SSTable-Identifiers.html) — doc
- [Apache Cassandra Wiki — CEP-14: Paxos Improvements](https://cwiki.apache.org/confluence/display/CASSANDRA/CEP-14:+Paxos+Improvements) — doc
- [CQL Reference — BATCH](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/dml.html#batch) — doc
