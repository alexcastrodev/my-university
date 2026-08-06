---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

Spring Batch is "just Spring beans," so a job repository, a launcher, and your
`Job` definitions can live inside any long-lived Spring context — including the
one a web application already keeps running. Embedding the batch environment in
a web app makes it *resident*: the infrastructure is initialized once when the
container starts and stays warm, so launching a job no longer means spawning a
fresh JVM and paying full context-bootstrap cost per run (the price of the
`cron` + `CommandLineJobRunner` approach in `spring-batch-command-line-launching`).

Once the batch environment is resident, you can also trigger jobs *on demand*
over HTTP. That matters when the thing that decides "run now" is an external
system — another team's scheduler, a monitoring tool, an admin UI — that can't
reach the batch JVM directly but can make an HTTP request. The catch is that a
web-triggered launch must be asynchronous, or the job monopolizes the request
thread for its entire duration.

## Use Cases

- An external system that can't talk to your batch process directly (a legacy
  scheduler, an ops team's `cron` on a *different* host, a webhook from another
  service) needs to kick off a job — expose an HTTP endpoint it can hit.
- A job runs often enough that re-bootstrapping the whole Spring context on
  every run (initializing connection pools, an ORM `SessionFactory`, etc.) would
  dominate its runtime — keep the context resident in a web container instead.
- You already operate a web application and want to co-locate batch jobs (and an
  in-process scheduler — see `spring-batch-job-schedulers-cron-and-spring-scheduler`)
  in the same context, reusing its data sources, DAOs, and business services.
- An operator, admin console, or another service's webhook needs an on-demand
  "run this job now" trigger, with parameters derived from the request.

## Deep Dive

### Embedding Spring Batch in a web application's root context

The Spring Framework ships a servlet listener, `ContextLoaderListener`, that
ties a Spring application context's lifecycle to the web application's. That
context is the web app's *root application context*. You register the listener
in `web.xml`:

```xml
<web-app xmlns="http://java.sun.com/xml/ns/javaee" version="2.5">
  <display-name>Spring Batch in a web application</display-name>
  <listener>
    <listener-class>
      org.springframework.web.context.ContextLoaderListener
    </listener-class>
  </listener>
</web-app>
```

By default the listener builds the context from `/WEB-INF/applicationContext.xml`.
That file holds the batch infrastructure, the jobs, an optional scheduler, and
app services — and a best practice is to split it so jobs can be reused (e.g. in
integration tests) instead of living in one monolithic file:

```xml
<beans xmlns="http://www.springframework.org/schema/beans">
  <import resource="batch-infrastructure.xml"/>  <!-- jobRepository, jobLauncher -->
  <import resource="batch-jobs.xml"/>            <!-- the Job definitions -->
  <import resource="scheduling.xml"/>            <!-- optional in-process scheduler -->
</beans>
```

Deploy the WAR and the batch environment is live and warm. If `scheduling.xml`
wires a Spring scheduler, you're done — jobs fire on a timer with no external
scheduler at all. The remaining scenario is when the trigger comes from
*outside*: an HTTP request.

### Launching a job on demand over HTTP (a Spring MVC controller)

The external trigger is just an HTTP call — even `cron` on another box can do it
with `wget`:

```bash
wget "http://localhost:8080/sbia/joblauncher?job=importProductsJob&date=20101218"
```

On the server side, a Spring MVC controller reads the `job` name plus arbitrary
parameters off the request, turns them into `JobParameters`, and launches:

```java
@Controller
public class JobLauncherController {

  private final JobLauncher jobLauncher;
  private final JobRegistry jobRegistry;

  public JobLauncherController(JobLauncher jobLauncher, JobRegistry jobRegistry) {
    this.jobLauncher = jobLauncher;
    this.jobRegistry = jobRegistry;
  }

  @RequestMapping(value = "joblauncher", method = RequestMethod.GET)
  @ResponseStatus(HttpStatus.ACCEPTED)                        // returns 202, empty body
  public void launch(@RequestParam String job, HttpServletRequest request)
      throws Exception {
    JobParameters params = extractParameters(request);        // every non-"job" param
    jobLauncher.run(jobRegistry.getJob(job), params);         // look up Job by name, run
  }
}
```

`jobRegistry.getJob(job)` resolves the `Job` bean from the name in the URL, so
the controller can launch *any* registered job without a compile-time reference.
That registry is a bean you declare alongside the infrastructure:

```xml
<bean id="jobRegistry"
      class="org.springframework.batch.core.configuration.support.MapJobRegistry"/>
<bean class="org.springframework.batch.core.configuration.support.JobRegistryBeanPostProcessor">
  <property name="jobRegistry" ref="jobRegistry"/>
</bean>
```

Spring MVC's `DispatcherServlet` (declared in `web.xml`) creates a *child*
context whose controller sees the root context's `jobLauncher` and `jobRegistry`.
The `202 ACCEPTED` is deliberate ("launch accepted," not "job finished"), and the
launch **must be asynchronous** — a synchronous `run()` pins the container's
thread for the whole job. The `TaskExecutor` that makes `run()` return
immediately is covered in `spring-batch-job-launcher-api-and-async-launching`;
here it's a hard requirement, not an optimization.

