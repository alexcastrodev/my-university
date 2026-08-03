---
version: 1.0
updatedAt: 2026-08-04
---
## Objective

A batch job's reader/processor/writer configuration describes what data moves
and how it's transformed — it says nothing about notifying an external system
when the job fails, recording which items got skipped, or running cleanup
logic after a step finishes. Spring Batch's listeners fill that gap: a
family of interfaces (and their annotation-based equivalents) that hook into
job, step, chunk, and per-item lifecycle events without requiring any change
to the reader, processor, or writer itself.

## Use Cases

- Notifying an external monitoring system when a job completes or fails, by
  reacting to `afterJob`'s `BatchStatus` rather than polling job state from
  outside.
- Recording exactly which items got skipped during processing (and why) for
  a downstream review, using `SkipListener` instead of hunting through logs.
- Running setup/teardown logic scoped to a single step — opening a resource
  in `beforeStep`, releasing it in `afterStep` — without folding that
  concern into the step's own reader or writer.
- Reacting to a retry being exhausted (all attempts failed) to log or alert,
  instead of only seeing the final propagated exception with no visibility
  into how many attempts preceded it.

## Deep Dive

### Job listeners: before/after the whole job

```java
public interface JobExecutionListener {
  void beforeJob(JobExecution jobExecution);
  void afterJob(JobExecution jobExecution);
}
```

`beforeJob` runs once, right before the job starts; `afterJob` runs once,
after the job ends, regardless of whether it succeeded or failed —
`JobExecution.getStatus()` (a `BatchStatus` constant) is how the listener
tells the two cases apart:

```java
public class ImportProductsJobListener implements JobExecutionListener {
  public void beforeJob(JobExecution jobExecution) {
    // called when the job starts
  }

  public void afterJob(JobExecution jobExecution) {
    if (jobExecution.getStatus() == BatchStatus.COMPLETED) {
      // called when the job ends successfully
    } else if (jobExecution.getStatus() == BatchStatus.FAILED) {
      // called when the job ends in failure
    }
  }
}
```

The book's XML registers a listener as a child of the `job` element:

```xml
<batch:job id="importProductsJob">
  <batch:listeners>
    <batch:listener ref="importProductsJobListener"/>
  </batch:listeners>
</batch:job>

<bean id="importProductsJobListener" class="ImportProductsJobListener"/>
```

### Skipping the interface: annotation-based listeners

A plain POJO can act as a listener too, without implementing
`JobExecutionListener` at all — `@BeforeJob`/`@AfterJob` mark which methods
Spring Batch should call:

```java
public class AnnotatedImportProductsJobListener {
  @BeforeJob
  public void executeBeforeJob(JobExecution jobExecution) {
    // notifying when the job starts
  }

  @AfterJob
  public void executeAfterJob(JobExecution jobExecution) {
    if (jobExecution.getStatus() == BatchStatus.COMPLETED) {
      // notifying on success
    } else if (jobExecution.getStatus() == BatchStatus.FAILED) {
      // notifying on failure
    }
  }
}
```

Same two hooks, no interface to implement — useful when a class already has
an unrelated superclass, or when only one of the two lifecycle events is
actually needed.

### Step listeners: `StepExecutionListener` and `ChunkListener`

Every step-level listener extends the marker interface `StepListener`.
`StepExecutionListener` brackets the whole step:

```java
public interface StepExecutionListener extends StepListener {
  void beforeStep(StepExecution stepExecution);
  ExitStatus afterStep(StepExecution stepExecution);
}
```

`afterStep` is notably not `void` — its return value can override the
step's own exit status, which is how a listener can turn a technically
successful step into a different outcome (or vice versa) based on
conditions the step itself doesn't check. `ChunkListener` brackets each
individual chunk instead of the whole step, with no parameters at all:

```java
public interface ChunkListener extends StepListener {
  void beforeChunk();
  void afterChunk();
}
```

### Item-level listeners: read, process, write, and skip

Three generic interfaces mirror the three stages of chunk-oriented
processing, each with a before/after/on-error triple:

```java
public interface ItemReadListener<T> extends StepListener {
  void beforeRead();
  void afterRead(T item);
  void onReadError(Exception ex);
}

public interface ItemProcessListener<T, S> extends StepListener {
  void beforeProcess(T item);
  void afterProcess(T item, S result);
  void onProcessError(T item, Exception e);
}

public interface ItemWriteListener<S> extends StepListener {
  void beforeWrite(List<? extends S> items);
  void afterWrite(List<? extends S> items);
  void onWriteError(Exception exception, List<? extends S> items);
}
```

A fourth interface, `SkipListener`, is distinct from the three above — it
fires specifically when an item is skipped (per the skip-limit mechanism
covered elsewhere in this chapter), with one method per stage the skip
happened in:

```java
public interface SkipListener<T, S> extends StepListener {
  void onSkipInRead(Throwable t);
  void onSkipInProcess(T item, Throwable t);
  void onSkipInWrite(S item, Throwable t);
}
```

Annotations exist for every method on every interface in this section —
`@BeforeStep`/`@AfterStep`, `@BeforeRead`/`@AfterRead`/`@OnReadError`, and so
on — following the exact same POJO pattern shown for job listeners:

