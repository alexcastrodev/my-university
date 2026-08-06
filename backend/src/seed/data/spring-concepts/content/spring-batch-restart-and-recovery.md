---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

Skip and retry make a job *survive* errors; restart is what you reach for when
survival fails and the job crashes anyway — the third pillar of chapter 8's
"bulletproof jobs" (the other two live in `spring-batch-skip-policy-and-listeners`
and `spring-batch-retry-policy-and-retrytemplate`). The book's dreaded scenario: a
job runs all night and dies two minutes before the end. Restart lets you answer "I
restart it and it takes two minutes" instead of "wait another day." Re-launching a
**FAILED** (or **STOPPED**, per `spring-batch-stopping-jobs-gracefully`)
`JobExecution` with the *same identifying job parameters* doesn't start over — it
creates a **new `JobExecution` of the same, still-uncompleted `JobInstance`** that
**resumes** from where the last one left off.

That resume trick is pure metadata: Spring Batch persists step state in the
`ExecutionContext` through the `JobRepository`, so restart requires a **persistent
(JDBC-backed) `JobRepository`** (`spring-batch-job-repository-database-configuration`),
and the `JobInstance` = job + identifying `JobParameters` identity that makes a
relaunch *resume* rather than *re-run* is detailed in
`spring-batch-job-instance-execution-flow`. This entry goes deep on restart
*behavior*: enabling/forbidding it, whether to re-run completed steps, capping
attempts, and the meaty part — resuming mid-chunk.

## Use Cases

- A long import crashes near the end — resume from the last committed chunk instead
  of reprocessing hours of already-written work.
- A completed setup step (decompress a ZIP) must run *again* on restart because the
  operator supplied a corrected archive — `allow-start-if-complete`.
- A step that keeps failing should stop being retried — `start-limit` dead-ends the
  instance so an operator investigates instead of looping forever.
- Fix a bad input line, then restart straight into the failed step — Spring Batch
  skips the steps that already completed by default.
- Avoid duplicate side effects (double inserts, re-sent web-service calls) by never
  reprocessing items an earlier execution already wrote.

## Deep Dive

### What restart resumes — a new JobExecution of the same JobInstance

Restart makes sense *only* for an execution that ended in `FAILED` or `STOPPED`. You
relaunch with the exact same identifying parameters, which resolves the same
uncompleted `JobInstance`; Spring Batch creates a fresh `JobExecution` and, reading
the metadata it stored last time, restarts **exactly where the previous execution
left off** — skipping already-completed steps by default, with an effectively
unlimited number of restarts allowed. Today `JobOperator` (which extends
`JobLauncher`) is both launcher and operator:

```java
JobExecution failed = jobRepository.getLastJobExecution(jobName, jobParameters);
JobExecution resumed = jobOperator.restart(failed);   // new execution, same instance
```

None of this works against an in-memory repository — with no persisted
`JobExecution`/`StepExecution` rows, "restart" silently becomes "start over."

### Enabling, forbidding, and re-running completed steps

Jobs are **restartable by default**. The book toggles this with the `restartable`
attribute on `<job>` and the `allow-start-if-complete` attribute on `<tasklet>`
(basics in `spring-batch-job-configuration-attributes`); today those are builder
calls. Forbid restart for a job that can't restart with correct semantics — a
command-line typo or a misfiring scheduler can otherwise reprocess data and corrupt
a database:

```java
new JobBuilder("importProductsJob", jobRepository)
    .preventRestart()          // restartable=false → JobRestartException on relaunch
    .start(decompress).next(readWrite).next(clean)
    .build();
```

The book's import-products job has two working steps: `decompressStep` unzips the
archive, `readWriteProductsStep` loads it. By default a restart **skips**
`decompressStep` because it already completed and jumps into the failed read-write
step. But if the fix is a *new* archive, the decompress step must run again — set
`allowStartIfComplete(true)` on that step so it re-executes every restart:

```java
@Bean
public Step decompress(JobRepository jobRepository, PlatformTransactionManager tx,
                       Tasklet decompressTasklet) {
    return new StepBuilder("decompressStep", jobRepository)
        .tasklet(decompressTasklet, tx)
        .allowStartIfComplete(true)     // always re-run, even after a prior COMPLETED
        .build();
}
```

### Limiting the number of restarts — startLimit(n)

Repeatedly restarting the same instance usually means something is genuinely wrong.
`start-limit` (set per **step**, default `Integer.MAX_VALUE`) caps how many times a
step may be started for one `JobInstance`. The book's walk-through: the read-write
step fails on executions one, two, and three; on the fourth, Spring Batch sees the
limit is reached and won't even try the step — the job fails and the instance can
*never* complete, so you must create a new instance.

```java
@Bean
public Step readWrite(JobRepository jobRepository, PlatformTransactionManager tx,
                      ItemReader<Product> reader, ItemWriter<Product> writer) {
    return new StepBuilder("readWriteProductsStep", jobRepository)
        .<Product, Product>chunk(100, tx)
        .reader(reader).writer(writer)
        .startLimit(3)                  // 4th start throws StartLimitExceededException
        .build();
}
```

### Restarting in the middle of a chunk-oriented step — the ItemStream contract

Capping restarts at the step boundary is coarse; the real prize is resuming a
chunk-oriented step **on the exact item where it failed**, so a run that already
processed a million rows doesn't reprocess them. The `ItemReader` drives the chunk,
so the reader is in charge of restart: it increments a counter per `read()` and
stores that counter in the **step `ExecutionContext`** each time a chunk commits. On
restart it reads the counter back and fast-forwards past processed items. Spring
Batch persists the step `ExecutionContext` between executions — but the reader must
implement the save/restore logic, which is exactly what the `ItemStream` interface
(`open` / `update` / `close`) exists for. The book's Listing 8.14:

