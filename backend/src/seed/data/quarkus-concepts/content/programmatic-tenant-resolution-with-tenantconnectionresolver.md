---
version: 1.0
updatedAt: 2026-08-22
---
## Objective

`TenantConnectionResolver` is the escape hatch for multitenancy scenarios that the static `SCHEMA`/`DATABASE`/`DISCRIMINATOR` strategies can't cover: instead of routing to a fixed, pre-configured set of schemas or datasources, you supply Hibernate with a JDBC connection provider computed programmatically, per tenant id, at runtime — for example by looking the tenant's connection details up in a database or a service registry rather than in `application.properties`.

## Use Cases

- Tenant connection details (host, credentials, database name) that are stored in a control-plane database and can change without a redeploy.
- A dynamically growing set of tenants, where new tenants are onboarded at runtime and can't be enumerated as static named datasources ahead of time.
- Per-tenant connection pooling or routing logic that goes beyond what a fixed `DATABASE` multitenancy configuration can express (e.g. resolving a physical shard from a tenant id via a lookup service).

## Deep Dive

### Implementing the resolver

The interface lives at `io.quarkus.hibernate.orm.runtime.tenant.TenantConnectionResolver`. Its single method, `resolve(String tenantId)`, returns a `ConnectionProvider` for that tenant — this "enables examples to read tenant information from a database and create a connection per tenant at runtime":

```java
@ApplicationScoped
@PersistenceUnitExtension
public class ExampleTenantConnectionResolver
        implements TenantConnectionResolver {

    @Override
    public ConnectionProvider resolve(String tenantId) {
        return new YourOwnCustomConnectionProviderImpl(
                createDatasource(tenantId));
    }
}
```

Unlike the request-scoped `TenantResolver` (which only answers "which tenant is this request for?"), `TenantConnectionResolver` answers "given a tenant id, how do I actually connect to its data?" — it owns the connection provider construction itself, so it's the right place to put logic like looking up connection details in a registry, lazily building a connection pool per tenant, or caching provisioned datasources.

### Registering it as a bean

The bean is application-scoped (one resolver instance for the whole application, since it's the connection *providers* that vary per tenant, not the resolver itself) and annotated `@PersistenceUnitExtension` so Quarkus wires it into the Hibernate ORM extension's tenant resolution machinery for the targeted persistence unit, the same qualifier pattern used for custom `TenantResolver`, `Interceptor`, and `StatementInspector` beans.

### Relationship to the built-in strategies

`TenantConnectionResolver` is typically paired with `quarkus.hibernate-orm.multitenant=DATABASE`-style tenancy, but where `DATABASE` alone expects each tenant's datasource to be named and statically configured up front, plugging in a `TenantConnectionResolver` replaces that static configuration with code — the resolver decides at call time how to obtain (or build) the `ConnectionProvider` for a tenant id it has never seen configured in `application.properties`.

## Trade-offs

- **You own connection lifecycle correctness** — with static `DATABASE` multitenancy, Quarkus manages datasource creation and pooling; with `TenantConnectionResolver` you're responsible for constructing (and ideally caching/reusing) `ConnectionProvider` instances yourself, including pool sizing and cleanup.
- **More flexible, less validated at build time** — a misconfigured static datasource fails fast at startup; a bug in a programmatic resolver may only surface when a specific tenant id is first requested at runtime.
- **Still needs a tenant id from somewhere** — `TenantConnectionResolver` resolves a *connection* for a given tenant id, but something else (typically a request-scoped `TenantResolver`) still has to determine *which* tenant id applies to the current request.
- **Caching is a deliberate design decision** — resolving/constructing a new connection provider on every call is wasteful if tenant connection details are stable; most real implementations cache providers keyed by tenant id, which then introduces its own invalidation question when a tenant's connection details change.

## Documentation Links

- [Using Hibernate ORM and Jakarta Persistence — Programmatically Resolving Tenant Connections](https://quarkus.io/guides/hibernate-orm) — Quarkus guide covering `TenantConnectionResolver` and its `resolve(String tenantId)` method.

