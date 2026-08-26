---
version: 1.0
updatedAt: 2026-08-22
---
## Objective

Multitenancy in Quarkus's Hibernate ORM extension lets a single application serve multiple tenants — separate customers, organizations, or environments — while keeping their data isolated at the persistence layer. Quarkus supports three strategies, selected with `quarkus.hibernate-orm.multitenant`: `SCHEMA` (one datasource, one schema per tenant), `DATABASE` (one datasource per tenant), and `DISCRIMINATOR` (one datasource, one table, a column that tags each row's tenant). Which one to use is primarily a trade-off between isolation strength and operational simplicity.

## Use Cases

- SaaS products where each customer's data must never leak into another customer's queries.
- Regulatory requirements that mandate physical data separation per tenant (favors `DATABASE`).
- Multi-environment or multi-region deployments sharing one application codebase but needing per-tenant schema versions (favors `SCHEMA`).
- Low-overhead tenancy for a large number of small tenants where provisioning a schema or database per tenant would not scale operationally (favors `DISCRIMINATOR`).

## Deep Dive

### Selecting a strategy and resolving the tenant

The strategy is a single top-level property:

```properties
quarkus.hibernate-orm.multitenant=SCHEMA
```

Values are `SCHEMA`, `DATABASE`, or `DISCRIMINATOR`. Whichever strategy is chosen, Hibernate still needs to know *which* tenant is active for the current request. That's the job of a `TenantResolver`, implemented against `io.quarkus.hibernate.orm.runtime.tenant.TenantResolver` and registered as a request-scoped bean (tenant resolution depends on the incoming request, e.g. a header, subdomain, or JWT claim):

```java
@PersistenceUnitExtension
@RequestScoped
public class CustomTenantResolver implements TenantResolver {

    @Override
    public String getDefaultTenantId() {
        return "base";
    }

    @Override
    public String resolveTenantId() {
        // e.g. inspect the current request to determine the tenant
        return currentTenant();
    }
}
```

### SCHEMA approach

```properties
quarkus.hibernate-orm.multitenant=SCHEMA
```

A single datasource is shared by all tenants, but each tenant gets its own database schema within it — Hibernate switches the active schema per request based on the resolved tenant id. Because Hibernate's own schema generation isn't multitenancy-aware, schema creation is delegated to Flyway, migrating each tenant schema independently:

```properties
quarkus.hibernate-orm.schema-management.strategy=none
quarkus.flyway.schemas=base,mycompany
quarkus.flyway.locations=classpath:schema
quarkus.flyway.migrate-at-start=true
```

### DATABASE approach

```properties
quarkus.hibernate-orm.multitenant=DATABASE
```

Here tenants are fully separate datasources rather than schemas within one datasource. For every tenant you create a named datasource whose identifier matches exactly what the `TenantResolver` returns for that tenant, and Hibernate routes to the matching datasource at runtime. This gives the strongest isolation of the three strategies (separate connections, separate connection pools, potentially separate physical databases) at the cost of a fixed, statically-configured set of tenants known at build/deploy time.

### DISCRIMINATOR approach

```properties
quarkus.hibernate-orm.multitenant=DISCRIMINATOR
```

All tenants share one datasource and one physical schema; isolation is enforced at the row level via a discriminator column. Entities declare which field carries the tenant identity with `@TenantId`:

```java
@Entity
public class Order {

    @Id
    @GeneratedValue
    private Long id;

    @TenantId
    private String tenantId;

    // ...
}
```

The `@TenantId` field is "populated automatically, and will get filtered automatically in queries" — application code never has to add a `WHERE tenant_id = ...` clause manually; Hibernate injects it transparently. This is the cheapest strategy to operate (no per-tenant schema or datasource provisioning) but the weakest isolation, since a bug that bypasses Hibernate's filtering could cross tenant boundaries at the SQL level.

## Trade-offs

- **Isolation vs. operational cost** — `DATABASE` gives the strongest tenant isolation but requires provisioning and configuring a real datasource per tenant ahead of time; `DISCRIMINATOR` is nearly free to provision but relies entirely on Hibernate's automatic filtering being correct and never bypassed by raw SQL.
- **Fixed tenant set for SCHEMA/DATABASE** — both require the tenant's schema or datasource to exist and be configured before it can be used, so onboarding a new tenant is a deployment/migration step, not something resolved purely at request time.
- **Hibernate schema generation is disabled under SCHEMA** — `quarkus.hibernate-orm.schema-management.strategy=none` is required, pushing all schema lifecycle management onto Flyway, one schema migration set per tenant.
- **DISCRIMINATOR couples every query to correct filtering** — a native query, a bulk update, or any code path that skips the Hibernate session-level filter risks leaking or corrupting another tenant's rows.
- **Tenant resolution is a separate, request-scoped concern from the strategy itself** — choosing SCHEMA/DATABASE/DISCRIMINATOR only decides *how* isolation is enforced; you must still implement `TenantResolver` (or, for dynamic per-tenant connections, `TenantConnectionResolver`) to decide *which* tenant applies to the current request.

## Documentation Links

- [Using Hibernate ORM and Jakarta Persistence — Multitenancy section](https://quarkus.io/guides/hibernate-orm) — Quarkus guide covering `quarkus.hibernate-orm.multitenant`, the SCHEMA/DATABASE/DISCRIMINATOR approaches, and `TenantResolver`.
