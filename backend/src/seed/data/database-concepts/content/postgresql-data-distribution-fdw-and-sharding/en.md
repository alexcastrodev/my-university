---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

Foreign Data Wrappers let PostgreSQL treat a table on a completely different server as if it were local — queryable, joinable, sometimes even writable — without the application knowing the data isn't physically nearby. `postgres_fdw` is the built-in wrapper for talking to other PostgreSQL servers, and it's the foundation both for simple cross-server access (a reporting server querying tables that live on the primary) and for hand-rolled horizontal sharding: distributing rows across many PostgreSQL instances by building the ID-generation, routing, and shard-management logic yourself on top of FDW primitives.

## Use Cases

- Querying tables that live on a different PostgreSQL server (e.g., a reporting replica accessing a subset of tables from the primary) without physically copying the data.
- Centralizing a small set of reference/lookup tables on one server that many other databases query via foreign tables, instead of duplicating them everywhere.
- Migrating data incrementally between servers by querying old and new locations transparently during a transition period.
- Building an application-level sharding scheme when a full distributed-database solution isn't justified — the DIY path this book teaches.

## Deep Dive

### Registering a remote PostgreSQL server

```sql
CREATE EXTENSION postgres_fdw;

CREATE SERVER primary_db
    FOREIGN DATA WRAPPER postgres_fdw
    OPTIONS (host 'pg-primary', dbname 'pgbench');
```

`CREATE SERVER` deliberately omits a username/password — connection credentials are handled separately by user mappings, which means the same server definition can be shared by many local users, each authenticating as themselves on the remote side rather than through one shared credential.

### Mapping local users to remote credentials

```sql
CREATE USER MAPPING FOR bench_user
    SERVER primary_db
    OPTIONS (user 'bench_user', password 'testing');
```

Every local user that queries the foreign server needs its own mapping — PostgreSQL requires this explicitly (a password option is mandatory for non-superusers, specifically to prevent a mapped user from silently pulling credentials out of `.pgpass` or another automated password store). For many users, a `DO $$ ... $$` anonymous PL/pgSQL block can generate the mappings in bulk instead of one `CREATE USER MAPPING` per user.

### Creating and using a foreign table

```sql
CREATE FOREIGN TABLE pgbench_accounts (
    aid       INTEGER NOT NULL,
    bid       INTEGER,
    abalance  INTEGER,
    filler    CHAR(84)
)
SERVER primary_db
OPTIONS (table_name 'pgbench_accounts');

ANALYZE pgbench_accounts;
```

A foreign table declares only column names/types/nullability — no indexes or constraints, since those live on the remote server and PostgreSQL can't enforce them locally anyway. Running `ANALYZE` still matters: without local statistics, the query planner has no idea how selective a filter on the foreign table will be and can make poor join-order decisions. For many tables at once, `IMPORT FOREIGN SCHEMA` avoids writing out each `CREATE FOREIGN TABLE` by hand:

```sql
IMPORT FOREIGN SCHEMA public
  FROM SERVER primary_db
  INTO public;
```

PostgreSQL enforces the foreign/local distinction everywhere — a plain `DROP TABLE` on a foreign table fails outright (it has to be `DROP FOREIGN TABLE`), and `pg_class.relkind` reports `f` instead of `r`, so tooling can always tell the two apart.

### DIY sharding: encoding shard + time + sequence into one ID

The book's approach to unique IDs across many shards — the same technique Instagram documented publicly for their own sharding system — packs three pieces of information into one 64-bit integer instead of relying on a single global sequence (which would itself become a bottleneck and single point of failure across shards):

```sql
CREATE SEQUENCE shard.table_id_seq;

CREATE OR REPLACE FUNCTION shard.next_unique_id(shard_id INT)
RETURNS BIGINT AS $$
DECLARE
  epoch     DATE := '2020-01-01';
  epoch_ms  BIGINT;
  now_ms    BIGINT;
  next_id   BIGINT;
BEGIN
  epoch_ms := floor(extract(EPOCH FROM epoch) * 1000);
  now_ms   := floor(extract(EPOCH FROM clock_timestamp()) * 1000);
  next_id  := (now_ms - epoch_ms) << 22
            | (shard_id << 11)
            | (nextval('shard.table_id_seq') % 2048);
  RETURN next_id;
END;
$$ LANGUAGE plpgsql;
```

