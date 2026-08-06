---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

Every step in a Spring Batch job is an isolated unit of work — its own transaction,
its own scope, its own `ExecutionContext`. That isolation makes a step independently
restartable, but it also means one step can't hand a value to the next through a
shared field: a plain in-memory variable is never written to the batch metadata, so
it vanishes when a job restarts and resumes at a later step. When a calculating step
must feed a receiving step (the book's `verify` step extracts an `importId` that a
later `track` step persists), you need a mechanism that either survives a restart or
that you knowingly accept won't. Chapter 10 offers two — the persisted
`ExecutionContext` and Spring **holder beans** — separated by exactly that:
restart-safety.

The chapter then turns from data to configuration: **externalizing a flow** so several
jobs reuse one sequence of steps, and **stopping a job declaratively** from within the
flow (`end`/`fail`/`stop`). Reading a promoted value declaratively is `@StepScope` +
SpEL late binding (`spring-batch-step-scope-and-spel-late-binding`); driving a
transition from an exit status is `spring-batch-controlling-flow-and-exit-status`;
stopping a *running* execution cooperatively is
`spring-batch-stopping-jobs-gracefully`. This entry covers moving data across steps and
reusing/stopping the flow around it.

## Use Cases

- A `verify` step computes an import ID (or digest, row count) a later step needs, and
  you must pass it forward with no database side channel — and have it survive a restart.
- Choosing restart-safe sharing (execution context) over a throwaway value (holder bean)
  when the data can't be cheaply recomputed.
- Reusing a generic *download → decompress → verify* flow across jobs (import products,
  import invoices) instead of duplicating step definitions.
- Ending a job cleanly after a step from a custom exit status — "no archive today"
  completes, anything unexpected fails — rather than forcing every path to the last step.
- Stopping at a checkpoint step for operator intervention, then restarting to resume at a
  named step.

## Deep Dive

### Why a shared variable doesn't work: the step vs. job `ExecutionContext`

Spring Batch keeps two contexts, both `ExecutionContext` (a persisted, map-like store):
a **step** context private to one step, and a **job** context visible to every step.
Both are written to the batch metadata, which is what makes them restart-safe. Timing
matters: the step context is flushed on **every chunk commit**, the job context **only
at step end** — so a mid-step writer must use the step context to be safe if the step
later fails. A tasklet that writes once and returns can reach the job context through
the chunk context (a real but non-obvious path):

```java
ExecutionContext jobContext = chunkContext.getStepContext()
        .getStepExecution().getJobExecution().getExecutionContext();
jobContext.putString("importId", metadata.getImportId());  // read back: getString("importId")
```

This works but tightly couples both steps to the runtime and the `"importId"` key. The
job context is global, so prefix keys (`com.acme.importId`) to avoid collisions.

### Promoting a key with `ExecutionContextPromotionListener`

The looser, preferred technique splits the concern: the writing step puts data in its
**own** step context, and a listener promotes selected keys to the job context at step
end — making exposure a configuration choice, not a hardcoded coupling. The writing
tasklet targets the step context:

```java
ExecutionContext stepContext = chunkContext.getStepContext()
        .getStepExecution().getExecutionContext();
stepContext.putString("importId", metadata.getImportId());
```

`ExecutionContextPromotionListener` is a step listener (see
`spring-batch-execution-listeners`), configured with the key names (and optionally the
exit statuses to promote on — `COMPLETED` by default):

```xml
<bean id="promotionListener"
      class="org.springframework.batch.core.listener.ExecutionContextPromotionListener">
  <property name="keys" value="importId" />
</bean>
<step id="verifyStep" next="readWriteStep">
  <tasklet ref="verifyTasklet">
    <listeners><listener ref="promotionListener" /></listeners>
  </tasklet>
</step>
```

The receiving step reads from the job context — cleanest as `@StepScope` +
`#{jobExecutionContext['importId']}` late binding, whose mechanics live in
`spring-batch-step-scope-and-spel-late-binding`. Because the chain rides on the
persisted context, it is **restart-safe**: the promoted value reloads on resume.

### Holder beans: simpler, but not restart-safe

The Spring-oriented alternative skips the execution context: a shared bean holds the
value, injected into both steps. It's simple and type-safe (no string keys):

```java
public class ImportMetadataHolder {
    private ImportMetadata importMetadata;
    public ImportMetadata get() { return importMetadata; }
    public void set(ImportMetadata m) { this.importMetadata = m; }
}
```

The catch: a holder is an ordinary bean, so **its state is never persisted and is lost
on restart**, and in a shared container it can leak state between job instances (clean
it when the job finishes). Use a holder only when restart-safety doesn't matter.

### Externalizing a flow for reuse: `Flow` beans and `FlowStep`

Sharing *configuration* mirrors sharing *data*. A generic *download → decompress →
verify* sequence is useful to many jobs, so define it once and reference it. The book's
XML `<flow>`:

```xml
<flow id="prepareInputFileFlow">
  <step id="downloadStep"   next="decompressStep"><tasklet ref="downloadTasklet"/></step>
  <step id="decompressStep" next="verifyStep"><tasklet ref="decompressTasklet"/></step>
  <step id="verifyStep"><tasklet ref="verifyTasklet"/></step>
</flow>
<job id="importProductsJob">
  <flow parent="prepareInputFileFlow" id="importProducts.prepare" next="readWriteStep"/>
  <step id="readWriteStep" next="trackImportStep"><tasklet>(...)</tasklet></step>
</job>
```

