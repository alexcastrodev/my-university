---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

`JobLauncher`/`JobOperator` gives you an API for running a `Job` bean from
Java, but a `cron`-triggered nightly batch process doesn't have a running
Spring context lying around to call that API from — it has to spawn a brand
new JVM, boot Spring, run the job, and exit with a status code the scheduler
can read. `CommandLineJobRunner` is Spring Batch's built-in class for exactly
that: a `main` method that turns `java -classpath ...` arguments into a
Spring context lookup, a job name, typed job parameters, and — on the way
out — a system exit code the triggering scheduler can act on. This concept
covers that command-line entry point specifically; the launcher API it calls
underneath (`JobLauncher`/`JobOperator.run(Job, JobParameters)`, synchronous
vs. asynchronous execution) is covered in
`spring-batch-job-launcher-api-and-async-launching`.

## Use Cases

- A `cron` job (or any external scheduler) that needs to invoke a Spring
  Batch job as a standalone OS process, with no web container or long-lived
  application already running.
- A batch process where the *next* job to run depends on how the *previous*
  one exited — chaining job A → job B or job A → job C based on a shell-level
  exit code rather than an in-process condition.
- Passing job parameters (input file path, run date, thresholds) from the
  invoking shell script or scheduler entry, with the parameter's Java type
  (string, date, long, double) preserved rather than collapsed to a string.

## Deep Dive

### Packaging: what has to be on the classpath

Before `CommandLineJobRunner` can run anything, the JVM needs to find it, the
job configuration, and every dependency on the classpath. The book's
recipe: package the application (job configuration, custom readers/writers,
DAOs) as a JAR with `mvn package`, gather all dependencies into a `lib/`
directory with `mvn dependency:copy-dependencies`, then point `-classpath` at
both:

```bash
java -classpath "./lib/*" \
  org.springframework.batch.core.launch.support.CommandLineJobRunner \
  import-products-job.xml importProductsJob
```

The first argument is the Spring configuration file (an XML file on the
classpath by default — a `file:` resource prefix overrides that to read from
the filesystem instead); the second is the job's bean name.

### `CommandLineJobRunner` settings

| Setting | Description |
|---|---|
| Spring configuration file | Configures the Spring Batch infrastructure, the job, and its components (data source, readers, writers) |
| Job | The name of the job to execute (a Spring bean name) |
| Job parameters | The parameters passed to the job launcher |
| Exit code mapping | Strategy that maps the job's exit status to a system exit status |

### Passing job parameters, with types

Appending `name=value` pairs after the job name passes job parameters —
untyped, they default to `String`:

```bash
java -classpath "./lib/*" \
  org.springframework.batch.core.launch.support.CommandLineJobRunner \
  import-products-job.xml importProductsJob \
  inputFile=file:./products.txt date=2010/12/08
```

`name(type)=value` picks a real Java type instead of `String` — relevant
because job parameters also determine `JobInstance` identity (covered
alongside the launcher API concept), so a `date` parameter typed as `Date`
rather than `String` behaves correctly wherever that identity check
compares values by type:

```bash
java -classpath "./lib/*" \
  org.springframework.batch.core.launch.support.CommandLineJobRunner \
  import-products-job.xml importProductsJob \
  inputFile=file:./products.txt date(date)=2010/12/08
```

| Type | Java type | Example |
|---|---|---|
| String | `java.lang.String` | `inputFile(string)=products.txt` |
| Date | `java.util.Date` | `date(date)=2010/12/08` |
| Long | `Long` | `timeout(long)=1000` |
| Double | `Double` | `delta(double)=20.1` |

### Mapping a job's exit status to a system exit code

A launched job ends with an `ExitStatus` (a string, e.g. `COMPLETED` or
`FAILED`) — not to be confused with `BatchStatus` (an enum). Something has
to turn that string into the integer a shell or scheduler understands, and
that something is an `ExitCodeMapper`:

```java
public interface ExitCodeMapper {
    int intValue(String exitCode);
}
```

`CommandLineJobRunner`'s default implementation, `SimpleJvmExitCodeMapper`:

