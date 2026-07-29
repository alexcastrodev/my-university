---
version: 1.0
updatedAt: 2026-07-29
---
## Objective

Understand the two infrastructure components every Spring Batch application relies on — the `JobLauncher`, which starts job executions, and the `JobRepository`, which persists execution metadata — and how a `Job` is modeled as a sequence of `Step`s with optional non-linear control flow based on a step's outcome.

## Use Cases

- Deciding whether a job's metadata needs to survive a restart (persistent `JobRepository`) or can be discarded after a single run (lightweight, in-memory repository) — this decision also determines whether the job can be restarted where it failed.
- Modeling a batch process as a sequence of independently testable `Step`s (decompress → read-write → cleanup) instead of one monolithic job, so steps can be reused across jobs.
- Adding a conditional branch to a job — e.g., generate and send a report only if the previous step skipped records — using Spring Batch's step-outcome-based control flow instead of hand-rolled orchestration logic.
- Reading unfamiliar Spring Batch configuration and recognizing which parts are infrastructure (job repository, job launcher — provided by the framework) versus application code (the job and its steps — written by the developer).

## Deep Dive

### Two infrastructure components: `JobLauncher` and `JobRepository`

Every Spring Batch application depends on the same two infrastructure interfaces. The `JobLauncher` is the entry point — where the outside world (a scheduler, a script, an HTTP request) meets Spring Batch:

```java
public interface JobLauncher {
  JobExecution run(Job job, JobParameters jobParameters)
      throws JobExecutionAlreadyRunningException, JobRestartException,
             JobInstanceAlreadyCompleteException, JobParametersInvalidException;
}
```

`SimpleJobLauncher`, the framework's implementation, only *launches* a job — it delegates the actual creation and persistence of execution state to the `JobRepository`:

```java
public interface JobRepository {
  boolean isJobInstanceExists(String jobName, JobParameters jobParameters);
  JobExecution createJobExecution(String jobName, JobParameters jobParameters)
      throws JobExecutionAlreadyRunningException, JobRestartException,
             JobInstanceAlreadyCompleteException;
  void update(JobExecution jobExecution);
  void add(StepExecution stepExecution);
  void update(StepExecution stepExecution);
  StepExecution getLastStepExecution(JobInstance jobInstance, String stepName);
  JobExecution getLastJobExecution(String jobName, JobParameters jobParameters);
}
```

The repository tracks which steps ran, how many items were read/written/skipped, and how long each step took — all transparently, without the application code calling it directly.

### In-memory vs. persistent job repository: the trade-off is monitoring and restart

An in-memory job repository is simpler to configure but loses everything on process exit — no restart-where-it-failed, no cross-process visibility, and it isn't safe for concurrent job execution. A persistent job repository, backed by a relational database, adds three capabilities in exchange for the overhead of talking to a database on every step: monitoring (the execution history is queryable), restart (a failed job resumes from its last successful step instead of from the start), and safety against launching the same job instance twice from different processes, since the database provides the isolation.

The practical guidance holds regardless of era: use the in-memory repository for development and testing; use the persistent repository — ideally against the *same* database as the business data, to keep batch metadata and business data transactionally consistent — for anything that needs restart or monitoring.

### Modeling a job as a sequence of steps

A `Job` is not one opaque unit of work; it is composed of `Step`s, each independently configurable and testable:

| Component | Description |
|---|---|
| Job repository | Infrastructure component that persists job execution metadata |
| Job launcher | Infrastructure component that starts job executions |
| Job | Application component representing a batch process |
| Step | A phase in a job; a job is a sequence of steps |
| Tasklet | A transactional, potentially repeatable process occurring in a step |
| Item reader / processor / writer | Read, transform/validate/filter, and write one item of a chunk |

Decomposing a job into steps (decompress → read-write → cleanup, for example) is cleaner than one monolithic job both for testing — each step can be tested in isolation — and for reuse, since a step like "decompress an archive" can be shared across any job that needs the same operation, just by referencing it from a different job configuration.

### Non-linear control flow based on step outcome

