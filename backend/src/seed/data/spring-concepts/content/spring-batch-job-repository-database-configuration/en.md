---
version: 1.0
updatedAt: 2026-08-03
---
## Objective

The job repository is what turns Spring Batch's domain objects — `Job`,
`JobInstance`, `JobExecution`, `StepExecution` — from in-process state into
data a batch infrastructure can rely on across restarts and nodes. Spring
Batch ships exactly one `JobRepository` implementation, `SimpleJobRepository`,
but backs it with two interchangeable kinds of DAOs: in-memory (no
persistence) and JDBC-backed (persistent). The book's `<batch:job-repository>`
XML element and its attributes — `data-source`, `transaction-manager`,
`isolation-level-for-create`, `table-prefix`, `max-varchar-length`,
`lob-handler` — configure the persistent DAO. Today the same attributes are
set through `@EnableJdbcJobRepository`, and the in-memory default has changed
implementation entirely.

## Use Cases

- Running a short-lived, non-restartable batch job (an integration test, a
  one-off script) where persisting execution metadata to a database is pure
  overhead — the in-memory repository is enough.
- Running a production import that must survive a process crash: the JDBC
  repository persists `JobInstance`/`JobExecution`/`StepExecution` rows so a
  failed run can be identified and restarted from its last completed step.
- Launching the same job from multiple nodes (a clustered scheduler, several
  application instances behind a load balancer) and needing a guarantee that
  two nodes never accidentally create two `JobInstance`s for what should be
  one logical run — this is what `isolation-level-for-create` protects
  against.
- Running Spring Batch's tables alongside other tables in a shared schema
  without name collisions, by giving the batch tables a distinct prefix.

## Deep Dive

### `JobRepository`, `SimpleJobRepository`, and its two DAO kinds

Spring Batch provides the `JobRepository` interface for the batch
infrastructure to interact with (chapter 2, section 2.2.1, introduces it) and
exactly one implementation, `SimpleJobRepository`, built on a set of Data
Access Objects. Spring Batch ships two kinds of DAOs at this level:

- **In-memory**, with no persistence — fine for tests, but batch metadata is
  lost between job executions, so it shouldn't be used in production.
- **Persistent**, backed by JDBC — the DAO to use for robust batch
  processing with checks on startup and restart support, at the cost of
  needing a data source and a transaction manager in the configuration.

### The book's XML: in-memory job repository

```xml
<bean id="jobRepository"
      class="org.springframework.batch.core.repository.support.MapJobRepositoryFactoryBean">
  <property name="transactionManager-ref" ref="transactionManager"/>
</bean>

<bean id="transactionManager"
      class="org.springframework.batch.support.transaction.ResourcelessTransactionManager"/>

<batch:job id="importInvoicesJob" job-repository="jobRepository">
  (...)
</batch:job>
```

`MapJobRepositoryFactoryBean` builds the in-memory repository; because
there's no real datastore behind it, it's paired with
`ResourcelessTransactionManager`, a NOOP (`NO OPeration`) implementation of
`PlatformTransactionManager`. The job then references the repository bean
through its `job-repository` attribute.

### The book's XML: persistent job repository and its attributes

```xml
<bean id="dataSource" class="org.apache.commons.dbcp.BasicDataSource" destroy-method="close">
  <property name="driverClassName" value="${batch.jdbc.driver}"/>
  <property name="url" value="${batch.jdbc.url}"/>
  <property name="username" value="${batch.jdbc.user}"/>
  <property name="password" value="${batch.jdbc.password}"/>
</bean>

<bean id="transactionManager" lazy-init="true"
      class="org.springframework.jdbc.datasource.DataSourceTransactionManager">
  <property name="dataSource" ref="dataSource"/>
</bean>

<batch:job-repository id="jobRepository"
                data-source="dataSource"
                transaction-manager="transactionManager"
                isolation-level-for-create="SERIALIZABLE"
                table-prefix="BATCH_"/>

<batch:job id="importInvoicesJob" job-repository="jobRepository">
  (...)
</batch:job>
```

The `job-repository` element's attributes (book's table 3.8):

| Attribute | Mandatory? | Default | Meaning |
|---|---|---|---|
| `data-source` | yes | `dataSource` | Bean id of the data source used to access the database |
| `transaction-manager` | yes | `transactionManager` | Bean id of the Spring transaction manager for job repository transactions |
| `isolation-level-for-create` | yes | `SERIALIZABLE` | Isolation level used when creating job executions |
| `max-varchar-length` | no | not stated by the book | Maximum length for `VARCHAR` columns (e.g. exit messages) |
| `table-prefix` | no | `BATCH_` | Prefix used to identify the job repository's tables |
| `lob-handler` | no | — | Handler for LOB columns; only needed for Oracle or when Spring Batch can't detect the database type |

### Why `isolation-level-for-create` defaults to `SERIALIZABLE`

The book frames this attribute as the job repository's answer to a
concurrency question: what happens if the same Spring Batch job is launched
from different physical nodes at once? There's a real risk of creating the
same `JobInstance` twice, which is bad for the metadata — Spring Batch would
have no principled way to decide which of the two instances to restart. The
job repository acts as a centralized safeguard when creating entities like
job instances, relying on the underlying database's transactional
capabilities to synchronize concurrent creators. `SERIALIZABLE` (or the
equally sufficient `REPEATABLE_READ`) is aggressive enough to prevent this
race, which is precisely what lets Spring Batch be distributed across
multiple nodes without starting the same instance twice due to a timing
coincidence.

### Today: `@EnableJdbcJobRepository`

