---
version: 1.0
updatedAt: 2026-09-11
---
## Objective

`hibernate.order_inserts` and `hibernate.order_updates` make Hibernate group and reorder the `INSERT`/`UPDATE` statements it batches at flush time, so that statements touching the same table happen in a consistent order across transactions. On a multi-node cluster such as Galera, where two transactions taking locks on the same rows in a different order is a common cause of deadlocks, this consistent ordering reduces how often that happens.

## Use Cases

- Running Hibernate against a synchronous multi-primary cluster (Galera, Percona XtraDB Cluster) where deadlocks show up more often than on a single-primary database.
- Reducing deadlock frequency between concurrent transactions that each insert or update rows across several of the same tables, without redesigning the transactions themselves.
- A cheap, configuration-only mitigation to try before reaching for explicit locking, which trades throughput for safety and doesn't remove the underlying contention.

## Deep Dive

### What "ordering" means here

Without these settings, Hibernate issues insert/update statements in whatever order the entities were persisted or modified in your code, statements for different tables can end up interleaved. With ordering enabled, Hibernate groups pending statements by table at flush time and executes each table's group together, in a stable order:

```properties
spring.jpa.properties.hibernate.order_inserts=true
spring.jpa.properties.hibernate.order_updates=true
```

```java
// application code interleaves entities from two tables
em.persist(new Book(...));
em.persist(new Author(...));
em.persist(new Book(...));
// with order_inserts=true, the flush still groups: both Book inserts, then the Author insert
```

### Why this helps with deadlocks, not why it prevents them

A deadlock between two transactions typically comes from each acquiring locks on the same set of rows/tables in a different order. If every transaction consistently locks, say, `book` before `author`, the two transactions block and wait rather than deadlock. Ordering inserts and updates by table nudges Hibernate toward that consistent ordering, but it doesn't control the order of reads, deletes, or any locking that happens outside batched insert/update statements, so it reduces deadlock frequency rather than eliminating the possibility.

### Batching benefits as a side effect

Because same-table statements end up grouped together, ordering also makes JDBC batching (`hibernate.jdbc.batch_size`) more effective: a batch of consecutive `INSERT`s against the same table can be sent as one batched statement, where interleaved statements against different tables would break the batch.

## Trade-offs

- **This reduces deadlock likelihood, it does not guarantee deadlock-free execution.** Locking that happens outside grouped insert/update statements (explicit row locks, reads under an isolation level that takes locks, deletes) is unaffected.
- **The first recommendation is still to avoid explicit locking altogether.** Locking has a direct performance cost of its own; reach for `order_inserts`/`order_updates` as a low-effort mitigation, not as a substitute for reconsidering why locks are needed in the first place.
- **Ordering changes flush behavior for the whole persistence unit.** It's a global setting, not something you can scope to a single transaction or entity, so its batching side effects apply everywhere once enabled.

## Documentation Links

- [Hibernate ORM Configuration Properties — order_inserts / order_updates](https://docs.jboss.org/hibernate/orm/current/userguide/html_single/Hibernate_User_Guide.html#configurations-database-orderInserts) — doc
- [Thorben Janssen — JPQL, Criteria API and Native Queries (Coffee with Thorben)](https://thorben-janssen.com/coffee-with-thorben/) — doc
