---
version: 1.0
updatedAt: 2026-08-01
---
## Objective

A chunk-oriented step's basic reader/processor/writer wiring says nothing about
what happens when an item fails. The book's `chunk` element attributes —
`skip-limit`, `retry-limit`, `cache-capacity`, plus the tasklet's own
`transaction-attributes` and `no-rollback-exception-classes` — are what turn a
step from "fails on the first bad row" into one that tolerates a bounded amount
of trouble. The Java configuration surface for this has moved twice since the
book was written: first onto `FaultTolerantStepBuilder`, and, as of Spring
Batch 6.0, onto `ChunkOrientedStepBuilder`'s policy-object model.

## Use Cases

- Importing a file where a handful of malformed rows shouldn't abort an
  otherwise-successful load of thousands of good rows — skip up to a bounded
  number, fail past that.
- Retrying an item write that failed on a transient condition (a deadlock from
  a concurrent process) without treating it as a permanent failure the first
  time.
- Choosing a transaction isolation level for a chunk's commit that matches how
  much concurrent write activity the target table sees, instead of leaving it
  at a database-chosen default that may be wrong for a high-contention import.
- Telling Spring Batch that a specific validation exception shouldn't roll
  back the chunk's transaction, because the record was already flagged and
  skipped, not a database-consistency problem.

## Deep Dive

### The book's XML: chunk fault-tolerance attributes

```xml
<batch:step id="readWrite">
  <batch:tasklet transaction-manager="transactionManager">
    <batch:chunk reader="productItemReader" processor="productItemProcessor"
                 writer="productItemWriter" commit-interval="100"
                 skip-limit="20" retry-limit="3" cache-capacity="100"
                 chunk-completion-policy="timeoutCompletionPolicy">
      <batch:skippable-exception-classes>
        <batch:include class="org.springframework.batch.item.file.FlatFileParseException"/>
        <batch:exclude class="java.io.FileNotFoundException"/>
      </batch:skippable-exception-classes>
      <batch:retryable-exception-classes>
        <batch:include class="org.springframework.dao.DeadlockLoserDataAccessException"/>
      </batch:retryable-exception-classes>
    </batch:chunk>
    <batch:transaction-attributes isolation="DEFAULT" propagation="REQUIRED" timeout="30"/>
    <batch:no-rollback-exception-classes>
      <batch:include class="org.springframework.batch.item.validator.ValidationException"/>
    </batch:no-rollback-exception-classes>
  </batch:tasklet>
</batch:step>
```

`skip-limit` caps how many failed items a step tolerates before failing outright;
`retry-limit` caps how many times a single item is retried on a transient
error; `cache-capacity` bounds the retry context cache (items awaiting
recovery across transactions) as a safeguard against unbounded memory growth
if items can't be reliably identified between attempts.

### Java configuration, era 1: `FaultTolerantStepBuilder` (still common today, but deprecated since 6.0)

```java
@Bean
public Step readWrite(JobRepository jobRepository, PlatformTransactionManager transactionManager,
                       ItemReader<Product> reader, ItemProcessor<Product, Product> processor,
                       ItemWriter<Product> writer) {
    return new StepBuilder("readWrite", jobRepository)
        .<Product, Product>chunk(100, transactionManager)
        .reader(reader)
        .processor(processor)
        .writer(writer)
        .faultTolerant()
        .skip(FlatFileParseException.class)
        .skipLimit(20)
        .noSkip(FileNotFoundException.class)
        .retry(DeadlockLoserDataAccessException.class)
        .retryLimit(3)
        .retryContextCache(new MapRetryContextCache(100))   // cache-capacity
        .noRollback(ValidationException.class)
        .transactionAttribute(transactionAttribute())        // isolation/propagation/timeout
        .build();
}

private TransactionAttribute transactionAttribute() {
    DefaultTransactionAttribute attr = new DefaultTransactionAttribute();
    attr.setIsolationLevel(TransactionDefinition.ISOLATION_DEFAULT);
    attr.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRED);
    attr.setTimeout(30);
    return attr;
}
```

Every XML attribute has a near-1:1 builder call: `skip-limit`→`.skipLimit()`,
`retry-limit`→`.retryLimit()`, `cache-capacity`→`.retryContextCache(new
MapRetryContextCache(n))`, `no-rollback-exception-classes`→`.noRollback(...)`.
This is the shape most Spring Batch 4.x/5.x codebases use today — and it's
**exactly** the API the book's own attributes translate to, which is why it's
worth learning even though it's now deprecated: it's still what you'll read in
most production code and most tutorials.