Java configuration for the job repository moved through `JobRepositoryFactoryBean`
for most of Spring Batch's 4.x/5.x life, then changed again in Spring Batch
6.0. `@EnableBatchProcessing` now configures only the attributes common to
any store; store-specific attributes moved to dedicated annotations —
`@EnableJdbcJobRepository` for JDBC, `@EnableMongoJobRepository` for MongoDB:

```java
@Configuration
@EnableBatchProcessing
@EnableJdbcJobRepository(
    dataSourceRef = "batchDataSource",
    transactionManagerRef = "batchTransactionManager",
    tablePrefix = "BATCH_",
    maxVarCharLength = 1000,
    isolationLevelForCreate = "SERIALIZABLE")
public class BatchConfig {
    // job and step beans
}
```

Every book attribute maps directly: `data-source`→`dataSourceRef`,
`transaction-manager`→`transactionManagerRef`, `table-prefix`→`tablePrefix`,
`max-varchar-length`→`maxVarCharLength`, `isolation-level-for-create`→
`isolationLevelForCreate`. Two attributes are new since the book:
`databaseType` (to force a specific SQL dialect when auto-detection from the
`DataSource` can't determine it) and `incrementerFactoryRef` (overrides the
primary-key incrementer strategy for platforms whose defaults don't fit —
this is the closest thing today to a "schema/platform adaptation" knob,
distinct from schema *versioning*, which Spring Batch does not expose as a
configuration attribute at all).

Two things behind the scenes changed more than the attribute names:

- `JobRepositoryFactoryBean` — the class most 4.x/5.x Java configurations
  build directly — is deprecated since 6.0 in favor of
  `JdbcJobRepositoryFactoryBean`, scheduled for removal in 6.2+.
- The in-memory default is no longer `MapJobRepositoryFactoryBean`. When
  `@EnableBatchProcessing` is used with no JDBC repository configured, Spring
  Batch defaults to `ResourcelessJobRepository`: not thread-safe, not usable
  for concurrent or partitioned steps, and with no execution-context sharing
  between steps — a fit for exactly the "one-off, non-restartable job" case
  the book already recommends the in-memory DAO for, just a different class
  behind it.

Also worth knowing when reading current code: `JobExplorer` (a read-only view
over the same metadata) is deprecated since 6.0, scheduled for removal in 6.2+,
because `JobRepository` now directly extends `JobExplorer` — one bean now
covers both concerns where the book-era API needed two.

## Trade-offs

- **The in-memory repository is a testing/one-shot tool, not a production
  shortcut.** Book and current docs agree: no persistence between runs means
  no restart support, and today's `ResourcelessJobRepository` adds "not
  thread-safe" and "no partitioned-step support" on top of that — pick it
  deliberately for a job that genuinely runs once and doesn't need to
  survive a crash, not as a way to skip setting up a data source.
- **`SERIALIZABLE` as the default `isolation-level-for-create` trades a
  little contention for correctness.** It only guards the moment a job
  execution row is created, not the whole job — but an aggressive isolation
  level there is cheap insurance against a multi-node race creating
  duplicate `JobInstance`s. Lowering it (`READ_COMMITTED` is usually enough,
  `READ_UNCOMMITTED` if concurrent launches of the same job are unlikely) is
  a real, documented option, not just theoretically available — it trades
  that insurance for less lock contention on the metadata tables under high
  job-launch concurrency.
- **`table-prefix` only renames the prefix, not the table or column
  layout.** It's enough to avoid a name collision with other tables in a
  shared schema (e.g. `SYSTEM.TEST_JOB_EXECUTION` instead of
  `BATCH_JOB_EXECUTION`), but it can't be used to reshape the schema itself
  — the table and column names Spring Batch expects are fixed, in the XML
  form and in `@EnableJdbcJobRepository` alike.
  ```java
  @EnableJdbcJobRepository(tablePrefix = "SYSTEM.TEST_")
  // BATCH_JOB_EXECUTION -> SYSTEM.TEST_JOB_EXECUTION, column names unchanged
  ```
- **`max-varchar-length` trades storage/index size against how much of a
  job parameter or exit message survives truncation.** A default that's too
  small for a job with long parameter values or verbose exit descriptions
  silently truncates that data in the metadata tables; too large wastes
  space across a schema with many job executions. Book vs. today: the book
  states the attribute's purpose but not its default; the current reference
  docs give it a concrete number, `2500`, matching the long `VARCHAR`
  columns in the sample schema scripts.
- **Book vs. today: `lob-handler` is gone, not just renamed.** The book
  treats it as an optional attribute needed for Oracle or an undetected
  database type. `setLobHandler()` on the modern
  `JobRepositoryFactoryBean`/`JdbcJobRepositoryFactoryBean` has been
  deprecated since Spring Batch 5.2 with no replacement offered, and is
  scheduled for removal — LOB handling today is resolved automatically from
  the detected database type instead of being a manual escape hatch.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 3, "Batch configuration", section 3.3, "Configuring the job repository", p. 72-75 — doc
- [Spring Batch Reference — Configuring a JobRepository (@EnableJdbcJobRepository, JdbcJobRepositoryFactoryBean)](https://docs.spring.io/spring-batch/reference/job/configuring-repository.html) — doc
- [Spring Batch Reference — What's New in Spring Batch 6 (JobRepository now extends JobExplorer)](https://docs.spring.io/spring-batch/reference/whatsnew.html) — doc
- [Spring Batch API — Deprecated List (lobHandler / setLobHandler removal)](https://docs.spring.io/spring-batch/docs/current/api/deprecated-list.html) — doc