```java
public class FilesInDirectoryItemReader implements ItemReader<File>, ItemStream {

    private File[] files;
    private int currentCount;
    private final String key = "file.in.directory.count";

    @Override
    public void open(ExecutionContext ec) throws ItemStreamException {
        currentCount = ec.getInt(key, 0);   // 0 on first run; last saved count on restart
    }

    @Override
    public File read() {
        int index = ++currentCount - 1;
        return index == files.length ? null : files[index];
    }

    @Override
    public void update(ExecutionContext ec) throws ItemStreamException {
        ec.putInt(key, currentCount);       // called just before each chunk commit
    }

    @Override
    public void close() throws ItemStreamException { }
}
```

Spring Batch calls `open` at step start, `update` before it saves the context (just
before a chunk commits), and `close` to release resources, and it **auto-registers**
any reader that implements `ItemStream`. The interface is one kind of step listener
(see `spring-batch-execution-listeners`) and works for processors and writers too.
Most built-in readers (e.g. `MultiResourceItemReader`) are already restartable, so
check the Javadoc before writing your own. **Caveat:** the counter assumes a *stable*
input — added, removed, or reordered items shift it and corrupt the resume position.

### Book vs. today: restart(JobExecution), a new recover() op, and relocated ItemStream

The mechanics are unchanged — metadata-driven resume, skip-completed-steps default,
per-step `start-limit` — but the 6.0 API and packages moved:

- **Config is Java, not the `batch:` XML namespace** (deprecated since 6.0).
  `restartable` still defaults to `true`; you opt out with `JobBuilder.preventRestart()`
  (there is no fluent `restartable(boolean)` method — `restartable` is a property).
  `allowStartIfComplete(true)` and `startLimit(n)` are `StepBuilder` calls.
- **`JobOperator` (extends `JobLauncher`) is THE API.** The current method is
  `JobExecution restart(JobExecution jobExecution)`; the older
  `Long restart(long executionId)` is `@Deprecated(since = "6.0", forRemoval = true)`.
- **New in 6.0: `JobOperator.recover(JobExecution)`** — the "recovery" half. A crash
  can leave an execution stuck in `STARTED` (neither `FAILED` nor `STOPPED`), which
  isn't restartable; `recover(...)` marks it `FAILED` and sets `recovered=true` in
  its execution context so it becomes eligible for restart.
- **A persistent JDBC `JobRepository` is still required**; the in-memory default is
  now `ResourcelessJobRepository`, which keeps no metadata between runs and cannot
  restart (see `spring-batch-job-repository-database-configuration`).
- **Packages relocated:** `javax`→`jakarta`, and the item infrastructure moved from
  `org.springframework.batch.item.*` to `org.springframework.batch.infrastructure.item.*`
  — `ItemStream`, `ItemReader`, `ExecutionContext`, and `ItemStreamException` all
  live there now (the book uses the old package).

Confirmed via the Spring Batch 6.0 `JobOperator` source (`restart(JobExecution)`,
deprecated `restart(long)`, `recover`), `JobBuilderHelper.preventRestart`, the
"Configuring a Step for Restart" and "Configuring a Job" reference pages, and the
Spring Batch 6.0 Migration Guide.

## Trade-offs

- **Restart only helps a `FAILED`/`STOPPED` execution.** A successfully completed
  `JobInstance` won't re-run (it throws), and a process that crashed while `STARTED`
  is stuck until `recover()` marks it `FAILED` — restart is recovery, not a rerun
  button.
- **Re-running completed steps is a business decision, not a default.**
  `allowStartIfComplete(true)` re-does work that succeeded (fine for an idempotent
  setup step, dangerous for one with side effects); the default skips it, which is
  wrong when that step *must* run with fresh input each time.
- **`start-limit` is blunt.** Too low gives up on a step that was only transiently
  unlucky; too high wastes hours re-failing — and hitting it permanently dead-ends
  the instance, forcing a brand-new `JobInstance`.
- **Mid-chunk resume is only as good as the reader's bookkeeping.** A reader that
  isn't an `ItemStream` (or never stores its counter) reprocesses from the top on
  restart, and even a correct counter assumes a *stable* input.
- **Everything hinges on a persistent JDBC `JobRepository`.** With the in-memory
  `ResourcelessJobRepository` there is no saved `ExecutionContext`, so a "restart"
  quietly starts over — choose it deliberately for any job that must survive a crash.
- **Restartable-by-default cuts both ways.** An accidental relaunch (scheduler or CLI
  mistake) can reprocess and corrupt data — call `preventRestart()` on any job that
  can't restart with correct semantics.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 8, "Implementing bulletproof jobs", section 8.4, "Restart on error", p. 242-250 — doc
- [Spring Batch Reference — Configuring a Step for Restart (allowStartIfComplete, startLimit)](https://docs.spring.io/spring-batch/reference/step/chunk-oriented-processing/restart.html) — doc
- [Spring Batch Reference — Configuring a Job (preventRestart, restartability)](https://docs.spring.io/spring-batch/reference/job/configuring-job.html) — doc
- [Spring Batch API — JobOperator (restart(JobExecution); restart(long) deprecated; recover)](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/core/launch/JobOperator.html) — doc
- [Spring Batch API — ItemStream (org.springframework.batch.infrastructure.item)](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/infrastructure/item/ItemStream.html) — doc
- [Spring Batch 6.0 Migration Guide](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
