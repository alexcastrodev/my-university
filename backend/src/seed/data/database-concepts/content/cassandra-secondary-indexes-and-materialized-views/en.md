---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Understand the two mechanisms Cassandra offered, before Storage-Attached Indexing existed, for querying on a column that isn't part of the primary key: the built-in secondary index (2i) and the materialized view. Learn what each one actually does mechanically, why `ALLOW FILTERING` shows up in the first place, and — quoting the book's own candid warnings — exactly where each mechanism breaks down in production. This concept is the "before" half of a pair: the sibling concept, *Storage-Attached Indexes: Fixing Cassandra's Secondary Index and Materialized View Problem*, is the "after" — SAI exists specifically to fix the problems documented here.

## Use Cases

- Reading an existing Cassandra schema that predates Cassandra 5.0 (or one that still avoids SAI) and needing to recognize a `CREATE INDEX` statement as a legacy 2i index rather than SAI, so you know which cardinality and tombstone rules apply to it.
- Diagnosing a production incident where queries against an indexed column started timing out or a write started failing with a tombstone-related error — both are classic symptoms of 2i hitting one of its documented failure modes.
- Deciding, when a new access pattern shows up late in a project, whether to add another denormalized table, add a 2i index, add a materialized view, or reach for SAI instead — and being able to explain the trade-off in each direction rather than picking by habit.
- Reading a `CREATE MATERIALIZED VIEW` statement and correctly identifying the base table, the view's primary key, and why every primary-key column needs an `IS NOT NULL` filter clause.
- Explaining to a team lead why materialized views are disabled by default on modern Cassandra clusters, and why "just add a materialized view" is not automatically the safe answer it looks like.
- Migrating an old schema off legacy 2i or materialized views onto SAI, which requires first understanding precisely what the old mechanism was doing and why it was chosen in the first place.

## Deep Dive

### The problem: how many denormalized tables is too many

The book sets this chapter up with a familiar scenario: a hotel application's data model was originally built around a handful of access patterns, and then a business stakeholder asks for more ways to search — by name, by location, by amenities. The instinct from the query-first modeling chapter is to keep doing what worked: add another denormalized table shaped for each new query. That works, but the book flags the obvious follow-up question directly: "it's reasonable to begin to ask how many denormalized tables is too many." The answer depends on read/write volume and data size, but the chapter's real point is that table-per-query isn't the only tool available. "Cassandra provides two mechanisms that you can use as alternatives to managing multiple denormalized tables: secondary indexes and materialized views."

### Secondary indexes (2i): what `ALLOW FILTERING` is actually telling you

Cassandra's `WHERE` clause is not a general-purpose filter — it addresses the partition key and clustering columns, because those are the only predicates the coordinator can use to route a query to a small set of nodes. Try to query on anything else and Cassandra refuses outright:

```sql
cqlsh:hotel> SELECT * FROM hotels
  WHERE name = 'Super Hotel Suites at WestWorld';
InvalidRequest: Error from server: code=2200 [Invalid query]
message=
  "Cannot execute this query as it might involve data filtering and
thus may have unpredictable performance. If you want to execute this
  query despite the performance unpredictability, use ALLOW
FILTERING"
```

The error names the escape hatch, but the book is clear about what that escape hatch actually costs: using `ALLOW FILTERING` means "Cassandra would need to ask all of the nodes in the cluster to scan all stored SSTable files for hotels matching the provided name, because Cassandra has no indexing built on that particular column" — a cluster-wide scan, not a targeted lookup.

A secondary index is the built-in alternative: "an index on a column that is not part of the primary key."

```sql
cqlsh:hotel> CREATE INDEX ON hotels ( name );
```

If unnamed, cqlsh generates a name of the form `<table>_<column>_idx` — visible via `DESCRIBE KEYSPACE` as `CREATE INDEX hotels_name_idx ON hotel.hotels (name);`. Indexes aren't limited to simple columns either — the book indexes a user-defined-type column (`address`) and a collection column (`pois`, a set) the same way, and notes that for map columns specifically you can index the keys (`KEYS(addresses)`), the values (the default), or both. Removing one is `DROP INDEX hotels_name_idx;`.

**Why 2i doesn't come free.** The mechanical reason is spelled out directly: "Because Cassandra partitions data across multiple nodes, each node must maintain its own copy of a secondary index based on the data stored in partitions it owns. For this reason, queries involving a secondary index typically involve more nodes, making them significantly more expensive." There's no coordinator-side global index — an index built with 2i is scattered across the cluster the same way the base data is, so satisfying a query still means asking around.

