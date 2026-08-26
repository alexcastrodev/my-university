---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Learn HBase's data model — a sparse, distributed, sorted multidimensional map, keyed by row key, column family, column qualifier, and timestamp/version, down to a single cell value — and the basic CRUD and table-administration vocabulary of the HBase shell: `create`, `put`, `get`, `scan`, `disable`, `alter`, `enable`. Along the way, place HBase against Cassandra, the other wide-column store this track already covers in depth: both borrow "column family" from the same Bigtable lineage, but they diverge hard on architecture and consistency, and that divergence is the more important thing to remember than the shared vocabulary.

## Use Cases

- Reading an unfamiliar HBase schema and being able to say, correctly, which part of a cell's address is the row key, which is the column family, and which is the qualifier — and why none of that requires a predefined column list the way a relational `CREATE TABLE` does.
- Deciding how many column families a table needs, since HBase (unlike Cassandra) stores each column family in its own separate files on disk and expects that decision made up front, before the table holds much data.
- Performing basic administration in the HBase shell: creating a table, inspecting it with `status` and `scan`, and taking it offline with `disable` to change column-family options with `alter` before bringing it back with `enable`.
- Reading and writing versioned data — a page revision, a sensor reading, a log line — where HBase's built-in per-cell timestamp/version history removes the need to build that bookkeeping yourself.
- Recognizing when HBase's operating model (Hadoop/HDFS underneath, five-plus-node clusters, master-coordinated writes) is the wrong tool for the job — most new projects below "many, many gigabytes" scale, or without an existing Hadoop investment, are better served by Cassandra, a cloud-managed wide-column service, or something simpler entirely.

## Deep Dive

### What HBase is, in the book's own words

The book opens with a warning that doubles as the single most useful sentence in the chapter: "Apache HBase is made for big jobs, like a nail gun. You would never use HBase to catalog your corporate sales list or build a to-do list app for fun, just like you'd never use a nail gun to build a doll house." And it doubles down on the false-familiarity trap: HBase "stores data in buckets it calls tables, which contain cells that appear at the intersection of rows and columns. Sounds like a relational database, right? Wrong! In HBase, tables don't behave like relations, rows don't act like records, and columns are completely variable and not enforced by any predefined schema." The book's own framing for this is blunt: HBase is "the evil twin, the bizarro doppelgänger, if you will, of RDBMS."

HBase is a column-oriented database built on **Bigtable**, "a high-performance, proprietary database developed by Google and described in the 2006 white paper 'Bigtable: A Distributed Storage System for Structured Data.'" It began life as a contrib package for Apache Hadoop and grew into a top-level Apache project. It lives inside the Hadoop ecosystem, storing its data on HDFS and relying on Apache ZooKeeper for distributed coordination — a materially different architecture from Cassandra's, covered below.

### The data model: a sparse, sorted, multidimensional map

The book's simplest analogy: "Most programming languages have some concept of a key/value map... A table in HBase is basically a big map — well, more accurately, a map of maps." In an HBase table:

- **Row key** — an arbitrary string (uninterpreted bytes) that identifies a row. Rows are stored in sorted order by row key, which is why row-key design drives HBase's scan performance the way partition-key design drives Cassandra's.
- **Column family** — a named grouping of columns, declared up front when the table is created (or altered later, at real cost — see below). Column families are stored in separate files on disk.
- **Column qualifier** — the second half of a column's full name, not predefined anywhere; any row can introduce a new qualifier within an existing column family at write time. The full column name is conventionally written `family:qualifier`, for example `cf1:col1`.
- **Timestamp / version** — every cell value is stamped with a version, by default the write time in milliseconds since the epoch. Writing a new value to the same cell doesn't overwrite the old one; it's kept, indexed by timestamp, up to a configurable number of retained `VERSIONS`. The book calls this out as "pretty awesome," and "one that is unique to HBase amongst the databases in this book": most databases need you to build historical tracking yourself, but "in HBase, versioning is baked right in."

