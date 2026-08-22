---
version: 1.0
updatedAt: 2026-08-22
---
## Objective

Jakarta Data is a standard, vendor-neutral repository abstraction: instead of writing DAO boilerplate or hand-rolled query methods, you declare an interface extending a built-in repository contract like `CrudRepository`, and the persistence provider (Hibernate ORM, in Quarkus) generates the implementation at build time. Query methods can be derived from their name, or written explicitly with `@Query`/`@Find`, and Quarkus wires the whole thing into CDI and, optionally, security.

## Use Cases

- Replacing repeated `EntityManager` boilerplate (find-by-id, save, delete, list-all) with a single interface declaration.
- Exposing custom finder methods without writing JPQL by hand, when the query is simple enough to derive from the method signature.
- Securing data access at the method or repository level using the same annotations used elsewhere in a Quarkus app (`@RolesAllowed`, `@Authenticated`).
- Targeting a specific persistence unit in a multi-persistence-unit application from within a repository interface.

## Deep Dive

### Declaring a repository

A Jakarta Data repository is just an interface extending one of the standard built-in contracts, most commonly `CrudRepository<EntityType, IdType>`:

```java
public interface MyEntityRepository extends CrudRepository<MyEntity, Integer> {
}
```

Hibernate ORM's Jakarta Data implementation generates the backing class at build time and Quarkus makes it injectable like any other CDI bean — no `@ApplicationScoped` or manual wiring needed on the interface itself.

### Custom query methods

Beyond the inherited CRUD operations, a repository interface can declare additional methods backed by an explicit query:

```java
public interface MyEntityRepository extends CrudRepository<MyEntity, Integer> {

    @Query("select e from MyEntity e where e.name = :name")
    List<MyEntity> findByCustomCriteria(String name);

    @Find
    MyEntity findByName(String name);

    @Delete
    void removeExpired();
}
```

`@Query` takes an explicit JPQL-like query string when the operation is more than a simple lookup. `@Find` and `@Delete` mark methods that Hibernate ORM's provider maps to find/delete operations based on parameter names and method conventions, without requiring a query string to be written out.

### Targeting a non-default persistence unit

In an application with multiple persistence units, a repository is pinned to one of them via `@Repository`:

```java
@Repository(dataStore = "other")
public interface OtherEntityRepository extends CrudRepository<OtherEntity, Long> {
}
```

`dataStore` matches the persistence unit's configured name — without it, a repository is assumed to belong to the default persistence unit.

### Securing repository methods

Because generated repository implementations are ordinary CDI beans, standard Quarkus security annotations apply directly to them, at either the method or the class level:

```java
public interface AdminRepository extends CrudRepository<Account, Long> {

    @RolesAllowed("admin")
    void deleteAll();
}
```

A class-level `@Authenticated` restricts every method on the repository to authenticated callers. One caveat called out in the guide: generic methods with type variables in their signature can't be reliably secured this way, since the security interceptor needs a concrete method signature to check against.

## Trade-offs

- **Standard, but young** — Jakarta Data is a newer Jakarta EE specification; it buys you portability across compliant providers in principle, but the ecosystem of examples and tooling is thinner than for hand-written JPQL or Panache.
- **Derived/annotation-based queries have a ceiling** — `@Find` and name-derived methods handle straightforward lookups well, but anything with real query complexity (joins, aggregations, dynamic predicates) is better expressed with an explicit `@Query`, or falls back to `CriteriaBuilder`/JPQL entirely.
- **Generic methods can't be secured** — a repository method whose signature includes a type variable can't have `@RolesAllowed` reliably enforced on it, which constrains how generic base interfaces can be shared across secured repositories.
- **Multi-persistence-unit wiring is implicit unless declared** — forgetting `@Repository(dataStore = "...")` silently binds a repository to the default persistence unit rather than failing loudly, which can be a confusing bug in multi-unit setups.
  ```java
  @Repository(dataStore = "other")
  ```

## Documentation Links

- [Hibernate ORM guide — Jakarta Data repositories](https://quarkus.io/guides/hibernate-orm) — source guide covering `CrudRepository`, `@Query`/`@Find`/`@Delete`, `@Repository(dataStore=...)`, and method-level security on repositories.
