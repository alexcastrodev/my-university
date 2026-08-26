---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Understand how to actually look inside a running Cassandra cluster: the JMX/MBean layer that exposes internal state, the `nodetool` commands built on top of it that you will run during any incident, and the virtual tables feature that lets you query that same internal state with plain CQL instead of a separate tool. The companion concepts on storage engine internals and distributed architecture describe what compaction, memtables, gossip, and tokens *are*; this concept is about how you *observe* those mechanisms on a live node — which command tells you a node is unbalanced, which one tells you compaction is falling behind, and which one tells you a client is misbehaving.

## Use Cases

- Running `nodetool status` after a deploy or hardware event to confirm every node is `UN` (up/normal) before assuming the cluster is healthy — a node stuck in `Leaving` or unreachable will not show up any other way.
- Reading `nodetool tpstats` when client-visible latency spikes, to tell the difference between "the node is idle and something upstream is slow" and "the `MutationStage` is backed up and this node genuinely cannot keep up with writes."
- Using `nodetool compactionstats` and `nodetool tablestats` (formerly `cfstats`) together to decide whether a table with degrading read latency has a real compaction backlog or just needs a different compaction strategy — the diagnostic step the storage-engine concept's compaction section assumes you already know how to perform.
- Querying `system_views.sstable_tasks`, `system_views.max_partition_size`, or `system_views.settings` directly over a CQL connection from application code or a monitoring script, without shelling into the node or opening a JMX port.
- Checking `system_views.clients` to confirm which application instances are actually connected to a node, and at what request volume, when a client team reports "we can't reach Cassandra" and you need to know whether the problem is on their side or the node's.
- Wiring Cassandra's Dropwizard-based JMX metrics into Prometheus and Grafana for cluster-wide dashboards, rather than relying on point-in-time `nodetool` output from one node at a time.
- Enabling full query logging with `nodetool enablefullquerylog` to capture and later replay exact CQL traffic when a production incident needs to be reproduced against a test cluster.

## Deep Dive

### JMX and MBeans: the layer everything else sits on

Cassandra exposes its internals through Java Management Extensions. "JMX is a Java API that provides management of applications in two key ways. First, it allows you to understand your application's health and overall performance in terms of memory, threads, and CPU usage... Second, it allows you to work with specific aspects of your application that you have instrumented." Cassandra is heavily instrumented: "Many classes in Cassandra are exposed as MBeans, which means in practical terms that they implement a custom interface that describes attributes they expose and operations that need to be implemented and for which the JMX agent will provide hooks."

The `CompactionManagerMBean` is a representative example the book walks through directly:

```java
public interface CompactionManagerMBean
{
    public List<Map<String, String>> getCompactions();
    public List<String> getCompactionSummary();
    public TabularData getCompactionHistory();

    public void forceUserDefinedCompaction(String dataFiles);
    public void stopCompaction(String type);
    public void stopCompactionById(String compactionId);
    public int getCoreCompactorThreads();
    public void setCoreCompactorThreads(int number);
    ...
}
```

"Some simple values in the application are exposed as attributes... Other attributes that are read-only are the current compactions in progress, the compactionSummary, and the compactionHistory... MBeans can also make operations available to the JMX agent that let you execute some useful action." This is the mechanism, and nearly everything downstream — `nodetool`, JConsole, Grafana dashboards fed by JMX exporters — is a client reading these same attributes and invoking these same operations remotely: "In most cases, the operations and attributes exposed by the MBeans are accessible via nodetool commands discussed throughout this book."

A handful of MBeans map directly onto the diagnostics used most often:

- `StorageServiceMBean` — reports `OperationMode` (`normal`, `leaving`, `joining`, `decommissioned`, `client`), the live and unreachable node sets, and `getLoadMapWithPort()` for per-node storage load. This backs `nodetool status`, `describecluster`, and `ring`.
- `StorageProxyMBean` — read/write timeout values and hinted-handoff statistics (`getTotalHints()`, `getHintsInProgress()`), backing `enablehandoff`/`disablehandoff`/`statushandoff`.
- `ColumnFamilyStoreMBean` — one instance per table (and per secondary index, since indexes are tables), exposing `getSSTableCountPerLevel()`, `estimateKeys()`, and `forceMajorCompaction()`. This is the attribute set behind `tablestats` and manual compaction.
- `CompactionManagerMBean` — compaction history and the ability to force or stop a specific compaction, behind `compact`, `compactionhistory`, and `compactionstats`.
- `GossiperMBean` — `getEndpointDowntime()` and `getCurrentGenerationNumber()`; the generation number "is included in gossip messages exchanged between nodes and is used to distinguish the current state of a node from the state prior to a restart," incrementing on every restart. The distributed-architecture concept's gossip mechanics show up here as directly queryable state, and `assassinateEndpoint()` — "similar to the concept of 'character assassination' in human gossip" — is the JMX operation behind `nodetool assassinate`, a maintenance step of last resort for a node that will not leave the ring normally.