### Java configuration, era 2: `ChunkOrientedStepBuilder` (Spring Batch 6.0+, the current direction)

Spring Batch 6.0 deprecated `FaultTolerantStepBuilder` (removal planned for
7.0) in favor of `ChunkOrientedStepBuilder`, which drops the individual
`skip(class)`/`skipLimit(n)`/`retry(class)`/`retryLimit(n)` convenience
methods in favor of supplying policy objects directly:

```java
@Bean
public Step readWrite(JobRepository jobRepository, PlatformTransactionManager transactionManager,
                       ItemReader<Product> reader, ItemProcessor<Product, Product> processor,
                       ItemWriter<Product> writer) {
    return new StepBuilder("readWrite", jobRepository)
        .chunk(100)
        .reader(reader)
        .processor(processor)
        .writer(writer)
        .transactionAttribute(transactionAttribute())
        .faultTolerant()
        .skipPolicy(skipPolicy())
        .retryPolicy(retryPolicy())
        .build();
}

private SkipPolicy skipPolicy() {
    Map<Class<? extends Throwable>, Boolean> skippable = Map.of(
        FlatFileParseException.class, true,
        FileNotFoundException.class, false);
    return new LimitCheckingItemSkipPolicy(20, skippable);   // skip-limit + skippable-exception-classes, combined
}

private RetryPolicy retryPolicy() {
    return RetryPolicy.builder()
        .maxAttempts(3)                                      // retry-limit
        .includes(DeadlockLoserDataAccessException.class)
        .build();
}
```

Two things changed, not just the method names: `RetryPolicy` here is
`org.springframework.core.retry.RetryPolicy` — **Spring Framework's own core
retry feature**, not the separate Spring Retry library `FaultTolerantStepBuilder`
depended on — and skip logic is expressed as a single `SkipPolicy` object
(`LimitCheckingItemSkipPolicy` combines what `skip-limit` +
`skippable-exception-classes` used to split across two things) rather than a
limit plus a list of include/exclude calls. `cache-capacity`'s retry-context
cache and `no-rollback-exception-classes` don't have a direct equivalent in
this new builder as of Spring Batch 6.0 — the retry cache concern is
handled internally by the new core-retry integration.

## Trade-offs

- **`FaultTolerantStepBuilder` is deprecated, not gone.** It's still present in
  Spring Batch 6.x and is what most existing codebases use — don't be
  surprised to see it in real projects. Removal is planned for 7.0, so
  existing `.skip()`/`.retry()`/`.retryLimit()` chains need a migration plan,
  not an urgent rewrite.
- **The move to explicit `SkipPolicy`/`RetryPolicy` objects is more verbose for
  the simple case** (a single limit and a couple of exception classes) but
  scales better for custom logic — a `SkipPolicy` implementation can consult
  external state (a circuit breaker, a per-item retry count from a database)
  in a way `skipLimit`/`skip(class)` never could.
- **`cache-capacity`'s safeguard (throwing when too many items are mid-retry
  without being skipped/recovered) matters most for large, highly
  concurrent chunks** — a cache sized too small on a step with a large
  commit-interval and a flaky downstream dependency will throw
  `RetryCacheCapacityExceededException` well before the actual `retry-limit`
  is hit for any single item.
- **`no-rollback-exception-classes` is specifically for exceptions that mean
  "this item was already handled" (like a validation failure that's also
  being skipped), not general error tolerance** — marking the wrong
  exception as no-rollback can commit a transaction that left the database
  in a state the step didn't intend.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 3, "Batch configuration", sections 3.2.4-3.2.5, p. 61-71 — doc
- [Spring Batch API — FaultTolerantStepBuilder (deprecated since 6.0)](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/core/step/builder/FaultTolerantStepBuilder.html) — doc
- [Spring Batch API — ChunkOrientedStepBuilder](https://docs.spring.io/spring-batch/docs/6.0.0-M2/api/org/springframework/batch/core/step/builder/ChunkOrientedStepBuilder.html) — doc
- [Spring Batch API — LimitCheckingItemSkipPolicy](https://docs.spring.io/spring-batch/docs/current/api/org/springframework/batch/core/step/skip/LimitCheckingItemSkipPolicy.html) — doc
- [Spring Batch 6.0 release announcement](https://spring.io/blog/2025/08/20/spring-batch-6/) — doc
