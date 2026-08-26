---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

An `ItemProcessor<I, O>` is the optional middle stage of a chunk-oriented step — it sits between the item reader and the item writer (the read→process→write loop described in `spring-batch-chunk-processing`) and is invoked once per read item. When a step declares no processor, items flow from reader to writer as-is; when one is present, Spring Batch hands each read item of type `I` to `process(...)` and forwards the returned object of type `O` to the writer. This is the designated home for business logic — enforcing rules, enriching, or reshaping data — kept out of the reading and writing code so concerns stay separated.

The contract covers three roles. **(1) Transform/enrich**: mutate or compute on the read item and return the same type (`I` == `O`), e.g. apply a discount or remap an ID. **(2) Change type**: read type `I` and produce a different write type `O` (read a `PartnerProduct`, emit a store `Product`); the reader, processor, and writer generics must line up. **(3) Hydrate a driving query**: the reader emits lightweight keys and the processor loads the full detail per item. Spring Batch also ships ready-made processors — `PassThroughItemProcessor` (no-op) and `ItemProcessorAdapter` (reuse an existing bean method). Returning `null` from `process` *filters* the item out; that follow-up belongs to `spring-batch-filtering-and-validating-items`, not here.

## Use Cases

- Applying business rules to read items before writing — discounts, defaults, computed fields — without touching the reader or writer.
- Remapping a partner's product IDs into the online store's own ID namespace (same type in and out) through a plain business POJO.
- Converting an incoming `PartnerProduct` record into the store's `Product` model when the read and write types differ.
- The driving-query pattern: a reader selects only row IDs (see `spring-batch-database-item-readers`) and the processor loads each full object, avoiding large locked result sets.
- Reusing an existing service method as a processor via `ItemProcessorAdapter`, with no custom `ItemProcessor` class to write.

## Deep Dive

### The `ItemProcessor<I, O>` contract

Spring Batch defines a one-method contract; you pick the concrete `I` and `O` in your implementation:

```java
package org.springframework.batch.item;

public interface ItemProcessor<I, O> {
    O process(I item) throws Exception;
}
```

The processor is wired into the chunk element with the `processor` attribute, alongside the reader and writer:

```xml
<batch:job id="readWriteJob">
  <batch:step id="readWriteStep">
    <batch:tasklet>
      <batch:chunk reader="reader" processor="processor"
                   writer="writer" commit-interval="100" />
    </batch:tasklet>
  </batch:step>
</batch:job>
```

If you have nothing to do yet, the built-in `PassThroughItemProcessor` returns each item unchanged — a useful default. Returning `null` instead signals filtering (the read item never reaches the writer); the filtering/validation contract, including `ValidatingItemProcessor`, lives in `spring-batch-filtering-and-validating-items`.

### Transforming in place: change the read item's state

When the read and written types are identical, the processor mutates the item and returns it. ACME imports each partner's catalog and must remap partner product IDs into the store's namespace. The business logic is a POJO that depends only on Spring JDBC, not on Spring Batch:

```java
public class PartnerIdMapper {
    private String partnerId;
    private JdbcTemplate jdbcTemplate;

    public Product map(Product partnerProduct) {
        String storeProductId = jdbcTemplate.queryForObject(
            "select store_product_id from partner_mapping " +
            "where partner_id = ? and partner_product_id = ?",
            String.class, partnerId, partnerProduct.getId());
        partnerProduct.setId(storeProductId);
        return partnerProduct;
    }
    // setPartnerId / setDataSource ...
}
```

A thin `ItemProcessor` delegates to that POJO. Both type arguments are `Product`, so the reader and writer keep working with the same object:

```java
public class PartnerIdItemProcessor implements ItemProcessor<Product, Product> {
    private PartnerIdMapper mapper;

    @Override
    public Product process(Product item) throws Exception {
        return mapper.map(item);   // same type in, same type out
    }
    public void setMapper(PartnerIdMapper mapper) { this.mapper = mapper; }
}
```

### Changing type: read `I`, write `O`

When partners ship a different model, the processor converts the read `PartnerProduct` into the store's `Product`. Only the type arguments change — the writer now receives `Product` objects:

```java
public class PartnerProductItemProcessor
        implements ItemProcessor<PartnerProduct, Product> {
    private PartnerProductMapper mapper;   // business POJO

    @Override
    public Product process(PartnerProduct item) throws Exception {
        return mapper.map(item);           // PartnerProduct in, Product out
    }
    public void setMapper(PartnerProductMapper mapper) { this.mapper = mapper; }
}
```

The generics have to line up end to end: the reader must emit `PartnerProduct`, the processor is `ItemProcessor<PartnerProduct, Product>`, and the writer must accept `Product`. Swap in a different partner's processor and you reuse the same reader and writer.

### Reusing a POJO with `ItemProcessorAdapter`

Writing a class whose only job is to delegate one call is boilerplate. `ItemProcessorAdapter` invokes any method on an existing bean, so the `PartnerIdMapper` above can act as a processor with no extra Java:

```xml
<bean id="processor"
      class="org.springframework.batch.item.adapter.ItemProcessorAdapter">
  <property name="targetObject" ref="partnerIdMapper" />
  <property name="targetMethod" value="map" />
</bean>
```

The adapter validates its configuration when the context starts, so a bad `targetMethod` fails fast — but it is less type-safe than a dedicated class, and the method name is a stringly-typed value you can mistype.

### The driving-query pattern