| System exit code | Job's exit status |
|---|---|
| 0 | `COMPLETED` |
| 1 | `FAILED` |
| 2 | Runner-level error (e.g. the named job wasn't found in the context) |

To drive a more specific sequencing decision — say, distinguishing "completed
cleanly" from "completed but skipped some items" — write a custom
`ExitCodeMapper` and declare it as a bean in the job's Spring context; the
runner picks it up automatically, no extra wiring:

```java
package com.manning.sbia.ch04;

public class SkippedAwareExitCodeMapper implements ExitCodeMapper {
    @Override
    public int intValue(String exitCode) {
        if (ExitStatus.COMPLETED.getExitCode().equals(exitCode)) {
            return 0;
        } else if (ExitStatus.FAILED.getExitCode().equals(exitCode)) {
            return 1;
        } else if ("COMPLETED WITH SKIPS".equals(exitCode)) {
            return 3;
        } else {
            return 2;
        }
    }
}
```

```xml
<bean class="com.manning.sbia.ch04.SkippedAwareExitCodeMapper" />

<job id="importProductsJob"
     xmlns="http://www.springframework.org/schema/batch">
  <!-- ... -->
</job>
```

A scheduler can then branch on the shell exit code directly: `0` → start job
B, `3` → start job C instead, `1`/`2` → do nothing and alert. This is one
concrete way `cron` (or any scheduler) drives *sequences* of jobs without
Spring Batch's own step/flow orchestration.

### Book vs. today: `CommandLineJobRunner` is deprecated, replaced by `CommandLineJobOperator`

`CommandLineJobRunner` is deprecated since Spring Batch 6.0, with removal
planned for 6.2 or later. The Spring Batch team's stated reasons: static
initialization made it inflexible, its option/parameter handling wasn't
standard, it was hard to extend, and — worst in practice — Spring Boot had
its own duplicate implementation that behaved differently (e.g. differing
job-parameter-incrementer behavior), which was confusing across the two
projects.

Its replacement, `CommandLineJobOperator`, changes more than the class name:

- **The first argument is now a Java `@Configuration` class, not an XML
  file.** `import-products-job.xml` becomes something like
  `io.spring.ImportProductsJobConfiguration` — consistent with Java-based job
  configuration replacing the XML namespace across Spring Batch 6 (see
  `spring-batch-chunk-processing` for that broader XML → `JobBuilder`/
  `StepBuilder` shift).
- **It operates jobs, not just launches them.** Beyond `start`, it supports
  `startNextInstance`, `stop`, `restart`, `abandon`, and `recover` — mirroring
  the fact that `JobOperator` (which it wraps) is a superset of `JobLauncher`.
- **Job parameter syntax changed shape.** The book's `name(type)=value` (e.g.
  `date(date)=2010/12/08`) becomes `name=value,type,identifying` with
  fully-qualified Java types and an explicit identifying flag:
  ```bash
  java org.springframework.batch.core.launch.support.CommandLineJobOperator \
    io.spring.EndOfDayJobConfiguration start endOfDay \
    schedule.date=2007-05-05,java.time.LocalDate,true \
    vendor.id=123,java.lang.Long,false
  ```
  `java.util.Date` is gone from the type vocabulary in favor of
  `java.time.LocalDate`-style `java.time` types, matching Spring Batch 6's
  move to `java.time` throughout its parameter and metadata handling.
- **The exit-code contract survives almost unchanged.** `ExitCodeMapper` is
  still the interface, `SimpleJvmExitCodeMapper` is still the default, and
  0/1/2 still mean completed/failed/runner-error — the book's mental model of
  "exit status string in, system exit code out" transfers directly; only the
  class doing the mapping (`setExitCodeMapper(...)` on `CommandLineJobOperator`)
  and the surrounding vocabulary changed.

Confirmed via the current Spring Batch API docs (`CommandLineJobOperator`,
`CommandLineJobRunner` deprecated-list entry) and the Spring Batch 6
reference documentation on running jobs from the command line.

## Trade-offs

- **A new JVM per execution is simple but pays a fixed startup cost every
  single run.** Booting the entire Spring application context — beans,
  `JobRepository`, data source pool — happens fresh each time `cron` fires the
  command, which is fine for an hourly-or-slower job and wasteful for
  anything approaching per-minute triggering (the book's own chapter roadmap
  flags "embed Spring Batch in a running container" as the alternative for
  that case).
- **Untyped job parameters silently become `String`, which can break restart
  identity.** Forgetting `(date)` on a date parameter doesn't fail loudly —
  the job runs — but two runs with the same date passed as different string
  formats can be treated as different `JobInstance`s, defeating the
  idempotent-restart guarantee that typed identifying parameters exist to
  provide.
  ```bash
  # These are two different JobInstances to Spring Batch, not the same run:
  date=2010/12/08          # String "2010/12/08"
  date(date)=2010/12/08    # java.util.Date, parsed
  ```
- **Relying on exit codes to sequence jobs couples your orchestration to the
  shell/scheduler layer.** It works well for a small, linear chain (job A's
  exit code picks B or C), but as the number of conditional branches grows,
  encoding that logic in scheduler scripts around exit codes gets harder to
  audit than expressing the same sequencing as Spring Batch steps/flows
  inside a single job.
- **Following the book's exact command verbatim on current Spring Batch
  silently targets a deprecated, soon-to-be-removed class.** `CommandLineJobRunner`
  still runs on 6.0/6.1, but a codebase built against the book's invocation
  today accrues migration debt immediately — the config-file argument, the
  parameter syntax, and the class name all need to change to move to
  `CommandLineJobOperator`.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 4, "Running batch jobs", section 4.2, "Launching from the command line", p. 92-97 — doc
- [Spring Batch Reference — Running a Job from the Command Line](https://docs.spring.io/spring-batch/reference/job/running.html) — doc
- [Spring Batch API — CommandLineJobOperator](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/core/launch/support/CommandLineJobOperator.html) — doc
- [Spring Batch API — Deprecated List (CommandLineJobRunner)](https://docs.spring.io/spring-batch/reference/api/deprecated-list.html) — doc
- [Spring Batch 6.0 Migration Guide](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
