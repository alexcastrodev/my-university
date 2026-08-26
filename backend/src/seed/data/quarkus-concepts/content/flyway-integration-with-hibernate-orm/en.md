---
version: 1.0
updatedAt: 2026-08-22
---
## Objective

Flyway is Quarkus's answer to a question Hibernate's own schema generation can't safely answer on its own: how do you get a versioned, repeatable migration history out of an entity model that keeps changing? Instead of hand-writing SQL migrations from scratch, Quarkus lets Hibernate ORM generate the schema SQL in dev mode and hands that SQL to Flyway as the seed for a proper migration file, then steps out of the way so Flyway owns schema evolution in every other environment.

## Use Cases

- Bootstrapping the first migration (`V1.0.0__...sql`) for a new project straight from your JPA entities instead of transcribing DDL by hand.
- Generating incremental migration drafts after adding a column, table, or index to an entity, without diffing the database yourself.
- Running Hibernate ORM with `database.generation=none` in production while Flyway applies versioned migrations on startup — the standard "Hibernate never touches production schema" setup.
- Keeping schema management sane under multitenancy, where Hibernate's own DDL generation isn't supported and Flyway has to be the one to initialize tenant schemas/databases.

## Deep Dive

### Generating the initial migration from Hibernate's DDL

With the `quarkus-flyway` extension on the classpath, the Dev UI exposes a "Create Initial Migration" action. It takes the DDL Hibernate ORM would generate from your current entity model and writes it out as a real migration file:

```
src/main/resources/db/migration/V1.0.0__MyApp.sql
```

That single action also wires up the properties needed to make Flyway actually apply it automatically:

```properties
quarkus.flyway.baseline-on-migrate=true
quarkus.flyway.migrate-at-start=true

%dev.quarkus.flyway.clean-at-start=true
%test.quarkus.flyway.clean-at-start=true
```

`baseline-on-migrate` tells Flyway to treat an existing, non-empty database as already being at a baseline version rather than failing because there's no migration history table yet. `migrate-at-start` runs pending migrations automatically when the application boots, which is what makes this useful for dev/test loops. The `clean-at-start` flags are scoped per-profile (`%dev`, `%test`) so a clean slate on every restart never leaks into production configuration.

### Generating incremental migrations as entities evolve

Once the first migration exists, the Dev UI's "Generate Migration File" action produces a new draft migration whenever the entity model has drifted from what the last migration created. The naming follows a simple versioning convention: the major version is taken from the last existing migration, and the minor/patch portion is derived from the current timestamp, so successive drafts sort correctly and never collide:

```
V1.1.1692650000__MyApp.sql
```

This is a workflow aid, not a magic diffing engine — the generated SQL still needs to be reviewed before it's committed, the same way you'd review any hand-written migration.

### Letting Flyway own the schema instead of Hibernate

The typical division of labor is: Hibernate ORM only generates schema in dev mode to seed migrations, and in every real environment schema changes come from Flyway migrations:

```properties
%dev.quarkus.hibernate-orm.database.generation=none
quarkus.flyway.migrate-at-start=true
```

Hibernate's `database.generation` values (`none`, `create`, `drop-and-create`, `update`, `validate`) and Flyway's migration engine are not meant to run against the same schema changes at the same time — letting Hibernate auto-generate DDL while Flyway also migrates the same tables is how you get drift and startup failures. The safe pattern is: Hibernate generates SQL only to *produce* migration files, Flyway is the only thing that *applies* schema changes at runtime.

### Flyway under multitenancy

When a persistence unit uses schema-based or database-based multitenancy, Hibernate ORM's own schema management can't be used — the guide is explicit that it "is not supported by Hibernate ORM for schema multi-tenancy." In that setup, `quarkus.hibernate-orm.schema-management.strategy` must be set to `none`, and Flyway (run once per tenant schema/database, typically as part of tenant provisioning) becomes the only mechanism initializing and evolving the schema:

```properties
quarkus.hibernate-orm.schema-management.strategy=none
```

## Trade-offs

- **Generated migrations are a starting point, not a final answer** — the SQL Hibernate emits is a reasonable first draft, but reviewing and hand-tuning it (indexes, constraints, data-preserving `ALTER` vs `DROP`/`CREATE`) before committing is still on you.
- **Mixing Hibernate auto-DDL and Flyway is the trap** — running `quarkus.hibernate-orm.database.generation=update` alongside active Flyway migrations against the same schema invites conflicting changes; pick one owner per environment.
  ```properties
  %dev.quarkus.hibernate-orm.database.generation=none
  ```
- **Multitenancy forces Flyway's hand** — schema/database multitenancy strategies can't rely on Hibernate schema management at all, so Flyway (or an equivalent external tool) is mandatory, not optional, there.
- **`clean-at-start` is a dev/test-only convenience** — it's easy to copy a config snippet without noticing it's profile-scoped; an unscoped `clean-at-start=true` reaching production would drop the schema on every deploy.
- **Dev UI generation is a manual trigger** — it doesn't run automatically on every entity change, so it's easy to forget to regenerate a migration after a schema-affecting refactor and have dev-mode and migration history quietly diverge.

## Documentation Links

- [Hibernate ORM guide — Flyway integration](https://quarkus.io/guides/hibernate-orm) — source guide covering the Dev UI migration generation workflow and multitenancy schema-management interaction.
- [Quarkus Flyway guide](https://quarkus.io/guides/flyway) — dedicated documentation for `quarkus.flyway.*` configuration properties.