The driving query loads only the IDs to work with, then loads each full object one at a time. This can outperform one large cursor because some engines take pessimistic locks on big result sets, hurting concurrent access. In Spring Batch the reader runs the driving query and the processor hydrates each ID. A cursor reader selects just the IDs (fully configured in `spring-batch-database-item-readers`); the book narrows it with `where update_timestamp > ?` bound from a job parameter:

```xml
<bean id="reader"
      class="org.springframework.batch.item.database.JdbcCursorItemReader">
  <property name="dataSource" ref="dataSource"/>
  <property name="sql" value="select id from product"/>
  <property name="rowMapper">
    <bean class="org.springframework.jdbc.core.SingleColumnRowMapper">
      <constructor-arg value="java.lang.String" />
    </bean>
  </property>
</bean>
```

The processor takes the `String` ID and returns a fully loaded `Product`, so the type parameters are `<String, Product>`:

```java
public class IdToProductItemProcessor implements ItemProcessor<String, Product> {
    private ProductDao productDao;

    @Override
    public Product process(String productId) throws Exception {
        return productDao.load(productId);   // one row fetched per item
    }
    public void setProductDao(ProductDao productDao) { this.productDao = productDao; }
}
```

Because the processor is a natural place to call a DAO or ORM session, the pattern pairs well with Hibernate/JPA, whose caches can amortise the per-item loads.

### Book vs. today: `infrastructure.item.*` relocation and Java-config wiring

The `ItemProcessor<I, O>` contract carries over unchanged and is still heavily used — in Spring Batch 6 it is a `@FunctionalInterface`, so a lambda or method reference works anywhere a processor is expected. What moved is the packaging. Through 5.x the book's `org.springframework.batch.item.ItemProcessor` was correct; Spring Batch 6.0 relocated the item classes under `org.springframework.batch.infrastructure.item.*`, so the interface is now `org.springframework.batch.infrastructure.item.ItemProcessor`, `PassThroughItemProcessor` is `...infrastructure.item.support.PassThroughItemProcessor`, and `ItemProcessorAdapter` is `...infrastructure.item.adapter.ItemProcessorAdapter`. The pre-6.0 `org.springframework.batch.item.*` paths now 404 — a 6.0 upgrade is a hard import change. (Framework-wide, Spring Batch 5+ also rebased on Jakarta EE, turning `javax.*` EE imports into `jakarta.*`; the book's `javax.sql.DataSource` is a Java SE JDBC type and is unaffected.)

Wiring changed too. Since v4 each step is built with a fluent builder, and the `batch:` XML namespace is deprecated as of 6.0, so the recommended style is Java config with `StepBuilder.processor(...)`:

```java
@Bean
public ItemProcessor<PartnerProduct, Product> processor(PartnerProductMapper mapper) {
    return mapper::map;   // functional interface → method reference
}

@Bean
public Step readWriteStep(JobRepository jobRepository, PlatformTransactionManager tx,
        ItemReader<PartnerProduct> reader,
        ItemProcessor<PartnerProduct, Product> processor,
        ItemWriter<Product> writer) {
    return new StepBuilder("readWriteStep", jobRepository)
            .<PartnerProduct, Product>chunk(100, tx)
            .reader(reader).processor(processor).writer(writer)
            .build();
}
```

`ItemProcessorAdapter` still exists for reusing a POJO method. The driving-query pattern is also still valid, but today it is often replaced by a single paging reader with a join (`JdbcPagingItemReader`) when the join can be expressed in SQL, avoiding N per-item queries. Confirmed via the Spring Batch reference "Item processing" chapter, the Spring Batch 6.0.4 API Javadoc for `org.springframework.batch.infrastructure.item.ItemProcessor` / `...item.adapter.ItemProcessorAdapter` / `...item.support.PassThroughItemProcessor`, and the Spring Batch 6.0 Migration Guide.

## Trade-offs

- **Dedicated `ItemProcessor` vs. `ItemProcessorAdapter`** — a hand-written class is fully type-safe and easy to read; the adapter erases the boilerplate but is stringly-typed on `targetMethod` and only type-checks reflectively. It fails fast at context startup, not at compile time.
- **Mutate in place vs. return a new object** — mutating the read item is cheap but leaks side effects if the item is shared or the step restarts; producing a fresh `O` keeps the transformation clean but forces the reader/processor/writer generics to line up exactly.
- **Driving query vs. one join query** — selecting IDs then loading per item sidesteps pessimistic locks and huge result sets, but fires N extra queries; when a join is expressible, a paging reader is usually simpler and faster today.
- **One call per item** — `process` runs once per item, so heavy per-item remote/DB calls dominate throughput; prefer aggregating such work in the writer (which sees a whole chunk) over doing it item-by-item in the processor.
- **`null` filters silently** — returning `null` drops the item with no writer call and no error; this is filtering, not skipping, and its full contract is in `spring-batch-filtering-and-validating-items`.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 7, "Processing data", sections 7.1-7.2, "Processing items" / "Transforming items", p. 194-208 — doc
- [Spring Batch Reference — Item processing (`ItemProcessor`)](https://docs.spring.io/spring-batch/reference/processor.html) — doc
- [Spring Batch 6.0.4 API — `org.springframework.batch.infrastructure.item.ItemProcessor`](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/infrastructure/item/ItemProcessor.html) — doc
- [Spring Batch 6.0 Migration Guide (`infrastructure` package relocation; `batch:` XML deprecated)](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
