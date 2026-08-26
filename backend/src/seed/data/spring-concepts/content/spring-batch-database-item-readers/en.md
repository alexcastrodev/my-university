---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

The relational database is the other standard batch input source alongside files (contrast the line-oriented parsing in `spring-batch-reading-flat-files`). The hard part is size: if a `SELECT` returns a million rows, a naive `JdbcTemplate.query(...)` holds every mapped object in memory until the whole result set is read. Spring Batch solves this with `ItemReader` implementations that hand back one row per `read()` so the chunk step (`spring-batch-chunk-processing`) can process and commit incrementally while memory stays flat. These readers typically share the same `DataSource` that backs the job metadata tables (`spring-batch-job-repository-database-configuration`), but they run business queries, not framework bookkeeping.

There are two families, and choosing between them is the whole story. **Cursor-based** readers (`JdbcCursorItemReader`, `StoredProcedureItemReader`, and the book's `HibernateCursorItemReader`) issue one query and stream rows through a live JDBC `ResultSet` on a held connection. **Paging** readers (`JdbcPagingItemReader`, `JpaPagingItemReader`, `HibernatePagingItemReader`) issue successive fixed-size `SELECT`s, each fetching one page. Both come in a raw-JDBC flavour and an ORM flavour; the ORM flavour trades explicit SQL for entity mapping.

## Use Cases

- Streaming a large `product` table into a chunk step with a `JdbcCursorItemReader` and a `RowMapper`, one row at a time, without buffering the whole result.
- Reading an even larger table **restartably** and **under multiple threads** with `JdbcPagingItemReader`, where each page is an independent `SELECT` ordered by a unique sort key.
- Sourcing rows from a database `StoredProcedureItemReader` (a returned `ResultSet`, an out-parameter ref-cursor, or a stored-function result).
- Reading already ORM-mapped entities with a JPQL query via `JpaPagingItemReader` when the domain model is defined with JPA annotations.
- Applying the driving-query pattern: read only identifiers with a JDBC cursor/paging reader, then let the processor load full objects through the ORM in the writer's transaction.

## Deep Dive

### `JdbcCursorItemReader`: one query, a live cursor

The cursor reader leaves data retrieval to the JDBC `ResultSet` — the object form of a database cursor. Spring Batch executes exactly one statement, then moves the cursor forward one row per `read()`. The minimal properties are `dataSource`, `sql`, and `rowMapper`:

```xml
<bean id="productItemReader"
      class="org.springframework.batch.item.database.JdbcCursorItemReader">
  <property name="dataSource" ref="dataSource"/>
  <property name="sql"
            value="select id, name, description, price from product"/>
  <property name="rowMapper" ref="productRowMapper"/>
</bean>

<bean id="productRowMapper"
      class="com.manning.sbia.reading.jdbc.ProductRowMapper"/>
```

The `RowMapper` is the one piece you always write — a factory that turns the current `ResultSet` row into a domain object (the flat-file analogue is the `FieldSetMapper` in `spring-batch-reading-flat-files`):

```java
public class ProductRowMapper implements RowMapper<Product> {
    public Product mapRow(ResultSet rs, int rowNum) throws SQLException {
        Product product = new Product();
        product.setId(rs.getString("id"));
        product.setName(rs.getString("name"));
        product.setDescription(rs.getString("description"));
        product.setPrice(rs.getFloat("price"));
        return product;
    }
}
```

When the SQL is parameterized, set a `preparedStatementSetter` (a `PreparedStatementSetter` that binds `?` placeholders); tune throughput with `maxRows` (a hard cap) and `fetchSize` (a driver hint for how many rows to pull per network round-trip):

```xml
<bean id="productItemReader"
      class="org.springframework.batch.item.database.JdbcCursorItemReader">
  <property name="dataSource" ref="dataSource"/>
  <property name="sql"
            value="select id, name, description, price from product where name like ?"/>
  <property name="preparedStatementSetter" ref="samsungStatementSetter"/>
  <property name="rowMapper" ref="productRowMapper"/>
  <property name="fetchSize" value="100"/>
  <property name="maxRows" value="3000"/>
</bean>
```

The trade-off is structural: the connection stays open for the entire step, and because the same `ResultSet` is advanced on every call, a `JdbcCursorItemReader` is **not thread-safe**. By default the cursor uses its own connection and does not join the step's transaction; set `useSharedExtendedConnection` (with an `ExtendedConnectionDataSourceProxy`) to hold the cursor open across commits.

### `StoredProcedureItemReader`: a cursor from a stored procedure

When the SQL lives in the database, `StoredProcedureItemReader` extends the cursor approach: replace `sql` with `procedureName`. It handles a returned `ResultSet`, a ref-cursor in an out parameter (`refCursorPosition`), or a stored-function result (`function=true`), and otherwise reuses every `JdbcCursorItemReader` property.

```xml
<bean id="reader"
      class="org.springframework.batch.item.database.StoredProcedureItemReader">
  <property name="dataSource" ref="dataSource"/>
  <property name="procedureName" value="sp_product"/>
  <property name="rowMapper" ref="productRowMapper"/>
</bean>
```

### `JdbcPagingItemReader`: successive fixed-size `SELECT`s

Instead of one long-lived cursor, the paging reader runs many bounded queries. It needs a `PagingQueryProvider`; rather than pick a database-specific one by hand, configure the `SqlPagingQueryProviderFactoryBean`, which auto-detects the database and returns the right provider (for example `PostgresPagingQueryProvider`):

```xml
<bean id="productItemReader"
      class="org.springframework.batch.item.database.JdbcPagingItemReader">
  <property name="dataSource" ref="dataSource"/>
  <property name="queryProvider" ref="productQueryProvider"/>
  <property name="rowMapper" ref="productRowMapper"/>
  <property name="pageSize" value="1500"/>
</bean>

<bean id="productQueryProvider"
      class="org.springframework.batch.item.database.support.SqlPagingQueryProviderFactoryBean">
  <property name="dataSource" ref="dataSource"/>
  <property name="selectClause" value="select id, name, description, price"/>
  <property name="fromClause" value="from product"/>
  <property name="sortKey" value="id"/>
</bean>
```

You supply the `selectClause`, `fromClause`, an optional `whereClause`, and a `sortKey`; the provider assembles the paged SQL. The first page is a plain limited query, and every later page adds a predicate on the sort key:

```sql
SELECT id, name, description, price FROM product LIMIT 1500
SELECT id, name, description, price FROM product WHERE id > ? LIMIT 1500
```

Because pages are re-anchored on the `sortKey` rather than a live cursor, this reader is **restartable** and safe for **multithreaded** steps — but the sort key must be unique, or rows can be skipped or duplicated between pages. Page size is a tuning knob (the book's rule of thumb is ~1,000, usually larger than the commit interval): too small floods the database with queries, too large defeats the memory savings.

### ORM readers: `HibernateCursorItemReader` and `JpaPagingItemReader`

ORM removes hand-written SQL but complicates batch, because the first-level cache grows as rows accumulate. The book's cursor answer is Hibernate's `StatelessSession` (no cache, no dirty checking), exposed through `HibernateCursorItemReader` with `useStatelessSession=true` by default:

```xml
<bean id="productItemReader"
      class="org.springframework.batch.item.database.HibernateCursorItemReader">
  <property name="sessionFactory" ref="sessionFactory"/>
  <property name="queryString" value="from Product"/>
</bean>
```

JPA has no cacheless `StatelessSession` equivalent, so its natural mode is paging: `JpaPagingItemReader` runs a JPQL query one page at a time, then **detaches the entities and clears the persistence context** after each page so they can be garbage-collected. `HibernatePagingItemReader` is the Hibernate paging counterpart. Configuration mirrors the cursor form — swap the factory and provide the query.

### Book vs. today: XML beans → fluent builders, `infrastructure` relocation, JPA over Hibernate

Three concrete changes since the 2012 book (Spring Batch 2.1), all against the current 6.0.x line.

**Java config + builders replace the XML beans.** Since Spring Batch 4 each reader has a fluent `*Builder`, and these are what the current reference shows first:

```java
@Bean
public JdbcCursorItemReader<Product> productItemReader(DataSource dataSource) {
    return new JdbcCursorItemReaderBuilder<Product>()
            .name("productItemReader")
            .dataSource(dataSource)
            .sql("select id, name, description, price from product")
            .rowMapper(new ProductRowMapper())
            .fetchSize(100)
            .build();
}

@Bean
public JdbcPagingItemReader<Product> productPagingReader(
        DataSource dataSource, PagingQueryProvider queryProvider) {
    return new JdbcPagingItemReaderBuilder<Product>()
            .name("productPagingReader")
            .dataSource(dataSource)
            .queryProvider(queryProvider)   // still built via SqlPagingQueryProviderFactoryBean
            .rowMapper(new ProductRowMapper())
            .pageSize(1000)
            .build();
}
```

The generic Spring-bean XML above still compiles against the relocated class name, but the batch-specific `batch:` XML namespace is deprecated as of 6.0, so Java config plus `JdbcCursorItemReaderBuilder` / `JdbcPagingItemReaderBuilder` / `JpaPagingItemReaderBuilder` is the recommended style.

**The item classes moved packages in 6.0.** The book and 5.x used `org.springframework.batch.item.database.*`; Spring Batch 6.0 relocated them to `org.springframework.batch.infrastructure.item.database.*` (for example `org.springframework.batch.infrastructure.item.database.JdbcCursorItemReader`). The pre-6.0 `org.springframework.batch.item.database.*` paths now 404, so a 6.0 upgrade is a hard import change, not a drop-in.

**JPA is now the ORM reader; Hibernate readers are gone.** Spring Batch 6.0 removed `HibernateCursorItemReader` and `HibernatePagingItemReader` entirely (they were deprecated earlier); the migration path is `JpaCursorItemReader` (added in 4.3, a JPQL cursor) and `JpaPagingItemReader`, both configured with an `EntityManagerFactory` instead of a Hibernate `SessionFactory`. The 6.0 appendix's reader list bears this out: it ships `JdbcCursorItemReader`/`JdbcPagingItemReader`/`JpaCursorItemReader`/`JpaPagingItemReader` and no Hibernate reader. Confirmed via the Spring Batch 6.0.4 reference "Database" chapter, the 6.0.4 API Javadoc for `org.springframework.batch.infrastructure.item.database.JdbcCursorItemReader`, and the Spring Batch 6.0 Migration Guide.

## Trade-offs

- **Cursor vs. paging** — A cursor issues one query and streams, but pins a connection for the whole step and is single-threaded; the same held `ResultSet` makes `JdbcCursorItemReader` **not thread-safe**. Paging holds no long cursor, is restartable, and is thread-safe (`JdbcPagingItemReader`), at the cost of N queries and a strict, unique `sortKey`. Switching between them is configuration-only, so the book's advice is to test both against your driver.
- **`fetchSize` tuning** — On a cursor reader, `fetchSize` is only a hint to the driver for rows-per-round-trip; a good value cuts network chatter on big reads, but the effect is entirely driver- and database-dependent, so it is empirical, not guaranteed.
- **Page size** — Larger pages mean fewer queries but more memory per page; smaller pages invert that. Reading 1M rows in pages of 10 fires 100,000 queries. Aim near ~1,000 and usually above the commit interval, then measure.
- **ORM in batch** — Reading runs in a separate transaction from processing/writing, so ORM lazy loading plus a mid-step failure is a classic explosion. Cursor ORM needs Hibernate's `StatelessSession` to stop the first-level cache growing; JPA sidesteps this by detaching and clearing the context per page. When you need real ORM semantics, prefer the driving-query pattern over a plain ORM cursor.
- **JDBC vs. ORM readers** — Raw JDBC forces explicit SQL and a `RowMapper` but is predictable and fast; ORM readers erase the SQL and reuse existing entity mappings but add a caching layer that fights batch's memory and transaction model. For pure bulk import, JDBC paging is often the simplest robust choice.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 5, "Reading data", sections 5.5-5.6, "Reading from relational databases" / "Using ORM item readers", p. 139-151 — doc
- [Spring Batch Reference — Database (Cursor-based and Paging `ItemReader` implementations)](https://docs.spring.io/spring-batch/reference/readers-and-writers/database.html) — doc
- [Spring Batch 6.0.4 API — `org.springframework.batch.infrastructure.item.database.JdbcCursorItemReader`](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/infrastructure/item/database/JdbcCursorItemReader.html) — doc
- [Spring Batch 6.0 Migration Guide (Hibernate item readers removed; `infrastructure` package relocation)](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
