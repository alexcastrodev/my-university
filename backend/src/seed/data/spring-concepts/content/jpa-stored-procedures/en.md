---
version: 1.0
updatedAt: 2026-09-11
---
## Objective

JPA can call a database stored procedure directly through `@NamedStoredProcedureQuery`, without falling back to a native query. You declare the procedure's name and its parameters (which can be `IN`, `OUT`, `INOUT`, or `REF_CURSOR`) once on an entity, then reference that declaration by name wherever you need to call it.

## Use Cases

- Calling existing business logic that already lives in the database as a stored procedure, instead of duplicating it in Java.
- Retrieving a computed value through an `OUT` parameter (a total, a status code) rather than a result set of entities.
- Calling a procedure that returns a cursor (`REF_CURSOR`) on databases where that's how a procedure produces rows.
- Working in an environment where DBAs own the procedures and application code is expected to call, not replace, them.

## Deep Dive

### Declaring a named stored procedure query

```java
@Entity
@NamedStoredProcedureQuery(
    name = "calculate",
    procedureName = "calculate",
    parameters = {
        @StoredProcedureParameter(name = "x", mode = ParameterMode.IN, type = Integer.class),
        @StoredProcedureParameter(name = "y", mode = ParameterMode.IN, type = Integer.class),
        @StoredProcedureParameter(name = "result", mode = ParameterMode.OUT, type = Integer.class)
    }
)
public class Calculation { /* ... */ }
```

`name` is the identifier your application code uses to look up this query; `procedureName` is the actual name of the stored procedure in the database. Matching them makes the mapping easy to follow, but they don't have to be identical. A procedure can declare more than one `OUT` parameter, each retrieved separately after the call.

### Calling it: `execute()`, not `getResultList()`

```java
StoredProcedureQuery query = em.createNamedStoredProcedureQuery("calculate");
query.setParameter("x", 3);
query.setParameter("y", 4);

query.execute();

Integer result = (Integer) query.getOutputParameterValue("result");
```

A stored procedure call is executed with `execute()`, unlike a JPQL or native `SELECT`, which uses `getResultList()`/`getSingleResult()`. `IN` parameters are set the same way as with any other query; `OUT` (and `INOUT`) parameter values are only available afterward, through `getOutputParameterValue(name)`.

### `REF_CURSOR` parameters

```java
@StoredProcedureParameter(name = "cursor", mode = ParameterMode.REF_CURSOR, type = void.class)
```

Some databases (Oracle and PostgreSQL among them) return a result set from a procedure via a cursor parameter rather than as the query's own result. A `REF_CURSOR`-mode parameter maps that cursor so Hibernate can read it as a result list, but support and exact behavior are database-specific.

## Trade-offs

- **`execute()` is mandatory, not a style choice.** Calling `getResultList()` on a stored procedure query that produces no result set (only `OUT` parameters) is a usage error; the parameter mode dictates which retrieval method applies.
- **Stored procedure logic lives outside your codebase and your migrations tooling.** Changes to the procedure's signature (parameter count, types, order) break the `@NamedStoredProcedureQuery` mapping silently until the next call, since nothing in the Java code enforces the two staying in sync.
- **`REF_CURSOR` support is not uniform across databases.** A mapping that works on Oracle may need adjustment on PostgreSQL or may not be supported at all on databases without a comparable cursor mechanism.

## Documentation Links

- [Jakarta Persistence API — StoredProcedureQuery](https://jakarta.ee/specifications/persistence/3.2/apidocs/jakarta.persistence/jakarta/persistence/storedprocedurequery) — doc
- [Jakarta Persistence API — NamedStoredProcedureQuery](https://jakarta.ee/specifications/persistence/3.2/apidocs/jakarta.persistence/jakarta/persistence/namedstoredprocedurequery) — doc
- [Thorben Janssen — JPQL, Criteria API and Native Queries (Coffee with Thorben)](https://thorben-janssen.com/coffee-with-thorben/) — doc
