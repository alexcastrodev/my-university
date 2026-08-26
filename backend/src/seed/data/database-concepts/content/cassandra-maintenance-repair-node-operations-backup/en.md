---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Understand the operator's half of Cassandra's consistency story: the **periodic, manually-triggered anti-entropy repair** (`nodetool repair`) that catches everything the per-query mechanisms miss, the **node lifecycle operations** (adding, replacing, and removing nodes) that keep a cluster's replica set correct as hardware comes and goes, and the **backup and restore** tooling (`nodetool snapshot`, incremental backups) that protects against the failure modes replication cannot cover — human error, corruption, and multi-datacenter disaster. Where the sibling consistency-levels concept covers hinted handoff and read repair as things that happen automatically *during* a request, this concept covers the maintenance an operator schedules and runs *between* requests.

## Use Cases

- Scheduling a recurring `nodetool repair` job (via cron, Reaper, or a Kubernetes operator) and picking a cadence that keeps every node repaired inside its tables' `gc_grace_seconds`, so a downed replica can never resurrect a deleted row.
- Deciding whether a given repair needs `-pr` (primary range only, for routine sweeps), `-full` (for a snitch change, replication factor change, or recovering a node that was down), or a `-dc`/`-local` scope restriction.
- Bringing a cluster back to full capacity after a node dies: choosing between "replace it" (`-Dcassandra.replace_address_first_boot`) and "just add a fresh node and decommission the dead one," and knowing why the book calls the latter inefficient.
- Retiring a node or an entire data center without data loss — walking through `decommission` → `removenode` → `assassinate` in the order the book recommends them, and understanding what each one actually promises.
- Building a backup strategy that satisfies "we need to recover from an `DROP TABLE` someone ran by accident" as well as "we need to survive losing a data center" — snapshots for the former, snapshots plus incremental backups shipped off-cluster for the latter.
- Explaining to an on-call engineer why `nodetool status` showing a node `DN` for ten minutes is not automatically an incident, but the same node down for longer than `max_hint_window` is a "this needs a repair or a rebuild" incident.

## Deep Dive

### Anti-entropy repair: `nodetool repair`

The problem repair solves is stated precisely in the book: "writes at consistency levels less than `ALL` may succeed even if some of the nodes don't respond, especially when a cluster is under heavy load. It's also possible for a node to miss mutations if it is down or unreachable for longer than the time window for which hints are stored. The result is that different replicas for a different partition may have different versions of your data." Deletions make this worse — "a node that is down when the deletion occurs and remains offline for longer than the `gc_grace_seconds` defined for the table in question can 'resurrect' the data when it is brought back online." Hinted handoff and read repair (covered in the consistency-levels concept) narrow that window per-query; `nodetool repair` is the sweep that closes it for data nobody happened to read.

A basic repair:

```
$ nodetool repair
[2019-12-09 17:53:01,741] Starting repair command #1 (6aa75460-...
...
[2019-12-09 17:53:06,213] Repair completed successfully
```

Behind that command: the node you run it on becomes the **coordinator for the repair** — a different role than the per-query coordinator described in the consistency-levels concept, but the same idea of "whichever node you talk to takes charge of this one operation." `org.apache.cassandra.service.ActiveRepairService` runs a **validation compaction**: a read-only pass over local data that builds Merkle trees (see the consistency-levels concept for what a Merkle tree is) for the tables under repair. The node then trades trees with neighboring replicas via a `TreeRequest`/`TreeResponse` exchange; where trees disagree, the nodes stream the disagreeing ranges to each other.

That streaming step has a well-known cost, called **overstreaming**: "if you have a lot of data in a table, the resolution of Merkle trees will not go down to the individual partition. For example, in a node with a million partitions, each leaf node of the Merkle tree will represent about 30 partitions. Each of these partitions will have to be streamed together even if only a single partition requires repair." Every knob below exists to shrink either the search space or the blast radius of that streaming.

