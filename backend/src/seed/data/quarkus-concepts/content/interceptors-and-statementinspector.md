---
version: 1.0
updatedAt: 2026-08-22
---
## Objective

Hibernate exposes two low-level extension points for hooking into what it's doing under the hood: `org.hibernate.Interceptor`, which is called on entity lifecycle events (load, save, flush, and more), and `org.hibernate.engine.jdbc.spi.StatementInspector`, which is called with every SQL statement Hibernate is about to execute. In Quarkus, both are plugged in the same way — as a CDI bean annotated `@PersistenceUnitExtension` — letting you observe or rewrite Hibernate's behavior without touching the entities or the queries themselves.

## Use Cases

- Cross-cutting audit logging that needs entity-level lifecycle hooks rather than SQL-level logging (`Interceptor`).
- Automatically stamping fields (e.g. a "last modified by" column) on entity load/save without repeating logic across every entity (`Interceptor`).
- Logging, redacting, or rewriting the exact SQL Hibernate sends to the database for debugging or compliance (`StatementInspector`).
- Injecting a comment or hint into generated SQL (e.g. for tracing which code path issued a query) without modifying every query in the codebase (`StatementInspector`).

## Deep Dive

### Implementing an Interceptor

Implement `org.hibernate.Interceptor` and override the lifecycle callback(s) you need — here, `onLoad`, which fires when an entity is loaded:

```java
@PersistenceUnitExtension
public static class MyInterceptor implements Interceptor {

    @Override
    public boolean onLoad(Object entity, Object id,
            Object[] state, String[] propertyNames, Type[] types) {
        // implementation
        return false;
    }
}
```

Registration is purely by CDI bean discovery plus the `@PersistenceUnitExtension` qualifier — there is no separate `quarkus.hibernate-orm.interceptor` property to set; declaring the bean is enough for Quarkus to wire it into the targeted persistence unit.

### Interceptor bean scope: application vs. per-entity-manager

Beans are application-scoped by default, meaning a single `Interceptor` instance is shared across the whole application — which means it must be thread-safe if it holds any state. If you need one interceptor instance per entity manager instead (for example, to safely accumulate per-session state), declare the bean `@Dependent` so Quarkus creates a fresh instance per entity manager rather than sharing one:

```java
@Dependent
@PersistenceUnitExtension
public class PerSessionInterceptor implements Interceptor {
    // safe to hold per-session mutable state here
}
```

### Implementing a StatementInspector

`StatementInspector` gets a look at every SQL string right before Hibernate executes it, and can return a modified string to change what actually runs:

```java
@PersistenceUnitExtension
public class MyStatementInspector implements StatementInspector {

    @Override
    public String inspect(String sql) {
        return sql;
    }
}
```

Because `inspect` returns the SQL that is actually executed, this is the hook point for both passive inspection (logging every statement) and active rewriting (appending a comment, adjusting a hint) — whatever the method returns replaces what Hibernate sends to the JDBC driver.

### Registration pattern shared across both

Both `Interceptor` and `StatementInspector` beans are wired the same way: declare the class as a CDI bean and annotate it `@PersistenceUnitExtension` (optionally scoped to a named persistence unit in multi-persistence-unit setups). This is the same qualifier pattern used elsewhere in the Hibernate ORM extension for pluggable components like `TenantResolver` and `TenantConnectionResolver` — Quarkus discovers the bean and hands it to the corresponding persistence unit's Hibernate configuration automatically, with no matching `quarkus.hibernate-orm.*` property required.

## Trade-offs

- **Application-scoped by default means shared state is dangerous** — an `Interceptor` bean without `@Dependent` is a single instance serving every entity manager concurrently, so any mutable field must be handled with the same care as a singleton service.
- **`StatementInspector` operates on raw SQL strings** — rewriting SQL by string manipulation is fragile compared to modifying the query at the JPQL/Criteria level; a change in Hibernate's generated SQL shape between versions can silently break a hand-written inspection/rewrite rule.
- **Both hooks run on the hot path of every persistence operation** — an `Interceptor` callback or a `StatementInspector.inspect()` call adds overhead to every load/save or every SQL statement respectively, so expensive logic here (network calls, heavy logging) has an outsized performance cost.
- **No dedicated `quarkus.*` configuration property** — registration is entirely via bean discovery and the `@PersistenceUnitExtension` qualifier, which means there's no config-only way to toggle these hooks on or off per environment; enabling/disabling means changing code (e.g. conditionally producing the bean).

## Documentation Links

- [Using Hibernate ORM and Jakarta Persistence — Interceptors and Statement Inspectors](https://quarkus.io/guides/hibernate-orm) — Quarkus guide covering the `Interceptor` and `StatementInspector` extension points and the `@PersistenceUnitExtension` registration pattern.