Put together as the book's own illustration: a table with row keys `first` and `second`, and two column families, `color` and `shape`. The `first` row has three columns in `color` (qualifiers `red`, `blue`, `yellow`) and one in `shape` (qualifier `square`); the tuple `first / color:red` addresses the value `'#F00'`. As the book puts it, "the combination of row key and column name (including both family and qualifier) creates an address for locating data" — and a row that has no value for a given column simply has no cell there, rather than a stored `null`. That's the "sparse" half of "sparse, distributed, sorted multidimensional map."

The book's advice on thinking about rows: "I recommend thinking of HBase rows as being a tiny database in their own right. Each cell in the database can have many different values associated with it (like a mini timeseries database). When you fetch a row in HBase, you're not fetching a set of values; you're fetching a small world."

### Why column families exist

The book poses the obvious question directly — why not skip column families and put everything in one? Two reasons given:

1. **Independent performance tuning.** "Each column family's performance options are configured independently. These settings affect things such as read and write speed and disk space consumption."
2. **Physical separation on disk.** "Column families are stored in different directories. When reading row data in HBase, you can potentially target your reads to specific column families within the row and thus avoid unnecessary cross-directory lookups... especially in read-heavy workloads."

And a guarantee worth knowing: "All operations in HBase are atomic at the row level. No matter how many columns are affected, the operation will have a consistent view of the particular row being accessed or modified."

### CRUD in the HBase shell

The shell is JRuby-based (`${HBASE_HOME}/bin/hbase shell`), and the book walks through the basics building a tiny wiki. Create a table with one column family:

```
hbase> create 'wiki', 'text'
0 row(s) in 1.2160 seconds
```

Insert data with `put` (table, row key, `family:qualifier`, value):

```
hbase> put 'wiki', 'Home', 'text:', 'Welcome to the wiki!'
```

Note the trailing colon — "this is actually a requirement in HBase if you don't specify a column family in addition to a column," here meaning an empty qualifier. Read a specific row/column with `get`:

```
hbase> get 'wiki', 'Home', 'text:'
COLUMN    CELL
 text:    timestamp=1295774833226, value=Welcome to the wiki!
1 row(s) in 0.0590 seconds
```

And read everything in a table with `scan`, which the book flags as useful for development but dangerous at production scale: "Scans are powerful and great for development purposes but they are also a very blunt instrument... if you're running HBase in production, stick to more precise reads or you'll put a lot of undue strain on your tables."