The book's own "Secondary Index Pitfalls" callout names three specific cases where 2i should not be used at all:

- **Columns with high cardinality.** "Indexing on the `hotel.address` column could be very expensive, as the vast majority of addresses are unique" — a near-unique column means the index barely narrows anything down, but the cluster-wide fan-out cost is paid regardless.
- **Columns with very low data cardinality.** Indexing something like a `title` column ("Mr.", "Mrs.") "would result in a massive row in the index" — one index value now covers a huge fraction of the table, which is the opposite failure mode from high cardinality but just as bad.
- **Columns that are frequently updated or deleted.** "Indexes built on these columns can generate errors if the amount of deleted data (tombstones) builds up more quickly than the compaction process can handle." This is the operational trap that actually pages people: a 2i index on a churny column doesn't degrade gracefully, it eventually starts failing outright.

The book's summary verdict is blunt: "For optimal read performance, denormalized table designs or materialized views... are generally preferred to using secondary indexes. However, secondary indexes can be a useful way of supporting queries that were not considered in the initial data model design." In other words: a fallback for the query you didn't plan for, not a default modeling tool.

**SASI, the book's own attempted fix.** The book also documents Cassandra's first attempt at fixing 2i, before SAI existed: SASI (SSTable Attached Secondary Index), an experimental index type introduced in Cassandra 3.4, developed by Apple and released as an open-source implementation of Cassandra's secondary index API. The name gives away the architectural idea SAI would later take further: "SASI indexes are calculated and stored as part of each SSTable file, differing from the original Cassandra implementation, which stores indexes in separate, 'hidden' tables." SASI added real capabilities 2i never had — inequality searches and `LIKE` text search on indexed columns — but the book is honest about its limits too: "While SASI indexes do perform better than traditional indexes by eliminating the need to read from additional tables, they still require reads from a greater number of nodes than a denormalized design." SASI narrowed the gap; it didn't close it. That's the gap SAI, covered in the sibling concept, was built to close for real — by attaching the index to storage at the engine level rather than bolting it on as a custom index implementation.

### Materialized views: denormalization Cassandra manages for you

Materialized views are the book's other pre-SAI answer, aimed specifically at the case 2i handles worst: "Materialized views were introduced to help address some of the shortcomings of secondary indexes that we've discussed. Creating indexes on columns with high cardinality tends to result in poor performance, because most or all of the nodes in the ring are queried." Instead of an index scattered across the cluster, a materialized view is "preconfigured views that support queries" — a real, separate table that Cassandra keeps in sync with the base table automatically, so the application doesn't have to write to two tables by hand on every update.

Here's the book's worked example, building `reservations_by_confirmation` as a view on `reservations_by_hotel_date`:

```sql
CREATE MATERIALIZED VIEW reservation.reservations_by_confirmation
AS
SELECT * FROM reservation.reservations_by_hotel_date
WHERE confirm_number IS NOT NULL and hotel_id IS NOT NULL and
  start_date IS NOT NULL and room_number IS NOT NULL
PRIMARY KEY (confirm_number, hotel_id, start_date, room_number);
```

Walking the clauses: the name comes first (`reservations_by_confirmation`), `FROM` names the base table, `PRIMARY KEY` names the view's own primary key, and `AS SELECT` (here a wildcard) picks the columns to carry over. Two constraints matter more than the syntax:

- **The view's primary key must include every column of the base table's primary key.** "This restriction keeps Cassandra from collapsing multiple rows in the base table into a single row in the materialized view, which would greatly increase the complexity of managing updates." The common pattern is the new filterable column as the view's partition key, followed by the base table's own primary-key columns as clustering columns.
- **Every primary-key column needs an explicit filter**, even a trivial `IS NOT NULL` — the `WHERE` clause isn't optional decoration here, it's a hard requirement for every column named in `PRIMARY KEY`.

`reservations_by_confirmation` is the book's example of a genuinely good fit: confirmation numbers are as close to unique per row as a column gets, which is exactly the shape that makes 2i expensive and a materialized view cheap in comparison.

**What it costs.** The sync isn't free: "Materialized views incur a performance impact on writes to the base table because some reads are required to maintain this consistency." Internally, the book notes, view updates are implemented using batching — every base-table write potentially fans out into more work to keep the view's copy correct. The trade the book frames it as: more expensive writes, in exchange for not having application code manually keep multiple denormalized tables in sync itself.

