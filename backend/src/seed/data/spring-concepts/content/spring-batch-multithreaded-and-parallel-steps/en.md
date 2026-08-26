---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

Scaling a batch job means meeting an execution-time window by running work in
parallel — ideally through configuration, without rewriting the step's business
logic. Chapter 13 frames scaling as a decision made mostly at the *step* level and
lays out **four strategies**: a **multithreaded step** and **parallel steps** (both
*local*, single-JVM), plus **remote chunking** and a **partitioning step** (which
*scale out* across machines, covered in `spring-batch-remote-chunking` and
`spring-batch-partitioning`). This entry is the single-machine half of that model.

Both local strategies build on Spring's `TaskExecutor` thread-pool abstraction and
parallelize the chunk-oriented step from `spring-batch-chunk-processing`. The catch
that runs through the chapter — and the reason the book admits multithreading is "far
from good enough" alone — is that the stateful readers and writers that make a step
**restartable** (`spring-batch-restart-and-recovery`) are usually **not thread-safe**,
so naive parallelism buys throughput at the cost of correctness. Knowing where each
strategy puts its threads is what lets you scale without corrupting state.

## Use Cases

- A processing-heavy step (expensive per-item transformation or enrichment) that
  under-uses a multicore box — hand chunk processing to a thread pool so several
  chunks are worked concurrently instead of one at a time.
- Two unrelated imports (e.g. books and mobile phones from separate files) with no
  ordering dependency — run them as parallel flows in one job rather than two
  sequential steps.
- An I/O-bound load that must stay restartable — pair a synchronized reader with the
  process-indicator pattern so threads don't corrupt the restart position.
- Modernizing an I/O-bound step onto Java 21 virtual threads by swapping in a
  virtual-thread `TaskExecutor`.

## Deep Dive

### The scaling model: four strategies, two of them local

Spring Batch runs everything sequentially by default; *scaling* is how you opt
specific steps into parallel execution. Table 13.1 lists four strategies:

- **Multithreaded step** *(local)* — one step processes multiple chunks concurrently
  on a thread pool.
- **Parallel steps** *(local)* — several *independent* steps/flows run at once via a
  `split`.
- **Remote chunking** *(remote)* — a master reads and ships chunks to slave nodes
  (`spring-batch-remote-chunking`).
- **Partitioning step** *(local or remote)* — data is divided into partitions, each
  handled by its own step instance (`spring-batch-partitioning`).

The first pair is *vertical* scaling (scale up: use more cores on one machine); the
last pair is *horizontal* (scale out). Both local strategies rest on Spring's
`TaskExecutor`, which you declare once and plug in. The book's implementations are
`ThreadPoolTaskExecutor` (a sized pool — used as `taskExecutor()` in the snippets
below), `SimpleAsyncTaskExecutor` (a fresh thread per task, with an optional
concurrency limit), and `WorkManagerTaskExecutor` (CommonJ).

### Multithreaded step: hand each chunk to the pool

The simplest local scaling is to add a `TaskExecutor` to a step; Spring Batch then
processes chunks (`spring-batch-chunk-processing`) on pool threads, so *N* chunks are
in flight at once instead of one. The book renames `readWriteProductsStep` to
`readWriteProductsMultiThreadedStep`; today it is a builder call, not the
`<batch:tasklet task-executor="…">` attribute:

```java
@Bean
public Step readWriteProductsMultiThreadedStep(JobRepository jobRepository,
        PlatformTransactionManager tx, ItemReader<Product> reader, ItemWriter<Product> writer) {
    return new StepBuilder("readWriteProductsMultiThreadedStep", jobRepository)
        .<Product, Product>chunk(10).transactionManager(tx)
        .reader(reader).writer(writer)
        .taskExecutor(taskExecutor())   // enables multithreading for this step
        .build();
}
```

Run an import of 100 products with trace logging and you see interleaved threads —
`thread #5` reading product #51 while `thread #3` reads #54 — so **items are not
processed in order**; treat ordering as random. The book bounds concurrency with a
`throttle-limit` attribute (it notes a default of 6) so the step actually fills the
pool, and warns that the core pool size must be at least the throttle limit.

### The thread-safety vs. restart caveat (slow down here)

