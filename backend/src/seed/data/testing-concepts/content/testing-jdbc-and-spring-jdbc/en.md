---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

Before an application reaches for an ORM, it talks to a relational database through `JDBC` — the low-level Java API for opening a connection, running SQL, and reading a `ResultSet`. Testing such code means pointing it at a database the test controls, typically an in-memory one (H2) created and dropped around each test so runs stay fast and isolated. Spring's `JdbcTemplate` sits on top of raw JDBC and removes the connection/exception/resource boilerplate, so the same data-access test becomes much shorter while still exercising real SQL against a real (embedded) database.

## Use Cases

- Testing a DAO that issues hand-written SQL, by creating the schema, inserting known rows, running the DAO, and asserting on the results — all against an in-memory database.
- Verifying that a query maps `ResultSet` columns to domain objects correctly (right fields, right order).
- Migrating raw-JDBC data access to Spring's `JdbcTemplate`/`NamedParameterJdbcTemplate` and keeping the tests green through the change.
- Testing SQL with named parameters (`:name`) instead of positional `?` placeholders, which are easier to read and reorder.
- Getting fast, deterministic data-access feedback in CI without provisioning an external database server.

## Deep Dive

### Raw JDBC data access

Plain JDBC manages everything by hand: open a connection, prepare a statement, iterate the `ResultSet`, close resources. The book's DAO reads countries from an H2 database:

```java
public List<Country> getCountryList() {
    List<Country> countryList = new ArrayList<>();
    try {
        Connection connection = openConnection();
        PreparedStatement statement = connection.prepareStatement("select * from country");
        ResultSet resultSet = statement.executeQuery();
        while (resultSet.next()) {
            countryList.add(new Country(resultSet.getString(2), resultSet.getString(3)));
        }
        statement.close();
    } catch (SQLException e) {
        throw new RuntimeException(e);
    } finally {
        closeConnection();
    }
    return countryList;
}
```

### Testing it against an in-memory database

The test controls the schema: create the table (and seed rows) before each test, drop it after, so every test starts from a known state. Because H2 runs in-process, no server needs to be started:

```java
@BeforeEach
void setUp() {
    TablesManager.createTable();   // CREATE TABLE COUNTRY(...)
    // insert known rows
}

@AfterEach
void tearDown() {
    TablesManager.dropTable();     // DROP TABLE IF EXISTS COUNTRY
}

@Test
void testGetCountryList() {
    List<Country> countries = countryDao.getCountryList();
    assertEquals(expectedCountries, countries);
}
```

### Spring JDBC: `JdbcTemplate` removes the boilerplate

`JdbcTemplate` handles the connection, statement, exception translation, and resource cleanup, so the DAO shrinks to the SQL and a row mapping. `NamedParameterJdbcTemplate` adds named parameters:

```java
NamedParameterJdbcTemplate template = new NamedParameterJdbcTemplate(dataSource);
Map<String, Object> params = Map.of("name", name + "%");
return template.query(
    "select * from country where name like :name",
    params,
    (rs, rowNum) -> new Country(rs.getString("NAME"), rs.getString("CODE_NAME")));
```

The test looks the same as before — it still runs real SQL against the embedded database — but the production code no longer manages connections by hand.

### Book vs. today: obsolete driver loading, `JdbcDaoSupport`, and test slices

> **`Class.forName("org.h2.Driver")` is obsolete.** The book's `ConnectionManager` loads the driver explicitly. Since JDBC 4.0 (Java 6, 2008), drivers on the classpath are auto-registered via the `ServiceLoader` mechanism, so the `Class.forName(...)` call is unnecessary dead code today:

```java
// book: manual, no longer needed
Class.forName("org.h2.Driver");
Connection c = DriverManager.getConnection("jdbc:h2:~/country", "sa", "");
// today: the driver registers itself; just get the connection
Connection c = DriverManager.getConnection("jdbc:h2:~/country", "sa", "");
```

> **Prefer an injected `JdbcTemplate` over extending `JdbcDaoSupport`.** The book's DAOs `extends JdbcDaoSupport` and call `getJdbcTemplate()`. That base class predates constructor injection; modern Spring injects a `JdbcTemplate` (or `NamedParameterJdbcTemplate`) directly, which is easier to test and doesn't tie the DAO to a Spring base class:

```java
@Repository
public class CountryDao {
    private final JdbcTemplate jdbcTemplate;
    public CountryDao(JdbcTemplate jdbcTemplate) {  // injected, no JdbcDaoSupport
        this.jdbcTemplate = jdbcTemplate;
    }
}
```

> **Spring Boot has a slice for this.** `@JdbcTest` loads just the JDBC infrastructure and an embedded database, and `@Sql` runs setup scripts, replacing manual `createTable()`/`dropTable()` plumbing.

## Trade-offs