**The book's own hedge on maturity.** Even while presenting materialized views as the answer to 2i's cardinality problem, the book includes a callout that reads, in hindsight, as a warning sign: "The initial implementation of materialized views in the 3.0 release has some limitations on the selection of primary key columns and filters. There are several Jira issues currently in progress to add capabilities, such as multiple nonprimary key columns in materialized view primary keys... or using aggregates in materialized views... If you're interested in these features, track the Jira issues to see when they will be included in a release." That is the book, in 2022, describing a feature still under active repair years after its 3.0 introduction — and it's exactly this fragility that led the project to disable materialized views by default (`materialized_views_enabled: false`) from Cassandra 4.0 onward, and keep them marked experimental to this day. The chapter's own reservation example shows the workaround teams actually use: `reservations_by_hotel_date` and `reservations_by_guest` are built as ordinary hand-denormalized tables, and only `reservations_by_confirmation` — the case materialized views fit best — is built as a view, an explicit hedge rather than a blanket endorsement.

### Where this leaves you

Put the two mechanisms side by side and the shared root cause is the same one the book names at the start of the chapter: a `WHERE` clause on a non-partition-key column has no efficient, engine-native answer without help. 2i gives you that help but pays for it with cluster-wide fan-out and hard cardinality limits at both ends. Materialized views give you automatic denormalization but pay for it with write-path cost and an implementation the book itself flags as unfinished. Both were real, useful, and shipped for years before Cassandra had anything better — which is exactly the gap Storage-Attached Indexing was built to close. SAI, covered in the sibling concept, fixes 2i's cost-per-column and cardinality-cliff problems by attaching the index to the storage engine itself instead of a hidden table, and it removes the reason to reach for a materialized view's fragile consistency machinery in most cases where the goal was simply "let me filter on this column." The mechanisms in this concept aren't obsolete trivia, though — they're still what you'll find reading older schemas, and 2i in particular is still the only option on a cluster not yet running SAI-capable Cassandra.

## Trade-offs

- **2i's cost model punishes both cardinality extremes, and the book says so without softening it.** High-cardinality columns pay full cluster fan-out for a handful of matches; low-cardinality columns produce oversized index rows. There is no cardinality sweet spot where 2i is free — only a middle band where it's tolerable.
- **2i's tombstone failure mode is an operational trap, not a performance nuisance.** A column that's frequently updated or deleted can push an index's tombstone count past what compaction keeps up with, and the book is explicit that this "can generate errors" — not just slow queries, but query failures once the index has degraded far enough.
- **Materialized views trade write cost for consistency automation, and the book prices that trade honestly.** "Materialized views incur a performance impact on writes to the base table because some reads are required to maintain this consistency" — every base-table write is potentially more expensive, in exchange for not hand-writing denormalization code.
- **The book's own callout about "Jira issues currently in progress" is a tell, not a footnote.** Presenting a feature's known gaps as things to "track" rather than settled behavior is the book flagging, in real time, that materialized views were less mature than the surrounding prose implies — a caution later validated by the feature being disabled by default from Cassandra 4.0 onward.
- **SASI shows that "attach the index to the SSTable" was the right idea years before SAI existed — but a partial version of the right idea is still partial.** SASI removed 2i's separate-hidden-table overhead and added real capabilities (inequality, `LIKE`) but the book still recorded it needing "reads from a greater number of nodes than a denormalized design." Being experimental and Apple-contributed rather than a core, GA feature also meant it never got the adoption or long-term support SAI has.
- **Neither mechanism repeals partition-first modeling — they're explicitly framed as the fallback, not the default.** The book's own verdict — "denormalized table designs or materialized views... are generally preferred to using secondary indexes... secondary indexes can be a useful way of supporting queries that were not considered in the initial data model design" — applies with only slightly less force to materialized views themselves. Reach for either mechanism to trim a long tail of secondary access patterns, not to replace query-first design for a genuinely hot query.

## Documentation Links

- [Jeff Carpenter and Eben Hewitt, "Cassandra: The Definitive Guide", Revised 3rd Edition (O'Reilly, 2022) — Chapter 7, "Extending Designs" (Secondary Indexes, SASI, Materialized Views)](https://www.oreilly.com/library/view/cassandra-the-definitive/9781492097143/) — doc
- [Apache Cassandra Documentation — When to Use an Index (legacy secondary indexes, 2i)](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/indexing/2i/2i-when-to-use.html) — doc
- [Apache Cassandra Documentation — CQL Indexing Overview](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/indexing/indexing-overview.html) — doc
- [Apache Cassandra Documentation — CQL Materialized Views](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/mvs.html) — doc
- [Apache Cassandra Jira — CASSANDRA-9928 (Support multiple non-primary key columns in materialized view primary key)](https://issues.apache.org/jira/browse/CASSANDRA-9928) — doc
