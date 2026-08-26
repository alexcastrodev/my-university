---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

Writing is the last phase of chunk-oriented processing, and Spring Batch models it with one contract, `ItemWriter<T>`, whose `write(...)` receives the **whole chunk at once** rather than a single item. Database writers differ in spirit from file writers: a file writer has to imitate a transaction (buffering written items and flushing at commit), but a database write is already inside a transaction, so no such bookkeeping is needed. What the JDBC writer adds instead is throughput — `JdbcBatchItemWriter` accumulates the chunk's N items and issues them as a *single* JDBC batch (`PreparedStatement.addBatch()` per item, then one `executeBatch()`), so N inserts collapse into one database round-trip per chunk.

This is the write-side mirror of chunked reading (`spring-batch-database-item-readers`) and hangs off the same chunk step (`spring-batch-chunk-processing`): the reader/processor fill a chunk, the writer flushes it, and the step's transaction commits — all at the chunk boundary. Two families exist: JDBC (`JdbcBatchItemWriter`) and ORM (`JpaItemWriter`, plus the book's now-removed `HibernateItemWriter`). These writers target your *business* tables; the batch metadata tables are a separate `DataSource` concern (`spring-batch-job-repository-database-configuration`), and unlike file writers there is no per-format writer to configure (contrast `spring-batch-writing-files`).

## Use Cases

- Bulk-inserting a processed chunk of `Product` rows with one batched `INSERT` per commit interval instead of one statement per item.
- Binding SQL named parameters (`:id`, `:name`) straight from JavaBean properties, with no hand-written parameter code.
- Using positional `?` markers when column-to-property mapping needs explicit, typed control (custom conversions, ordering).
- Persisting JPA/Hibernate entities and letting the ORM decide `INSERT` vs. `UPDATE`, flushing once per chunk.
- Catching a silent no-op write — a statement that updated zero rows — via `assertUpdates`.

## Deep Dive

### `JdbcBatchItemWriter`: one JDBC batch per chunk (the throughput win)

`JdbcBatchItemWriter` sits on top of Spring's JDBC layer and needs two things: a `sql` statement and **exactly one** binding strategy — an `ItemSqlParameterSourceProvider` (named parameters) or an `ItemPreparedStatementSetter` (positional `?`). The book's named-parameter configuration wires the stock `BeanPropertyItemSqlParameterSourceProvider`, which maps each `:param` to the matching bean property:

```xml
<bean id="productItemWriter"
      class="org.springframework.batch.item.database.JdbcBatchItemWriter">
  <property name="dataSource" ref="dataSource"/>
  <property name="sql"
            value="INSERT INTO PRODUCT (ID, NAME, PRICE) VALUES (:id, :name, :price)"/>
  <property name="itemSqlParameterSourceProvider">
    <bean class="org.springframework.batch.item.database.BeanPropertyItemSqlParameterSourceProvider"/>
  </property>
  <property name="assertUpdates" value="true"/>
</bean>
```

The batch size equals the commit interval configured on the chunk step: for a chunk of N items the writer builds N parameter sources, adds each to the batch, and fires a single `executeBatch()` — one round-trip instead of N. That is *why* batched writes are the throughput payoff of chunk-oriented processing on the write side, exactly as paged/cursor reads are on the read side (`spring-batch-database-item-readers`). With `assertUpdates` at its default `true`, a statement that updates zero rows throws `EmptyResultDataAccessException`, catching, say, an `UPDATE` whose key was absent.

### Positional parameters: `ItemPreparedStatementSetter`

When you want to fill the statement yourself, switch to `?` markers and an `ItemPreparedStatementSetter`, which hands you the `PreparedStatement` for each item:

```java
public class ProductItemPreparedStatementSetter
        implements ItemPreparedStatementSetter<Product> {
    @Override
    public void setValues(Product item, PreparedStatement ps) throws SQLException {
        ps.setString(1, item.getId());
        ps.setString(2, item.getName());
        ps.setBigDecimal(3, item.getPrice());
    }
}
```

```xml
<bean id="productItemWriter"
      class="org.springframework.batch.item.database.JdbcBatchItemWriter">
  <property name="dataSource" ref="dataSource"/>
  <property name="sql" value="INSERT INTO PRODUCT (ID, NAME, PRICE) VALUES (?, ?, ?)"/>
  <property name="itemPreparedStatementSetter">
    <bean class="com.manning.sbia.ch06.database.ProductItemPreparedStatementSetter"/>
  </property>
</bean>
```

The batching is identical; only the binding style changes. Named binding is zero-code when parameter names match bean properties; positional binding trades that convenience for explicit, per-column control.

### ORM writers: `JpaItemWriter` and `HibernateItemWriter`

An ORM writer hides the JDBC layer and lets the persistence context decide `INSERT` vs. `UPDATE`. The core of the book's `HibernateItemWriter` saves or updates each entity not already in the session, then flushes **once** at the end of the chunk:

```java
protected void doWrite(HibernateOperations hibernateTemplate, List<? extends T> items) {
    for (T item : items) {
        if (!hibernateTemplate.contains(item)) {
            hibernateTemplate.saveOrUpdate(item);
        }
    }
}
@Override
public void write(List<? extends T> items) {   // book signature (Spring Batch 2.x)
    doWrite(hibernateTemplate, items);
    hibernateTemplate.flush();                  // one flush per chunk
}
```

`JpaItemWriter` is the JPA equivalent, configured with an `EntityManagerFactory` (and the entity declared in `META-INF/persistence.xml`):

```xml
<bean id="productItemWriter"
      class="org.springframework.batch.item.database.JpaItemWriter">
  <property name="entityManagerFactory" ref="entityManagerFactory"/>
</bean>
```

