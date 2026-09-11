---
version: 1.0
updatedAt: 2026-09-11
---
## Objective

A JPQL (or SQL) `IN` clause with a large number of literal values isn't unlimited on every database, Oracle rejects one once it holds more than 1000 elements. That limit is a database restriction, not a JPA or Hibernate one, so it surfaces regardless of how the query was built. There are three practical ways around it: batching the values yourself, rewriting the filter as a sub-select, or, specifically when filtering by primary key, using Hibernate's multi-identifier loading API.

## Use Cases

- Filtering `WHERE b.id IN (:ids)` where `:ids` is a collection whose size depends on user input or another query's result, and can exceed 1000 elements on Oracle.
- Fetching a batch of entities by a list of primary keys pulled from another system (a message payload, an export file) without knowing its size ahead of time.
- Replacing a large `IN` list with an equivalent condition that doesn't hit the database's parameter/element limit at all.

## Deep Dive

### The failure

```java
List<Long> ids = /* 1500 ids */;
em.createQuery("SELECT b FROM Book b WHERE b.id IN :ids", Book.class)
    .setParameter("ids", ids)
    .getResultList();
// ORA-01795: maximum number of expressions in a list is 1000
```

This is Oracle's own hard limit on the number of elements in an `IN (...)` list; other databases have their own limits or none at Oracle's scale, but the pattern of "the list can grow unpredictably" is worth handling defensively regardless of target database.

### Option 1: batch the values yourself

```java
List<Book> books = new ArrayList<>();
for (List<Long> batch : Lists.partition(ids, 1000)) {
    books.addAll(em.createQuery("SELECT b FROM Book b WHERE b.id IN :ids", Book.class)
        .setParameter("ids", batch)
        .getResultList());
}
```

Straightforward and portable, but it means N queries instead of one, and the batching logic (and its batch size) is now something your application code owns and has to get right.

### Option 2: rewrite as a sub-select

```sql
SELECT b.* FROM book b
WHERE b.id IN (SELECT ol.book_id FROM order_line ol WHERE ol.order_id = :orderId)
```

When the values being filtered on come from another query rather than an arbitrary in-memory list, a sub-select avoids materializing the list of ids entirely, it never hits the `IN`-list size limit because there's no literal list, just a nested query. This only applies when the filter values are themselves derivable by a query; it doesn't help for an arbitrary external list of ids.

### Option 3: `MultiIdentifierLoadAccess`, for primary-key lookups specifically

```java
List<Book> books = em.unwrap(Session.class)
    .byMultipleIds(Book.class)
    .multiLoad(ids);
```

When the values are primary keys, Hibernate's `MultiIdentifierLoadAccess` (obtained via `Session.byMultipleIds()`) fetches many entities by id in one call, internally batching the underlying SQL according to `hibernate.jdbc.batch_size` (or a fetch size set explicitly on the loader), so the 1000-element limit is handled for you rather than by hand-rolled partitioning. It's Hibernate-specific API (accessed via `unwrap(Session.class)`), not portable JPA, and it's for loading entities by id specifically, not for an arbitrary `IN` filter on a non-key column.

## Trade-offs

- **Manual batching is portable but pushes the batching logic into application code.** Every call site that might exceed the limit needs its own partitioning, and the batch size becomes a magic number to keep in sync with the target database's actual limit.
- **The sub-select rewrite only works when the values come from a query, not an arbitrary list.** It solves a different shape of problem than "I have a `List<Long>` of unknown size from outside the database."
- **`MultiIdentifierLoadAccess` is the cleanest option for id-based lookups, but it's Hibernate API, not JPA.** Reaching for it via `unwrap(Session.class)` ties the code to Hibernate as the provider; it doesn't apply when filtering on a non-primary-key column.

  ```java
  // not applicable: filtering by a non-id column still needs batching or a sub-select
  em.createQuery("SELECT b FROM Book b WHERE b.isbn IN :isbns", Book.class);
  ```

## Documentation Links

- [Hibernate ORM User Guide — Natural Id and Multiple Identifier Loading](https://docs.jboss.org/hibernate/orm/current/userguide/html_single/Hibernate_User_Guide.html#pc-loading) — doc
- [Hibernate ORM API — MultiIdentifierLoadAccess](https://docs.jboss.org/hibernate/orm/current/javadocs/org/hibernate/MultiIdentifierLoadAccess.html) — doc
- [Thorben Janssen — JPQL, Criteria API and Native Queries (Coffee with Thorben)](https://thorben-janssen.com/coffee-with-thorben/) — doc