```java
public class ImportProductsExecutionListener {
  @BeforeStep
  public void handlingBeforeStep(StepExecution stepExecution) {
    // ...
  }

  @AfterStep
  public ExitStatus afterStep(StepExecution stepExecution) {
    // ...
    return ExitStatus.FINISHED;
  }
}
```

Registration is a `listeners` child of the `tasklet` element (several
listeners can be registered at once):

```xml
<batch:job id="importProductsJob">
  <batch:step id="decompress" next="readWrite">
    <batch:tasklet ref="decompressTasklet">
      <batch:listeners>
        <batch:listener ref="stepListener"/>
      </batch:listeners>
    </batch:tasklet>
  </batch:step>
</batch:job>
```

### Repeat and retry listeners: robustness, not lifecycle

A separate pair of listener interfaces targets *robustness* mechanisms —
repeat and retry — rather than the job/step/item lifecycle above:

```java
public interface RepeatListener {
  void before(RepeatContext context);
  void after(RepeatContext context, RepeatStatus result);
  void open(RepeatContext context);
  void onError(RepeatContext context, Throwable e);
  void close(RepeatContext context);
}

public interface RetryListener {
  <T> void open(RetryContext context, RetryCallback<T> callback);
  <T> void onError(RetryContext context,
             RetryCallback<T> callback, Throwable e);
  <T> void close(RetryContext context,
             RetryCallback<T> callback, Throwable e);
}
```

`open`/`close` bracket the entire retry or repeat sequence for an item;
`onError` fires on every unsuccessful attempt. Registration follows the same
`listeners` child element used for step listeners.

## Trade-offs

- **`afterStep`'s return value can silently override the step's real
  outcome.** Returning a different `ExitStatus` than the step actually
  produced is a legitimate, documented capability — but it also means a
  step's success/failure isn't fully determined by the step's own logic
  once a listener is in the picture, which is easy to forget when debugging
  an unexpected job outcome.
- **`SkipListener` is a distinct interface from the read/process/write
  listeners, not a fourth method bolted onto them.** It's easy to assume
  `onReadError`/`onProcessError`/`onWriteError` already cover skips — they
  don't; those fire on *every* error during that stage, while
  `SkipListener` fires specifically when the skip-limit mechanism accepts
  the error and moves on rather than failing the step.
- **Annotation-based listeners avoid an interface but hide the contract.**
  A POJO annotated with `@BeforeStep` reads as "just a method," but it's
  still bound by the same signature rules as the interface method it stands
  in for (parameter type, return type for `@AfterStep`) — a mismatched
  signature fails at startup, not at compile time, the same category of
  risk noted for derived Spring Data query methods elsewhere in this
  workflow.
- **Repeat and retry listeners solve a narrower problem than they sound
  like.** They don't observe the job or step lifecycle at all — only the
  internal retry/repeat loop around a single item — so reaching for
  `RetryListener` to log step-level progress is the wrong tool; that's what
  `StepExecutionListener`/`ChunkListener` are for.
- **Book vs. today: listener registration in Java configuration is a
  builder method, not an XML child element.** The book's
  `<batch:listeners><batch:listener ref="..."/></batch:listeners>` maps
  onto `.listener(...)` on the step/job builder in current Java
  configuration — functionally equivalent, just invoked as a method call
  instead of nested XML, matching the same XML→Java migration already
  documented for other Spring Batch concepts in this workflow. The
  annotation set itself (`@BeforeStep`/`@AfterStep`,
  `@BeforeRead`/`@AfterRead`/`@OnReadError`, etc.) is unchanged.
- **Book vs. today: `RepeatListenerSupport` (a no-op base class for
  `RepeatListener`) was deprecated in Spring Batch 5.0 and removed in
  6.0** — `RepeatListener` itself gained default (no-op) methods instead,
  so the support class became redundant rather than the interface being
  replaced; existing code extending `RepeatListenerSupport` needs to
  implement `RepeatListener` directly. Confirmed via the current Spring
  Batch deprecated-list.
- **Book vs. today: `RetryListener`'s entire package and method set
  changed, not just its location.** Since Spring Batch 6.0, retry is no
  longer built on the separate Spring Retry library the book describes
  (`org.springframework.batch.retry.RetryListener`, with
  `open`/`onError`/`close`) — it's built on Spring Framework's own core
  retry feature (`org.springframework.core.retry.RetryListener`), whose
  methods don't map one-to-one onto the book's three: `beforeRetry()`,
  `onRetrySuccess()`, `onRetryFailure()`, `onRetryPolicyExhaustion()`,
  `onRetryPolicyInterruption()`, and `onRetryPolicyTimeout()` replace the
  book's `open`/`onError`/`close` trio with a more granular set of
  callbacks specific to each retry outcome. Confirmed via the current
  Spring Framework API docs.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 3, "Batch configuration", section 3.4.3, "Using listeners to provide additional processing", p. 78-83 — doc
- [Spring Batch Reference — Intercepting Step Execution (listener interfaces and annotations)](https://docs.spring.io/spring-batch/reference/step/chunk-oriented-processing/intercepting-execution.html) — doc
- [Spring Batch API — Deprecated List (RepeatListenerSupport removal)](https://docs.spring.io/spring-batch/docs/current/api/deprecated-list.html) — doc
- [Spring Framework API — RetryListener (org.springframework.core.retry)](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/core/retry/RetryListener.html) — doc