It `merge`s each item not already managed, then flushes the entity manager once per chunk. Because `saveOrUpdate`/`merge` may trigger a `SELECT` before the `INSERT`/`UPDATE`, ORM writers do more work per item than a raw JDBC batch — portability and cascade handling in exchange for overhead. Crucially, that flush lands **inside the chunk transaction**: Spring Batch wraps each chunk in a transaction (`spring-batch-chunk-processing`), the writer runs, and the commit flushes the JDBC batch or ORM session; any exception rolls the whole chunk back, so no partial chunk is persisted.

### Book vs. today: builders replace XML, and 6.0 relocated the packages

Four things changed since the book (Spring Batch 2.x, 2012).

First, since **Spring Batch 4** fluent builders replace the XML. `JdbcBatchItemWriterBuilder` (since 4.0) constructs the writer; `.beanMapped()` installs a `BeanPropertyItemSqlParameterSourceProvider`, while `.itemPreparedStatementSetter(...)`/`.columnMapped()` cover positional binding:

```java
@Bean
public JdbcBatchItemWriter<Product> productItemWriter(DataSource dataSource) {
    return new JdbcBatchItemWriterBuilder<Product>()
            .dataSource(dataSource)
            .sql("INSERT INTO PRODUCT (ID, NAME, PRICE) VALUES (:id, :name, :price)")
            .beanMapped()          // BeanPropertyItemSqlParameterSourceProvider
            .assertUpdates(true)
            .build();
}
```

`JpaItemWriterBuilder` (since 4.1) does the same for JPA — and note `JpaItemWriter` now takes its `EntityManagerFactory` by **constructor** (5.0+ removed the default-constructor-plus-setter style), with `.usePersist(true)` to call `persist` instead of the default `merge`:

```java
@Bean
public JpaItemWriter<Product> productJpaWriter(EntityManagerFactory emf) {
    return new JpaItemWriterBuilder<Product>()
            .entityManagerFactory(emf)   // jakarta.persistence, not javax.persistence
            .usePersist(true)
            .build();
}
```

Second, the **6.0 package relocation**: these classes moved from `org.springframework.batch.item.database.*` to `org.springframework.batch.infrastructure.item.database.*` (builders under `...infrastructure.item.database.builder`, and the `ItemWriter` interface to `org.springframework.batch.infrastructure.item.ItemWriter`). The book's and 5.x's `org.springframework.batch.item.database.*` paths now 404.

Third, the write signature changed: `write(List<? extends T>)` (book) became `write(Chunk<? extends T>)` in Spring Batch 5.0, where `Chunk` is `org.springframework.batch.infrastructure.item.Chunk`.

Fourth, `HibernateItemWriter` was deprecated-for-removal in 5.x and **removed in 6.0** — migrate to `JpaItemWriter`, which works with Hibernate as the JPA provider (and `javax.persistence` became `jakarta.persistence` in 5.0). The XML `batch:` namespace still parses but is deprecated as of 6.0 (removal planned for 7.0), so Java config plus builders is the recommended style. Confirmed via the Spring Batch 6.0.x API Javadoc for `JdbcBatchItemWriter`, `JpaItemWriter`, `JdbcBatchItemWriterBuilder`, and `JpaItemWriterBuilder`, the 5.0.5 `HibernateItemWriter` Javadoc (deprecated for removal), the Spring Batch 6.0 Migration Guide, and the Database ItemReaders/Writers reference.

## Trade-offs

- **Named vs. positional binding** — `BeanPropertyItemSqlParameterSourceProvider` (`:name`) is zero-code when SQL parameter names match bean properties; an `ItemPreparedStatementSetter` (`?`) is more code but gives explicit, typed control and per-column conversions. Convention vs. control.
- **JDBC batch vs. ORM writer** — `JdbcBatchItemWriter` is the fastest path: one `executeBatch()` per chunk, no extra `SELECT`s, full command of the SQL. `JpaItemWriter` buys dialect portability and cascade/identity handling, but `merge`/`saveOrUpdate` may issue a `SELECT` per item and generally does more work.
- **Batching hides which item failed** — because the whole chunk is flushed at commit, a `DataIntegrityViolationException` surfaces at flush time, not at the offending item; reliable skip/retry forces Spring Batch to fall back to item-at-a-time writes, trading throughput for pinpoint error handling.
- **`assertUpdates` on vs. off** — leaving it `true` (default) catches a statement that matched zero rows by throwing `EmptyResultDataAccessException`; you must turn it off for idempotent `MERGE`/upsert-style statements that may legitimately affect no rows.
- **No batch writer at all** — since a DB write is already transactional, an `ItemWriter` over a plain DAO is perfectly valid; you forgo the single-round-trip batching but gain arbitrary write logic. Batching is an optimization, not a requirement.

  ```java
  public class ProductDaoItemWriter implements ItemWriter<Product> {
      private final ProductDao dao;
      public ProductDaoItemWriter(ProductDao dao) { this.dao = dao; }
      @Override
      public void write(Chunk<? extends Product> chunk) {   // still inside the chunk transaction
          chunk.forEach(dao::save);                          // one call per item, no JDBC batch
      }
  }
  ```

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 6, "Writing data", section 6.3, "Writing to databases", p. 179-183 — doc
- [Spring Batch Reference — Database ItemReaders and ItemWriters](https://docs.spring.io/spring-batch/reference/readers-and-writers/database.html) — doc
- [Spring Batch 6.0 API — JdbcBatchItemWriter](https://docs.spring.io/spring-batch/docs/6.0.x/api/org/springframework/batch/infrastructure/item/database/JdbcBatchItemWriter.html) — doc
- [Spring Batch 6.0 Migration Guide](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
