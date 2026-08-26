---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

The processing phase of a chunk-oriented step is not only for transforming read items (see `spring-batch-item-processing-and-transformation`) — an `ItemProcessor` can also *remove* items and *reject* them. This concept covers two related uses of that phase: **filtering** (a `process()` that returns `null` drops the item so the `ItemWriter` never sees it) and **validation** (enforcing business rules, either filtering invalid items or throwing to skip them), plus **chaining** several processors with `CompositeItemProcessor`.

The single most important idea is that *filtering is not skipping*. Returning `null` is a deliberate "don't write this record" decision counted as `filterCount`; throwing an exception is an error that the fault-tolerance machinery turns into a *skip* (`skipCount`) — a separate mechanism detailed in `spring-batch-skip-policy-and-listeners`. Both keep the item out of the writer, but they mean different things and are tracked separately in the job repository.

## Use Cases

- Discarding records that already exist in the target table so a nightly import only inserts new rows and never locks/updates rows the online store is serving.
- Rejecting business-invalid items (a negative product price, a malformed field) before they can reach the database.
- Reusing the same Bean Validation constraints (`@NotNull`, `@Min`) across the web layer, the JPA layer, and the batch job instead of re-encoding them three times.
- Enforcing several independent business rules in one step by chaining single-purpose processors with `CompositeItemProcessor`.
- Choosing per rule whether a failure is a *filter* (silently not written) or a *skip* (an error tolerated up to a limit), because the job-repository counts differ.

## Deep Dive

### Filtering: return `null` to drop an item from the chunk

The filtering contract is deliberately tiny: **if `process()` returns `null`, the item does not go to the `ItemWriter`.** Everything else about the processor is normal. The book's example discards products already in the database, so the import inserts new records only:

```java
public class ExistingProductFilterItemProcessor
    implements ItemProcessor<Product, Product> {

  private static final String SQL_COUNT_PRODUCT =
      "select count(1) from product where id = ?";
  private JdbcTemplate jdbcTemplate;

  @Override
  public Product process(Product item) throws Exception {
    return needsToBeFiltered(item) ? null : item;   // null -> filtered out
  }

  private boolean needsToBeFiltered(Product item) {
    return jdbcTemplate.queryForInt(SQL_COUNT_PRODUCT, item.getId()) != 0;
  }
}
```

Wiring it is nothing special — the processor sits between the reader and writer of a chunk-oriented step (see `spring-batch-chunk-processing`), and the returned `null`s simply never accumulate into the chunk handed to the writer. The book's best-practice advice is to **not mix filtering and transformation in one processor**: if you need both, use two processors and chain them (see `CompositeItemProcessor` below).

### Filter is not skip

This is the distinction the book hammers on, and it is unchanged today:

- **Filtering** means "Spring Batch shouldn't *write* this record" — a normal outcome. You signal it by returning `null`, and it increments the step's `filterCount`.
- **Skipping** means "this record is *invalid*" — an error outcome. You signal it by *throwing*, and only if a skip policy is configured is the exception tolerated (otherwise the step fails). It increments `skipCount`.

```java
@Override
public Product process(Product item) throws Exception {
  if (alreadyImported(item)) {
    return null;                                       // FILTER: filterCount++
  }
  if (item.getPrice().signum() < 0) {
    throw new ValidationException("negative price");   // SKIP (if skippable): skipCount++
  }
  return item;
}
```

Both keep the item out of the writer, but the job repository records them separately, and skipping is driven by the fault-tolerant step configuration and its listeners — see `spring-batch-skip-policy-and-listeners`.

### Validation with `ValidatingItemProcessor` and the `Validator` contract

Rather than hand-coding the throw-or-return decision, Spring Batch ships `ValidatingItemProcessor`, which wraps a `Validator` and exposes a `filter` flag:

- `filter = false` (default) → a `ValidationException` from the validator is **re-thrown** (skip).
- `filter = true` → the item is **filtered** (`null` returned) instead.

The `Validator` contract is a single method, and a custom validator for the "no negative price" rule looks like this:

```java
package org.springframework.batch.item.validator; // pre-6.0 package

public interface Validator<T> {
  void validate(T value) throws ValidationException;
}

public class ProductValidator implements Validator<Product> {
  @Override
  public void validate(Product product) throws ValidationException {
    if (BigDecimal.ZERO.compareTo(product.getPrice()) >= 0) {
      throw new ValidationException("Product price cannot be negative!");
    }
  }
}
```

Because the default `filter` is `false`, the processor *skips* on failure, so you must make `ValidationException` skippable or the whole job fails:

```xml
<batch:chunk reader="reader" processor="processor" writer="writer"
             commit-interval="100" skip-limit="5">
  <batch:skippable-exception-classes>
    <batch:include class="org.springframework.batch.item.validator.ValidationException"/>
  </batch:skippable-exception-classes>
</batch:chunk>

<bean id="processor"
      class="org.springframework.batch.item.validator.ValidatingItemProcessor">
  <property name="filter" value="false"/>
  <property name="validator">
    <bean class="com.manning.sbia.ch07.validation.ProductValidator"/>
  </property>
</bean>
```

Flip `filter` to `true` and you no longer need any skip configuration — the invalid item is quietly filtered instead of skipped.

### Bean Validation with annotations

The book's most reusable approach is JSR-303 Bean Validation: put the constraints on the class itself and enforce them anywhere (web, JPA, batch):

```java
public class Product {
  private BigDecimal price;

  @NotNull
  @Min(0)                       // book import: javax.validation.constraints.*
  public BigDecimal getPrice() { return price; }
}
```

