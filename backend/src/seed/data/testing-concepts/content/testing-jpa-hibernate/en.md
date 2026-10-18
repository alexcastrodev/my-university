---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

An ORM maps objects to database rows so you write Java instead of SQL. `JPA` (the Jakarta Persistence API) is the specification; `Hibernate` is its most common implementation. A domain class becomes a table via annotations (`@Entity`, `@Table`, `@Id`, `@Column`), and an `EntityManager` persists and queries those objects. Testing a persistence layer means standing up an `EntityManager` against a test database, seeding entities inside a transaction, and asserting that queries return them — the book does this against an in-memory H2 database configured through `persistence.xml`.

## Use Cases

- Testing that a domain class is mapped correctly — that persisting it and reading it back yields the same object graph.
- Verifying JPQL queries (`select c from Country c`) return the expected entities and honor filters.
- Checking that schema generation from annotations produces a workable table for the entity.
- Testing repository/DAO methods built on `EntityManager` without hand-writing SQL.
- Regression-testing persistence behavior (cascades, generated IDs, transactions) around an in-memory or a real containerized database.

## Deep Dive

### Mapping a class to a table

Annotations turn a POJO into a managed entity; `@GeneratedValue` delegates the primary key to a database identity column:

```java
@Entity
@Table(name = "COUNTRY")
public class Country {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "ID")
    private int id;

    @Column(name = "NAME")
    private String name;

    @Column(name = "CODE_NAME")
    private String codeName;
}
```

### Configuring the persistence unit

`persistence.xml` (under `META-INF`) names a persistence unit, points at the JPA provider, and configures the test database. `hibernate.hbm2ddl.auto=create` rebuilds the schema from the annotations on every run — appropriate for a throwaway test database:

```xml
<persistence-unit name="manning.hibernate">
    <provider>org.hibernate.jpa.HibernatePersistenceProvider</provider>
    <class>com.manning.junitbook.databases.model.Country</class>
    <properties>
        <property name="jakarta.persistence.jdbc.driver" value="org.h2.Driver"/>
        <property name="jakarta.persistence.jdbc.url" value="jdbc:h2:mem:test;DB_CLOSE_DELAY=-1"/>
        <property name="hibernate.dialect" value="org.hibernate.dialect.H2Dialect"/>
        <property name="hibernate.hbm2ddl.auto" value="create"/>
    </properties>
</persistence-unit>
```

(The property keys above are shown in their current `jakarta.*` form — the book uses `javax.*`; see the note below.)

### Testing with an EntityManager

The test builds an `EntityManagerFactory` for that persistence unit, seeds data inside a transaction, then queries it back with JPQL:

```java
private EntityManager em;

@BeforeEach
void setUp() {
    EntityManagerFactory emf = Persistence.createEntityManagerFactory("manning.hibernate");
    em = emf.createEntityManager();
    em.getTransaction().begin();
    for (String[] row : COUNTRY_INIT_DATA) {
        em.persist(new Country(row[0], row[1]));
    }
    em.getTransaction().commit();
}

@Test
void testCountryList() {
    List<Country> countries = em.createQuery("select c from Country c", Country.class).getResultList();
    assertEquals(COUNTRY_INIT_DATA.length, countries.size());
}
```

### Book vs. today: `javax` → `jakarta`, test slices, and Testcontainers

> **The persistence package moved from `javax.persistence` to `jakarta.persistence`.** This is the single most important change since the 2020 book. When Java EE became Jakarta EE, the JPA namespace was renamed; Hibernate 6 (2022) and Spring 6 / Spring Boot 3 use `jakarta.persistence` **exclusively**. The book's `import javax.persistence.*;` and its `javax.persistence.jdbc.*` property keys **do not compile / are not recognized** on a current stack — every import and `persistence.xml` property key must be `jakarta`:

```java
// book (JPA in javax, Hibernate 5)          // today (Jakarta Persistence, Hibernate 6+)
import javax.persistence.Entity;             import jakarta.persistence.Entity;
import javax.persistence.EntityManager;      import jakarta.persistence.EntityManager;
// property name="javax.persistence.jdbc.url"   property name="jakarta.persistence.jdbc.url"
```

> **Spring Boot slices manage the boilerplate.** `@DataJpaTest` loads only the JPA layer, configures a test database, and wraps each test in a transaction that **rolls back automatically** — replacing the manual `EntityManagerFactory` construction, `persistence.xml`, and hand-managed `begin()`/`commit()`:

```java
@DataJpaTest
class CountryRepositoryTest {
    @Autowired CountryRepository repository;   // transaction + rollback handled for you
}
```

> **Test against the real database with Testcontainers.** The book tests on in-memory H2, which does not behave identically to the production engine. Testcontainers (not in the 2020 book, the de-facto standard today) starts the *actual* database — PostgreSQL, MySQL — in a Docker container for the test, eliminating dialect drift:

```java
@Testcontainers
class CountryRepositoryIT {
    @Container
    static PostgreSQLContainer<?> db = new PostgreSQLContainer<>("postgres:16");
    // Spring Boot 3.1+: @ServiceConnection wires the datasource to the container automatically
}
```

## Trade-offs