Multithreading a step is "far from good enough" because every object the step shares
across threads — reader, processor, writer — must be thread-safe, and *most built-in
Spring Batch readers and writers are not*. The book calls them **stateful**. The
worst offenders are `ItemReader`s, because they hold the state that makes a job
**restartable**: `JdbcCursorItemReader`, for instance, walks a JDBC `ResultSet` and
records its position in the step `ExecutionContext` at each chunk commit. That
position counter assumes **single-threaded, sequential reads**. Let several threads
read at once and the counter no longer describes what was processed — restart
(`spring-batch-restart-and-recovery`) then resumes from a corrupted position,
reprocessing or skipping rows.

The book gives three mitigations, in increasing order of safety:

1. **Give up restartability** — set `saveState=false` on the reader so Spring Batch
   stops tracking a now-meaningless position.
2. **Serialize the reads** — wrap the reader so only `read()` is synchronized;
   reading is cheap and writing is expensive, so one thread reads a chunk while
   others are busy writing. The book's `SynchronizingItemReader` (today: the built-in
   `SynchronizedItemStreamReader`) delegates the state callbacks to its target:

```java
public class SynchronizingItemReader<T> implements ItemReader<T>, ItemStream {
    private ItemReader<T> delegate;

    public synchronized T read() throws Exception {     // reads can't overlap
        return delegate.read();
    }
    public void open(ExecutionContext c)   { if (delegate instanceof ItemStream s) s.open(c); }
    public void update(ExecutionContext c) { if (delegate instanceof ItemStream s) s.update(c); }
    public void close()                    { if (delegate instanceof ItemStream s) s.close(); }
}
```

3. **The process-indicator pattern** — the only option that keeps restartability
   *and* parallelism. Add a `processed` boolean column to the input table; the
   (synchronized) reader selects only `where processed = false` with
   `saveState=false`, and the writer flags each item as it writes it:

```java
public class ProductItemWriter implements ItemWriter<Product> {
    private JdbcTemplate jdbcTemplate;

    public void write(Chunk<? extends Product> items) {
        for (Product p : items) {
            jdbcTemplate.update("update product set processed = true where id = ?", p.getId());
            // ...persist the product content...
        }
    }
}
```

State now lives in the database, not a thread-fragile counter: a restart simply picks
up the rows still marked unprocessed. (For file input the book's trick is to stage the
file into a table first, then parallelize off the table.)

### Parallel steps: run independent flows at once with `split`

The second local strategy parallelizes *whole steps* instead of chunks, and sidesteps
the thread-safety problem entirely because each step owns its reader and writer. It is
a **flow** construct (`spring-batch-controlling-flow-and-exit-status`): a `split` runs
its contained flows concurrently and joins when all of them finish. The book imports
books and mobile phones *in parallel*:

```java
@Bean
public Job importProductsJob(JobRepository jobRepository,
        Step readWriteBookProduct, Step readWriteMobileProduct) {

    Flow bookFlow   = new FlowBuilder<Flow>("bookFlow").start(readWriteBookProduct).build();
    Flow mobileFlow = new FlowBuilder<Flow>("mobileFlow").start(readWriteMobileProduct).build();

    return new JobBuilder("importProductsJob", jobRepository)
        .start(bookFlow)
        .split(taskExecutor()).add(mobileFlow)   // bookFlow and mobileFlow run concurrently
        .end()
        .build();
}
```

`FlowBuilder.split(taskExecutor).add(flowA, flowB)` is the same mechanic as XML's
`<batch:split>`. The book wraps this between a `decompress` step and a
`moveProcessedFiles` step; because a split is itself a step, it can declare a `next`
so the join fans back into one downstream step. Two rules apply: the flows must be
**genuinely independent** (no shared ordering, no one flow feeding another), and
without an explicit executor a split falls back to a *synchronous* executor and runs
sequentially — so the `TaskExecutor` is what actually buys the parallelism.

### Book vs. today: the multithreaded step now parallelizes only the processor

The single most important change since 2012 is *what runs on which thread* inside a
multithreaded step. In the book — and unchanged through Spring Batch 5.2 — the step
"executes by reading, processing, and writing each chunk of items in a separate
thread of execution," which is exactly why the reader had to be synchronized. Spring
Batch 6.0's redesigned ("new") chunk-oriented step changed this: the reference now
states that **reading and writing are done serially by the main thread, so the
`ItemReader` and `ItemWriter` do not have to be thread-safe or synchronized**, and
**only the `ItemProcessor` is invoked from multiple threads** (so the processor must
be thread-safe).