**Full vs. incremental repair, and anti-compaction.** Before 2.1, every repair was what's now called a **full repair** — every SSTable examined, every time. **Incremental repair** (2.1+, default since 2.2) separates repaired data from unrepaired data via **anti-compaction**, so each subsequent repair only has to search the unrepaired slice — fewer SSTables, smaller Merkle trees, less overstreaming. Cassandra tags this in SSTable metadata; `sstablemetadata` on a fresh SSTable shows `Repaired at: 0` until it's been through a repair. To force a full repair despite the default, pass `-full`.

**Sequential vs. parallel repair.** Sequential (`-seq`, default through 2.1) repairs the coordinator against one replica at a time, taking a snapshot at each node to build Merkle trees from; the dynamic snitch keeps performance up by favoring replicas not currently busy with repair. Parallel (`-par`, default since 2.2) repairs all replicas simultaneously — heavier load, faster completion, no snapshots needed.

**Scope options that shrink the work:**

| Option | Effect |
|---|---|
| `-pr` / `--partitioner-range` | Repairs only the node's primary range instead of every range it replicates. Run `-pr` on every node and the whole ring gets repaired exactly once each, instead of RF times. |
| `-st <token> -et <token>` | **Subrange repair** — breaks a node's range into a smaller chunk, both shrinking the work and sharpening Merkle-tree resolution enough to identify individual rows precisely, cutting overstreaming further. The book notes this is rarely hand-rolled; tools like **Reaper** automate it. |
| `-local` / `-dc <name>` | Restricts repair to the local data center, or a named one. |

**Reaper**, created by Spotify with a web UI added by The Last Pickle, is the book's recommended answer to "how do I actually run subrange repairs at scale": it "orchestrates repairs across one or more clusters, and lets you pause, resume, or cancel repairs and track repair status," using subrange repair plus a backpressure mechanism, with state stored in memory, H2, Postgres, or Cassandra itself.

**Best practices the book calls out explicitly:**

- *Frequency* is a function of your consistency levels, `gc_grace_seconds`, and repair strategy together — looser consistency levels demand more frequent repair.
- *Scheduling*: run repairs off-peak, or spread the load with subrange repair or staggered start times per keyspace/table.
- *Operations that require a full repair regardless of schedule*: changing the snitch, changing a keyspace's replication factor, or recovering a node that was down.
- *Conflicts*: "Cassandra does not allow multiple simultaneous repairs over a given token range," so manage repair scheduling from one external location rather than letting every node kick off its own.
- *Monitoring in flight*: `nodetool netstats`, until (per the book, quoting JIRA `CASSANDRA-10302`) "a more robust repair status mechanism is put in place."
- *Secondary indexes are not covered by repair at all* — they're local-only tables, so use `nodetool rebuild_index` after repairing the base table.

#### Book vs today

> **The recommended cadence is now a concrete number, not just "often enough."** The book's guidance is qualitative — repair before `gc_grace_seconds` expires on unrepaired data. Current Apache Cassandra operations docs put a number on it: with the default 10-day `gc_grace_seconds`, "repairing every node in your cluster at least once every 7 days will prevent" tombstone resurrection, and as a starting point for a healthy cluster, "running an incremental repair every 1-3 days, and a full repair every 1-3 weeks is probably reasonable." The underlying mechanism (Merkle trees, anti-compaction, overstreaming) is unchanged from the book; what's new is an operationally concrete cadence built on top of it.
> **Incremental repair's known flaw got fixed, not replaced.** The book flags — via a pointer to Alex Dejanovski's "Incremental Repair Improvements in Cassandra 4" — that anti-compaction alone wasn't sufficient to prevent overstreaming in pre-4.0 releases, without saying exactly what changed. It's still the default in current Cassandra, and current docs still recommend running occasional full repairs anyway, "because incremental repairs don't protect against things like disk corruption, [or] operator error" the way a from-scratch full repair does. The fix made incremental repair more efficient; it didn't make full repair obsolete.
> **`CASSANDRA-10302` ("track repair state for more reliable repair"), which the book cites for why `netstats` is the best you get, is still open.** `nodetool netstats` remains the practical way to watch a repair in progress; no built-in richer repair-status API has landed in mainline Cassandra. Tools like Reaper fill that gap with their own tracking, which is a large part of why the book — and current practice — recommend them over hand-rolled scripting.

