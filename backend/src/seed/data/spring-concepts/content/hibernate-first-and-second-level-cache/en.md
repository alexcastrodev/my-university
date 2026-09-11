---
version: 1.0
updatedAt: 2026-09-11
---
## Objective

Hibernate's first-level cache (the persistence context) and second-level cache only get consulted on specific access paths, `em.find()` and traversing a to-one association, not on every way of reading data. A JPQL, Criteria, or native query always hits the database first; the caches only come into play afterward, when Hibernate reconciles the rows it got back with entities it may already manage.

## Use Cases

- Understanding why repeatedly calling `em.find(Book.class, id)` for the same id within one persistence context returns the same managed instance without a second database round-trip.
- Explaining why a query that returns entities still executes SQL every time, even when every one of those entities is already cached.
- Deciding whether caching applies to a given access pattern before reaching for the second-level cache as a performance fix.
- Distinguishing "entity is cached" from "query result is cached", two related but separate mechanisms.

## Deep Dive

### `find()` and to-one navigation: cache-first

```java
Book book1 = em.find(Book.class, 1L);   // hits the database
Book book2 = em.find(Book.class, 1L);   // same persistence context: returned from the first-level cache, no SQL
```

```java
Author author = book.getAuthor();       // to-one association: same cache lookup applies
```

Both `em.find()` and navigating a to-one association go through the same lookup: check the first-level cache (the current persistence context) first, then the second-level cache if one is configured and the entity type is marked cacheable, and only fall through to the database if neither has the entity.

### Queries always execute SQL, but reuse what's already loaded

```java
List<Book> books = em.createQuery("SELECT b FROM Book b", Book.class).getResultList();
```

This always sends a `SELECT` to the database, there is no cache check before the query runs. What the cache *does* affect is what happens with each row afterward: for every row in the JDBC result set, Hibernate checks whether the first-level cache already holds a managed entity for that identifier. If it does, that row is discarded and the already-managed instance is returned in its place, rather than hydrating a second object for the same row.

```java
// same id already managed from an earlier find() in this persistence context
Book cached = em.find(Book.class, 1L);
List<Book> books = em.createQuery("SELECT b FROM Book b WHERE b.id = :id", Book.class)
    .setParameter("id", 1L)
    .getResultList();
// books.get(0) == cached -> true: the SQL still ran, but the row became the existing instance
```

### Caching a query's result: the separate Query Cache

```java
TypedQuery<Book> query = em.createQuery("SELECT b FROM Book b WHERE b.author.id = :authorId", Book.class);
query.setParameter("authorId", 1L);
query.setHint("org.hibernate.cacheable", true);
```

To skip re-executing a query entirely, not just avoid re-hydrating entities, requires the Query Cache, a distinct opt-in cache from the first- and second-level entity caches. It stores the identifiers a query returned, keyed by the query and its parameters, and still relies on the second-level cache to resolve those identifiers back into entity data.

## Trade-offs

- **A cacheable entity does not make its queries free.** The database round-trip for a JPQL/Criteria/native query happens regardless of how many of the returned rows are already cached; only the object-instantiation cost is avoided.
- **The Query Cache adds invalidation complexity.** Any insert, update, or delete on the underlying table can invalidate cached query results, which makes the Query Cache most valuable for data that changes rarely relative to how often it's queried, and a net loss otherwise.
- **First-level cache scope is the persistence context, not the application.** Two different requests, each with their own `EntityManager`, do not share a first-level cache; only the (optional) second-level cache is shared across persistence contexts.

## Documentation Links

- [Hibernate ORM User Guide — Caching](https://docs.jboss.org/hibernate/orm/current/userguide/html_single/Hibernate_User_Guide.html#caching) — doc
- [Jakarta Persistence API — EntityManager.find](https://jakarta.ee/specifications/persistence/3.2/apidocs/jakarta.persistence/jakarta/persistence/entitymanager) — doc
- [Thorben Janssen — JPQL, Criteria API and Native Queries (Coffee with Thorben)](https://thorben-janssen.com/coffee-with-thorben/) — doc
