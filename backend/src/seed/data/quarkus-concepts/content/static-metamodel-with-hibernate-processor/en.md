---
version: 1.0
updatedAt: 2026-08-22
---
## Objective

The static metamodel is Hibernate's way of turning entity field names into compile-time-checked symbols instead of error-prone string literals. The `hibernate-processor` annotation processor scans your `@Entity` classes at compile time and generates a companion class per entity (conventionally suffixed `_`), whose static fields mirror the entity's persistent attributes — so a Criteria API query can reference `MyEntity_.name` instead of the string `"name"`, and a typo becomes a compile error instead of a runtime `IllegalArgumentException`.

## Use Cases

- Building `CriteriaBuilder` queries where attribute names need to survive refactors — rename a field, get a compile error at every query that referenced it, instead of a silent runtime failure.
- Any codebase with more than a handful of Criteria API queries, where string-based attribute references become a maintenance liability.
- Teams that want IDE autocomplete for entity attributes when constructing dynamic, programmatically-built queries.

## Deep Dive

### Enabling the processor in the build

The metamodel isn't generated automatically just because Hibernate ORM is on the classpath — `hibernate-processor` has to be registered explicitly as an annotation processor. For Maven, it's added to the `maven-compiler-plugin` configuration, with dependency management enforced so the processor version tracks the Hibernate ORM version Quarkus manages:

```xml
<plugin>
    <artifactId>maven-compiler-plugin</artifactId>
    <configuration>
        <annotationProcessorPaths>
            <path>
                <groupId>org.hibernate.orm</groupId>
                <artifactId>hibernate-processor</artifactId>
            </path>
        </annotationProcessorPaths>
        <annotationProcessorPathsUseDepMgmt>true</annotationProcessorPathsUseDepMgmt>
    </configuration>
</plugin>
```

For Gradle, the equivalent is declaring the processor as an `annotationProcessor` dependency, with the version pinned via an enforced platform so it matches the Hibernate ORM BOM Quarkus already manages:

```gradle
annotationProcessor enforcedPlatform("${quarkusPlatformGroupId}:quarkus-bom:${quarkusPlatformVersion}")
annotationProcessor 'org.hibernate.orm:hibernate-processor'
```

### What gets generated

For an entity `MyEntity`, the processor emits a class `MyEntity_` in the same package, with one static field per persistent attribute. These fields are typed against Hibernate's metamodel attribute types, which is what lets the Criteria API type-check attribute access instead of accepting an arbitrary string.

### Using the metamodel with CriteriaBuilder

The generated class is consumed directly wherever you'd otherwise pass a string attribute name to the Criteria API:

```java
var builder = session.getCriteriaBuilder();
var criteria = builder.createQuery(MyEntity.class);
var e = criteria.from(MyEntity_.class);
criteria.where(e.get(MyEntity_.name).equalTo(name));
```

`e.get(MyEntity_.name)` resolves to a strongly-typed path expression for the `name` attribute — the compiler verifies both that `name` exists on `MyEntity` and that the value passed to `equalTo` is assignment-compatible with its type.

### Where this fits relative to other query styles

The static metamodel only matters if you're writing Criteria API queries directly — it's a compile-time safety net for that specific style of dynamic query construction. It's orthogonal to (and can coexist with) higher-level data-access styles: Panache's simplified query strings and Jakarta Data's declarative repository methods don't need or use the generated `_` classes, since they don't ask you to reference attributes by name in Java code the way `CriteriaBuilder` does.

## Trade-offs

- **Build-time cost, not runtime cost** — the processor adds a compilation step and generated sources to review/ignore in version control, but has zero runtime overhead once compiled.
- **Only pays off with real Criteria API usage** — if a codebase mostly uses JPQL strings, Panache finders, or Jakarta Data repositories, standing up the metamodel processor for one or two dynamic queries is likely not worth the build config.
- **Version alignment matters** — `hibernate-processor` must track the same Hibernate ORM version as the runtime, which is why the recommended setup pins it through Quarkus's own dependency management (`annotationProcessorPathsUseDepMgmt` / the enforced BOM) rather than a hardcoded version.
  ```xml
  <annotationProcessorPathsUseDepMgmt>true</annotationProcessorPathsUseDepMgmt>
  ```
- **Generated classes are compile artifacts** — they need to be excluded from manual edits and typically from source-control diffs review, since they regenerate on every build from the entity source of truth.

## Documentation Links

- [Hibernate ORM guide — Static metamodel](https://quarkus.io/guides/hibernate-orm) — source guide covering `hibernate-processor` setup and `CriteriaBuilder` usage with generated metamodel classes.