By default JMX is local-only; enabling remote access means editing `cassandra-env.sh` to open the JMX port and, in cloud deployments, overriding `java.rmi.server.hostname` so remote clients can actually reach it.

### nodetool: the command-line JMX client you will use daily

`nodetool` ships in `<cassandra-home>/bin` and is a thin, purpose-built wrapper: "Behind the scenes, nodetool uses JMX to access the MBeans described previously using a helper class called `org.apache.cassandra.tools.NodeProbe`." Every command (except `help`) needs a target node — `-h` picks the address, and with no address it connects to the local default port. `bin/nodetool help` lists everything available; `help <command>` gives detail on one.

**Cluster-level status.**

`describecluster` prints cluster name, snitch, partitioner, and — critically — schema version agreement across nodes: "The Schema versions portion of the output is especially important for identifying any disagreements in table definitions... any lingering schema differences usually correspond to a node that is down or unreachable and needs to be restarted."

`status` is the everyday health check:

```
Datacenter: datacenter1
=======================
Status=Up/Down
|/ State=Normal/Leaving/Joining/Moving
-- Address     Load        Tokens Owns (effective)           Host ID   Rack
UN 127.0.0.1 251.77 KiB 256        48.7%                     d23716cb... rack1
UN 127.0.0.2 250.28 KiB 256        50.0%                     635f2ab7... rack1
```

"Each node's status is identified by a two-character code: the first character indicates whether the node is up... or down, and the second character indicates the state or operational mode of the node." `UN` is the code you want to see on every line — this is the fastest way to confirm the vnode/token-range picture from the distributed-architecture concept is actually healthy in practice.

`info`, run against one node, gives a denser single-node snapshot: heap and off-heap memory, uptime, generation number, and the current state of the key/row/counter/chunk caches, each reported with entries, size, capacity, hit rate, and (for key/row/counter caches) save period. `ring` shows the same up/down and load picture organized by vnode token rather than by physical node, and `describering` shows it organized by token range.

**Thread pools and dropped messages: `tpstats`.**

"The tpstats tool gives us information on the thread pools that Cassandra maintains. Cassandra is highly concurrent, and optimized for multiprocessor/multicore machines, so understanding the behavior and health of the thread pools is important to good Cassandra maintenance."

```
Pool Name              Active    Pending    Completed    Blocked   All time blocked
ReadStage                   0           0         399          0   0
MiscStage                   0           0           0          0   0
CompactionExecutor          0           0       95541          0   0
MutationStage               0           0           0          0   0
...

Message type     Dropped     Latency waiting in queue (micros)
                              50%       95%       99%       Max
READ_RSP                0    0.00      0.00      0.00      0.00
```

The top section is per-stage task counts — "by reviewing the number of active tasks in the MutationStage, you can learn how many writes are in progress." The bottom section reports dropped internode messages, which happen when "internode messages that are received by a node but not processed within the rpc_timeout are dropped, rather than processed, as the coordinator node will no longer be waiting for a response." The book's own read on the numbers: "Seeing lots of zeros in the output for blocked tasks and dropped messages means that you either have very little activity on the server or that Cassandra is doing an exceptional job of keeping up with the load. Lots of nonzero values are indicative of situations where Cassandra is having a hard time keeping up."

**Per-table detail: `tablestats` (formerly `cfstats`).**

"To see overview statistics for keyspaces and tables, you can use the tablestats command. You may also recognize this command from its previous name, cfstats." Per table it reports read/write count and latency, `SSTable count`, `Old SSTable count`, live and total space used, Bloom filter false-positive rate, memtable cell count and data size, and per-slice tombstone/live-cell averages. Running it with just a keyspace name scopes it to that keyspace; no arguments scopes it to every table in the cluster. This is the command that turns the storage-engine concept's abstractions — memtables, SSTables, Bloom filters, tombstones — into numbers you can actually watch trend over time on a specific table.

**Compaction-specific commands.** `compactionstats` and `compactionhistory` read directly from `CompactionManagerMBean`; `compact` triggers the discouraged major/full compaction the storage-engine concept already warns against for production use.

### Virtual tables: querying node internals with CQL instead of a separate tool