A job's steps don't have to run in a straight line. Spring Batch can branch based on a step's status (completed, failed) or on custom decision logic — for example, running a "generate report" / "send report" pair only when the read-write step skipped records, before continuing to a shared cleanup step:

```xml
<job id="importProductsJob" xmlns="http://www.springframework.org/schema/batch">
  <step id="decompress" next="readWrite">
    <tasklet ref="decompressTasklet" />
  </step>
  <step id="readWrite" next="skippedDecision">
    <tasklet>
      <chunk reader="reader" writer="writer" commit-interval="100" />
    </tasklet>
  </step>
  <!-- skippedDecision branches to generateReport+sendReport, or straight to cleanup -->
</job>
```

This keeps processing logic (inside steps) separate from execution-flow logic (the transitions between steps), which is declared once at the job level instead of being scattered as conditional logic inside individual steps — steps stay decoupled from each other because none of them needs to know what runs next.

### Book vs. today: from XML `<batch:job-repository>` to `@EnableJdbcJobRepository`, and `ResourcelessJobRepository` for lightweight runs

The book (2012, Spring Batch 2.1) configures the job repository and launcher entirely in XML:

```xml
<batch:job-repository id="jobRepository"
    data-source="dataSource" transaction-manager="transactionManager" />
<bean id="jobLauncher" class="org.springframework.batch.core.launch.support.SimpleJobLauncher">
  <property name="jobRepository" ref="jobRepository" />
</bean>
```

The XML namespace is deprecated (see `spring-batch-chunk-processing` for the Java-based `JobBuilder`/`StepBuilder` replacement). The infrastructure side moved the same direction: `@EnableBatchProcessing` now auto-configures a `JobRepository` and `JobLauncher` as beans, and a JDBC-backed, persistent repository is configured declaratively via `@EnableJdbcJobRepository` (data source, transaction manager, table prefix, isolation level as attributes) rather than an XML `job-repository` element.

The book's other in-memory option, `MapJobRepositoryFactoryBean`, was deprecated in Spring Batch 4 and removed in Spring Batch 5. Its replacement for lightweight, single-JVM, non-restartable runs (development, testing, one-off jobs) is **not** "just point it at H2" — it's a purpose-built `ResourcelessJobRepository`, the default when `@EnableBatchProcessing` has no configured `DataSource`, introduced in Spring Batch 5.2. An embedded database (H2 or similar) is still the recommended path when a test genuinely needs restart/monitoring behavior to verify, since `ResourcelessJobRepository` is intentionally non-persistent and non-thread-safe.

## Trade-offs

- **The in-memory repository trades safety for simplicity — this is a real production footgun, not just a testing shortcut.** It isn't designed for concurrent access; running it in production risks the exact same job launching twice from different nodes with no isolation to prevent it.
- **A persistent job repository against a separate database from the business data reintroduces the two-phase-commit problem** — without JTA spanning both databases, batch metadata (skipped-item counts, restart position) and business data can desynchronize on failure, producing inaccurate skip counts or broken restarts. Sharing one database avoids the problem entirely at the cost of coupling schemas.
- **Non-linear control flow adds power at the cost of traceability** — a job with several decision points is more flexible than a linear sequence, but harder to read at a glance than "step 1, then step 2, then step 3"; the trade-off is worth it exactly when the branches reflect genuine business conditions (a skip threshold, a file-not-found case), not as a default structuring choice.

## Documentation Links

- [Spring Batch in Action (Manning, 2012) — Chapter 1, "Introducing Spring Batch", p. 26-31, and Chapter 2, "Spring Batch concepts", p. 32-43](https://www.manning.com/books/spring-batch-in-action) — doc
- [Spring Batch Reference — Configuring a JobRepository](https://docs.spring.io/spring-batch/reference/job/configuring-repository.html) — doc
- [Spring Batch Reference — Configuring a JobLauncher](https://docs.spring.io/spring-batch/reference/5.1/job/configuring-launcher.html) — doc
- [Spring Boot Reference — Spring Batch](https://docs.spring.io/spring-boot/reference/io/spring-batch.html) — doc
- [Spring Batch 5.0 Migration Guide](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-5.0-Migration-Guide) — doc
