---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

A monitoring tool does two things: it *detects* that a job execution went wrong
and *notifies* someone (email, SMS, a dashboard). It matters more for batch jobs
than for most software because they run headless — no user interface is watching
them fail. Spring Batch makes this tractable by recording *everything* that
happens during a run into the job repository: the `JobRepository` persists
`JobInstance`, `JobExecution`, and `StepExecution` rows into `BATCH_JOB_INSTANCE`,
`BATCH_JOB_EXECUTION`, and `BATCH_STEP_EXECUTION` (the last carrying
read/write/filter/skip/commit/rollback counts), plus serialized context in the
`BATCH_*_EXECUTION_CONTEXT` tables.

So monitoring in Spring Batch is largely *reading that history back*. This
concept covers the book's four ways to do it: querying execution data with the
read-only `JobExplorer` and the simple-typed `JobOperator`, treating the metadata
schema itself as a queryable surface, pushing alerts at run boundaries with a
`JobExecutionListener`, and exposing batch beans over JMX for a live console.
Schema and repository configuration live in
*spring-batch-job-repository-database-configuration*.

## Use Cases

- Detect failed runs after the fact by walking job names → instances → executions
  for those whose exit status is `FAILED` — the "did last night's import break?" check.
- Read per-step counts (read/write/skip/commit/rollback) and durations to catch
  abnormal skips or a suspiciously slow run, even when the job "succeeded".
- Push an email or message the instant a job fails, from inside the running process.
- Give operators a live remote console (JConsole/JMX) to query summaries and
  start/stop jobs, using the simple-typed `JobOperator`.
- Feed job/step duration timers into Prometheus and graph trends in Grafana
  (the modern replacement for hand-rolled monitoring).

## Deep Dive

### Reading run history: `JobExplorer` and `JobOperator`

The `JobRepository` interface exists for the batch infrastructure to *write*
execution data during a run; its methods aren't meant for browsing. For
read-only exploration, Spring Batch provides `JobExplorer`:

```java
public interface JobExplorer {
  List<String> getJobNames();
  List<JobInstance> getJobInstances(String jobName, int start, int count);
  List<JobExecution> getJobExecutions(JobInstance jobInstance);
  Set<JobExecution> findRunningJobExecutions(String jobName);
  StepExecution getStepExecution(Long jobExecutionId, Long stepExecutionId);
  // ... (getJobExecution, getJobInstance, ... also available)
}
```

The book configures it with `JobExplorerFactoryBean` (it needs only a
`dataSource` and a `lobHandler`). The canonical monitoring use case — detecting
failed runs — walks job names → instances → executions and checks each exit
status (`getJobInstances` is paged, so loop the pages in production):

```java
List<JobExecution> failed = new ArrayList<>();
for (String name : jobExplorer.getJobNames()) {
  for (JobInstance instance : jobExplorer.getJobInstances(name, 0, 100)) {
    for (JobExecution execution : jobExplorer.getJobExecutions(instance)) {
      if (execution.getExitStatus().equals(ExitStatus.FAILED)) {
        failed.add(execution);   // then read failure exceptions / step counts
      }
    }
  }
}
```

`JobExplorer` returns full domain objects. `JobOperator` covers similar ground
but speaks in `String`/`Long` — deliberately simple types that travel well over
JMX — and adds control methods:

```java
public interface JobOperator {
  List<Long> getExecutions(long instanceId);
  Map<Long, String> getStepExecutionSummaries(long executionId);
  String getSummary(long executionId);
  Long restart(long executionId);
  boolean stop(long executionId);
  // ... (getJobNames, getJobInstances, getRunningExecutions, start, ... also available)
}
```

`getSummary` and `getStepExecutionSummaries` fold the same status/exit-code detail
into `String`s, which is exactly what a JMX console can render. (The identity
model behind instances vs. executions is covered in
*spring-batch-job-instance-execution-flow*.)

### The metadata schema as a monitoring surface