Bit layout: the top bits hold milliseconds since a chosen epoch (viable for ~140 years), the next 11 bits hold the shard number (up to 2,048 logical shards), and the low 11 bits hold a per-shard sequence value (up to 2,048 IDs per millisecond per shard). `clock_timestamp()` is used instead of `now()` deliberately — `now()` returns the *transaction's* start time, which would be identical for every ID generated within the same transaction and risk collisions; `clock_timestamp()` reflects actual wall-clock time at each call.

### From an ID generator to a sharding API

The book frames a genuine sharding *system* as far more than the ID function alone — a real implementation needs: a shard-configuration table, a table tracking which application tables exist on which shards, functions to build/alter each shard's structure consistently, a logical-to-physical shard mapping layer (so a logical shard number can move to a different physical server without the application knowing), and a dedicated role scoped to just the permissions this machinery needs. The ID generator is the easy 10% — the shard-management API around it is the other 90%.

## Trade-offs

- **A foreign table's query plan quality depends entirely on statistics PostgreSQL doesn't collect automatically.** Skipping `ANALYZE` after creating a foreign table leaves the planner blind to selectivity and row counts, which can produce a technically-correct but badly inefficient plan (fetching far more remote rows than a query actually needs) with no error or warning — just quietly bad performance.
- **User mappings are per-server and per-user by design, which is secure but doesn't scale to "map everyone automatically."** The anonymous-block workaround for bulk-mapping local users to identically-named remote users only works cleanly when usernames match on both sides — a remote system administered by someone else, with different usernames, breaks that assumption and forces manual mapping.
- **Hand-rolled sharding gives full control at the cost of building (and maintaining) a real distributed system from scratch.** The bit-packed ID scheme is a clever, well-understood pattern, but it's only the ID-generation layer — cross-shard joins, rebalancing shards, transaction consistency across shards, and query routing all still need to be designed and built; none of that comes from FDW or the ID function.
```sql
-- the ID generator alone doesn't answer questions like:
-- "which physical server holds shard 42 right now?"
-- "how do I join data that lives on two different shards?"
```
- **Book vs. today**: this chapter builds a sharding system essentially by hand — FDW for cross-server access, a custom ID generator, and a from-scratch shard-management API. **Citus**, a mature, actively-maintained PostgreSQL extension (open source, with a managed offering from Microsoft as Azure Cosmos DB for PostgreSQL), solves the same class of problem with a fraction of the custom code: `SELECT create_distributed_table('table_name', 'shard_key_column');` turns an ordinary table into a distributed one, with Citus handling shard placement, query routing, and cross-shard query planning internally. For new systems that need real horizontal sharding today, reaching for Citus (or an equivalent mature distributed-Postgres solution) is generally the more pragmatic starting point than reimplementing this chapter's DIY approach — the book's technique remains valuable for understanding *what* a sharding layer actually has to solve, even when the implementation itself is delegated to an extension.

## Documentation Links

- [Shaun Thomas, "PostgreSQL 12 High Availability Cookbook", 3rd Edition (Packt, 2020) — Chapter 14, "Data Distribution", p. 602-646](https://www.packtpub.com/en-us/product/postgresql-12-high-availability-cookbook-9781838984854) — doc
- [PostgreSQL Documentation — postgres_fdw](https://www.postgresql.org/docs/current/postgres-fdw.html) — doc
- [PostgreSQL Documentation — CREATE FOREIGN TABLE](https://www.postgresql.org/docs/current/sql-createforeigntable.html) — doc
- [PostgreSQL Documentation — IMPORT FOREIGN SCHEMA](https://www.postgresql.org/docs/current/sql-importforeignschema.html) — doc
- [Citus Documentation — What is Citus?](https://docs.citusdata.com/en/stable/get_started/what_is_citus.html) — doc
