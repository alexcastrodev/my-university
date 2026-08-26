---
version: 1.0
updatedAt: 2026-07-31
---
## Objective

Knowing the Job/Step model (covered by `spring-batch-job-model`) is only half the
story — a job also needs to say whether it can be restarted, how new launch
parameters get generated for repeated runs, and whether a launch should be rejected
outright for missing parameters. The book expresses all three as attributes and
child elements of its XML `<job>`/`<step>` vocabulary; today the same three
concerns are expressed as method calls on `JobBuilder`.

## Use Cases

- Marking a one-shot job (e.g., a destructive data-migration job) as
  non-restartable so a second launch attempt fails loudly instead of silently
  re-running destructive work.
- Auto-generating a fresh, always-unique parameter (like a run date) for each new
  launch of a recurring job, without the caller having to compute it themselves.
- Rejecting a job launch immediately — before any step runs — when a required
  parameter (like a `date`) is missing, instead of failing deep inside step logic.

## Deep Dive

### Restart behavior: `restartable` attribute → `preventRestart()`

The book's XML defaults every job to restartable and opts out per job:

```xml
<batch:job id="importProductsJob" restartable="false">
  ...
</batch:job>
```

The Java equivalent keeps the same default (restartable) and opts out with a single
builder call — no boolean flag to get backwards:

```java
@Bean
public Job importProductsJob(JobRepository jobRepository, Step readWrite) {
    return new JobBuilder("importProductsJob", jobRepository)
        .preventRestart()
        .start(readWrite)
        .build();
}
```

A job built with `.preventRestart()` throws `JobRestartException` on any attempt to
launch it again, exactly like the XML version — the guarantee is identical, only
the spelling changed.

### Generating fresh parameters: `incrementer` attribute → `.incrementer(...)`

`JobLauncher.run(...)` (or today's `JobOperator.start(...)`) never invents
parameters on its own — something has to supply them. For jobs launched
repeatedly with parameters that must differ each time, a `JobParametersIncrementer`
computes the next value from the last:

```java
public interface JobParametersIncrementer {
    JobParameters getNext(JobParameters parameters);
}
```

```java
@Bean
public Job importProductsJob(JobRepository jobRepository, Step readWrite) {
    return new JobBuilder("importProductsJob", jobRepository)
        .incrementer(new CustomIncrementer())
        .start(readWrite)
        .build();
}
```

This only matters when the launch mechanism explicitly asks for "the next
instance" (historically via `JobOperator.startNextInstance`); a caller that always
supplies its own explicit parameters (e.g., an externally computed `date`) doesn't
need an incrementer at all.

### Rejecting bad launches up front: `<validator>` → `.validator(...)`

```java
public interface JobParametersValidator {
    void validate(JobParameters parameters) throws JobParametersInvalidException;
}
```

```java
@Bean
public Job importProductsJob(JobRepository jobRepository, Step readWrite) {
    return new JobBuilder("importProductsJob", jobRepository)
        .validator(parametersValidator())
        .start(readWrite)
        .build();
}

@Bean
public JobParametersValidator parametersValidator() {
    var validator = new DefaultJobParametersValidator();
    validator.setRequiredKeys(new String[]{"date"});
    validator.setOptionalKeys(new String[]{"productId"});
    return validator;
}
```

`DefaultJobParametersValidator` (unchanged from the book's version) covers the
common case — required vs. optional keys — without writing a custom validator
class; the job fails with `JobParametersInvalidException` before any step runs if
a required key is missing.

### Step sequencing and "parent"/"abstract" configuration reuse

The book's `next` attribute on `<step>` chains steps declaratively; the Java form
is the same `.next(...)` chain already used to build linear or branching flows
(see `spring-batch-job-instance-execution-flow`). Where the book's XML `parent`/
`abstract` attributes let one step or job configuration extend another to avoid
repetition, Java configuration has no dedicated "abstract job" mechanism — the
same reuse is achieved with ordinary code reuse (a shared builder method, a base
`@Configuration` class, or a helper that returns a partially-configured
`JobBuilder`/`StepBuilder`), which is arguably more natural in a language that
already has inheritance and methods for exactly that purpose.

## Trade-offs

- **The XML vocabulary and the `JobBuilder` API express the same configuration
  surface, but the Java form keeps the identifier and the class it refers to
  (an incrementer, a validator, a listener) in one compiled, refactor-safe unit.**
  A typo in an XML `ref` attribute only surfaces at job-startup time; a typo in a
  Java method call fails to compile.
- **`preventRestart()`/`incrementer()`/`validator()` all default to "off" when
  omitted**, matching the book's XML defaults exactly — nothing about their
  semantics changed, only the configuration surface moved from markup to method
  calls.
- **Losing `parent`/`abstract` job inheritance isn't a real loss** — it was XML's
  workaround for not having language-level reuse in the first place; Java
  configuration doesn't need an equivalent because ordinary methods and class
  hierarchies already do the job, usually more legibly.
- **Book vs. today:** the whole XML vocabulary this chapter documents
  (`<job>`, `<step>`, `<batch:validator>`, and their attributes) is deprecated
  since Spring Batch 6.0, with removal planned for 7.0 — already noted in
  `spring-batch-chunk-processing`. This concept focuses on the specific
  attributes Chapter 3 adds (restart, incrementer, validator) rather than
  re-covering the namespace deprecation itself.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 3, "Batch configuration", section 3.1, "The Spring Batch XML vocabulary", and section 3.2, "Configuring jobs and steps", p. 53-61 — doc
- [Spring Batch Reference — Configuring a Job (JobBuilder, preventRestart, incrementer, validator)](https://docs.spring.io/spring-batch/reference/job/configuring-job.html) — doc
- [Spring Batch API — JobParametersValidator / DefaultJobParametersValidator](https://docs.spring.io/spring-batch/docs/current/api/org/springframework/batch/core/job/DefaultJobParametersValidator.html) — doc
- [Spring Batch 6.0 Migration Guide — XML namespace deprecation](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