Because it's just a relational schema, the most basic monitoring tool is a SQL
client. `BATCH_STEP_EXECUTION` carries the numbers you'd otherwise compute:
`READ_COUNT`, `WRITE_COUNT`, `FILTER_COUNT`, `READ_SKIP_COUNT`,
`WRITE_SKIP_COUNT`, `PROCESS_SKIP_COUNT`, `COMMIT_COUNT`, `ROLLBACK_COUNT`,
`STATUS`, `EXIT_CODE`, `START_TIME`, `END_TIME`:

```sql
SELECT je.JOB_INSTANCE_ID, se.STEP_NAME, se.STATUS,
       se.READ_COUNT, se.WRITE_COUNT, se.WRITE_SKIP_COUNT,
       (se.END_TIME - se.START_TIME) AS duration
FROM   BATCH_STEP_EXECUTION se
JOIN   BATCH_JOB_EXECUTION je ON je.JOB_EXECUTION_ID = se.JOB_EXECUTION_ID
WHERE  se.STATUS = 'FAILED' OR se.WRITE_SKIP_COUNT > 0;
```

The `JobExplorer`/`JobOperator` APIs are a thin object-oriented layer over this
exact data — see *spring-batch-job-repository-database-configuration* for the
full schema and table-prefix configuration.

### Monitoring with listeners (push, not poll)

A `JobExecutionListener` turns "a job ended" into an actionable event without
anyone querying the database. The book keeps the listener generic by delegating
to a `BatchMonitoringNotifier` interface and only firing on failure:

```java
public class MonitoringExecutionListener {
  private BatchMonitoringNotifier monitoringNotifier;   // injected

  @AfterJob
  public void executeAfterJob(JobExecution jobExecution) {
    if (jobExecution.getStatus() == BatchStatus.FAILED) {
      monitoringNotifier.notify(jobExecution);   // e-mail, Spring event, ...
    }
  }
}
```

Concrete notifiers plug in behind the interface: an `EmailMonitoringNotifier`
built on Spring's `MailSender`/`SimpleMailMessage`, or an
`ApplicationEventMonitoringNotifier` that publishes through the container's
`ApplicationEventPublisher`. The listener sees the *live* `JobExecution`,
including `getFailureExceptions()` — exceptions Spring Batch does **not** persist,
so they're reachable only from the running process. Registration and the full
listener lifecycle (job/step/chunk/item hooks, annotations) belong to
*spring-batch-execution-listeners*; here the listener is just a monitoring hook.

### Monitoring with JMX

JMX exposes resources as MBeans an external console can read and drive remotely.
The book exports the `JobOperator` (simple types) rather than the `JobExplorer`
(complex objects, awkward over JMX) with Spring's `MBeanExporter`:

```xml
<bean class="org.springframework.jmx.export.MBeanExporter">
  <property name="beans">
    <map>
      <entry key="spring:service=batch,bean=jobOperator" value-ref="jobOperator"/>
    </map>
  </property>
  <!-- InterfaceBasedMBeanInfoAssembler exports only JobOperator's methods over JMX -->
  <property name="assembler" ref="jobOperatorAssembler"/>
</bean>
```

Add a `ConnectorServerFactoryBean` + `RmiRegistryFactoryBean` for remote RMI, and
JConsole shows the operator under the `spring/batch` node; calling
`getJobInstances`, `getExecutions`, `getSummary`, and `getStepExecutionSummaries`
retrieves execution data live.

### Book vs. today: Spring Batch Admin is dead; monitoring moved to Micrometer

Three things changed materially since 2012. First, **Spring Batch Admin — the web
console the book covers in section 12.4 — is discontinued** (end-of-life December
31, 2017). Do not recommend it. Its role as a job dashboard passed to **Spring
Cloud Data Flow**, where each batch job is a Spring Boot task that SCDF launches,
monitors, and visualizes.

Second, the metadata tables and read APIs remain, but in **Spring Batch 6.0
`JobRepository` now extends `JobExplorer`** — the two were consolidated, the
standalone `JobExplorer` (moved to `org.springframework.batch.core.repository.explore`)
is deprecated for removal, and one bean now both writes and reads history (see
*spring-batch-job-repository-database-configuration*).