- **An in-memory database is fast but not your production database** — H2 is not PostgreSQL/Oracle; its SQL dialect, type coercions, and constraint behavior differ, so a test can pass on H2 and the same SQL fail in production (the "impedance mismatch" the book names). For SQL you depend on, integration-test against the real engine (see the Testcontainers note in the JPA/Hibernate concept).
- **Raw JDBC leaks resources if you forget `finally`** — every connection/statement must be closed explicitly, and a missed `close()` is a leak the compiler won't catch:

```java
PreparedStatement statement = connection.prepareStatement(sql);
// no finally { statement.close(); connection.close(); } → leaked on exception
```

- **`JdbcTemplate` trades explicitness for magic** — it swallows the connection lifecycle and translates `SQLException` into Spring's unchecked `DataAccessException`; convenient, but you no longer see exactly when the connection opens/closes, which matters for transaction-boundary debugging.
- **Column-index access is fragile** — the book's `resultSet.getString(2)` breaks silently if the `SELECT` column order changes; `getString("NAME")` (or a `RowMapper`) is more robust:

```java
new Country(rs.getString(2), rs.getString(3)); // breaks if the query's column order changes
```

## Lab

In this lab you get `CountryDao` **already built and working** and a test class with the database already prepared. Your job is to write the tests that run real SQL against a fresh in-memory H2 database for every test, the way the article shows for plain JDBC and for Spring's `JdbcTemplate`. The core idea is to feel that, in a DAO test, what matters is proving the SQL and the row mapping: a `RowMapper` that reads the wrong column still returns *a* `Country`, and only an assert on every field catches the mistake.

**The scenario**

A small DAO on top of `JdbcTemplate`, with no connection or resource-cleanup boilerplate.

- `CountryDao`: `findAll()`, `findByCodeName(codeName)`, `findByNameStartingWith(prefix)` and `insert(country)`. The first ones use positional `?` placeholders, but `findByNameStartingWith` uses `NamedParameterJdbcTemplate` with a named `:prefix`.
- `Country`: a record with `id`, `name` and `codeName`.
- `CountryDaoTest`: `setUp()` already creates the embedded H2, the `country` table and three known rows (France/FR, Germany/DE, Finland/FI), and `tearDown()` drops the table. That part is done, and every test starts from the same state with nothing shared.

**What you will do, step by step**

1. **List everything (TODO-00).** Call `findAll()` and check that it returns exactly 3 countries, the ones seeded in `setUp()`.
2. **Check the mapping (TODO-01).** Call `findByCodeName("FR")` and assert on every field of the `Country` (id, name and codeName), not just that a row came back.
3. **The no-result case (TODO-02).** Call `findByCodeName("XX")` and check that it throws `EmptyResultDataAccessException`. This is `JdbcTemplate` translating an empty `ResultSet` into Spring's unchecked hierarchy, not a raw `SQLException`.
4. **Named parameter and LIKE (TODO-03 and TODO-04).** `findByNameStartingWith("F")` must return exactly 2 (France and Finland, not Germany), which proves `:prefix` is really bound into the `LIKE` pattern. With the prefix "Z", the result must be an empty list, neither `null` nor an exception.
5. **Insert and read back (TODO-05).** `insert(...)` a new country (for example id 4, "Spain", "ES") and then `findByCodeName("ES")`, comparing with what you inserted. This proves the insert persisted, not just that the method returned without throwing.

**How you know you are done**

`mvn test` is all green. You can explain why every test always sees the same three countries, why the TODO-01 assert looks at all fields and which SQL mistake the "F" prefix test would catch (matching everything or nothing).

**Optional challenges**

- **TODO-06:** query `select count(*) from country` directly with `jdbcTemplate`, bypassing `CountryDao`, as an independent check that `insert()` wrote exactly one row.

**Prerequisites:** JUnit 5 fundamentals (`@Test`, `@BeforeEach`/`@AfterEach`, `assertThrows`) and reading `CountryDao` and `Country` in `src/main/java` before writing any test.

**How to run it:** clone the repository, go into `testing-concepts/testing-jdbc-and-spring-jdbc` and run `mvn test` (or, from the root, `mvn -pl testing-concepts/testing-jdbc-and-spring-jdbc test`). The test methods start with `fail("TODO-NN: not implemented yet")`, so the red tests are your checklist.

## Documentation Links

- [Data Access with JDBC — Spring Framework reference](https://docs.spring.io/spring-framework/reference/data-access/jdbc.html) — doc
- [`JdbcTemplate` / `NamedParameterJdbcTemplate` — Spring Framework](https://docs.spring.io/spring-framework/reference/data-access/jdbc/core.html) — doc
- [`@JdbcTest` auto-configuration — Spring Boot reference](https://docs.spring.io/spring-boot/appendix/test-auto-configuration/index.html) — doc
- [JUnit in Action, 3rd Ed. — Ch. 19.1–19.3, "Testing database applications" (JDBC, Spring JDBC), pp. 373–388 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) — doc
