---
version: 1.0
updatedAt: 2026-08-22
---
## Objective

Most applications get by with a single, implicit persistence unit backed by the default datasource. But when an application needs to talk to more than one database — a `users` store and a separate `inventory` store, for example — Quarkus lets you declare additional *named* persistence units, each bound to its own datasource, its own set of entity packages, and its own schema/cache/tenancy configuration. This concept covers how to declare named persistence units and datasources together, how to attach model classes to the right unit, and how to inject and extend each unit from CDI.

## Use Cases

- An application that must read/write two logically separate databases (e.g. a legacy system and a new microservice-owned schema) from the same deployable.
- Splitting entities by bounded context so each persistence unit only sees the packages relevant to it, keeping schema generation and caching scoped correctly.
- Registering per-unit customizations (interceptors, statement inspectors, tenant resolvers) without them leaking into every other unit in the application.
- Selectively activating/deactivating a persistence unit (and its backing datasource) per environment.

## Deep Dive

### Declaring named datasources and persistence units together

Each named persistence unit needs a named datasource to sit on top of, plus a `packages` scope so Hibernate knows which entities belong to it:

```properties
# Datasource definitions
quarkus.datasource."users".db-kind=h2
quarkus.datasource."users".jdbc.url=jdbc:h2:mem:users;DB_CLOSE_DELAY=-1

quarkus.datasource."inventory".db-kind=h2
quarkus.datasource."inventory".jdbc.url=jdbc:h2:mem:inventory;DB_CLOSE_DELAY=-1

# Persistence unit configuration
quarkus.hibernate-orm."users".datasource=users
quarkus.hibernate-orm."users".packages=org.acme.model.user

quarkus.hibernate-orm."inventory".datasource=inventory
quarkus.hibernate-orm."inventory".packages=org.acme.model.inventory
```

The default (unnamed) persistence unit can still coexist and gets its own package scope:

```properties
quarkus.hibernate-orm.packages=org.acme.model.defaultpu
quarkus.hibernate-orm."users".packages=org.acme.model.shared,org.acme.model.user
```

Here, model classes under both `org.acme.model.shared` and `org.acme.model.user` end up attached to the `users` unit.

### Attaching entities with `@PersistenceUnit` at the package level

Instead of (or in addition to) the `packages` property, you can annotate a `package-info.java` to declare which unit its classes belong to:

```java
@PersistenceUnit("users")
package org.acme.model.user;

import io.quarkus.hibernate.orm.PersistenceUnit;
```

This must be `io.quarkus.hibernate.orm.PersistenceUnit` — not the Jakarta Persistence annotation of a similar name — since it's a Quarkus-specific mechanism for routing entities to a named unit.

### Injecting a named unit's resources via CDI

Once a unit is declared, qualify any injection point with `@PersistenceUnit("name")` to get the components scoped to that specific unit:

```java
@Inject
@PersistenceUnit("users")
EntityManager entityManager;

@Inject
@PersistenceUnit("users")
EntityManagerFactory entityManagerFactory;
```

The same qualifier works for other injectable, per-unit components: `CriteriaBuilder`, `HibernateCriteriaBuilder`, `Metamodel`, `jakarta.persistence.Cache`, `org.hibernate.Cache`, `jakarta.persistence.PersistenceUnitUtil`, and both the Jakarta and Hibernate flavors of `SchemaManager`.

### Registering per-unit extensions with `@PersistenceUnitExtension`

Custom Hibernate SPI implementations (interceptors, statement inspectors, tenant resolvers, and more) can be scoped to a single unit by annotating the bean class:

```java
@PersistenceUnitExtension("users")
public class CustomComponent implements TenantResolver {
    // Implementation
}
```

Supported component types include `org.hibernate.Interceptor`, `org.hibernate.resource.jdbc.spi.StatementInspector`, `org.hibernate.type.format.FormatMapper`, `io.quarkus.hibernate.orm.runtime.tenant.TenantResolver`, `io.quarkus.hibernate.orm.runtime.tenant.TenantConnectionResolver`, `org.hibernate.boot.model.FunctionContributor`, and `org.hibernate.boot.model.TypeContributor`.

### Deactivating a persistence unit

A named unit (and its datasource) can be turned off entirely, typically per-profile:

```properties
quarkus.hibernate-orm."pg".active=false
quarkus.datasource."pg".active=false
```

When deactivated, the SessionFactory for that unit never starts, and any CDI injection point qualified for it fails — so deactivation should be paired with removing or conditionally disabling the code paths that depend on it.

## Trade-offs

- **Multiple units mean multiple things to keep environment-consistent** — each named unit has its own schema-management, caching, and datasource settings, so environment-specific config (`%dev`/`%prod`) has to be duplicated per unit rather than set once.
- **Package scoping is easy to get subtly wrong** — an entity that isn't covered by any unit's `packages` (or `@PersistenceUnit` package annotation) silently won't be picked up by that unit.
- **`@PersistenceUnitExtension` couples a component to one unit** — convenient for isolation, but if the same behavior (e.g. a `StatementInspector`) is needed across several units, it must be registered separately for each.
- **Deactivating a unit is an all-or-nothing switch** — any bean requiring `@PersistenceUnit("name")` for a deactivated unit fails at injection time, so deactivation needs to be coordinated with the rest of the deployment's config, not just flipped in isolation.
  ```properties
  quarkus.hibernate-orm."pg".active=false
  ```

## Documentation Links

- [Hibernate ORM guide — Quarkus](https://quarkus.io/guides/hibernate-orm) — source guide covering named persistence units, `quarkus.hibernate-orm."name".*` properties, `@PersistenceUnit`, and `@PersistenceUnitExtension`.
