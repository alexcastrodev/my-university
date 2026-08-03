---
version: 1.0
updatedAt: 2026-08-03
---
## Objective

Most Spring beans are built once, at application startup, from values known at
configuration time. A batch job breaks that assumption on purpose: the input
filename, a date range, or any other launch-time parameter is only known when
the job actually starts — sometimes only when a specific *step* inside it
starts. Spring Batch's `StepScope` bean scope defers instantiation of a bean
until its step begins, and combined with the Spring Expression Language
(SpEL), that deferred instant is also the moment a bean's properties can be
filled in from that step's own runtime context — no hardcoded filename in the
configuration, no custom plumbing to pass launch parameters down to a reader
or writer.

## Use Cases

- Configuring a file-reading step (`FlatFileItemReader`, a custom
  `Tasklet`) whose input file path is supplied as a job parameter at launch
  time, instead of baked into the Spring configuration.
- Sharing a value computed by an earlier step (written into the step or job
  execution context) with a later step's reader, writer, or tasklet, without
  introducing a separate side channel to pass it along.
- Running the same step definition for different dates, regions, or batch
  runs by parameterizing it at launch instead of duplicating the
  configuration per variant.

## Deep Dive

### `StepScope`: a custom bean scope tied to step lifecycle

Spring has supported pluggable custom bean scopes since version 2 — the
built-in `singleton`/`prototype`/`request`/`session` scopes are joined by
whatever a `CustomScopeConfigurer`-registered implementation defines. Spring
Batch ships one such scope, `StepScope`, whose entire purpose is to link a
bean's lifecycle to a specific step: a step-scoped bean is only instantiated
once its step actually begins, not when the surrounding Spring container
starts up.

```java
@Bean
@StepScope
public FlatFileItemReader<Foo> flatFileItemReader(
        @Value("#{jobParameters['input.file.name']}") String name) {
    return new FlatFileItemReaderBuilder<Foo>()
            .name("flatFileItemReader")
            .resource(new FileSystemResource(name))
            .build();
}
```

`StepScope` isn't registered by default — the current Spring Batch reference
is explicit that it must be added by one (and only one) of three routes:
`@EnableBatchProcessing`, an explicit `StepScope` bean definition, or the
legacy `batch` XML namespace. The book's XML-era equivalent registers the
same scope as a bean:

```xml
<bean class="org.springframework.batch.core.scope.StepScope"/>
```

and marks a bean step-scoped with a plain `scope` attribute:

```xml
<bean id="decompressTasklet"
      class="com.manning.sbia.ch01.batch.DecompressTasklet"
      scope="step">
  <property name="inputResource"
            value="#{jobParameters['inputResource']}" />
  <property name="targetDirectory"
            value="#{jobParameters['targetDirectory']}" />
  <property name="targetFile"
            value="#{jobParameters['targetFile']}" />
</bean>
```

Both forms do the same thing: nothing about `decompressTasklet`/
`flatFileItemReader` can be resolved until the step it belongs to actually
starts, because its property values are SpEL expressions, not literals.

### SpEL late binding: three contexts a step-scoped bean can read from

Spring Expression Language (SpEL), introduced in Spring 3, is a general
expression language usable anywhere in the Spring portfolio — not something
Spring Batch invented, just something it leans on heavily here. A step-scoped
bean's properties can reference any of three contexts via `#{...}`
placeholders:

| Context | Description |
|---|---|
| `jobParameters` | Parameters supplied when the job was launched |
| `jobExecutionContext` | The current job's shared execution context |
| `stepExecutionContext` | The current step's own execution context |

`jobParameters` is a map, indexed by key: `#{jobParameters['inputResource']}`
resolves the `inputResource` parameter exactly as it was passed at launch.
The other two work the same way against whatever key/value pairs a previous
step (or the job itself) chose to record — which is how one step passes a
computed value forward to a later one without a custom side channel.

### Why this matters: parameterizing without hardcoding

The concrete payoff, per the book's own case study: a product-import step
needs to know which file to read, but that file changes on every run. Without
step scope and SpEL, the filename would either be hardcoded per environment
(breaking as soon as the file changes) or plumbed through by hand. With step
scope, the job launcher's parameters flow straight into the reader's
configuration at the moment the step starts — the configuration expresses
"read from whatever file the caller specifies," not "read from
`/data/import.csv`."

## Trade-offs

- **Step scope only defers instantiation to step start — it doesn't make a
  bean re-instantiate per item or per chunk.** It solves "I don't know this
  value until the step starts," not "I need a fresh instance per unit of
  work"; conflating the two leads to reaching for step scope when a
  different mechanism (like a scoped-proxy reset between steps, or explicit
  state management) is what's actually needed.
- **A SpEL expression referencing a job parameter that was never supplied at
  launch fails at step start, not at configuration time.** The whole benefit
  of late binding — deferring resolution to runtime — is also its cost: a
  typo in a job-parameter key (`#{jobParameters['inputResourc']}`) compiles
  fine and only surfaces when the step actually tries to run.
- **`StepScope` must be registered exactly once, through exactly one of
  three mechanisms.** The current reference documentation is explicit that
  mixing routes (e.g., an explicit `StepScope` bean *and*
  `@EnableBatchProcessing`) is not the intended usage — pick one and be
  consistent, rather than assuming registering it twice is merely redundant.
- **Book vs. today: the primary configuration style moved from XML
  `scope="step"` to `@StepScope`+`@Bean` in Java configuration**, matching
  the same shift documented elsewhere in this workflow (`<batch:job-repository>`
  → `@EnableJdbcJobRepository`, XML job vocabulary → `JobBuilder`/
  `StepBuilder`). The book's XML form (`scope="step"` on a `<bean>`,
  `<property value="#{jobParameters['x']}"/>`) still works conceptually —
  the SpEL expressions and the three available contexts
  (`jobParameters`/`jobExecutionContext`/`stepExecutionContext`) are
  unchanged — but the XML batch namespace itself has been deprecated since
  Spring Batch 6.0, with removal planned for 7.0, the same migration
  already noted for the job/step/chunk vocabulary in this workflow's other
  Spring Batch concepts.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 3, "Batch configuration", sections 3.4.1-3.4.2, p. 75-78 — doc
- [Spring Batch Reference — Late Binding of Job and Step Attributes](https://docs.spring.io/spring-batch/reference/step/late-binding.html) — doc
- [Spring Batch API — StepScope](https://docs.spring.io/spring-batch/docs/current/api/org/springframework/batch/core/scope/StepScope.html) — doc
- [Spring Batch 6.0 Migration Guide — XML namespace deprecation](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
