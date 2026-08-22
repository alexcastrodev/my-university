---
version: 1.0
updatedAt: 2026-08-22
---
## Objective

Hibernate Envers is Hibernate ORM's built-in auditing and versioning module: annotate an entity (or specific fields) with `@Audited` and Envers transparently maintains a shadow "audit table" per audited entity, writing one row per revision every time the entity changes. In Quarkus, the `quarkus-hibernate-envers` extension wires this module into the Hibernate ORM extension with no additional configuration required — you add the dependency, annotate your entities, and Envers starts recording history alongside your normal transactional data.

## Use Cases

- Regulatory or compliance audit trails (who changed what, and when) for financial, healthcare, or HR data.
- Reconstructing the state of an entity as it looked at an arbitrary point in the past, for debugging or dispute resolution.
- Tracking the full change history of a record (every intermediate value, not just the current one) without hand-rolling audit columns and triggers.
- Attaching custom metadata to each change — the acting user, a request ID, a reason code — by extending the revision entity itself.

## Deep Dive

### Adding the extension and auditing an entity

Add the extension:

```xml
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-hibernate-envers</artifactId>
</dependency>
```

Then mark the entity (or just the fields you care about) with `@Audited`:

```java
@Entity
public class Person {

    @Id
    @GeneratedValue
    private Integer id;

    @Audited
    private String name;

    @Audited
    private String surname;

    @Audited
    @ManyToOne
    private Address address;
}
```

The extension "integrates automatically with Quarkus without requiring additional configuration properties" — there is no `quarkus.hibernate-envers.*` namespace to turn it on. Once the dependency is present and at least one entity is `@Audited`, Envers creates a companion `_AUD` table (e.g. `person_AUD`) for each audited entity and populates it on every insert, update, and delete.

### Revision entities

Every change Envers records is grouped into a *revision* — one row in a revision table shared by all audited entities. By default this is Envers' built-in default revision entity, but you can define your own to attach custom metadata (an acting username, IP address, etc.) using the core Hibernate Envers annotations:

```java
@Entity
@RevisionEntity
public class CustomRevisionEntity {

    @Id
    @GeneratedValue
    @RevisionNumber
    private int id;

    @RevisionTimestamp
    private long timestamp;

    private String username;
}
```

`@RevisionNumber` marks the field that stores the monotonically increasing revision id, and `@RevisionTimestamp` marks the field Envers stamps with the wall-clock time of the revision. Fields that should *not* be tracked at all — even on an otherwise `@Audited` entity — are marked `@NotAudited`.

### Querying history with AuditReader

History is queried through the `AuditReader` API, obtained from the JPA `EntityManager` via `AuditReaderFactory`:

```java
AuditReader reader = AuditReaderFactory.get(entityManager);

// the entity as it looked at a specific revision
Person historicPerson = reader.find(Person.class, personId, revisionNumber);

// every revision number at which this entity changed
List<Number> revisions = reader.getRevisions(Person.class, personId);

// a full query API for filtering by revision, property, or date range
List<?> results = reader.createQuery()
        .forRevisionsOfEntity(Person.class, false, true)
        .getResultList();
```

This lets you reconstruct any past version of an entity, list every revision that touched it, or query for revisions where a given property changed — all without writing manual history-tracking SQL.

### Tuning Envers behavior

Because the Quarkus extension itself exposes no dedicated configuration properties, native Hibernate Envers settings (all under the `org.hibernate.envers.*` namespace, such as `audit_table_suffix` — the suffix used for generated audit tables, `_AUD` by default — or `store_data_at_delete`) are passed through Quarkus's escape hatch for raw Hibernate properties, `quarkus.hibernate-orm.unsupported-properties`, on the persistence unit you want to affect:

```properties
quarkus.hibernate-orm.unsupported-properties."org.hibernate.envers.audit_table_suffix"=_history
```

## Trade-offs

- **Every audited write becomes two writes** — an insert/update/delete on the base table plus a row in its `_AUD` table, so high-frequency writes on heavily audited entities add measurable overhead.
- **Storage grows without bound by default** — Envers never prunes old revisions; a retention/archival strategy for audit tables is a separate concern you must own.
- **Schema evolution touches two tables** — adding, renaming, or removing an audited column means the audit table's schema (and any Flyway/Liquibase migration) has to be kept in sync alongside the base entity.
- **No dedicated Quarkus configuration surface** — since the extension "does not expose additional configuration properties," anything beyond the defaults (custom revision entities aside) requires reaching into `unsupported-properties`, which is a less discoverable, less stable escape hatch than a first-class `quarkus.*` key.
- **Extension is marked experimental** in the Quarkus extension catalog, so its configuration surface and guarantees may still change between releases.

## Documentation Links

- [Using Hibernate ORM and Jakarta Persistence — Envers section](https://quarkus.io/guides/hibernate-orm) — Quarkus guide covering the `quarkus-hibernate-envers` extension and `@Audited`.
- [Hibernate Envers](https://hibernate.org/orm/envers/) — official Hibernate Envers overview, `@Audited` usage, and `AuditReader` capabilities.