A `put` that sets several columns at once (typically done programmatically rather than through the shell's own `put`, which only sets one column per call) stamps all of them with the same timestamp if none is given explicitly:

```
hbase> get 'wiki', 'Home'
COLUMN             CELL
 revision:author   timestamp=1296462042029, value=jimbo
 revision:comment timestamp=1296462042029, value=my first edit
 text:             timestamp=1296462042029, value=Hello world
3 row(s) in 0.0300 seconds
```

### Table administration: create, disable, alter, enable

Column families are declared at `create` time, but their *options* — like how many versions to retain — can be changed later, with a catch: schema changes to column-family attributes require taking the table offline first.

```
hbase> disable 'wiki'
0 row(s) in 1.0930 seconds
hbase> alter 'wiki', { NAME => 'text', VERSIONS =>
hbase*   org.apache.hadoop.hbase.HConstants::ALL_VERSIONS }
0 row(s) in 0.0430 seconds
hbase> alter 'wiki', { NAME => 'revision', VERSIONS =>
hbase*   org.apache.hadoop.hbase.HConstants::ALL_VERSIONS }
0 row(s) in 0.0660 seconds
hbase> enable 'wiki'
0 row(s) in 0.0550 seconds
```

The book is explicit about the cost of this: "Operations that alter column family characteristics can be very expensive because HBase has to create a new column family with the chosen specifications and then copy all the data over. In a production system, this may incur significant downtime. For this reason, the sooner you settle on column family options the better." This is the HBase analog of Cassandra's "primary keys are forever" — a decision made early (which families exist, and their options) that is deliberately expensive to revisit, because it governs on-disk layout.

Note also what `alter` does *not* do: it adds or reconfigures a column *family*, never predefines individual columns. As the book puts it for the `revision` family, "we're only adding a revision column family to the table schema, not individual columns... it's up to the client to honor this expectation; it's not written into any formal schema. If someone wants to add a `revision:foo` for a page, HBase won't stop them." That absence of an enforced column list, inside a family whose existence *is* enforced, is the schema model in miniature.

### HBase vs. Cassandra: same ancestry, different architecture

Both HBase and Cassandra are wide-column stores in the Bigtable lineage, and both use "column family" for a named grouping of columns — which is exactly why the vocabulary overlap is more dangerous than helpful. Cassandra's own data model, covered in this track's *CQL Fundamentals* concept, builds a nested hierarchy of column → row → **partition** → table → keyspace → cluster, where a composite primary key (partition key plus clustering columns) decides both node placement and on-disk sort order. HBase's model is column family → qualifier → row key → table, with no separate partition abstraction visible at the data-modeling layer — the row key alone determines sort order and, indirectly, which region (a contiguous row-key range) and therefore which server holds the data.

The sharper difference is architectural, not lexical:

| | Cassandra | HBase |
|---|---|---|
| Write path | Leaderless, peer-to-peer — any node can coordinate a write for any partition | Master-coordinated: a single active **HMaster** assigns regions to **RegionServers**; ZooKeeper tracks cluster state |
| Underlying storage | Cassandra manages its own storage engine directly on local disk | Built on top of **HDFS** — HBase is a random-access layer over a filesystem designed for large sequential reads |
| Consistency model | Tunable, historically AP-leaning: tunable consistency levels, last-write-wins conflict resolution, no single point of coordination | Strongly consistent by design, atomic at the row level — the book states this as a selling point: "HBase also makes strong consistency guarantees... HBase guarantees atomicity at the row level" |
| Minimum viable deployment | Scales down reasonably; small clusters are workable | The book is emphatic that HBase does not scale down: "unlike relational databases, which sometimes have trouble scaling out, HBase doesn't scale down. If your production HBase cluster has fewer than five nodes, then, quite frankly, you're doing it wrong." |
| Ecosystem dependency | Self-contained; no separate coordination or filesystem service required | Depends on both HDFS and ZooKeeper as separate running services |

The practical consequence: reaching for HBase means, in effect, reaching for a slice of the Hadoop ecosystem — you inherit HDFS and ZooKeeper as operational dependencies whether or not you want them, which is a heavier commitment than standing up a Cassandra cluster. In exchange you get row-level atomicity and strong consistency guarantees that Cassandra's leaderless model does not offer in the same form.

### Book vs. today

Several things have shifted since the book's 2018 edition, and they matter more than usual here because they bear on whether HBase is still the default answer the book presents it as.

**Version.** The book was written against HBase 1.2.1. As of mid-2026 the actively maintained lines are the 2.5.x and 2.6.x series — HBase 2.5.15 and 2.6.5 both shipped in the first half of 2026 — with HBase 3.0 in beta. The shell commands covered here (`create`, `put`, `get`, `scan`, `disable`, `alter`, `enable`) are unchanged in current HBase; this part of the book has aged well.

**Project maintenance.** HBase remains a top-level Apache project with an "Ongoing" status, over a hundred committers, and regular point releases through 2025 and into 2026 — it has not been abandoned or retired. The book's claim that it's actively developed is still true.

**Market position — this has moved, and the book's framing has not aged as well.** The book presents HBase as a natural, near-default choice for big-data analytics workloads. Today, Cassandra (and its C++ rewrite ScyllaDB) is the more widely deployed wide-column store for *new* projects, precisely because it doesn't require standing up a Hadoop cluster and HDFS/ZooKeeper alongside it, and its operational model is simpler. Notably, Pinterest — a large historical HBase user — published a detailed account of deprecating HBase in its stack, citing high infrastructure cost from HBase's typical six-replica disaster-recovery setup and migrating to alternatives with lower cost per data replica. HBase still shows up at large, established Hadoop-shop enterprises (financial-services firms among them) where it's already embedded in an existing HDFS investment, but it is rarely the first recommendation for a greenfield wide-column workload in 2026.

**Cloud-managed alternatives absorbed much of the historical use case.** The book itself anticipates this, noting in a sidebar that "Cloud Bigtable isn't 100% compatible with HBase but as of early 2018 it's very close" and suggesting it as a lower-operational-burden alternative. That prediction played out: Google Cloud Bigtable — the managed descendant of the very paper HBase was modeled on — is now a mainstream choice for teams that want the wide-column model without running HDFS, ZooKeeper, and RegionServers themselves. For teams not committed to GCP, Cassandra-as-a-service offerings and DynamoDB fill a similar "don't operate the cluster yourself" niche. The net effect: HBase's differentiator in 2018 — strong consistency plus Hadoop-ecosystem proximity — is less unique in 2026 than it was, because both halves of that value proposition (strong consistency, and not having to hand-operate the cluster) are now available elsewhere with less operational weight.

## Trade-offs

- **The relational vocabulary is a trap here too, and arguably a worse one than in Cassandra.** "Table," "row," and "column" all exist in HBase, and none of them mean what a relational-database background expects. There is no predefined column list, no enforced schema below the column-family level, and no such thing as a `NULL` — a column that wasn't written simply isn't present in that row. Reading an HBase schema with SQL instincts intact will produce a wrong mental model quietly, not loudly.
- **Column-family decisions are cheap to make and expensive to unmake.** Declaring column families at `create` time is fast; changing their characteristics later requires `disable`, `alter`, `enable`, and the book is direct that this "can be very expensive because HBase has to create a new column family with the chosen specifications and then copy all the data over," with real production downtime risk. Settle column families early, the same way Cassandra developers are told to settle primary keys early — the specific thing that's expensive to change differs, but the "get it right up front" discipline is the same lesson twice.
- **Row-level atomicity and strong consistency are the genuine payoff for the added operational weight.** Where Cassandra buys tunable, leaderless availability at the cost of last-write-wins semantics, HBase buys atomic, consistent row operations at the cost of a coordinating master, ZooKeeper, and an HDFS substrate underneath — three separate services to run and reason about instead of one. That's a real trade, not a free upgrade: you're choosing consistency guarantees your application logic doesn't have to build itself, in exchange for infrastructure your application logic doesn't have to think about but your operators absolutely do.
- **Built-in versioning is a real advantage, with a real disk-space cost.** Every cell keeps its history up to the configured `VERSIONS` limit at no extra application code — genuinely convenient for anything shaped like revision history. But that history occupies real space and needs a retention policy (`VERSIONS`, TTL, or compaction settings) decided deliberately, or it accumulates indefinitely.
- **HBase does not scale down, and that's a deployment-shape trade-off, not a bug.** The book's "fewer than five nodes and you're doing it wrong" is a genuine constraint: HBase's architecture (region distribution, HDFS replication, master failover) assumes a nontrivial cluster to make sense of. For a workload measured in megabytes or low gigabytes, the fixed operational cost of HDFS + ZooKeeper + HBase outweighs almost any benefit the model offers — the book's own nail-gun-versus-doll-house framing is correct and still holds in 2026.
- **In 2026, choosing HBase for a new project means choosing it over more operationally simple options, and that choice needs a specific reason.** Existing HDFS investment, an existing HBase-literate team, or a specific need for row-level strong consistency inside the Hadoop ecosystem are reasons that still hold up. "It's the classic wide-column choice" is not — that role has largely passed to Cassandra/ScyllaDB for self-managed deployments and to Bigtable/DynamoDB for managed ones.

## Documentation Links

- [Eric Redmond and Jim R. Wilson, "Seven Databases in Seven Weeks", 2nd Edition (Pragmatic Bookshelf, 2018) — Chapter 3, "HBase", Introduction and Day 1](https://pragprog.com/titles/rwdata2/seven-databases-in-seven-weeks-second-edition/) — doc
- [Apache HBase Reference Guide](https://hbase.apache.org/book.html) — doc
- [Apache HBase Downloads](https://hbase.apache.org/downloads.html) — doc
- [Apache HBase — Project Information](https://hbase.apache.org/project-info.html) — doc
- [Google Cloud Bigtable Documentation](https://cloud.google.com/bigtable/docs) — doc
- [Pinterest Engineering — HBase Deprecation at Pinterest](https://medium.com/pinterest-engineering/hbase-deprecation-at-pinterest-8a99e6c8e6b7) — article
