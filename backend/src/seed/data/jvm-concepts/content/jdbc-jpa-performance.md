---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand two of the most common ways database access silently costs more than it should from Java: prepared statements that never get pooled, and JPA relationships that fetch related entities one query at a time instead of together.

## Use Cases

- Explaining why the first call to a given SQL statement on a fresh connection is slower than the hundredth, and why that's expected, not a bug.
- Diagnosing why fetching one entity in JPA silently triggers dozens or hundreds of extra queries.
- Deciding whether a JPA relationship should be lazy, eager, or fetched explicitly with a `JOIN` in a query.

## Deep Dive

### Prepared statements only pay off when they're pooled

A `PreparedStatement`'s advantage over a plain `Statement` is that the database can reuse what it already knows about a statement's execution plan — but that reuse only happens if the *same* prepared statement object is reused, not recreated every call. Statement pooling happens **per connection**: if two threads pull two different connections from the pool, each connection ends up with its own separate pool of prepared statements, even for the identical SQL. That has two direct consequences: the size of the connection pool affects how often a query hits a "cold," not-yet-pooled statement on a given connection, and each pooled statement consumes heap space on its connection — a bigger connection pool means more memory tied up in cached statement metadata, which is a real cost against GC time, not just a number to maximize blindly.

### JPA's lazy/eager choice, and why eager doesn't mean `JOIN`

JPA reads data three ways: `entityManager.find()`, a JPQL query, or navigating a relationship from an already-loaded entity. Relationship fields can be marked `@Basic(fetch = FetchType.LAZY)` (skip loading it until the getter is actually called — worth it for large `@Lob` columns) or `FetchType.EAGER` (load it immediately alongside the owning entity, which is already the default for `@OneToOne`/`@ManyToOne`).

The part that surprises people: **eager fetching does not mean the JPA provider generates a `JOIN`.** A typical provider issues one query for the primary entity, then a *separate* query per related entity (or per related collection) it needs to eagerly load:

```java
@OneToMany(mappedBy = "stock", fetch = FetchType.EAGER)
private Collection<StockOptionPriceImpl> optionsPrices;
```

Fetch this stock 100 times in a loop, and you get 1 query for each stock plus 1 more for its option prices — 200 queries where a single `JOIN`-based query could have done the job in one round trip. This is the classic **N+1 query problem**: N extra round trips, one per row, instead of the single query a hand-written `JOIN` would use. JPQL's `find()` and simple queries give you no control over this — the only way to force a real `JOIN` is to write it explicitly into a JPQL/Criteria query rather than relying on relationship-fetch annotations alone.

## Trade-offs

- **`FetchType.LAZY` is a hint, not a guarantee** — the JPA provider is free to load the data eagerly anyway; don't assume a lazy annotation is load-bearing without checking what the provider actually does.
- **A too-small connection pool re-pays the "cold statement" cost constantly; a too-large one wastes heap on cached statement metadata across connections that barely get used** — this is a genuine two-sided tuning problem, not a "bigger is always safer" one.
- **The N+1 problem is invisible in the code and only shows up in the query log or a profiler** — the entity graph traversal (`stock.getOptionsPrices()`) looks identical whether it costs one query or a hundred; catching this requires actually looking at generated SQL (or a tool like Hibernate's statistics/`SHOW_SQL`), not code review alone:

  ```java
  for (Stock s : stocks) {           // 1 query to load `stocks`
      s.getOptionsPrices().size();    // +1 query PER stock if eagerly-but-separately fetched
  }
  ```

## Documentation Links

- Scott Oaks, *Java Performance: The Definitive Guide*, 2nd Edition (O'Reilly, 2020) — Chapter 11 "Database Performance Best Practices", pp. 329-361 — book
- [Jakarta Persistence Specification](https://jakarta.ee/specifications/persistence/) — doc
- [PreparedStatement — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.sql/java/sql/PreparedStatement.html) — doc