Referencing a flow inserts its steps inline. A related option wraps the unit as a
`FlowStep` (runs a flow) or a `JobStep` (launches a whole separate job execution, with a
`JobParametersExtractor` selecting the sub-job's parameters). Flow branching by exit
status is `spring-batch-controlling-flow-and-exit-status`.

### Flow-driven stopping: `end`, `fail`, and `stopAndRestart`

By default a job ends at its last step, fails on an exception, or stops on an interrupt.
But a step's outcome isn't always the job's — "no archive today" may mean *complete*,
not *fail*. Three transition elements set the job's final `BatchStatus` after a step,
matched against the step's exit status via `on`:

```xml
<step id="downloadStep">
  <tasklet ref="downloadTasklet">
    <listeners><listener ref="fileExistsStepListener" /></listeners>
  </tasklet>
  <end  on="NO FILE" />
  <next on="FILE EXISTS" to="decompressStep" />
  <fail on="*" />
</step>
```

- `end` → `COMPLETED`, instance **not** restartable.
- `fail` → `FAILED`, instance restartable.
- `stop` → `STOPPED`, requires a `restart` step to resume at.

This declarative, flow-driven stop is distinct from the cooperative *runtime* stop
(`JobOperator.stop` / `setTerminateOnly`) in `spring-batch-stopping-jobs-gracefully`;
the restart semantics tie to `spring-batch-job-instance-execution-flow`.

### Book vs. today: item `ExecutionContext` moved; flows and stops are Java builders

The concepts are unchanged; the surface shifted with Java config and Spring Batch 6.0's
package reorganization:

- **`ExecutionContextPromotionListener` did not move** — still
  `org.springframework.batch.core.listener.ExecutionContextPromotionListener`, configured
  with `setKeys(new String[]{"importId"})` and registered via `StepBuilder.listener(...)`.
- **The item `ExecutionContext` did move**:
  `org.springframework.batch.item.ExecutionContext` (the book's import, listing 10.7) is
  now `org.springframework.batch.infrastructure.item.ExecutionContext`; its API
  (`putString`/`getString`, the two contexts) is identical.
- **`@StepScope` + `#{jobExecutionContext['importId']}` late binding is unchanged.**
- **Externalized flows are Java builders** — `<flow>` becomes a `Flow` from `FlowBuilder`:
  ```java
  @Bean
  public Flow prepareInputFileFlow(Step download, Step decompress, Step verify) {
      return new FlowBuilder<SimpleFlow>("prepareInputFileFlow")
              .start(download).next(decompress).next(verify).build();
  }
  // JobBuilder(...).start(prepareInputFileFlow).next(readWriteStep).end().build();
  ```
- **Flow stops are builder calls**: `<end>`/`<fail>`/`<stop>` map to `.on("NO FILE").end()`,
  `.on("*").fail()`, `.on("COMPLETED").stopAndRestart(step2)`.
- **The `batch:` XML namespace is deprecated since 6.0** (removal targeted for 7.0), so the
  XML above is legacy; new code uses the builders.

Confirmed via the Spring Batch 6.0.x API (`ExecutionContextPromotionListener` in
`...core.listener`, `ExecutionContext` now in `...infrastructure.item`), the Spring Batch
reference ("Passing Data to Future Steps", "Controlling Step Flow"), and the Spring Batch
6.0 migration guide.

## Trade-offs

- **Execution context vs. holder — persistence decides.** The execution context is
  persisted, so a promoted value reloads on restart; a holder is a plain bean whose state
  is lost on restart and can leak across instances in a shared container. Use a holder only
  when restart-safety is irrelevant.
- **Promotion decouples; direct job-context writes couple.** Writing straight to the job
  context hardwires both steps to the runtime and a shared key; the listener confines data
  to the writing step and makes exposure a one-line config choice.
- **The job context is global, so keys collide.** Any artifact can overwrite it — prefix
  keys (reverse-DNS `com.acme.importId`).
- **Sharing data couples steps — treat it as a fallback.** The book's warning: prefer
  independent steps (e.g. derive inputs from job parameters); share only when a step truly
  can't compute its own inputs.
- **`FlowStep` vs `JobStep`, and `end` vs `fail` vs `stopAndRestart`.** A `FlowStep` inlines
  a flow into the same execution; a `JobStep` launches a separate child execution with its
  own metadata. `end` completes and blocks restart; `fail` stays restartable;
  `stopAndRestart` must name the resume step — getting it wrong turns a recoverable pause
  into a dead-end `COMPLETED`.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 10, "Controlling execution", sections 10.3-10.5, "Sharing data between steps" / "Externalizing flow definitions" / "Stopping a job execution", p. 287-304 — doc
- [Spring Batch Reference — Passing Data to Future Steps (`ExecutionContext`, `ExecutionContextPromotionListener`)](https://docs.spring.io/spring-batch/reference/common-patterns.html) — doc
- [Spring Batch Reference — Late Binding of Job and Step Attributes (`@StepScope`, `#{jobExecutionContext[...]}`)](https://docs.spring.io/spring-batch/reference/step/late-binding.html) — doc
- [Spring Batch Reference — Controlling Step Flow (externalizing flows, `FlowStep`/`JobStep`, `end`/`fail`/`stop`)](https://docs.spring.io/spring-batch/reference/step/controlling-flow.html) — doc
- [Spring Batch API — `ExecutionContextPromotionListener` (`org.springframework.batch.core.listener`)](https://docs.spring.io/spring-batch/docs/current/api/org/springframework/batch/core/listener/ExecutionContextPromotionListener.html) — doc
- [Spring Batch 6.0 Migration Guide (XML namespace deprecation; `ExecutionContext` → `org.springframework.batch.infrastructure.item`)](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
