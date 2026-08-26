---
version: 1.0
updatedAt: 2026-08-22
---
## Objective

Hibernate ORM needs to know which SQL dialect and which specific database version it is talking to before it can generate optimal, feature-aware SQL. Quarkus removes almost all of this ceremony: for supported databases it auto-detects the dialect straight from your datasource configuration, and it lets you pin the exact database version so Hibernate can use newer syntax and functions instead of falling back to the lowest common denominator. This concept covers how that auto-detection works, when and how to override it, and how Quarkus protects you from a mismatch between the version you declared and the version you actually connect to.

## Use Cases

- Running against a mainstream, well-supported database (PostgreSQL, MySQL, etc.) and wanting zero-config dialect selection.
- Pinning `db-version` so Hibernate emits SQL that takes advantage of a specific database release's features (e.g. newer window functions, upsert syntax) instead of the conservative default.
- Connecting to a database Hibernate doesn't ship a built-in dialect for, or one that needs a custom/third-party dialect class.
- Guarding a production deployment against silently running with the wrong assumed database version after an infra change.

## Deep Dive

### Auto-detection from the datasource

For supported databases, Quarkus infers the dialect purely from `quarkus.datasource.db-kind` — there is nothing dialect-specific to configure:

```properties
quarkus.datasource.db-kind = postgresql
```

By default, the dialect Hibernate picks targets the *minimum* supported version of that database kind, which is the safest but not necessarily the most efficient choice.

### Targeting a specific database version

To get more efficient, version-aware SQL generation, tell Quarkus which version you actually run:

```properties
quarkus.datasource.db-kind = postgresql
quarkus.datasource.db-version = 18.1
```

As a rule, set this as high as possible, but it must stay lower than or equal to the version of every database instance the application will actually connect to — the version you declare is a *floor* Hibernate is allowed to assume, not just documentation.

### Explicit dialect override

When you're on a database Quarkus doesn't auto-detect, or you need a custom dialect, set it directly:

```properties
quarkus.hibernate-orm.dialect=Cockroach
```

For built-in dialects, the value is the name from Hibernate's official dialect list *without* the `Dialect` suffix — `Cockroach` maps to `CockroachDialect`. For a third-party or custom dialect, use the fully-qualified class name instead:

```properties
quarkus.hibernate-orm.dialect=com.acme.hibernate.AcmeDbDialect
```

### Startup version checking

Quarkus doesn't just trust the version you configured — by default it validates the *actual* connected database's version against it at startup, and fails fast if the real database is older than what you declared. This catches the class of bug where SQL generated for a newer version silently breaks at runtime on an older instance:

```properties
quarkus.hibernate-orm.database.version-check.enabled=false
```

Turning this off removes the safety net; only do it if you have another way of guaranteeing the version contract holds.

## Trade-offs

- **Declaring a higher `db-version` unlocks better SQL but raises the floor** — if you later have to support an older database instance than the version you configured, Hibernate may emit SQL that instance can't run.
  ```properties
  quarkus.datasource.db-version = 18.1
  ```
- **Disabling version-check trades safety for flexibility** — useful for edge cases like connecting to slightly divergent forks/managed variants of a database, but it removes an automatic guard against version drift.
- **Auto-detection is convenient but opaque** — relying on it means the effective dialect isn't visible anywhere in your config; an explicit `dialect` setting is more verbose but self-documenting and necessary for anything outside the supported list.
- **Third-party dialects are an escape hatch, not a first-class path** — they work, but you're now responsible for keeping that dialect class compatible across Hibernate ORM upgrades that Quarkus itself ships.

## Documentation Links

- [Hibernate ORM guide — Quarkus](https://quarkus.io/guides/hibernate-orm) — source guide covering dialect auto-detection, `db-version`, explicit `quarkus.hibernate-orm.dialect`, and `database.version-check.enabled`.
