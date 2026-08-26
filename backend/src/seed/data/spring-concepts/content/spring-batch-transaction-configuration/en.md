---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

Spring Batch manages transactions at the **step** level: it never wraps a whole
multi-step job in a single transaction. Unlike a web application — where you demarcate
transactions yourself or with declarative `@Transactional` and let the request/response
cycle drive them — **Spring Batch drives both the flow and the transactions**: your code
doesn't decide when a transaction begins, commits, or rolls back; the framework does. For
a chunk-oriented step the boundary is the chunk — `commit-interval` items are read,
processed, written, and committed as one unit, and any failure rolls the whole chunk back.
For a `TaskletStep`, each `Tasklet.execute()` call is its own transaction.

This concept covers the model end to end: a transaction primer (ACID,
`PlatformTransactionManager`, isolation, propagation), where the boundary sits in
chunks, tasklets, and listeners, the pitfalls of declarative `@Transactional` and
transactional readers, and how to pick the right transaction manager.

## Use Cases

- Running a batch job **concurrently with an online application** and raising the
  isolation level so neither reads the other's half-written data — or lowering it
  when the batch is the sole writer, trading isolation for speed.
- Putting a **timeout** on a chunk's transaction so a stuck row lock fails the step
  instead of hanging it indefinitely.
- Choosing the right `PlatformTransactionManager` per step: JDBC, JPA, or a
  resourceless one when nothing transactional is touched.
- Draining a **JMS queue** where a chunk rollback must un-read (requeue) messages,
  so the reader is marked transactional and the processor made idempotent.
- Setting `PROPAGATION_NEVER` on a tasklet that only decompresses a ZIP or signs a
  file, so no transaction is started around non-transactional work.

## Deep Dive

### A transaction primer: ACID and the `PlatformTransactionManager`

A transaction makes a data-store interaction **ACID** — Atomic (all operations
succeed or none do), Consistent (leaves the store valid), Isolated (concurrent
transactions don't see each other's partial data), and Durable (a commit survives
failure). Spring's whole transaction abstraction hangs off one strategy interface,
and Spring Batch uses exactly this — nothing batch-specific:

```java
public interface PlatformTransactionManager extends TransactionManager {
    TransactionStatus getTransaction(TransactionDefinition definition) throws TransactionException;
    void commit(TransactionStatus status) throws TransactionException;
    void rollback(TransactionStatus status) throws TransactionException;
}
```

A `TransactionDefinition` carries the **propagation** (REQUIRED, REQUIRES_NEW, NEVER,
…), **isolation** level, and **timeout**. Isolation is the dial you tune most in batch
jobs, trading correctness under concurrency for throughput — from `READ_UNCOMMITTED`
(dirty, non-repeatable, and phantom reads all possible) up to `SERIALIZABLE` (none, but slow).

### Where the boundary sits: one transaction per chunk, one per `Tasklet.execute()`

A chunk-oriented step commits at the chunk boundary — one transaction for all
`commit-interval` items (efficient), where an error affects only the current chunk
(robust). The rollback rule is specific: **an exception from the item processor or
writer triggers a rollback; an exception from the item reader does not** — the read
happens effectively outside the chunk's write transaction, regardless of skip/retry
configuration. See `spring-batch-chunk-processing`, where the chunk *is* the
transaction, for the read → process → write → commit loop itself.

A `TaskletStep` is different: each `execute()` call runs in its own transaction, and
Spring Batch keeps calling it while it returns `RepeatStatus.CONTINUABLE`.

```java
public interface Tasklet {
    RepeatStatus execute(StepContribution contribution, ChunkContext chunkContext) throws Exception;
}
```

Because every `execute()` is transactional, a tasklet that touches no transactional
resource (decompressing a ZIP, say) should set propagation to `PROPAGATION_NEVER`
rather than pay for a pointless transaction.

Listeners are the subtle case — **there is no blanket rule; check the Javadoc**.
`ChunkListener.beforeChunk()` runs *inside* the chunk transaction, `afterChunk()`
*outside* it; the read/process/write error callbacks run inside a transaction Batch
is *about to roll back*, so a listener logging to a database must open its own
`REQUIRES_NEW` transaction or lose the log (see `spring-batch-execution-listeners`).

### Overriding the defaults: transaction attributes

The defaults are fine most of the time; override them per step when the use case
demands it. In the book this is the `transaction-attributes` element inside the
tasklet:

```xml
<step id="importProductsStep">
  <tasklet>
    <chunk reader="reader" writer="writer" commit-interval="100" />
    <transaction-attributes isolation="READ_UNCOMMITTED" propagation="REQUIRED" timeout="30" />
  </tasklet>
</step>
```

`READ_UNCOMMITTED` here says "I'm the only process on this data." This is a
*different* knob from the `JobRepository`'s `isolation-level-for-create`, which
protects the creation of `JobExecution` rows and defaults to `SERIALIZABLE` (see
`spring-batch-job-repository-database-configuration`) — don't conflate the two.

### Pitfalls: declarative `@Transactional` and transactional readers

Declarative transaction management is a best friend online and a potential enemy in
a batch job. Since Spring Batch already owns the transaction, `@Transactional` code
with the default `REQUIRED` propagation simply *joins* the Batch transaction —
usually harmless. But an `@Transactional(propagation = REQUIRES_NEW)` method runs in
its **own** transaction independent of the chunk, so it commits even if the chunk
later rolls back — quietly breaking chunk atomicity.

Two guidelines: **disable declarative transactions** (no `tx:annotation-driven`) in
a batch application, and mind propagation if they must stay on. A second trap is
**self-invocation**: a `@Transactional` method called from *within the same bean*
bypasses the Spring proxy, so the annotation does nothing.

