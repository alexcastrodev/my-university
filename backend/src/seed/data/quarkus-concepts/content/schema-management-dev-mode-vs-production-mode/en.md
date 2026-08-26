---
version: 1.0
updatedAt: 2026-08-22
---
## Objective

Hibernate ORM can manage your database schema for you — creating it, dropping it, updating it incrementally, or just validating it against your entities — and Quarkus exposes this through a single `quarkus.hibernate-orm.schema-management.strategy` property. The strategy that makes sense while iterating locally (recreate everything on every change) is exactly the strategy that will destroy data in production, so Quarkus's config-profile system (`%dev`, `%prod`) is the mechanism for keeping these two worlds cleanly separated in one codebase.

## Use Cases

- Local development where entity changes should be reflected in the schema immediately, without manual migration scripts.
- Seeding a known, repeatable dataset for manual testing or demos via `import.sql`.
- Production deployments where schema changes must go through a controlled, auditable migration tool rather than Hibernate auto-generation.
- Verifying, at startup, that a target database's schema actually matches what the entity model expects (`validate`) before allowing the application to serve traffic.

## Deep Dive

### The schema management strategies

All schema strategies are controlled through one property:

```properties
quarkus.hibernate-orm.schema-management.strategy=[strategy]
```

Available values:

- `none` — no automatic schema management at all.
- `create` — create the schema on startup (fails if it already exists / doesn't handle drops).
- `drop-and-create` — drop the schema, then create it fresh, on every startup.
- `drop` — just drop the schema on startup.
- `update` — incrementally alter the existing schema to match the entity model.
- `validate` — compare the existing schema against the entity model and fail startup if they don't match, without changing anything.

### Dev mode: recreate schema and reload fixture data on every change

In development, Hibernate ORM benefits from datasource Dev Services, so there's often nothing to configure for the connection itself — Quarkus spins up a matching database container automatically. The idiomatic dev setup pairs `drop-and-create` with a SQL fixture file:

```properties
%dev.quarkus.hibernate-orm.schema-management.strategy = drop-and-create
%dev.quarkus.hibernate-orm.sql-load-script = import-dev.sql
```

This is what makes Quarkus's live reload feel "magic" for persistence code: any change to an entity, or to `import.sql`, is picked up and the schema is recreated and repopulated without restarting the application.

### Loading SQL fixtures with `sql-load-script`

To load SQL statements when Hibernate ORM starts, add an `import.sql` file to the root of the `resources` directory — Quarkus picks it up automatically. To point at a different file, or disable loading entirely:

```properties
quarkus.hibernate-orm.sql-load-script=custom-import.sql
quarkus.hibernate-orm.sql-load-script=no-file
```

### Production mode: hands off, let a migration tool own the schema

In production, the recommendation is the opposite of dev mode — don't let Hibernate touch the schema at all, and don't load a dev-only fixture file:

```properties
%prod.quarkus.hibernate-orm.schema-management.strategy = none
%prod.quarkus.hibernate-orm.sql-load-script = no-file
```

The guide is explicit about this: do not set `schema-management.strategy` to `drop-and-create` or `update` in a production environment — schema evolution there should go through a real migration tool (see Flyway integration).

### Layering additional profiles for finer control

Because this is ordinary Quarkus profile-based config, you can define more granular profiles beyond just `%dev`/`%prod` — for example, a profile that runs against a *copy* of production data while still auto-updating the schema:

```properties
%dev.quarkus.hibernate-orm.schema-management.strategy = drop-and-create
%dev-with-data.quarkus.hibernate-orm.schema-management.strategy = update
%prod.quarkus.hibernate-orm.schema-management.strategy = none
```

Activated with `quarkus dev -Dquarkus.profile=dev-with-data`. This gives three distinct dev-time postures: `drop-and-create` + `import.sql` for a from-scratch fixture on every change; `update` when you need many entity changes but want to preserve a working copy of production-like data; and `none` (paired with a migration tool) when you want full control over schema evolution even locally.

## Trade-offs

- **`drop-and-create` guarantees a clean, reproducible schema but destroys all data on every restart** — fine for dev/test, never acceptable once real data exists.
  ```properties
  %dev.quarkus.hibernate-orm.schema-management.strategy = drop-and-create
  ```
- **`update` preserves data but its inference logic is best-effort** — it can add columns/tables it detects are missing, but it's not a reliable tool for renames, type changes, or drops, and its behavior isn't something you want to depend on outside local development.
- **`none` is the only production-safe choice, but it means Hibernate does nothing for you** — schema evolution must be handled entirely by an external tool (e.g. Flyway), which is more setup upfront in exchange for auditable, versioned migrations.
- **Profile-based overrides are easy to get backwards** — forgetting the `%prod.` prefix on a strategy override means the unprefixed (often dev-oriented) value silently applies everywhere, including production.
- **`validate` catches drift but requires the schema to already be right** — it's a safety check, not a way to get from "no schema" to "correct schema"; it has to be paired with a real migration step.

## Documentation Links

- [Hibernate ORM guide — Quarkus](https://quarkus.io/guides/hibernate-orm) — source guide covering `schema-management.strategy` values, `sql-load-script`/`import.sql`, and `%dev`/`%prod` profile recommendations.
