---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

Stopping a running Spring Batch job is not a hard kill. You can't reliably
halt executing Java code from the outside, so Spring Batch makes stopping
*cooperative*: a **stop message** flips the execution's status to `STOPPING`,
and the job stops cleanly at the next **chunk boundary** rather than mid-work.
Two audiences trigger this. An **operator** stops a job from the outside — an
alert fires, and they call `JobOperator.stop(...)` from a JMX console or admin
endpoint. A **developer** stops a job from the inside — a business rule is
violated (don't import more than 1,000 products a day, don't run past 8 a.m.),
so step code calls `StepExecution.setTerminateOnly()`.

Because the stop lands on a chunk boundary, the in-flight transaction commits
or rolls back as a whole unit — you never tear a chunk in half. The execution
ends in `STOPPED`, and unlike an abandoned or crashed run a `STOPPED` execution
is **restartable**: relaunching resumes where it left off (see
`spring-batch-restart-and-recovery`). This entry covers both paths; wiring the
launcher/operator bean is in `spring-batch-job-launcher-api-and-async-launching`.

## Use Cases

- An operator receives an alert ("the import file contains bad data") two hours
  into a long job and stops that specific execution from a JMX console to stop
  wasting server resources.
- A developer enforces a business limit from inside the job — stop after the
  1,000th imported item, or stop a catalog-indexing job before 8 a.m. peak
  traffic — without coupling the reader/processor/writer to that decision.
- Scheduling a *stop*, not just a start: a job runs overnight but a scheduled
  task sends a stop signal at 6 a.m. so it never overlaps business hours.
- Stopping cleanly so the run stays restartable — resuming a half-finished
  import instead of re-running it from scratch or corrupting a partial chunk.

## Deep Dive

### Stopping from the outside: the operator and `JobOperator.stop(...)`

The operator doesn't know Spring Batch internals — only that a job is running
and must stop. `JobOperator` exposes exactly that: look up the running execution
IDs for a job name, then signal a stop on one. The book's 2012 snippet:

```java
Set<Long> runningExecs = jobOperator.getRunningExecutions("importJob");
Long executionId = runningExecs.iterator().next();
boolean stopMessageSent = jobOperator.stop(executionId);
```

The `boolean` return is the crucial detail: it reports whether the stop
*message was sent*, **not** whether the job has stopped — the only way to know
that is to poll the execution status. Hence "stop message", covered next.

### The stop message: why a job stops at the next chunk boundary

You call `stop(...)`, but there's no guarantee the execution halts on that
call, because Java can't interrupt arbitrary running code on demand. Spring
Batch stops the job only once it *retakes control of the flow*. For a
chunk-oriented step that happens every chunk: Spring Batch drives the
read-process-write loop, so it regains control at each boundary and stops
promptly. That boundary is also the transactional safety net — the chunk's
transaction commits (or rolls back) as one unit before the stop takes effect,
so the store is never left in a torn, half-a-chunk state (see
`spring-batch-chunk-processing` for the commit-interval mechanics).

The exception is a **custom `Tasklet`** with a long body: Spring Batch can't
regain control until `execute(...)` returns, so a long tasklet should itself
check `Thread.currentThread().isInterrupted()` and return `RepeatStatus.FINISHED`
(or throw) to end cleanly.

### Stopping from the inside: `setTerminateOnly()` from a tasklet or listener

A developer has two ways to stop from within. Throwing an exception works but
is fragile — a chunk step configured to *skip* that exception type swallows it.
The preferred way sets the stop flag: `StepExecution.setTerminateOnly()`,
equivalent to sending a stop message. How you reach the `StepExecution` depends
on the step type.

A **tasklet** has direct access through the chunk context:

```java
public class ProcessItemsTasklet implements Tasklet {
    @Override
    public RepeatStatus execute(StepContribution contribution,
                                ChunkContext chunkContext) throws Exception {
        if (shouldStop()) {
            chunkContext.getStepContext()
                        .getStepExecution().setTerminateOnly();
        }
        processItem();
        return moreItemsToProcess() ? RepeatStatus.CONTINUABLE
                                    : RepeatStatus.FINISHED;
    }
}
```

A **chunk-oriented step** deliberately hides the `StepExecution` from the
`ItemReader`/`ItemProcessor`/`ItemWriter` — those components should focus on
their job, not on stopping. Instead, a listener captures the `StepExecution`
via `@BeforeStep` and checks the stop condition on a lifecycle event such as
`@AfterRead`:

```java
public class StopListener {
    private StepExecution stepExecution;

    @BeforeStep
    public void beforeStep(StepExecution stepExecution) {
        this.stepExecution = stepExecution;
    }

    @AfterRead
    public void afterRead() {
        if (stopConditionsMet()) {
            stepExecution.setTerminateOnly();
        }
    }
}
```

This keeps stopping a *crosscutting concern*: only the dedicated listener knows
about it. The book registers that listener in XML; today it's a `StepBuilder`
call:

