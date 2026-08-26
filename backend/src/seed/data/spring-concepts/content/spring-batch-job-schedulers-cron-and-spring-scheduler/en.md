---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

`CommandLineJobRunner` (covered in `spring-batch-command-line-launching`) knows
how to turn `java -classpath ...` arguments into a running Spring Batch job —
but something still has to *invoke* that command on a recurring basis. This
concept is about that trigger, not the runner itself: `cron`, the classic
UNIX job scheduler that spawns a new process on a time-based expression, and
Spring's own `@Scheduled`/`TaskScheduler` support, which schedules a method
call inside an already-running Spring context instead. The two solve the same
"launch this periodically" problem at different layers — OS process
scheduling vs. in-process task scheduling — and the choice between them
mostly comes down to whether a Spring application context is already up and
how expensive it is to bootstrap.

## Use Cases

- A nightly re-index or file-import job with a wide time window (e.g.
  "sometime between 2 a.m. and 4 a.m.") where spawning a fresh JVM once a day
  is cheap relative to the job's own runtime — a good fit for `cron` +
  `CommandLineJobRunner`.
- A job that needs to run very frequently (e.g. scanning a directory every
  minute) where bootstrapping the Spring context — initializing a Hibernate
  `SessionFactory`, connection pools, etc. — is itself CPU-intensive and would
  dominate or exceed the job's own execution time if repeated per run; the
  Spring scheduler avoids that cost by keeping the context resident.
- An application that already runs as a long-lived process (a web app or any
  other managed container) and wants to add scheduled batch launches without
  depending on OS-level cron access — relevant for restricted or
  container-only deployment targets.
- Choosing between a simple fixed interval ("every minute") and a complex
  calendar rule ("last weekday of the month at 23:00") — Spring's scheduler
  supports both without forcing every case through a cron expression.

## Deep Dive

### Triggering with cron: the crontab entry

A crontab line has three parts — cron expression, user, and command:

```
0 4 * * ?     acogoluegnes    java -classpath "/usr/local/bin/sb/lib/*" \
  org.springframework.batch.core.launch.support.CommandLineJobRunner \
  import-products-job.xml importProductsJob \
  inputFile=file:/home/sb/import/products.txt date=2010/12/08
```

`0 4 * * ?` says "every day at 4 a.m."; the command is the same
`CommandLineJobRunner` invocation from `spring-batch-command-line-launching`
— cron's only job is deciding *when* to run it. Each firing spawns a brand
new JVM: bootstrap the Spring context, run the job, exit. That's fine for an
infrequent job; it becomes the bottleneck for a job triggered every minute if
context startup is expensive, since the next cron tick can fire before the
previous JVM has even finished booting.

### Triggering in-process: `@Scheduled`

The Spring scheduler needs a running Spring application context — you
typically embed it in a web app or other managed environment rather than
launching it standalone. The launch logic itself is a plain method that calls
the job launcher:

```java
public class SpringSchedulingAnnotatedLauncher {

    private Job job;
    private JobLauncher jobLauncher;

    @Scheduled(fixedRate = 1000)
    public void launch() throws Exception {
        JobParameters jobParams = createJobParameters();
        jobLauncher.run(job, jobParams);
    }

    private JobParameters createJobParameters() {
        // typically a timestamp or sequence, to give each run a distinct
        // JobInstance identity
    }
}
```

Activating `@Scheduled` support and (optionally) a thread pool:

```xml
<task:scheduler id="scheduler" pool-size="10" />
<task:annotation-driven scheduler="scheduler" />
```

Declaring the scheduler bean is optional — Spring falls back to a
single-threaded scheduler as soon as any `@Scheduled` method exists — but
declaring it explicitly, with a pool size, matters once multiple scheduled
jobs can overlap in their launch times and shouldn't block on one shared
thread. `fixedRate` here uses the *start* time of the previous invocation to
measure the interval; `fixedDelay` instead measures from the previous
invocation's *completion*, and `cron` accepts a full cron expression when the
schedule is too irregular for a fixed interval. Unlike system `cron`, Spring's
own cron parser supports a seconds field.

