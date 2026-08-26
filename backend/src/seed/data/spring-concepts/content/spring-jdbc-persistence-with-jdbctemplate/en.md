---
version: 1.0
updatedAt: 2026-08-01
---
## Objective

Raw JDBC buries a one-line query under connection setup, statement creation, and
try/finally cleanup — and forces every caller to handle a checked `SQLException`
that usually can't be meaningfully recovered from anyway. `JdbcTemplate` strips
that ceremony down to the query itself and a `RowMapper`; `SimpleJdbcInsert` goes
further for the common case of "insert a row and get back its generated key."

## Use Cases

- Querying a small reference table (like a list of taco ingredients) into domain
  objects without hand-writing `Connection`/`PreparedStatement`/`ResultSet`
  plumbing.
- Inserting a row and immediately needing the database-generated ID to save
  related rows in a child table (e.g., a taco's ID before inserting its
  ingredient associations).
- Getting a fresh database schema and reference data loaded automatically every
  time a Spring Boot application starts, with zero extra configuration.

## Deep Dive

### JdbcTemplate: query() and queryForObject() plus a RowMapper

```java
@Repository
public class JdbcIngredientRepository implements IngredientRepository {

    private JdbcTemplate jdbc;

    public JdbcIngredientRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Iterable<Ingredient> findAll() {
        return jdbc.query("select id, name, type from Ingredient",
            this::mapRowToIngredient);
    }

    @Override
    public Ingredient findOne(String id) {
        return jdbc.queryForObject(
            "select id, name, type from Ingredient where id=?",
            this::mapRowToIngredient, id);
    }

    private Ingredient mapRowToIngredient(ResultSet rs, int rowNum) throws SQLException {
        return new Ingredient(
            rs.getString("id"),
            rs.getString("name"),
            Ingredient.Type.valueOf(rs.getString("type")));
    }
}
```

`query()` returns a collection and needs a `RowMapper` (a method reference works
fine, as shown, or an explicit `RowMapper<T>` implementation when the mapping
logic is reused elsewhere); `queryForObject()` is the same idea for a single
expected row, with query parameters filled in via the trailing varargs (`id`
here) instead of a raw `?` substitution you'd have to escape yourself.

### Inserting the hard way: PreparedStatementCreator + GeneratedKeyHolder

When a save needs the database-generated ID back (to then insert child rows),
`update()` takes a `PreparedStatementCreator` and a `KeyHolder`:

```java
private long saveTacoInfo(Taco taco) {
    taco.setCreatedAt(new Date());
    PreparedStatementCreator psc = new PreparedStatementCreatorFactory(
        "insert into Taco (name, createdAt) values (?, ?)",
        Types.VARCHAR, Types.TIMESTAMP
    ).newPreparedStatementCreator(
        Arrays.asList(taco.getName(), new Timestamp(taco.getCreatedAt().getTime())));

    KeyHolder keyHolder = new GeneratedKeyHolder();
    jdbc.update(psc, keyHolder);
    return keyHolder.getKey().longValue();
}
```

This is the most verbose path in the whole section — a `PreparedStatementCreatorFactory`
built from the SQL and each parameter's `java.sql.Types`, then a
`PreparedStatementCreator` built from the actual values, before `update()` can
even run.

### Inserting the easy way: SimpleJdbcInsert

For a table where the generated key just needs to come back as a value (not
threaded through a custom `PreparedStatementCreator`), `SimpleJdbcInsert` wraps
the same `JdbcTemplate` with far less code:

```java
this.orderInserter = new SimpleJdbcInsert(jdbc)
    .withTableName("Taco_Order")
    .usingGeneratedKeyColumns("id");

Map<String, Object> values = objectMapper.convertValue(order, Map.class);
values.put("placedAt", order.getPlacedAt());
long orderId = orderInserter.executeAndReturnKey(values).longValue();
```

`execute()`/`executeAndReturnKey()` both take a `Map<String, Object>` whose keys
are column names — the book builds that map by repurposing Jackson's
`ObjectMapper.convertValue()` to turn the `Order` object into a `Map` in one
line, rather than copying each property by hand.

### Auto-initializing the database: schema.sql and data.sql

Spring Boot runs `schema.sql` and `data.sql` from the classpath root
(`src/main/resources`) against the datasource automatically at startup — no
extra configuration needed for this behavior itself:

```sql
-- schema.sql
create table if not exists Ingredient (
  id varchar(4) not null,
  name varchar(25) not null,
  type varchar(10) not null
);
```

```sql
-- data.sql
delete from Ingredient;
insert into Ingredient (id, name, type) values ('FLTO', 'Flour Tortilla', 'WRAP');
```

This is why the book's examples work out of the box against the embedded H2
database — the schema and reference data are simply there every time the app
starts, which is convenient for a demo/dev database but not something you'd
want re-running destructive `delete from` statements against a real production
database on every restart.

## Trade-offs

- **`JdbcTemplate` eliminates connection/statement/result-set boilerplate and
  the need to handle `SQLException` yourself, but it's still fundamentally
  string-SQL-plus-positional-parameters** — a typo in the SQL or a
  parameter-order mistake only surfaces at runtime, not at compile time.
- **`SimpleJdbcInsert`'s `Map<String, Object>` convenience (especially via
  `ObjectMapper.convertValue()`) trades explicitness for brevity** — the book
  itself calls this a "hackish use of `ObjectMapper`"; it works because Jackson
  is already on the classpath via the web starter, not because it's the
  idiomatic tool for object-to-map conversion.
- **Book vs. today: Spring Framework 6.1 introduced `JdbcClient`, a fluent
  facade unifying `JdbcTemplate` and `NamedParameterJdbcTemplate`** — official
  Spring documentation now points to `JdbcClient` as the preferred entry point
  for new code (`client.sql("...").param("id", 3).query(Type.class).optional()`
  style), with `JdbcTemplate`/`SimpleJdbcInsert` remaining for lower-level or
  more complex cases (batch operations, stored procedures) rather than as the
  default recommendation. The book's 2019 `JdbcTemplate`-only approach is still
  fully functional today — `JdbcClient` sits on top of it, it doesn't replace
  the underlying mechanism.
- **`schema.sql`/`data.sql` auto-execution is a dev/demo convenience, not a
  migration strategy** — it has no versioning and re-runs destructively on
  every restart; real applications reach for Flyway or Liquibase instead once
  the schema needs to evolve safely across environments.

## Documentation Links

- Craig Walls, "Spring in Action", 5th Edition (Manning, 2019) — Chapter 3, "Working with data", section 3.1, p. 56-74 — doc
- [Spring Framework Reference — Data Access with JDBC (JdbcTemplate)](https://docs.spring.io/spring-framework/reference/data-access/jdbc/core.html) — doc
- [Spring Framework API — JdbcClient (fluent facade over JdbcTemplate)](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/jdbc/core/simple/JdbcClient.html) — doc
- [Spring Boot Reference — SQL Databases (schema.sql/data.sql initialization)](https://docs.spring.io/spring-boot/how-to/data-initialization.html) — doc