The **transactional reader** pitfall is sharper. To support retry, Spring Batch
buffers a chunk's read items and re-submits them from its cache on a retryable write
error instead of reading again. That's fine for a database but wrong for a JMS
queue: reading *dequeues* the message and a rollback *requeues* it, so replaying
from cache leaves the message on the queue **and** processes it — again. Disable the
cache by declaring the reader transactional:

```xml
<chunk reader="reader" writer="writer" commit-interval="100"
       reader-transactional-queue="true" />
```

In Java configuration the equivalent is `.readerIsTransactionalQueue()` on the
fault-tolerant builder. With the cache off, the processor may **re-run** after a
rollback (`processor-transactional` defaults to `true`), so it must be
**idempotent**. JMS is the canonical case — see
`spring-batch-custom-and-service-readers` for the transactional JMS reader, and
`spring-batch-transaction-patterns` for the multi-resource (global/XA) patterns that
build on it.

### Choosing the transaction manager

The manager must match the resource; wire it into `.chunk(size, txManager)` or
`.tasklet(tasklet, txManager)`:

- **`DataSourceTransactionManager`** (`org.springframework.jdbc.datasource`) — plain
  JDBC, the common case for a `JdbcBatchItemWriter`.
- **`JpaTransactionManager`** (`org.springframework.orm.jpa`) — when the writer goes
  through a JPA `EntityManager`.
- **`ResourcelessTransactionManager`** — a no-op for a step with **no** real
  transactional resource (a flat-file-only step, or an in-memory `JobRepository`); it
  fakes begin/commit/rollback so the framework's transaction path still works.

### Book vs. today: XML transaction config → `.transactionManager()` / `.transactionAttribute()`, and `jakarta.transaction`

The **core model is unchanged**: Spring Batch still handles transactions at the step
level through a `PlatformTransactionManager`, the chunk is still the transaction
boundary, and processor/writer exceptions still trigger rollback (with
`no-rollback-exception-classes` still the escape hatch — see
`spring-batch-fault-tolerant-step-configuration`). What moved is the configuration
surface: the book's XML `transaction-attributes` become builder calls, and the
transaction manager is now an **explicit, required** argument, not an implicit
default:

```java
@Bean
public Step step1(JobRepository jobRepository, PlatformTransactionManager transactionManager) {
    DefaultTransactionAttribute attribute = new DefaultTransactionAttribute();
    attribute.setPropagationBehavior(Propagation.REQUIRED.value());
    attribute.setIsolationLevel(Isolation.DEFAULT.value());
    attribute.setTimeout(30);

    return new StepBuilder("step1", jobRepository)
                .<String, String>chunk(2).transactionManager(transactionManager)
                .reader(itemReader())
                .writer(itemWriter())
                .transactionAttribute(attribute)
                .build();
}
```

Three further changes since 2012: `javax.transaction` became `jakarta.transaction`
when Spring 6 / Spring Batch 6 adopted the Jakarta EE 9+ baseline;
`ResourcelessTransactionManager` was relocated in 6.0 from
`org.springframework.batch.support.transaction` to
`org.springframework.batch.infrastructure.support.transaction`; and the XML `batch:`
namespace (including `transaction-attributes`) is deprecated as of 6.0 with removal
planned for 7.0, making the Java builder above the forward path. Confirmed via the
Spring Batch reference "Transaction Attributes", the Spring Batch 6.0.x API Javadoc
for `ResourcelessTransactionManager`, the Spring Batch 6.0 Migration Guide, and the
Spring Framework "Transaction Strategies" reference.

## Trade-offs

- **Isolation level is a correctness-vs-throughput dial** — raising a chunk toward
  `SERIALIZABLE` protects a batch running beside an online application but drops
  performance; lowering toward `READ_UNCOMMITTED` speeds a sole-writer batch at the
  cost of dirty reads.
- **The commit-interval is also the rollback-cost dial** — because the chunk *is* the
  transaction, a larger interval means fewer commits but a wider, costlier rollback and a
  resource held longer; the throughput side is covered in `spring-batch-chunk-processing`.
- **`ResourcelessTransactionManager` is a no-op, not a real manager** — ideal for a
  step with no transactional resource, dangerous if someone later adds a database
  write: nothing actually commits or rolls back, so a mid-chunk failure can leave
  partially written data.
- **Declarative `@Transactional` in a batch app is a footgun** — `REQUIRES_NEW` or an
  un-proxied self-invocation silently detaches code from the chunk transaction, so
  "it looked transactional" is not the same as "it rolled back with the chunk."
- **A transactional reader trades the retry cache for correctness** — disabling
  buffering re-reads items after a rollback instead of replaying from cache, so the
  processor must be idempotent because it runs again on the retried chunk.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 9, "Transaction management", sections 9.1-9.3, "A transaction primer" … "Transaction configuration", p. 252-259 — doc
- [Spring Batch Reference — Transaction Attributes (`.transactionManager()` / `.transactionAttribute()`)](https://docs.spring.io/spring-batch/reference/step/chunk-oriented-processing/transaction-attributes.html) — doc
- [Spring Batch 6.0 API — ResourcelessTransactionManager (org.springframework.batch.infrastructure.support.transaction)](https://docs.spring.io/spring-batch/docs/6.0.x/api/org/springframework/batch/infrastructure/support/transaction/ResourcelessTransactionManager.html) — doc
- [Spring Batch 6.0 Migration Guide (jakarta.transaction, package relocations, XML namespace deprecation)](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
- [Spring Framework Reference — Transaction Strategies (PlatformTransactionManager)](https://docs.spring.io/spring-framework/reference/data-access/transaction/strategies.html) — doc
