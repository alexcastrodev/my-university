---
version: 1.0
updatedAt: 2026-08-22
---
## Objective

Panache is Quarkus's opinionated layer on top of Hibernate ORM that strips away most of the JPA/EntityManager ceremony. It offers two styles for the same underlying entities: an active-record style where the entity class itself exposes `find`/`list`/`persist` as static methods, and a repository style where those same operations live on an injectable `PanacheRepository`. Both compile down to plain Hibernate ORM — Panache is a convenience layer, not a different persistence engine.

## Use Cases

- Small-to-medium CRUD-heavy services where full JPA boilerplate (getters/setters, `EntityManager` calls for every operation) is pure overhead.
- Codebases that prefer keeping query logic close to the entity it operates on (active record) versus codebases that prefer a clean separation between entities and data-access logic (repository).
- Any query that can be expressed as a simplified Panache query string, avoiding hand-written JPQL for the common case (equality filters, ordering, named/positional parameters).
- Paginating or sorting result sets without writing manual `setFirstResult`/`setMaxResults`/`ORDER BY` boilerplate.

## Deep Dive

### Active record entities

An entity extends `PanacheEntity`, which supplies an auto-generated `Long id` and a full set of static finder/persist methods:

```java
@Entity
public class Person extends PanacheEntity {
    public String name;
    public LocalDate birth;
    public Status status;
}
```

Fields are public and accessed directly — Panache leans into the idea that getters/setters add no value for simple data classes. Custom queries are added as additional static methods on the entity itself:

```java
public static Person findByName(String name) {
    return find("name", name).firstResult();
}
```

Common operations: `Person.findAll()`, `Person.findById(id)`, `Person.list("status", Status.Alive)`, `Person.count()`, `person.persist()`, `Person.delete("name", "value")`. Stream-returning variants exist for the list-style methods when you want to process results lazily.

If you need a custom identifier type or strategy instead of the built-in `Long id`, extend `PanacheEntityBase` instead of `PanacheEntity` and declare the `@Id` field yourself.

### Repository-style access

For teams that prefer entities without any persistence-aware static methods, the same functionality is available through `PanacheRepository<T>`, implemented by an injectable bean:

```java
@ApplicationScoped
public class PersonRepository implements PanacheRepository<Person> {
    public Person findByName(String name) {
        return find("name", name).firstResult();
    }
}
```

```java
@Inject
PersonRepository personRepository;

long count = personRepository.count();
personRepository.persist(person);
```

The method surface mirrors the active-record API almost one-to-one, just moved from static entity methods to instance methods on the repository. `PanacheRepositoryBase<Entity, IdType>` is the repository-side equivalent of `PanacheEntityBase`, for entities with a non-`Long` identifier.

### Simplified query strings

Panache's `find`/`list`/`count`/`delete` methods accept a shorthand query language instead of requiring full JPQL. A bare attribute name becomes an equality check against the first parameter; an `order by` clause gets a full `FROM EntityName` prepended automatically:

```java
Person.list("status", Status.Alive);
Person.list("order by name");
```

Positional and named parameters both work for anything beyond simple equality:

```java
Person.find("name = ?1 and status = ?2", "stef", Status.Alive);
Person.find("name = :name", Map.of("name", "stef")).firstResult();
```

### Pagination and sorting

`PanacheQuery`, the object returned by `find`, supports paging directly, without manual offset/limit math:

```java
PanacheQuery<Person> livingPersons = Person.find("status", Status.Alive);
livingPersons.page(Page.ofSize(25));
List<Person> firstPage = livingPersons.list();
List<Person> secondPage = livingPersons.nextPage().list();
```

Sorting is expressed with the `Sort` helper, composable across multiple fields:

```java
List<Person> persons = Person.list(
    Sort.by("name").and("birth"),
    Status.Alive
);
```

## Trade-offs

- **Active record couples persistence to the entity class** — convenient for small services, but it means the entity carries data-access responsibility, which some teams intentionally avoid via the repository style instead.
- **Public fields trade encapsulation for brevity** — Panache's field-access style is a deliberate simplicity choice, not compatible with codebases that enforce getter/setter-only access to entity state.
- **Query shorthand has a ceiling** — the simplified string syntax covers equality, ordering, and simple parameterized conditions well; anything with joins or complex predicates still needs a real JPQL string or a `CriteriaBuilder` query.
- **Still plain Hibernate ORM underneath** — Panache doesn't replace Hibernate's session/transaction semantics (dirty checking, lazy loading, N+1 concerns still apply); it only removes boilerplate around invoking it.
- **Choosing `PanacheEntity` vs `PanacheEntityBase` is a one-way door per entity** — the built-in `Long id` from `PanacheEntity` can't be swapped for a custom identifier later without switching the entity to `PanacheEntityBase` and redefining `@Id` yourself.
  ```java
  public class Person extends PanacheEntityBase { @Id public String code; }
  ```

## Documentation Links

- [Hibernate ORM with Panache guide](https://quarkus.io/guides/hibernate-orm-panache) — dedicated guide with full active-record and repository examples, query shorthand, pagination, and sorting.
- [Hibernate ORM guide](https://quarkus.io/guides/hibernate-orm) — references Panache as the simplified alternative to direct Hibernate ORM/JPA usage.