Cassandra 4.0 added virtual tables: "Virtual tables are so named because they are not actual tables that are stored using Cassandra's typical write path, with data written to memtables and SSTables. Instead, these virtual tables are views that provide metadata about nodes and tables via standard CQL." Three properties matter before touching them: "You may not define your own virtual tables. The scope of virtual tables is the local node... When interacting with virtual tables through cqlsh, results will come from the node that cqlsh connected to... Virtual tables are not persisted, so any statistics will be reset when the node restarts."

Two keyspaces hold them. `system_virtual_schema` describes the schema of virtual tables themselves — its `keyspaces`, `tables`, and `columns` tables let you introspect column names, types, and primary-key roles the same way `DESCRIBE` would for a normal table; in fact "cqlsh traditionally scanned tables in the system keyspace to implement these operations, but is updated in the 4.0 release to use virtual tables."

`system_views` holds the actual data. The book lists 17 tables in the 4.0 release: `caches`, `clients`, `coordinator_read_latency`, `coordinator_scan_latency`, `coordinator_write_latency`, `disk_usage`, `internode_inbound`, `internode_outbound`, `local_read_latency`, `local_scan_latency`, `local_write_latency`, `max_partition_size`, `rows_per_read`, `settings`, `sstable_tasks`, `thread_pools`, `tombstones_per_read`. Two are singled out as especially diagnostic: "The max_partition_size and tombstones_per_read tables are particularly useful in helping to identify some of the situations that lead to poor performance in Cassandra clusters" — wide partitions and tombstone buildup are exactly the two failure modes the storage-engine concept's trade-offs section calls out by name.

`clients` gives you, per connected client, address, port, hostname, and request count — "this table provides information about each client with an active connection to the node, including its location and number of requests... useful to make sure the list of clients and their level of usage is in line with what you expect for your application." `settings` exposes every configurable `cassandra.yaml` parameter as currently in effect on that node, including anything overridden live via JMX, queryable over the same CQL native protocol your application already uses: "the value of virtual tables is that they may be accessed through any client using the CQL native protocol, including applications you write using the DataStax Java Drivers."

### Metrics and log files

Beyond `nodetool` and virtual tables, Cassandra registers a wide range of Dropwizard metrics — counters, gauges, meters, histograms, timers — under the `org.apache.cassandra.metrics` JMX domain, covering buffer pools, CQL statement execution, caches, client connections, commit log, compaction, gossip/internode connections, dropped messages, read repair, hints, streaming, thread pools, and per-table/per-keyspace latency histograms at 1-, 5-, and 15-minute intervals. `tpstats`, `tablehistograms`, and `proxyhistograms` are all just curated presentations of this same metrics registry. One caveat worth remembering during an incident: "in Cassandra releases through 4.0, the metrics reported are lifetime metrics since the node was started. To reset the metrics on a node, you have to restart it."

For cluster-wide visibility, these metrics feed standard aggregation tooling: "Cassandra's metrics can also fit into a broader observability strategy for your applications... metrics aggregation frameworks such as Prometheus and metrics visualization tools such as Grafana." A published integration provides four built-in Grafana dashboards — cluster overview, cluster metrics (read/write load and latency, active/pending/blocked tasks per node), table metrics (sliced by keyspace and table), and system metrics (host OS compute) — which is the practical answer to `nodetool`'s biggest limitation: it only ever shows you one node at a time.

Logging is the complementary, more granular tool. Cassandra uses SLF4J with Logback, configured in `<cassandra-home>/conf/logback.xml`, with the standard `ALL < DEBUG < INFO < WARN < ERROR < FATAL < OFF` level progression and default appenders writing `system.log` (INFO+), `debug.log` (DEBUG+), and `gc.log`. Several WARN-level triggers are directly tunable via `cassandra.yaml`: `tombstone_warn_threshold` (default 1,000 tombstones scanned by a single read), `batch_size_warn_threshold_in_kb` (default 5 KB), and `gc_warn_threshold_in_ms` (default 1,000 ms, with a separate 200 ms `gc_log_threshold_in_ms` for INFO-level GC pause logging). Log levels can be viewed and changed on a live node without a restart via `nodetool getlogginglevels` and `setlogginglevel`. For exact query-level detail, `full_query_logging_options` in `cassandra.yaml` plus `nodetool enablefullquerylog`/`disablefullquerylog` capture every CQL statement to a binary log designed for "live traffic capture and replay," readable with the bundled `tools/bin/fqltool dump`.

### Book vs today