### Book vs. today: Spring Boot auto-configures the resident context you wired by hand

Every moving part above — a resident context, its lifecycle, the servlet, even
the launcher bean — is what Spring Boot now provides for free. A Boot app *is* a
long-lived process with an already-running `ApplicationContext` and an embedded
servlet container, so there's no `web.xml`, no `ContextLoaderListener`, no
`DispatcherServlet` declaration, and no parent/child context split to reason
about. `BatchAutoConfiguration` wires the `JobRepository` and batch
infrastructure, and by default runs your `Job` on startup via
`JobLauncherApplicationRunner`. You opt out of the startup run — the usual choice
when you want to launch on demand instead — with one property:

```properties
# don't run jobs at startup; we'll trigger them ourselves over HTTP
spring.batch.job.enabled=false
# spring.batch.job.name=importProductsJob   # pick one when several Jobs exist
```

The HTTP trigger becomes an ordinary `@RestController` that injects the launch
API and the `Job` bean directly (both are auto-configured beans) — no
`JobRegistry` lookup, no XML:

```java
@RestController
class ProductsJobController {

  private final JobOperator jobOperator;      // modern launch API (see below)
  private final Job importProductsJob;

  ProductsJobController(JobOperator jobOperator, Job importProductsJob) {
    this.jobOperator = jobOperator;
    this.importProductsJob = importProductsJob;
  }

  @PostMapping("/jobs/import-products")
  @ResponseStatus(HttpStatus.ACCEPTED)
  JobExecution launch() throws Exception {
    JobParameters params = new JobParametersBuilder()
        .addLocalDateTime("requestedAt", LocalDateTime.now())
        .toJobParameters();
    return jobOperator.start(importProductsJob, params);   // 6.0: start(Job, JobParameters)
  }
}
```

Two current-state details drive that snippet. First, the launch API itself
changed: `JobLauncher` is deprecated since Spring Batch 6.0 in favor of
`JobOperator` (which now *extends* `JobLauncher`; the implementation is
`TaskExecutorJobOperator`), so the book's `jobLauncher.run(job, params)` becomes
`jobOperator.start(job, params)` — the string-based `start(String, Properties)`
is itself deprecated for removal. Second, the asynchronous requirement from the
book hasn't gone away: you still give the operator a `TaskExecutor` so the
request thread returns immediately, exactly as detailed in
`spring-batch-job-launcher-api-and-async-launching`. (Add `@EnableBatchProcessing`
/ `DefaultBatchConfiguration` only to make Boot's auto-config back off and wire
the infrastructure by hand.) Confirmed via the current Spring Boot reference
("Spring Batch" / running a Job on startup) and the Spring Batch 6.0
`JobOperator` API.

## Trade-offs

- **Resident context vs. a fresh JVM per run** — Embedding keeps the batch
  environment warm, so a launch skips the full context-bootstrap cost that
  `cron` + `CommandLineJobRunner` pays every time. The flip side is coupling:
  job availability is now tied to the web app's uptime, jobs share its heap and
  thread pool, and a container crash takes the jobs down with it.
- **An HTTP trigger decouples the caller, but you inherit its security surface** —
  Anyone who can reach the URL can start a job. The book's bare `wget` has no
  authentication or rate limiting; a network-reachable launch endpoint needs
  both, plus a guard against duplicate launches.
- **Use POST, not GET, for a launch endpoint** — The book maps the launcher to
  `GET`, but launching a job is a state-changing, non-idempotent action; per HTTP
  semantics that belongs on `POST` (`@PostMapping`), which also keeps job
  parameters out of proxy/access logs and off the URL.
- **Async is mandatory here, not a tuning knob** — A synchronous web-triggered
  launch holds one servlet thread for the job's entire duration; a handful of
  concurrent long jobs can drain the container's pool and stall *unrelated*
  requests. This is a resource-exhaustion failure mode, not a batch error — see
  `spring-batch-job-launcher-api-and-async-launching` for the `TaskExecutor` fix.
- **Name-based lookup vs. injecting the `Job`** — The book's `JobRegistry.getJob(name)`
  lets one controller launch any registered job by string, at the cost of a
  runtime failure if the name is wrong. Injecting the `Job` bean (the Boot idiom)
  is compile-time safe but pins the controller to a specific job.
- **Two contexts (root + servlet) are a classic wiring footgun** — In the XML
  setup, a bean defined in the wrong one of the parent/child pair is either
  invisible or silently duplicated. Spring Boot's single `ApplicationContext`
  removes the split entirely.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 4, "Running batch jobs", section 4.4, "Launching from a web application", p. 103-109 — doc
- [Spring Boot Reference — Spring Batch (auto-configuration & running a Job on startup)](https://docs.spring.io/spring-boot/reference/io/spring-batch.html) — doc
- [Spring Batch 6.0 API — JobOperator (start(Job, JobParameters); JobLauncher deprecated)](https://docs.spring.io/spring-batch/docs/6.0.x/api/org/springframework/batch/core/launch/JobOperator.html) — doc
