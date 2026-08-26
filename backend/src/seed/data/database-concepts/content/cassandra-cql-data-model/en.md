---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Learn the vocabulary of Cassandra's data model — cluster, keyspace, table, partition, row, column — as CQL actually implements it, and understand why the words that look borrowed from SQL (table, column, primary key, `SELECT`, `INSERT`) mean something meaningfully different here. Along the way, get a working command of the CQL type system: numeric, textual, time and identity types, the other simple types, the three collections, tuples, and user-defined types, including which of them carry restrictions that will bite you later.

## Use Cases

- Onboarding onto an existing Cassandra codebase and needing to read a `CREATE TABLE` statement correctly — specifically, being able to say which columns form the partition key, which are clustering columns, and therefore which queries the table can and cannot serve.
- Choosing a type for a new column: `uuid` vs. `timeuuid` for an identifier, `text` vs. `ascii` for a string, `int` vs. `bigint` vs. `varint`, `timestamp` vs. the separate `date` and `time` types.
- Deciding whether a variable-length attribute (a user's email addresses, phone numbers, tagged addresses) should be a collection column, a separate table, or extra clustering columns.
- Modeling a structured value — an address, a set of coordinates — and picking between a tuple, a user-defined type, and flattened columns.
- Expiring data without writing a cleanup job, using per-column TTL.
- Building counters for page views, log volume, or similar statistics, and knowing up front the restrictions the `counter` type imposes on the whole table.
- Debugging a "why did my write disappear / why did the older value win?" incident, where the answer is Cassandra's per-column timestamp and last-write-wins conflict resolution.

## Deep Dive

### Starting from the relational model

The book deliberately begins from relational terminology, because that is the mental model most readers arrive with. In a relational database the *database* is the outermost container, usually corresponding to a single application; it contains tables; tables have names and one or more named columns. When you add data you specify a value for every defined column, using `null` where you have none, and that entry becomes a row you can later read by its unique identifier (primary key) or by a SQL statement expressing criteria the row might meet. Updates hit all rows or a subset, depending on the `WHERE` clause filter.

The warning the chapter opens with is worth quoting in spirit: for developers and administrators coming from the relational world the Cassandra data model can be difficult to understand initially, because "some terms, such as *keyspace*, are completely new, and some, such as *column*, exist in both worlds but have slightly different meanings." And for people arriving from Dynamo or Bigtable it is no easier — although Cassandra is based on those technologies, "its own data model is significantly different."

### Building the model bottom-up

The chapter constructs Cassandra's data model from primitives rather than asserting it.

Start with a **list** of values. You could persist it and query it later, but you'd have to inspect each value to know what it represents, or always store each value at the same index and maintain documentation externally about which cell means what — which in turn means supplying placeholder nulls to preserve the array's predetermined size when an optional attribute (a fax number, an apartment number) is missing. Useful, but "not semantically rich."

Add a second dimension — names for the values — and you get a **map**. Now the cells can be called `first_name`, `last_name`, `phone`, `email`. Richer, but it only works for a single instance of an entity. Nothing unifies a collection of name/value pairs, and there is no way to repeat the same column names for a second person.

So you need a key referencing a group of columns treated together as a set. That gives you **rows**: name/value pairs are *columns*, each entity holding a set of columns is a *row*, and the unique identifier for a row is the *row key* or *primary key*.

Cassandra defines a **table** as a logical division associating similar data — a `user` table, a `hotel` table, an address book table — and in that sense a Cassandra table is genuinely analogous to a relational table. But the storage behavior diverges immediately: you don't need a value for every column every time. Rather than storing `null` for values you don't know, "which would waste space, you just don't store that column at all for that row." The result is a **sparse, multidimensional array structure** — the shape characteristic of Cassandra and of the databases classified as *wide column stores*.

Then the piece that changes everything. Cassandra uses a special kind of primary key called a **composite key** (or compound key) to represent groups of related rows, also called **partitions**. The composite key consists of:

- a **partition key** — used to determine the nodes on which rows are stored, and which can itself consist of multiple columns;
- plus an optional set of **clustering columns** — used to control how data is sorted for storage within a partition.

Cassandra also supports a **static column**, for data that is not part of the primary key but is shared by every row in a partition. And a detail that is easy to miss: where no clustering columns are provided, each partition consists of a single row.

Putting it together, the book's canonical list of structures, innermost to outermost:

| Structure | Definition |
|---|---|
| Column | A name/value pair |
| Row | A container for columns referenced by a primary key |
| Partition | A group of related rows stored together on the same nodes |
| Table | A container for rows organized by partitions |
| Keyspace | A container for tables |
| Cluster | A container for keyspaces, spanning one or more nodes |

**Clusters.** The outermost structure, sometimes called the *ring*, because Cassandra assigns data to nodes by arranging them in a ring. Cassandra is designed to be distributed over several machines that operate together and appear as a single instance to the end user.

**Keyspaces.** The outermost container *for data*, corresponding closely to a database in the relational model — a container for tables, with a name and a set of attributes defining keyspace-wide behavior such as replication.

**Tables.** A container for an ordered collection of rows, each of which is itself an ordered collection of columns. Rows are organized into partitions and assigned to nodes according to the column(s) designated as the partition key; ordering *within* a partition is determined by the clustering columns.

### Partitions are visible in query results

The chapter's `user` table makes the partition/row distinction concrete rather than abstract. The table is:

```sql
CREATE TABLE my_keyspace.user (
    last_name text,
    first_name text,
    middle_initial text,
    title text,
    PRIMARY KEY (last_name, first_name)
);
```

`last_name` is the partition key; `first_name` is the clustering column. Querying on the partition key alone can return many rows:

```sql
cqlsh:my_keyspace> INSERT INTO user (first_name, last_name, title)
  VALUES ('Wanda', 'Nguyen', 'Mrs.');
cqlsh:my_keyspace> SELECT * FROM user WHERE last_name='Nguyen';

 last_name | first_name | title
-----------+------------+-------
    Nguyen |       Bill |   Mr.
    Nguyen |      Wanda | Mrs.

(2 rows)
```

"By partitioning users by `last_name`, you've made it possible to load the entire partition in a single query by providing that `last_name`." To get exactly one row you must supply the entire primary key — `WHERE last_name='Nguyen' AND first_name='Bill'`.

> **Data access requires a primary key.** `SELECT`, `INSERT`, `UPDATE`, and `DELETE` all operate in terms of rows. For `INSERT` and `UPDATE`, *all* primary key columns must be specified in order to identify the row affected. `SELECT` and `DELETE` can operate on one or more rows within a partition, an entire partition, or multiple partitions via `WHERE` and `IN`.

Non-primary-key columns are optional: inserting `('Mary', 'Rodriguez')` with no `title` returns `title` as `null`. Adding a column later is an `ALTER TABLE user ADD middle_initial text;`.

The chapter then sets a trap and springs it. Two consecutive inserts:

```sql
INSERT INTO user (first_name, middle_initial, last_name, title)
  VALUES ('Bill', 'S', 'Nguyen', 'Mr.');
INSERT INTO user (first_name, middle_initial, last_name, title)
  VALUES ('Bill', 'R', 'Nguyen', 'Mr.');
```

A `SELECT` afterwards returns **one** row, with `middle_initial = 'R'`. Both statements specify the same primary key columns, so Cassandra faithfully updated the same row — the second insert overwrote the first.

> **Insert, update, and upsert.** Because Cassandra uses an append model, "there is no fundamental difference between the insert and update operations." Insert a row whose primary key already exists and the row is replaced; update a row whose primary key doesn't exist and Cassandra creates it. Hence: Cassandra supports *upsert*, with one minor exception (lightweight transactions).

The end state of the worked example is two partitions — `Nguyen` and `Rodriguez` — where the `Nguyen` partition holds two rows, `Bill` and `Wanda`, and `Bill` has values in both `title` and `middle_initial` while `Wanda` has only a `title`. That asymmetry is the sparse structure in action.

### Columns carry time: timestamps and TTL

A column is the most basic unit of the data model — a name and a value, with the value constrained to a declared type. But each column also carries two pieces of time metadata.

**Timestamps.** Every write generates a timestamp *in microseconds* for each column value inserted or updated. Internally Cassandra uses these timestamps to resolve conflicting changes to the same value — the **last write wins** approach. You can read them with `writetime()`:

```sql
cqlsh:my_keyspace> SELECT first_name, last_name, title, writetime(title) FROM user;

 first_name | last_name | title | writetime(title)
------------+-----------+-------+------------------
       Mary | Rodriguez |  null |             null
       Bill |    Nguyen |   Mr. | 1567876680189474
      Wanda |    Nguyen |  Mrs. | 1567874109804754
```

A column that was never set has no timestamp. And primary key columns have no queryable timestamp at all:

```
cqlsh:my_keyspace> SELECT WRITETIME(first_name) FROM user;
InvalidRequest: code=2200 [Invalid query] message="Cannot use
  selection function writeTime on PRIMARY KEY part first_name"
```

You can also *supply* a timestamp with `USING TIMESTAMP`, but note the constraint the book flags inline: the timestamp must be later than the existing one or the `UPDATE` will simply be ignored — silently.

> **Working with timestamps.** Setting the timestamp is not required. It is "typically used for writes in which there is a concern that some of the writes may cause fresh data to be overwritten with stale data. This is advanced behavior and should be used with caution." The book also notes there is no way in cqlsh to convert a `writetime()` value into a friendlier format.

**Time to live.** TTL is stored per column value and indicates how long to keep the value; it defaults to `null`, meaning data written does not expire. `UPDATE user USING TTL 3600 SET middle_initial = 'Z' ...` sets an hour, and reading `TTL(middle_initial)` back immediately already shows the countdown in progress (the book's output shows `3574` — the seconds it took to type the second command). `USING TTL` on an `INSERT` expires the *entire row*; the book demonstrates a 60-second row that is present on the first `SELECT` and gone (`0 rows`) a minute later.

> **Using TTL.** TTL is stored per column for nonprimary-key columns. "There is currently no mechanism for setting TTL at a row level directly after the initial insert; you would instead need to reinsert the row, taking advantage of Cassandra's upsert behavior." As with the timestamp, there is no way to obtain or set the TTL of a primary key column, and TTL can only be set for a column when you provide a value for it.

### CQL types

**Numeric.** Closely mirroring Java:

| CQL type | Meaning |
|---|---|
| `int` | 32-bit signed integer (as in Java) |
| `bigint` | 64-bit signed long integer (Java `long`) |
| `smallint` | 16-bit signed integer (Java `short`) |
| `tinyint` | 8-bit signed integer (as in Java) |
| `varint` | Variable precision signed integer (`java.math.BigInteger`) |
| `float` | 32-bit IEEE-754 floating point (as in Java) |
| `double` | 64-bit IEEE-754 floating point (as in Java) |
| `decimal` | Variable precision decimal (`java.math.BigDecimal`) |

`smallint` and `tinyint` were added in Cassandra 2.2. There is **no enumerated type** in CQL; the common practice is to store enum values as strings — in Java, `Enum.name()` on the way out and `Enum.valueOf()` on the way back.

**Textual.** Two types, and a recommendation:

- `text`, `varchar` — synonyms for a UTF-8 character string.
- `ascii` — an ASCII character string.

"UTF-8 is the more recent and widely used text standard and supports internationalization, so we recommend using `text` over `ascii` when building tables for new data. The `ascii` type is most useful if you are dealing with legacy data that is in ASCII format."

**Time and identity.** These are the types that matter for defining unique partition keys.

- `timestamp` — a distinct thing from the per-column write timestamp discussed above; here it is a *value*. Encodable as a 64-bit signed integer, but usually more useful entered in one of several ISO 8601 formats: `2015-06-15 20:05-0700`, `2015-06-15 20:05:07-0700`, `2015-06-15 20:05:07.013-0700`, and the `T`-separated variants. The best practice named in the book: **always provide time zones** rather than relying on the operating system's time zone configuration.
- `date`, `time` — added in Cassandra 2.2. Releases through 2.1 only had `timestamp`, which bundled a date and a time of day together; `date` and `time` let those be represented independently. Both support ISO 8601 formats. A Java-specific note: although `java.time` types exist since Java 8, the `date` type maps to a **custom** Cassandra type to preserve compatibility with older JDKs, and `time` maps to a Java `long` representing nanoseconds since midnight.
- `uuid` — a 128-bit universally unique identifier. The CQL `uuid` type is a **Type 4** UUID, based entirely on random numbers, and is typically written as dash-separated hex, e.g. `1a6300ca-0572-4736-a393-c0b7229e193e`. Frequently used as a surrogate key, alone or combined with other values. The book is candid that "because UUIDs are of a finite length, they are not absolutely guaranteed to be unique," while noting that OS and language utilities provide adequate uniqueness in practice. The CQL `uuid()` function generates one.
- `timeuuid` — a **Type 1** UUID, based on the MAC address of the computer, the system time, and a sequence number to prevent duplicates. Frequently used as a *conflict-free timestamp*. CQL provides convenience functions `now()`, `dateOf()`, and `unixTimestampOf()` — and the availability of those functions "is one reason why `timeuuid` tends to be used more frequently than `uuid`."

> **Primary keys are forever.** "After you create a table, there is no way to modify the primary key, because this controls how data is distributed within the cluster, and even more importantly, how it is stored on disk." This is the single most consequential irreversibility in the model.

**Other simple types.**

- `boolean` — cqlsh is case insensitive on input but outputs `True` / `False`.
- `blob` — an arbitrary array of bytes, useful for media or binary files. Cassandra does not validate or examine the bytes. Represented as hex digits, e.g. `0x00000ab83cf0`; `textAsBlob()` encodes textual data into one.
- `inet` — IPv4 or IPv6 addresses. cqlsh accepts any legal IPv4 format (dotted or nondotted, decimal, octal, hexadecimal) but always *outputs* dotted decimal, e.g. `192.0.2.235`. IPv6 is eight colon-separated groups of four hex digits, with the specification's consecutive-zero collapsing applied on read.
- `counter` — a 64-bit signed integer whose value **cannot be set directly**, only incremented or decremented. "Cassandra is one of the few databases that provides race-free increments across data centers." Used for page views, tweets, log messages. The restrictions are hard ones: a counter cannot be part of a primary key, and if a counter is used, **all** columns other than primary key columns must be counters. Hence the separate table:

```sql
CREATE TABLE user_visits (
  user_id uuid PRIMARY KEY, visits counter);

UPDATE user_visits SET visits = visits + 1
  WHERE user_id=ebf87fee-b372-4104-8a22-00c1252e3e05;
```

There is no operation to reset a counter; you can approximate one by reading the value and decrementing by that amount, but "this is not guaranteed to work perfectly, as the counter may have been changed elsewhere in between reading and writing."

> **A warning about idempotence.** Counter increment and decrement are *not* idempotent. In a distributed system a node may fail to respond with success or failure, and the typical client response is to retry — "since it is not known whether the first attempt succeeded, the value may have been incremented twice." The book notes the only other non-idempotent CQL operation is **adding an item to a list**.

**Collections.** Rather than `email2`, `email3`, and so on — an approach that "does not scale very well and might cause a lot of rework" — CQL offers three collection types.

- `set<text>` — elements are unordered when stored but returned in sorted order (text alphabetically). Sets can hold simple types, user-defined types, and even other collections. A named advantage: "the ability to insert additional items without having to read the contents first." Assigning replaces the whole set (`SET emails = {'mary@example.com'}`); concatenating adds (`SET emails = emails + {'mary.rodriguez.AZ@gmail.com'}`); subtraction removes (`SET emails = emails - {'mary@example.com'}`); `SET emails = {}` clears it.
- `list<text>` — an ordered list, stored by default in insertion order. Append with `phone_numbers + ['480-111-1111']`, prepend by reversing the operands, replace by index with `SET phone_numbers[1] = '480-111-1111'`, remove by value with subtraction, or delete by index with `DELETE phone_numbers[0] FROM user WHERE ...`.

> **Expensive list operations.** "Because a list stores values according to position, there is the potential that updating or deleting a specific item in a list could require Cassandra to read the entire list, perform the requested operation, and write out the entire list again." Expensive with many values — "for this reason, many users prefer to use the `set` or `map` types, especially in cases where there is the potential to update the contents of the collection."

- `map<timeuuid, int>` — key-value pairs where keys and values can be any type **except** `counter`. The book's example tracks login session durations keyed by `now()`:

```sql
ALTER TABLE user ADD login_sessions map<timeuuid, int>;
UPDATE user SET login_sessions = { now(): 13, now(): 18}
  WHERE first_name = 'Mary' AND last_name = 'Rodriguez';
```

Individual map items can be referenced by key. Collections are "very useful in cases where we need to store a variable number of elements within a single column."

**Tuples.** A fixed-length set of values of various types. An address as `tuple<text, text, text, int>` works:

```sql
ALTER TABLE user ADD address tuple<text, text, text, int>;
UPDATE user SET address = ('7712 E. Broadway', 'Tucson', 'AZ', 85715)
  WHERE first_name = 'Mary' AND last_name = 'Rodriguez';
```

But the book's verdict is unusually blunt: it is "awkward to try to remember the positional values of the various fields of a tuple without having a name associated with each value. There is also no way to update individual fields of a tuple; the entire tuple must be updated. For these reasons, tuples are infrequently used in practice." The chapter drops the column immediately and moves on.

**User-defined types.** UDTs are "easier to use than tuples since you can specify the values by name rather than position," and are **scoped by the keyspace** they're defined in — `CREATE TYPE my_keyspace.address` is the fully qualified form, and `DESCRIBE KEYSPACE` shows the type as part of the keyspace definition.

```sql
CREATE TYPE address (
  street text,
  city text,
  state text,
  zip_code int);
```

Trying to use it inside a map fails:

```
cqlsh:my_keyspace> ALTER TABLE user ADD addresses map<text, address>;
InvalidRequest: code=2200 [Invalid query] message="Non-frozen
  collections are not allowed inside collections: map<text, address>"
```

The explanation is the key insight of this section: **a user-defined type is itself considered a collection**, because its implementation is similar to a set, list, or map. Nesting one inside a map is nesting a collection in a collection.

> **Freezing collections.** Releases prior to 2.2 do not fully support nesting collections — specifically, individual attributes of a nested collection cannot be accessed, "because the nested collection is serialized as a single object by the implementation. Therefore, the entire nested collection must be read and written in its entirety." Freezing was introduced as a *forward compatibility mechanism*: marking a nested collection `frozen` tells Cassandra to store that value as a blob of binary data, with the intent that a future "unfreeze" mechanism would allow individual attribute access. A collection can also be used as a primary key **if it is frozen**.

So the working form is `map<text, frozen<address>>`, and the final table reads:

```sql
CREATE TABLE my_keyspace.user (
    last_name text,
    first_name text,
    addresses map<text, frozen<address>>,
    emails set<text>,
    id uuid,
    login_sessions map<timeuuid, int>,
    middle_initial text,
    phone_numbers list<text>,
    title text,
    PRIMARY KEY (last_name, first_name)
) WITH CLUSTERING ORDER BY (first_name ASC)
    AND bloom_filter_fp_chance = 0.01
    AND caching = {'keys': 'ALL', 'rows_per_partition': 'NONE'}
    AND compaction = {'class': '...SizeTieredCompactionStrategy',
      'max_threshold': '32', 'min_threshold': '4'}
    AND compression = {'chunk_length_in_kb': '16',
      'class': 'org.apache.cassandra.io.compress.LZ4Compressor'}
    AND gc_grace_seconds = 864000
    ...;
```

Worth noticing in that output: `CLUSTERING ORDER BY (first_name ASC)` is not decoration — it is the physical on-disk sort order inside every `last_name` partition, and it is what makes range queries on `first_name` within a partition efficient.

### Book vs. today

The chapter is written against Cassandra 4.0, and the model itself — cluster, keyspace, table, partition key, clustering columns, static columns, freezing — is unchanged in Cassandra 5.0. Four points have moved:

> **The `DESCRIBE TABLE` output in the book is from a pre-4.0 cluster.** It includes `read_repair_chance` and `dclocal_read_repair_chance`. Both were removed in Cassandra 4.0 by CASSANDRA-13910 — probabilistic *background* read repair was dropped entirely, and `read_repair_chance` was replaced by a `read_repair` table option whose values are `BLOCKING` (the default) and `NONE`. If you run `DESCRIBE TABLE` on a modern cluster you will not see the old properties. Nothing about the data model changed — only that particular property listing.

> **`dateOf()` and `unixTimestampOf()` are the deprecated spellings.** The book lists them alongside `now()` as the `timeuuid` convenience functions. They still work, but the replacements introduced in Cassandra 2.2 are `toDate()`, `toTimestamp()`, and `toUnixTimestamp()`, which are the ones current documentation uses and which also work uniformly across `timeuuid`, `timestamp`, and `date`. This is a rename, not a behavior change. Cassandra 4.0 additionally added `currentTimestamp()`, `currentDate()`, `currentTime()`, and `currentTimeUUID()` for the server-side "now" of the corresponding type.

> **Non-frozen UDTs are supported at the top level.** The book's framing — "a user-defined data type is considered a collection" — comes from a period when UDT columns were always effectively frozen blobs. CASSANDRA-7423, resolved in Cassandra 3.6, made a UDT used as a plain column non-frozen, so you can update a single field (`SET home_address.city = 'Phoenix'`) instead of rewriting the whole value. Two conditions apply: the UDT must contain no collection fields, and it must be declared unfrozen in `CREATE TABLE`. The restriction the book actually demonstrates is still in force — *inside* a collection, or as part of a primary key, the UDT must be `frozen` — and the promised "unfreeze" mechanism for genuinely nested collections still does not exist.

> **The type list has grown.** `duration` (months, days, nanoseconds) arrived in Cassandra 3.10 and is missing from the book's "other simple data types" list; it cannot be used in a primary key or ordered by, because durations are not comparable. Cassandra 5.0 added `vector<float, n>` for embedding storage, paired with Storage-Attached Indexes (SAI) for approximate nearest-neighbor search — the one genuinely new modeling capability since the book, and the reason a Cassandra table can now back a retrieval workload it previously could not.

## Trade-offs

- **The relational resemblance is the trap.** Tables, columns, types, `SELECT`, `INSERT`, `WHERE` — the surface of CQL is deliberately SQL-shaped, and that makes the differences easy to miss rather than easy to learn. There are no ad-hoc joins, and the `WHERE` clause is not a general filter: it addresses partitions and clustering positions, so a predicate the schema wasn't designed for is either rejected or requires an index or a full scan. Schema design here is driven by the queries you intend to run, not by the entities in your domain — which is the inversion the sibling data-modeling concept covers properly. The point to carry out of *this* chapter is narrower: knowing the vocabulary is not knowing the model, and reading a `CREATE TABLE` correctly means reading the `PRIMARY KEY` clause first.
- **`INSERT` that silently overwrites is upsert working as designed, and it removes a safety net you had in SQL.** Two inserts with the same primary key produce one row, no error, no duplicate-key violation. The append model makes insert and update the same operation, which is what allows writes to be cheap and coordination-free — but it also means an application bug that reuses a key destroys data rather than failing loudly. Lightweight transactions (`IF NOT EXISTS`) are the escape hatch, and they cost a Paxos round trip, so they are a deliberate exception, not a default.
- **Collections buy convenience at a real cost that a relational background will not anticipate.** They look like the obvious answer to "a user has several email addresses," and for small, bounded, mostly-write-once sets they are. But the entire collection lives in one partition and is read and written as a unit for most operations; lists are worse, since a positional update or delete may require reading the whole list, applying the change, and rewriting it. Overwriting a whole collection also writes a tombstone covering the old contents, which then has to survive `gc_grace_seconds` before compaction can remove it — so a frequently-reassigned collection column quietly manufactures the tombstone load that shows up later as read latency. There is no query that says "give me the users whose emails contain X" without an index. The practical rule the book gestures at and experience confirms: prefer `set` or `map` over `list` when the contents will change, keep collections small and bounded, and promote anything unbounded to clustering columns in its own table.
- **Counters are a separate database inside the database.** Race-free cross-datacenter increments are genuinely rare and valuable, but the restrictions cascade into schema design: no counter in a primary key, and every non-key column in the table must also be a counter — so counters force a dedicated table, as the book's `user_visits` shows. Add non-idempotent increments to that, and a retry after an ambiguous network failure can double-count. Counters are correct for approximate statistics and wrong for anything that must balance.
- **UDTs add structure but not integrity.** A `frozen<address>` gives you named fields instead of a tuple's positional guesswork, and it keeps the components of a compound value together. What it does not give you is anything a SQL foreign key would: no referential integrity, no cascade, no guarantee that the `state` value is a real state or that two rows referencing "the same" address agree. A UDT is a shape, enforced only as far as the declared field types. Any invariant across rows is your application's job, permanently.
- **Freezing is forward-compatibility scaffolding you have to live inside today.** `frozen` means the value is stored as an opaque binary blob: read and written in its entirety, individual fields inaccessible. That is fine for a small address, meaningfully wasteful for a large nested structure updated field by field. The book presents freezing as temporary — "in the future, when nested collections are fully supported, there will be a mechanism to 'unfreeze'" — but that future has not arrived, and a schema built around deeply nested frozen collections is committing to whole-value rewrites indefinitely.
- **Per-column TTL is elegant and asymmetric.** Expiring individual values without a cleanup job is a real advantage over the relational world's scheduled-delete jobs. But TTL cannot be set on primary key columns, cannot be applied to a row after the initial insert without reinserting the whole row, and only applies to a column when you actually supply a value for it. And expiration is not free: an expired value becomes a tombstone, so a high-churn TTL table trades a cleanup job for compaction pressure and read-path tombstone scanning.
- **"Primary keys are forever" concentrates the risk in the first decision you make.** You can `ALTER TABLE ... ADD` a column freely, drop one, and add types to a keyspace — the schema is far from rigid. But the partition key and clustering columns determine data placement across the cluster and the on-disk layout, and they cannot be changed. Getting them wrong is not an `ALTER`; it is a new table plus a full migration of live data. Spend disproportionate time there.

## Documentation Links

- [Jeff Carpenter and Eben Hewitt, "Cassandra: The Definitive Guide", Revised 3rd Edition (O'Reilly, 2022) — Chapter 4, "The Cassandra Query Language", p. 94-128](https://www.oreilly.com/library/view/cassandra-the-definitive/9781492097143/) — doc
- [Apache Cassandra Documentation — CQL Data Types](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/types.html) — doc
- [Apache Cassandra Documentation — CQL Data Definition (keyspaces, tables, primary keys)](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/ddl.html) — doc
- [Apache Cassandra Documentation — CQL Data Manipulation (INSERT, UPDATE, DELETE, USING TTL and TIMESTAMP)](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/dml.html) — doc
- [Apache Cassandra Documentation — CQL Functions (writetime, ttl, uuid, now, toTimestamp)](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/functions.html) — doc
- [Apache Cassandra Documentation — Vector CQL Data Type](https://cassandra.apache.org/doc/latest/cassandra/reference/vector-data-type.html) — doc