### Book vs. today: `@Scheduled` gained reactive/virtual-thread support, and Kubernetes CronJob largely replaced raw crontab

The `@Scheduled` mechanics above are unchanged since the book (Spring 3.0):
`fixedRate`, `fixedDelay`, `cron`, and `@EnableScheduling` (the annotation
equivalent of `<task:annotation-driven>`) all still work exactly as
described. Two things have moved since 2012:

- **Spring Framework 6.1 added reactive and virtual-thread support to
  `@Scheduled`.** A scheduled method can now return `Mono`/`Flux` (or a
  Kotlin suspending function), and a new `SimpleAsyncTaskScheduler`
  implementation fires each scheduled execution on its own JDK 21 virtual
  thread — useful for a Spring scheduler that fans out many I/O-bound job
  launches without sizing a fixed platform-thread pool up front. None of this
  changes the trigger vocabulary (`fixedRate`/`fixedDelay`/`cron` are the same
  three options from table 4.5 of the book); it changes what runs on the
  thread the scheduler hands out.
- **The deployment model around `cron` has shifted more than `cron` itself.**
  `cron` + `CommandLineJobRunner` still works unchanged as a mechanic — but in
  a containerized/Kubernetes deployment, the equivalent of "edit `/etc/crontab`
  on a box" is a Kubernetes `CronJob` resource, which runs the same
  `CommandLineJobRunner`/`CommandLineJobOperator` invocation inside a
  container on a `spec.schedule` cron expression, with the cluster (not a
  single host's `cron` daemon) responsible for firing it, retrying on
  failure, and enforcing concurrency policy. The underlying "spawn a fresh
  process per scheduled run" trade-off from the book — no resident context,
  full bootstrap cost every time — carries over identically; what changed is
  *where* the schedule lives and who owns triggering it, not the mechanic
  cron vs. Spring's scheduler were being compared on.

Confirmed via the current Spring Framework reference documentation on task
scheduling and the Kubernetes documentation on the `CronJob` resource.

## Trade-offs

- **cron spawns a new JVM per run — simple, but pays full Spring context
  bootstrap cost every single firing.** Fine for a nightly job; for a job
  triggered every minute, an expensive context (e.g. one that initializes a
  Hibernate `SessionFactory`) can take longer to boot than the job itself
  takes to run, in which case a resident Spring scheduler avoids the repeated
  cost entirely.
- **cron has no awareness of the Spring context it's launching into.** It
  just runs a shell command; if the previous run's JVM is still shutting down
  or the classpath/config changes, cron has no way to know or coordinate —
  the Spring scheduler runs inside the same long-lived context it schedules
  against, so job and scheduler share the same lifecycle.
- **The Spring scheduler's simpler deployment ties job triggering to the
  app's own uptime.** It needs a running Spring application context to fire
  at all — no external OS-level cron access is required, which is attractive
  for restricted or container-only environments, but a scheduled job launch
  only happens while that specific application instance is up; restart or
  redeploy the app and, without a persisted "did this already fire today"
  check, a missed window is simply missed rather than picked up by an
  independent OS-level daemon.
- **XML scheduling configuration is decoupled from the Java method it
  triggers; annotation-driven `@Scheduled` is not.** `<task:scheduled ref="..."
  method="launch" fixed-rate="1000" />` lives entirely outside the Java class,
  so renaming or changing the target method requires editing XML — but the
  schedule can be externalized to a property file per environment.
  `@Scheduled(fixedRate = 1000)` keeps the schedule next to the code it
  governs, at the cost of being hardcoded and only usable on methods you
  control.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 4, "Running batch jobs", section 4.3, "Job schedulers", p. 98-104 — doc
- [Spring Framework Reference — Task Execution and Scheduling](https://docs.spring.io/spring-framework/reference/integration/scheduling.html) — doc
- [Spring Batch Reference — Running a Job from the Command Line](https://docs.spring.io/spring-batch/reference/job/running.html) — doc
- [Kubernetes Documentation — CronJob](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/) — doc