### Node lifecycle: adding, replacing, and removing nodes

**Adding a node.** Beyond installing the same Cassandra version and matching `cassandra.yaml` settings (`cluster_name`, `dynamic_snitch`, `partitioner`, seed list), the operationally important default is `autobootstrap: true` — a new node claims token ranges and streams its share of the data automatically on startup. Watch progress with `nodetool status` or `nodetool bootstrap` (or resume a disabled bootstrap on demand with `nodetool bootstrap resume`). **After every node addition, run `nodetool cleanup` on the previously-existing nodes** — bootstrap reassigns token ranges but doesn't delete the now-unowned data those nodes are still holding; `cleanup` is a special-case compaction that discards it. Skipping this step is a common reason a "balanced" cluster still shows uneven disk usage after scaling out.

**Adding a data center** follows the same node-by-node procedure, plus: pick per-DC seeds independently, configure the snitch (repairing first if you're changing it on existing nodes), and only after every node in the new DC is up, alter keyspace replication to include it — e.g. `ALTER KEYSPACE reservation WITH REPLICATION = {'class': 'NetworkTopologyStrategy', 'DC1': 3, 'DC2': 3};` — then run `nodetool rebuild -- DC1` on each new-DC node to stream its data. The book's sidebar warns not to skip a client-side consequence: teams using `QUORUM` will suddenly have reads and writes crossing the new data center's WAN link unless they move to `LOCAL_QUORUM`, which is exactly the `LOCAL_QUORUM` vs. `EACH_QUORUM` trade-off described in the consistency-levels concept.

**Diagnosing a failed node** is a three-way decision tree keyed off how long it's been down, relative to two independent windows:

1. Down less than the hint delivery window (`max_hint_window`) → restart it; hinted handoff should catch it up.
2. Down longer than the hint window but less than the shortest `gc_grace_seconds` among its tables → restart it, then run `nodetool repair`.
3. Down longer than the repair window → **rebuild or replace it**, to avoid tombstone resurrection.

That third case is the direct link back to the sibling architecture concept's caveat about hinted handoff: hints expire, and a node down past that expiry has permanently missed writes that only a full repair (or a rebuild) can restore.

**Replacing a node** rather than removing-then-adding is the book's explicit recommendation, because remove-then-add "results in excess streaming of data." The efficient path is to bring up a new node with the dead node's IP passed via `-Dcassandra.replace_address_first_boot=<address>` in `jvm.options`, then follow the normal add-node procedure; `nodetool netstats` on the replacement tracks bootstrap progress. If the replaced node was a seed, promote an existing non-seed node to fill that role first, so the replacement itself can bootstrap normally as a non-seed.

**Removing a node** — the book gives three techniques, "in order of preference":

| Technique | When | What happens |
|---|---|---|
| `nodetool decommission` | Node is up | Calls `StorageService.decommission()`; the node reassigns its token ranges to other nodes and streams its data to them before leaving — the mirror image of bootstrapping. Shows as `UL` (up, leaving) in `nodetool status` while running. |
| `nodetool removenode <host-id>` | Node is down | Run from a *different* node, targeting the dead one by host ID (not IP). Cassandra recalculates ranges and streams from surviving replicas to the new owners. |
| `nodetool assassinate <ip>` | `removenode` (even `-force`) failed | Last resort — removes the node from gossip state **without** re-streaming its data anywhere, "which leaves your cluster in a state where repair is needed." Takes an IP, not a host ID. |

Two easy-to-miss follow-ups: decommissioning **does not delete the node's datafiles** — reintroducing a decommissioned node into the ring later requires manually clearing its old data first — and removing a seed node requires manually cleaning its address out of every remaining node's `cassandra.yaml` seed list.

**Removing a data center** reuses the same building blocks: confirm no clients are still connecting (the book points to querying the `system_views.clients` virtual table), run a full repair so nothing in the departing DC's ranges is lost, `ALTER KEYSPACE` to drop that DC's replication factor to zero for every affected keyspace, then stop each node.

### Backup and restore: snapshots and incremental backups

Replication is not a backup strategy — it protects against a node failing, not against "a person or a bug deleting good data and that deletion replicating everywhere before anyone notices," SSTable corruption, or a multi-DC outage. Cassandra's answer is two complementary mechanisms:

- **Snapshots** (`nodetool snapshot`) — a full backup. Cassandra flushes memtables first, then creates a **hard link** to every SSTable file, so the operation is nearly instant and costs no extra disk space *until* compaction later removes the original file and the hard link is the only thing keeping the data on disk.
- **Incremental backups** (`nodetool enablebackup`) — once enabled, every SSTable flush additionally hard-links into a `backups/` directory under the table's data directory, giving you continuous, small backups between snapshots.

```
$ nodetool snapshot
Snapshot directory: 1576202815095
```

Snapshots default to covering every keyspace, including Cassandra's own system keyspaces; pass a keyspace (and optionally `-cf <table>`) to scope it down. `nodetool listsnapshots` inventories what exists; each snapshot directory carries a `manifest.json` listing the SSTables it contains, so a restore can verify completeness. Because `nodetool snapshot` only touches the one node it runs on, a true point-in-time snapshot across a cluster needs a parallel-ssh tool to fire the command at every node simultaneously. Cassandra also takes an **automatic snapshot** on every `DROP KEYSPACE`, `DROP TABLE`, or `TRUNCATE` — controlled by `auto_snapshot` (default enabled) — specifically as a safety net against the "someone ran a destructive DDL statement" case.

**Restoring** starts from the most recent snapshot plus any incremental backups taken since. Two things people get wrong on the first try:

1. **Schema is not included in a snapshot or backup.** The book is blunt about this: "Cassandra does not include the database schema as part of snapshots and backups. You will need to make sure that the schema is in place before doing any restore operations" — scripting `DESCRIBE TABLES` ahead of time is the book's suggested safeguard.
2. **The restore mechanism depends on whether cluster topology changed since the backup.** If token ranges and replication are unchanged, `nodetool import` (or, pre-4.0, `nodetool refresh`) loads the copied SSTable files directly into a running node's data directory. If topology, tokens, or replication *have* changed, you need `sstableloader` instead — it speaks gossip to learn the cluster and streams each SSTable's rows through the current partitioner and replication strategy, rather than copying files node-for-node. `sstableloader` is also the standard tool for moving data between two different clusters entirely.

**Medusa**, built by Spotify and The Last Pickle on top of `nodetool snapshot`/`import`, wraps this into a production-oriented tool: per-node or whole-cluster backup and restore, restore into a *different* cluster (normally hard, because cluster and node names differ), and storage in S3 or Google Cloud Storage instead of only local disk.

#### Book vs today

> **The core mechanics — hard-linked SSTables, `nodetool snapshot`/`enablebackup`, schema excluded, `sstableloader` for cross-topology restores — are unchanged in current Apache Cassandra documentation.** The one version-sensitive detail the book flags itself has already resolved: `nodetool import` is the current tool for loading SSTables into a running node; `nodetool refresh` is the pre-4.0 equivalent the book mentions only for readers on older releases.

## Trade-offs

- **Incremental repair is cheaper per run but adds a bookkeeping cost full repair doesn't have.** Anti-compaction splitting repaired from unrepaired data shrinks the search space for every subsequent repair, but it's another moving part — SSTable metadata tracking repair state, an anti-compaction pass that itself costs I/O — and it still needs full repairs on top of it for the failure modes it can't see (corruption, operator error). "Just always run incremental" is not, by the current docs' own admission, a complete strategy on its own.
- **`-pr` makes cluster-wide repair tractable but only if you actually run it on every node.** Repairing primary ranges only turns an O(RF) amount of redundant work per ring sweep into O(1), but it's an all-or-nothing property of the *schedule*, not the command — miss a node's turn and that primary range silently goes unrepaired past `gc_grace_seconds`, with no error from the ranges that were repaired on time. This is precisely the gap tools like Reaper exist to close.
- **Sequential repair is gentler on the cluster; parallel repair is faster — you can't have both.** Sequential's snapshot-per-replica approach lets the dynamic snitch route load away from busy nodes during the process; parallel repairs every replica at once with no such cushioning. Parallel became the default in 2.2 precisely because most operators value wall-clock time over gentleness, but a cluster already under load is exactly the case where that default can make things worse, not better.
- **Replace-in-place beats remove-then-add on network cost, but only because it assumes you can bring the replacement up quickly.** `-Dcassandra.replace_address_first_boot` avoids the "excess streaming" the book warns remove-then-add causes, by having one node inherit the dead node's ranges directly. But it works by keeping the cluster at reduced effective replication for the replacement's entire bootstrap window — the same exposure `max_hint_window` and `gc_grace_seconds` govern for a simple restart, just applied to a brand-new node instead of a recovering one.
- **`decommission` → `removenode` → `assassinate` is a strictly decreasing scale of safety, in that order for a reason.** `decommission` re-streams everything before leaving — no repair needed afterward. `removenode` reconstructs the same guarantee from the survivors' side when the node can't cooperate. `assassinate` skips re-streaming entirely and explicitly leaves the cluster needing a repair — it exists only because sometimes `removenode` itself is stuck, and reaching for it first (instead of last) trades a clean handoff for a data-consistency debt you now owe yourself.
- **Snapshots are nearly free to take and non-trivial to actually own.** The hard-link trick makes `nodetool snapshot` fast and initially disk-cheap, but that cheapness is temporary and easy to forget about: snapshots accumulate held disk space as compaction proceeds (each hard link keeps an otherwise-obsolete SSTable alive), and copying them off-node, plus clearing them afterward, is left entirely to the operator or a third-party tool like Medusa. "We take snapshots" is not the same claim as "we have backups we've verified we can restore from a different cluster."
- **Excluding schema from snapshots keeps the backup mechanism simple, at the cost of a restore step everyone forgets until it bites them.** Because snapshots are pure SSTable hard links, they're topology- and schema-agnostic by construction — which is also exactly why they don't protect you from a lost schema. Any real restore runbook has to treat "recreate the keyspace and table definitions" as its own tracked artifact, not an assumption.

## Documentation Links

- [Jeff Carpenter and Eben Hewitt, "Cassandra: The Definitive Guide", Revised 3rd Edition (O'Reilly, 2022) — Chapter 12, "Maintenance" (Repair through Backup and Recovery)](https://www.oreilly.com/library/view/cassandra-the-definitive/9781492097143/) — doc
- [Apache Cassandra Documentation — Repair](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/repair.html) — doc
- [Apache Cassandra Documentation — Adding, Replacing, Moving and Removing Nodes](https://cassandra.apache.org/doc/latest/cassandra/operating/topo_changes.html) — doc
- [Apache Cassandra Documentation — Backups](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/backups.html) — doc
- [Apache Cassandra Documentation — Bulk Loading (sstableloader)](https://cassandra.apache.org/doc/latest/cassandra/managing/tools/sstable/sstableloader.html) — doc
- [Apache Cassandra Documentation — cassandra.yaml Configuration Reference (max_hint_window, gc_grace_seconds, auto_snapshot, incremental_backups)](https://cassandra.apache.org/doc/latest/cassandra/managing/configuration/cass_yaml_file.html) — doc
- [CASSANDRA-10302 — Track repair state for more reliable repair](https://issues.apache.org/jira/browse/CASSANDRA-10302) — doc
- [TLP / Cassandra Reaper](http://cassandra-reaper.io/) — doc