In 2012 the book then hand-wrote a `BeanValidationValidator` that bootstrapped a JSR-303 `ValidatorFactory`, called `validator.validate(value)`, and translated any `ConstraintViolation`s into a Spring Batch `ValidationException` before injecting it into a `ValidatingItemProcessor`. Today that glue is built in — see "Book vs. today" below.

### Chaining with `CompositeItemProcessor`

A step allows only *one* processor between reader and writer. To run several business rules, apply the composite pattern: `CompositeItemProcessor` holds a list of delegates and calls them in order, each one's output feeding the next.

```xml
<bean id="processor"
      class="org.springframework.batch.item.support.CompositeItemProcessor">
  <property name="delegates">
    <list>
      <ref bean="productMapperProcessor"/>   <!-- PartnerProduct -> Product -->
      <ref bean="productIdMapperProcessor"/> <!-- partner ID -> ACME ID     -->
    </list>
  </property>
</bean>
```

Two rules matter. First, the delegates must form a **type-compatible chain**: the output type of one must match the input type of the next. Second, **`null` short-circuits the whole chain** — if any delegate returns `null`, the composite stops and the item is filtered, so a filtering processor placed anywhere in the list still removes the item for the entire step. The composite reuses the delegates as-is, which is exactly why the book recommends one processor per concern.

### Book vs. today: Bean Validation is built in, and the classes moved packages

Three concrete changes since 2012:

1. **You no longer hand-write a Bean Validation bridge.** Spring Batch ships `BeanValidatingItemProcessor` (a subclass of `ValidatingItemProcessor`, since 4.1) that drives JSR-303 / Jakarta Bean Validation annotations out of the box, so the book's custom `BeanValidationValidator` is obsolete:

```java
@Bean
public BeanValidatingItemProcessor<Product> validatingProcessor() {
  BeanValidatingItemProcessor<Product> p = new BeanValidatingItemProcessor<>();
  p.setFilter(false); // false = skip on violation, true = filter — same flag as before
  return p;
}
```

2. **`javax.validation` → `jakarta.validation`.** As of Spring Batch 5.0 (Spring Framework 6 / Jakarta EE 9+), the annotations are `jakarta.validation.constraints.Min` / `.NotNull`; the book's `javax.validation.*` imports no longer resolve. (The book's declarative Valang / Spring Modules validator is long defunct; Bean Validation is the idiomatic path today.)

3. **The item classes were relocated in Spring Batch 6.0** from `org.springframework.batch.item.*` to `org.springframework.batch.infrastructure.item.*`. The modern fully-qualified names are `org.springframework.batch.infrastructure.item.validator.ValidatingItemProcessor` / `BeanValidatingItemProcessor` / `.validator.Validator` / `ValidationException`, and `org.springframework.batch.infrastructure.item.support.CompositeItemProcessor`; the pre-6.0 paths now 404. The `filter` semantics and the null-returns-filter contract are otherwise unchanged, and the XML `batch:` namespace shown above is deprecated as of 6.0 (removal planned for 7.0) in favor of Java `JobBuilder`/`StepBuilder` config. Confirmed via the Spring Batch 6.0.x Javadoc for `ValidatingItemProcessor`, `BeanValidatingItemProcessor`, and `CompositeItemProcessor`, the Spring Batch 5.0/6.0 migration guides, and the Spring Batch reference "Item processing" chapter.

## Trade-offs

- **Filter vs. skip is a modeling decision, not a technicality** — returning `null` says "correctly not written," throwing says "invalid." They diverge in the job repository (`filterCount` vs `skipCount`) and in behavior: a skip needs a configured skip limit and can fail the job when exceeded, while a filter is always silent. Pick the one that matches what the record actually means.
- **Declarative Bean Validation vs. programmatic `Validator`** — annotations on the item are reusable across web/JPA/batch and keep rules in one place, but a hand-written `Validator` can reach into collaborators (e.g., a `JdbcTemplate`) for cross-record consistency checks that annotations can't express. Use annotations for state rules, a custom validator for contextual ones.
- **Separate filtering from transformation** — the book's best practice is one processor per concern, composed with `CompositeItemProcessor`, rather than a single processor that both mutates and drops items. It keeps each rule reusable and testable, at the cost of an extra bean and an ordering you must get right (a `null` from an early delegate short-circuits the rest).
- **`filter = true` hides rejections** — filtering invalid items instead of skipping them avoids skip configuration and never fails the job, but bad data then disappears with no exception and only a `filterCount` to show for it; skipping (with a `SkipListener`) gives you a hook to log or divert the offending record.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 7, "Processing data", sections 7.3-7.4, "Filtering and validating items" / "Chaining item processors", p. 208-221 — doc
- [Spring Batch Reference — Item processing (filtering & validating input)](https://docs.spring.io/spring-batch/reference/processor.html) — doc
- [ValidatingItemProcessor — Spring Batch 6.0.x Javadoc (filter flag, infrastructure package)](https://docs.spring.io/spring-batch/docs/6.0.x/api/org/springframework/batch/infrastructure/item/validator/ValidatingItemProcessor.html) — doc
- [BeanValidatingItemProcessor — Spring Batch 6.0.x Javadoc (JSR-303 / Jakarta Bean Validation)](https://docs.spring.io/spring-batch/docs/6.0.x/api/org/springframework/batch/infrastructure/item/validator/BeanValidatingItemProcessor.html) — doc
- [Spring Batch 6.0 Migration Guide — package relocation & XML namespace deprecation](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