```java
@Bean
public Step importProductsStep(JobRepository jobRepository,
                               PlatformTransactionManager tx,
                               ItemReader<Product> reader,
                               ItemWriter<Product> writer,
                               StopListener stopListener) {
    return new StepBuilder("importProductsStep", jobRepository)
            .<Product, Product>chunk(100, tx)
            .reader(reader)
            .writer(writer)
            .listener(stopListener)
            .build();
}
```

### Restarting a `STOPPED` job

A graceful stop is only half the value — the run can resume. A `STOPPED`
execution leaves its `JobInstance` open, so restarting starts a *new*
`JobExecution` of the *same* instance, resuming from the last committed chunk
(contrast `abandon(...)`, which marks an execution `ABANDONED` and
non-restartable):

```java
JobExecution stopped = jobRepository.getJobExecution(executionId);
JobExecution resumed = jobOperator.restart(stopped);
```

The `JobInstance`/`JobExecution` identity that makes this resume rather than
re-run is detailed in `spring-batch-job-instance-execution-flow`; recovery
mechanics are in `spring-batch-restart-and-recovery`.

### Book vs. today: `JobOperator` is now THE API, and the book's stop calls are deprecated

The *mechanics* are unchanged — `stop` still just sends a message, and
`setTerminateOnly()` still sets the flag Spring Batch checks when it regains
control — but the surface has shifted in Spring Batch 6.0:

- **`JobOperator` is now the operator API and extends `JobLauncher`.** No
  separate launcher bean is needed; `JobOperator` *is* the launcher plus the
  operations (`stop`, `restart`, `startNextInstance`, `abandon`, `recover`).
  The book's four-dependency `SimpleJobOperator` XML bean is gone.
- **The book's exact two lines are both deprecated for removal in 6.2+.**
  `getRunningExecutions(String)` (returning `Set<Long>`) and `stop(long)` are
  each `@Deprecated(since = "6.0", forRemoval = true)`. The replacement queries
  the repository for `JobExecution` objects and passes one to `stop`:
  ```java
  Set<JobExecution> running = jobRepository.findRunningJobExecutions("importJob");
  JobExecution execution = running.iterator().next();
  boolean stopSignalSent = jobOperator.stop(execution); // stop(JobExecution)
  ```
- **`setTerminateOnly()` is identical, but `StepExecution` moved** from
  `org.springframework.batch.core` to `org.springframework.batch.core.step`
  (6.0's reorganization also moved `JobExecution`/`JobInstance` to `...core.job`).
  Spring Batch 6 adds a `StoppableStep` interface whose default
  `stop(StepExecution)` calls `setTerminateOnly()` and sets `STOPPED`.
- **Configuration is Java, not the `batch:` XML namespace** the book uses for
  the job, step, and listener wiring — the namespace is deprecated in 6.0 in
  favor of `JobBuilder`/`StepBuilder` (see `spring-batch-chunk-processing`).

Confirmed via the Spring Batch 6.0.4 source (`JobOperator`,
`StepExecution.setTerminateOnly`, `JobRepository.findRunningJobExecutions`,
`StoppableStep`), the Spring Batch reference on running jobs, and the Spring
Batch 6.0 migration guide.

## Trade-offs

- **A stop is a request, not a guarantee.** `stop(...)` returns `true` when the
  *message* is sent, not when the job halts — code must poll the execution
  status, and a long custom tasklet that ignores
  `Thread.currentThread().isInterrupted()` can stay "stopping" a long time.
  Chunk steps avoid this because the framework drives the loop.
- **`setTerminateOnly()` beats throwing an exception.** An exception is the
  obvious way to bail out, but a chunk step configured to skip that exception
  type will silently swallow it and keep going. The stop flag is deterministic:
  Spring Batch honors it the moment it regains control, regardless of skip
  configuration.
- **Chunk boundary means clean but not instant.** A large `commit-interval`
  keeps the in-flight chunk running longer before the stop can take effect;
  smaller chunks stop sooner but pay more transaction overhead — the same
  throughput-vs-latency trade covered in `spring-batch-chunk-processing`.
- **Book vs. today: the book's stop code compiles but targets removal-scheduled
  methods.** `getRunningExecutions(String)` and `stop(long)` run on 6.0.x but
  are `forRemoval` in 6.2+; new code should use
  `JobRepository.findRunningJobExecutions` plus `stop(JobExecution)` to avoid
  migration debt.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 4, "Running batch jobs", section 4.5, "Stopping jobs gracefully", p. 109-116 — doc
- [Spring Batch Reference — Running a Job (`JobOperator`)](https://docs.spring.io/spring-batch/reference/job/running.html) — doc
- [Spring Batch Reference — Controlling Step Flow (`BatchStatus`: `STOPPING`/`STOPPED`)](https://docs.spring.io/spring-batch/reference/step/controlling-flow.html) — doc
- [Spring Batch API — `JobOperator` (`stop(JobExecution)`; `stop(long)` deprecated for removal)](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/core/launch/JobOperator.html) — doc
- [Spring Batch API — `StepExecution.setTerminateOnly()`](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/core/step/StepExecution.html) — doc
- [Spring Batch 6.0 Migration Guide](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