> **Virtual tables have grown well past the book's 17-table 4.0 baseline, and the growth continued through Cassandra 5.0 rather than stopping.** The book (targeting 4.0) lists `system_views` as 17 tables and explicitly flags that more were proposed in Jira — CASSANDRA-15254 (settings write-back), CASSANDRA-14795 (hints metadata), CASSANDRA-14572 (additional table metrics), CASSANDRA-12367 (partition sizes), CASSANDRA-15241 (running queries), CASSANDRA-15399 (repair status) — predicting "the data available via virtual tables will eventually catch up with JMX, and even surpass it in some areas." According to the [current Apache Cassandra documentation](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/virtualtables.html), `system_views` now also includes `cql_metrics`, `system_properties`, `system_logs`, and CIDR-filtering tables (`cidr_filtering_metrics_counts`, `cidr_filtering_metrics_latencies`) added since 4.0. `system_logs` in particular is a notable capability jump beyond what the book describes: a dedicated `CQLLOG` Logback appender can stream log messages directly into a queryable virtual table (capped by default at 50,000 rows, hard-limited at 100,000, tunable via the `cassandra.virtual.logs.max.rows` system property), meaning recent log history is now queryable with CQL alongside metrics, not just tailed from a file. Virtual tables remain node-local, non-persistent, and read-only for user purposes exactly as the book describes — that design constraint has not changed — but the practical gap with JMX/`nodetool` that the book predicted would close has, in fact, kept closing.

## Trade-offs

- **`nodetool` is simple and always available, but it is fundamentally single-node.** Every command connects to one node at a time via `-h`; understanding cluster-wide health means either scripting `nodetool` across every node or aggregating the underlying metrics elsewhere (Prometheus/Grafana). For a small cluster this is a minor annoyance; for a cluster with dozens of nodes it is the reason metrics aggregation exists at all.
- **Virtual tables are more accessible than JMX but still deliberately limited.** They can be queried with the same CQL driver your application already uses, over the native protocol, with no separate JMX port or client — a real operational simplification. But they cannot be defined by users, are scoped strictly to the connected node (so a load balancer or driver could route your monitoring query to a different node each time unless you pin the connection), and reset on restart, so they cannot substitute for durable historical metrics storage.
- **JMX gives you management operations, not just visibility, which is exactly why it needs to be locked down.** MBeans like `StorageServiceMBean` and `HintsServiceMBean` expose real mutating operations — `decommission()`, `assassinateEndpoint()`, `deleteAllHints()` — reachable by any JMX client with access. Remote JMX access is off by default for this reason; opening it means opening a channel that can reconfigure or remove nodes, not just read their state.
- **Lifetime metrics without a restart are honest but operationally awkward.** Because metrics through 4.0 accumulate since node start rather than resetting on demand, a rate you compute from `tpstats` or a Dropwizard counter mid-incident is diluted by however long the node has been running; you either track deltas yourself between two readings or restart the node to reset — the latter being a disruptive way to get a clean baseline.
- **Full query logging is designed to be low-overhead, but it is still an always-on cost while enabled.** It is described as "extremely fast" specifically because it is a purpose-built binary log rather than reusing `system.log`, but capturing every CQL statement for replay is still I/O and disk that a table with heavy query volume will notice; it is meant to be switched on for a diagnosis window via `enablefullquerylog`/`disablefullquerylog`, not left running indefinitely as a default.
- **WARN thresholds (`tombstone_warn_threshold`, `batch_size_warn_threshold_in_kb`, `gc_warn_threshold_in_ms`) are tunable, which means they can be tuned into uselessness.** Raising a threshold to silence noisy warnings on a table that is genuinely accumulating tombstones or oversized batches removes the log-based early warning the storage-engine concept's tombstone trade-offs section depends on — the warning threshold and the underlying problem are two different things, and adjusting the former does nothing to the latter.

## Documentation Links

- [Jeff Carpenter and Eben Hewitt, "Cassandra: The Definitive Guide", Revised 3rd Edition (O'Reilly, 2022) — Chapter 11, "Monitoring" ("Monitoring Cassandra with JMX" through "Logging")](https://www.oreilly.com/library/view/cassandra-the-definitive/9781492097143/) — doc
- [Apache Cassandra Documentation — nodetool](https://cassandra.apache.org/doc/latest/cassandra/managing/tools/nodetool/nodetool.html) — doc
- [Apache Cassandra Documentation — Virtual Tables](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/virtualtables.html) — doc
- [Apache Cassandra Documentation — Monitoring (metrics, JMX, Dropwizard)](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/metrics.html) — doc
- [Apache Cassandra Documentation — logback.xml file and logging configuration](https://cassandra.apache.org/doc/latest/cassandra/managing/configuration/cass_logback_xml_file.html) — doc
- [Apache Cassandra Blog — Announcing Apache Cassandra 5.0](https://cassandra.apache.org/_/blog/Apache-Cassandra-5.0-Announcement.html) — doc