- **In-memory H2 gives false confidence** — schema generation and JPQL can pass against H2 yet break on the production database (dialect, sequences, native queries, constraint semantics); H2 is fine for mapping smoke tests, but persistence behavior you depend on should be verified with Testcontainers against the real engine.
- **`hbm2ddl.auto=create` is a test-only setting** — it drops and recreates the schema on startup, which is exactly wrong for any environment with real data:

```xml
<property name="hibernate.hbm2ddl.auto" value="create"/> <!-- data loss if pointed at a real DB -->
```

- **Manual transaction management is error-prone** — the book's `em.getTransaction().begin()/commit()` must be paired correctly and rolled back on failure by hand; a forgotten `commit()` or missing rollback leaves the test's data in an undefined state, which is why Spring's transaction-per-test (auto-rollback) is preferred.
- **Mapping errors surface late** — a wrong `@Column` name or type mismatch compiles fine and only fails at schema generation or query time, not at build time, so ORM tests are essential precisely because the compiler can't verify the mapping.

## Lab

In this lab you get `Country` and `CountryRepository` **already built and working** (a Spring Data JPA repository has no method bodies: Spring generates the implementation from the signature and the `@Query`). Your job is to write tests with `@DataJpaTest` and `TestEntityManager` that prove the generated queries are correct and that expose a subtler behavior: the persistence context buffers writes and only sends them to the database when it flushes.

**The scenario**

A country catalog mapped with JPA.

- `Country`: an entity with `id` (`GenerationType.IDENTITY`), `name` and `codeName`, with `setName` to mutate the name.
- `CountryRepository`: `findByCodeName` (returns an `Optional`) and `searchByNameFragment`, a JPQL query with `LIKE %:fragment%`.
- `CountryRepositoryTest`: `setUp()` already stores France, Finland and Germany with `persistAndFlush` and clears the persistence context. There is also a `readNameFromDatabaseDirectly(id)` helper that queries the database with a plain `JdbcTemplate`, bypassing Hibernate. It is what lets a test see what is actually stored, independent of what the persistence context believes.

**What you will do, step by step**

1. **Find by code (TODO-00).** `findByCodeName("FR")` must return a present `Optional` with a `Country` named "France".
2. **Unknown code (TODO-01).** `findByCodeName("XX")` returns an empty `Optional`, with no exception. Compare with the `CountryDao` in the JDBC lab, which threw.
3. **Search by fragment (TODO-02).** `searchByNameFragment("ranc")` must return exactly one country, "France", which proves the `LIKE` matches a fragment anywhere, not just a prefix or an exact name.
4. **The key exercise: flush (TODO-03).** Fetch France with `entityManager.find(Country.class, franceId)` and call `setName("New France")`, with no `save`/`persist`, relying on dirty checking. Right after, check that `readNameFromDatabaseDirectly(franceId)` STILL returns "France": the setter only changed the in-memory entity, and Hibernate has not sent the UPDATE. Call `entityManager.flush()` and check that the helper now returns "New France".
5. **IDENTITY and the immediate id (TODO-04).** Do `entityManager.persist(new Country("Spain", "ES"))`, not `persistAndFlush`, and check that `getId()` is already non-null without any flush from you. With IDENTITY only the database auto-increment generates the id, so Hibernate has to run the INSERT right away, unlike a deferred strategy such as SEQUENCE.

**How you know you are done**

`mvn test` is all green. You can explain why the direct read still saw the old value before the flush and when Hibernate flushes on its own, and why the INSERT happens at `persist()` with IDENTITY.

**Optional challenges**

- **TODO-05:** save a new country with `countryRepository.save(new Country("Italy", "IT"))` and check that `count()` is now 4 (the 3 from `setUp()` plus the new one).

**Prerequisites:** the `testing-jdbc-and-spring-jdbc` lab (or equivalent JDBC/H2 testing background) and reading `Country` and `CountryRepository` in `src/main/java`, noting the `GenerationType.IDENTITY`.

**How to run it:** clone the repository, go into `testing-concepts/testing-jpa-hibernate` and run `mvn test` (or, from the root, `mvn -pl testing-concepts/testing-jpa-hibernate test`). The test methods start with `fail("TODO-NN: not implemented yet")`, so the red tests are your checklist.

## Documentation Links

- [Jakarta Persistence (JPA) migration — `javax` to `jakarta` (Hibernate 6 ORM guide)](https://docs.jboss.org/hibernate/orm/6.0/migration-guide/migration-guide.html) — doc
- [Data JPA & `@DataJpaTest` — Spring Boot reference](https://docs.spring.io/spring-boot/reference/testing/spring-boot-applications.html#testing.spring-boot-applications.autoconfigured-spring-data-jpa) — doc
- [Testcontainers for Java — official documentation](https://java.testcontainers.org/) — doc
- [`@ServiceConnection` (Testcontainers integration) — Spring Boot reference](https://docs.spring.io/spring-boot/reference/testing/testcontainers.html) — doc
- [JUnit in Action, 3rd Ed. — Ch. 19.4–19.6, "Testing database applications" (Hibernate, Spring Hibernate), pp. 388–397 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) — doc