Two consequences follow. First, the book's whole synchronize-the-reader /
process-indicator dance is no longer required for a plain multithreaded step: the
reader reads sequentially again, so its `ExecutionContext` position stays coherent and
restart is safe by default. `SynchronizedItemStreamReader` still ships — relocated to
`org.springframework.batch.infrastructure.item.support` — for cases where you *do*
share one reader across threads (e.g. under partitioning). Second, the parallelism has
moved from I/O to **processing**: a multithreaded step now speeds up processing-heavy
work, while I/O-bound reading/writing scales instead via partitioning, remote
chunking, or local chunking.

The rest is unchanged in *mechanic*: `.taskExecutor(...)` still enables a
multithreaded step and `FlowBuilder.split(taskExecutor).add(...)` still runs parallel
flows — but configuration is Java, since the `batch:` XML namespace is deprecated in
6.0. The standalone `throttle-limit` knob is deprecated for removal; concurrency is
now bounded by the `TaskExecutor` you supply (a `ThreadPoolTaskExecutor`'s pool size,
or a `SimpleAsyncTaskExecutor`'s concurrency limit). And a modern executor the book
could not have: **Java 21 virtual threads** via
`SimpleAsyncTaskExecutor.setVirtualThreads(true)` (backed by `Thread.ofVirtual()`),
ideal for I/O-bound processors — virtual threads are created per task, so you pair
them with a `SimpleAsyncTaskExecutor` (never a pool) and cap them with a concurrency
limit. Confirmed via the Spring Batch 6.0 "Scaling and Parallel Processing" reference,
the archived 4.3/5.1/5.2 references (the old "separate thread of execution" wording),
the Spring Batch 6.0 Migration Guide (XML deprecation, new chunk model, throttle-limit
deprecation), and the `SimpleAsyncTaskExecutor` Javadoc.

## Trade-offs

- **Throughput vs. restartability** — the core tension. In the book's model a
  multithreaded step could corrupt the restart position, and each fix
  (`saveState=false`, a synchronized reader, or the process indicator) costs either
  restartability or extra schema and code. Under 6.0 this is largely resolved for
  readers/writers, but a stateful `ItemProcessor` is now the thing you must make
  thread-safe.
- **A multithreaded step is not a guaranteed speed-up** — the book notes no gain on a
  single core and (its 2012 model) benefit only for I/O; the 6.0 model parallelizes
  only the processor, so an I/O-bound step barely benefits — reach for partitioning or
  remote chunking instead.
- **Ordering becomes undefined** — chunks contain non-consecutive items and finish in
  any order, so any order-dependent logic (sequencing, running totals) breaks under a
  multithreaded step.
- **Parallel steps demand true independence** — a `split` only helps when its flows
  share no data or ordering; a hidden dependency (one flow reading another's output)
  yields races, and forgetting the `TaskExecutor` silently runs them sequentially.
- **Concurrency is bounded by your weakest pool** — threads fighting over a too-small
  `DataSource` connection pool, throttle, or concurrency limit erase the gains; size
  the executor, the connection pool, and (pre-6.0) the throttle limit together.
- **Virtual threads are not a pool** — pooling them defeats the point; use a
  `SimpleAsyncTaskExecutor` with a concurrency limit, and remember they help
  I/O-bound, not CPU-bound, work.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 13, "Scaling and parallel processing", sections 13.1-13.4, "The scaling model" / "Multithreaded steps" / "Parallelizing processing (single machine)", p. 374-386 — doc
- [Spring Batch Reference — Scaling and Parallel Processing (Multi-threaded Step, Parallel Steps)](https://docs.spring.io/spring-batch/reference/scalability.html) — doc
- [Spring Batch 6.0 Migration Guide (XML namespace deprecation, new chunk-oriented model)](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
- [Spring Batch API — SynchronizedItemStreamReader (org.springframework.batch.infrastructure.item.support)](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/infrastructure/item/support/SynchronizedItemStreamReader.html) — doc
- [Spring Framework API — SimpleAsyncTaskExecutor (setVirtualThreads, concurrencyLimit)](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/core/task/SimpleAsyncTaskExecutor.html) — doc