Third, hand-rolled JMX has been superseded by **built-in Micrometer metrics,
available since Spring Batch 4.2**. The framework registers timers under the
`spring.batch` prefix automatically — no MBean wiring required:

| Metric | Type | Tags |
|---|---|---|
| `spring.batch.job` | `TIMER` | `name`, `status` |
| `spring.batch.job.active` | `LONG_TASK_TIMER` | `name` |
| `spring.batch.step` | `TIMER` | `name`, `job.name`, `status` |
| `spring.batch.step.active` | `LONG_TASK_TIMER` | `name` |
| `spring.batch.item.read` / `spring.batch.item.process` / `spring.batch.chunk.write` | `TIMER` | `job.name`, `step.name`, `status` |

```java
// Register a Prometheus-backed registry; timers are recorded for you.
@Bean
public MeterRegistry meterRegistry() {
  return new PrometheusMeterRegistry(PrometheusConfig.DEFAULT);
}
// exposed as e.g. spring.batch.job{name="importProductsJob",status="FAILED"}
```

With Spring Boot, adding `micrometer-registry-prometheus` and Actuator exposes
`/actuator/prometheus`, which Prometheus scrapes and Grafana graphs; Spring Batch
6.0 also records these through an `ObservationRegistry`. Confirmed via the Spring
Batch 6.0 reference (Monitoring and metrics / What's New), the Spring Batch 6.0
Migration Guide, and the Spring Batch Admin EOL notice.

## Trade-offs

- **Failure exceptions aren't persisted — only exit descriptions survive.**
  `JobExecution.getFailureExceptions()` returns real `Throwable`s, but only inside
  the process that ran the job; Spring Batch never stores them. After the fact you
  have the exit-status *description* (the `EXIT_MESSAGE` column), so post-mortem
  monitoring reads text, not live stack traces.
- **`JobExplorer` vs. `JobOperator` is richness vs. remote-friendliness.**
  `JobExplorer` hands back full domain objects — ideal in-process, poor over JMX;
  `JobOperator` returns `String`/`Long` summaries — ideal for a JConsole. The book
  explicitly recommends exposing `JobOperator`, not `JobExplorer`, through JMX.
- **Direct SQL is the most powerful and the most coupled.** Querying `BATCH_*`
  tables answers anything, but it hard-wires your monitoring to the schema and the
  table prefix — a prefix change or migration silently breaks it.
  ```sql
  -- breaks the moment table-prefix is customized away from BATCH_
  SELECT COUNT(*) FROM BATCH_JOB_EXECUTION WHERE STATUS = 'FAILED';
  ```
- **Listeners give push but no history.** A monitoring listener sees only the
  current `JobExecution`; it knows nothing about prior runs. Alerting is immediate,
  but any "is this the third failure this week?" context still needs `JobExplorer`.
- **Book vs. today: don't build the book's high-level tools from scratch.** Spring
  Batch Admin and hand-wired JMX were *the* answers in 2012; today they're
  superseded by built-in Micrometer metrics, Prometheus/Grafana, and Spring Cloud
  Data Flow. Rolling your own MBean exporter now largely duplicates framework
  metrics you get for free.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 12, "Monitoring jobs", sections 12.1-12.3 & 12.5, "Accessing batch execution data" … "Monitoring with JMX", p. 348-372 — doc
- [Spring Batch Reference — Monitoring and metrics (Micrometer timers, since 4.2)](https://docs.spring.io/spring-batch/reference/spring-batch-observability/micrometer.html) — doc
- [Spring Batch Reference — What's New in Spring Batch 6 (JobRepository now extends JobExplorer)](https://docs.spring.io/spring-batch/reference/whatsnew.html) — doc
- [Spring Batch 6.0 Migration Guide — JobExplorer consolidated into JobRepository](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
- [Spring Cloud Data Flow (modern dashboard replacing Spring Batch Admin)](https://dataflow.spring.io/) — doc
