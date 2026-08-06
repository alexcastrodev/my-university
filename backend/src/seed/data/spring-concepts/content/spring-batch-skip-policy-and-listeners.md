---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

Not every error should abort a job. When the import-products job reads tens of
thousands of lines from a flat file, a couple of badly formatted rows shouldn't
cost every insert and update in the run. Skipping tells Spring Batch which
exceptions to tolerate — the item is excluded, counted as a *skip*, and
processing continues — a business decision made in configuration, not in code.

A skip is *exception-driven* fault tolerance — different from a *filter* (an
`ItemProcessor` returning `null`; see `spring-batch-filtering-and-validating-items`)
— and it behaves differently for read, process, and write. This entry goes deep
on the skip pillar of chapter 8's "bulletproof jobs"; retry and restart are
separate siblings (`spring-batch-retry-policy-and-retrytemplate`,
`spring-batch-restart-and-recovery`). The declarative `skip-limit` /
`skippable-exception-classes` attributes live in
`spring-batch-fault-tolerant-step-configuration`; here we go deeper on skip
*semantics* per phase, the `SkipPolicy` object, and the `SkipListener`.

## Use Cases

- Loading a flat file where a handful of malformed lines (`FlatFileParseException`)
  shouldn't fail the whole job — skip the bad rows so the good ones still import.
- Distinguishing tolerable noise from corrupt input: skip up to a limit, then
  fail past it so an operator validates the file and restarts.
- Recording every skipped record to a dead-letter table or file (via a
  `SkipListener`) so it can be corrected and re-imported later.
- Taking full programmatic control — "skip this exception no matter the count" —
  with a custom `SkipPolicy` when a declarative limit isn't expressive enough.
- Knowing when *not* to skip: a missing file or an I/O failure
  (`NonTransientResourceException`) is fatal and should abort the step.

## Deep Dive

### Skip vs. fail vs. filter — three different outcomes

A chunk-oriented step has three non-interchangeable ways an item can fail to
reach the writer:

- **Fail** — the default: any exception from reader/processor/writer aborts the
  step.
- **Skip** — an exception you *declared skippable* is thrown; the item is
  excluded, the skip count increments, and processing continues until the skip
  limit is exceeded. Exception-driven.
- **Filter** — the `ItemProcessor` returns `null`; the item is deliberately
  dropped as a business decision, counted as a *filter* (not a skip), with no
  exception and no rollback (see `spring-batch-filtering-and-validating-items`).

Rule of thumb: **skip** a technical/malformed fault you *can't* process,
**filter** a valid item you *choose* to exclude, and let a **fatal** error
(missing file, I/O) abort. Enabling skip just means naming exceptions and a
`skip-limit`; the skip-specific subtlety is the exception hierarchy:

```xml
<skippable-exception-classes>
  <include class="org.springframework.batch.item.ItemReaderException"/>
  <exclude class="org.springframework.batch.item.NonTransientResourceException"/>
</skippable-exception-classes>
```

`include` skips an exception *and all its subclasses*; `exclude` carves a
sub-hierarchy back out (skip a parse error like `FlatFileParseException`, keep an
I/O `NonTransientResourceException` fatal). The full attribute set and its builder
equivalents live in `spring-batch-fault-tolerant-step-configuration`.

### Read-skip, process-skip, write-skip — the chunk drives each differently

*Where* the exception is thrown decides how much work Spring Batch must redo:

- **Read-skip** — the reader throws. Spring Batch just calls `read()` again for
  the next item. **No rollback**; the chunk in progress is untouched. Cheapest.
- **Process-skip** — the processor throws. Spring Batch **rolls back the chunk's
  transaction**, re-reads the cached items, and re-submits them to the processor
  *except* the one that failed.
- **Write-skip** — the writer throws. The writer received the whole chunk as a
  `List`, so the framework **can't tell which item failed**: it rolls back, then
  replays the chunk **one item at a time, each in its own transaction**, to
  isolate the culprit — good items commit individually, the bad one is skipped.
  It does *not* re-read; a chunk-scoped cache holds the items.

The consequence is a throughput cliff: a single write-skip degrades that chunk to
an effective `commit-interval` of 1, so a high write-skip rate collapses
throughput — better to catch the problem earlier (validate/filter, or a
read/process skip). Which exceptions roll back at all is tuned with
`no-rollback-exception-classes` (see `spring-batch-fault-tolerant-step-configuration`).

### A custom SkipPolicy for control beyond a limit

When you use `skippable-exception-classes`, Spring Batch installs a default
`LimitCheckingItemSkipPolicy` (skip by exception type *and* running skip count).
When that isn't enough — e.g. skip a given exception regardless of count —
implement `SkipPolicy` yourself:

```java
import org.springframework.batch.core.step.skip.SkipLimitExceededException;
import org.springframework.batch.core.step.skip.SkipPolicy;

public class ExceptionSkipPolicy implements SkipPolicy {
    private final Class<? extends Exception> exceptionClassToSkip;

    public ExceptionSkipPolicy(Class<? extends Exception> exceptionClassToSkip) {
        this.exceptionClassToSkip = exceptionClassToSkip;
    }

    @Override
    public boolean shouldSkip(Throwable t, int skipCount) throws SkipLimitExceededException {
        return exceptionClassToSkip.isAssignableFrom(t.getClass());
    }
}
```

`shouldSkip` returns `true` to skip, `false` to fail; this one ignores
`skipCount`, skipping its target unbounded. Wire it via `skip-policy` (XML) or
`.skipPolicy(...)` (Java); once set, `skip-limit` and `skippable-exception-classes`
have *no effect* — the policy owns the decision. Ready-made policies in
`org.springframework.batch.core.step.skip` are `LimitCheckingItemSkipPolicy`
(default), `ExceptionClassifierSkipPolicy`, `AlwaysSkipItemSkipPolicy`, and `NeverSkipItemSkipPolicy`.

### SkipListener — recording and dead-lettering skipped items

Skipping without a record silently loses data. `SkipListener` gives one callback
per phase, matching the three semantics above:

```java
public interface SkipListener<T, S> extends StepListener {
    void onSkipInRead(Throwable t);
    void onSkipInProcess(T item, Throwable t);
    void onSkipInWrite(S item, Throwable t);
}
```

The book logs each skipped line via the annotation form (no interface needed —
override only the phase you use):

```java
public class DatabaseSkipListener {
    private final JdbcTemplate jdbcTemplate;
    public DatabaseSkipListener(DataSource ds) { this.jdbcTemplate = new JdbcTemplate(ds); }

    @OnSkipInRead
    public void log(Throwable t) {
        if (t instanceof FlatFileParseException ffpe) {
            jdbcTemplate.update("insert into skipped_product (line, line_number) values (?, ?)",
                ffpe.getInput(), ffpe.getLineNumber());
        }
    }
}
```

Registration uses the generic `<listener>` element, which auto-detects the
listener type (see `spring-batch-execution-listeners`). One timing subtlety:
Spring Batch **postpones skip-listener calls until just before the chunk
commit**, not the moment the exception is thrown — so if a later phase in the
same chunk rolls back, you won't have logged a skip that got undone.

### Book vs. today: SkipPolicy/SkipListener persist, but packages and the builder moved

- `.faultTolerant()` on the step builder still turns on skip/retry (Java config;
  the XML `batch:` namespace is deprecated since 6.0).
- **`SkipPolicy`** is still a `@FunctionalInterface` in
  `org.springframework.batch.core.step.skip`, but `shouldSkip` widened its count
  from `int` (book) to `long`: `shouldSkip(Throwable t, long skipCount)`. The
  implementations above still ship, joined by `LimitCheckingExceptionHierarchySkipPolicy`.
- **`SkipListener`** keeps the same three methods but moved from
  `org.springframework.batch.core` to `org.springframework.batch.core.listener`
  and now declares *default* no-op methods — so `SkipListenerSupport` was removed
  in 6.0 (implement the interface directly, overriding only what you need). The
  `@OnSkipInRead`/`@OnSkipInProcess`/`@OnSkipInWrite` annotations are unchanged in
  `org.springframework.batch.core.annotation`.
- The skipped exceptions moved too: `FlatFileParseException` is now
  `org.springframework.batch.infrastructure.item.file.FlatFileParseException`
  (item infrastructure relocated under `org.springframework.batch.infrastructure.*`).
- The declarative attributes and the 6.0 policy-object builder rework
  (`ChunkOrientedStepBuilder`) live in
  `spring-batch-fault-tolerant-step-configuration` — not repeated here.

Confirmed via the Spring Batch 6.0.4 `SkipPolicy`/`SkipListener` Javadoc, the
"Configuring Skip Logic" reference, and the Spring Batch 6.0 Migration Guide.

## Trade-offs

- **Skip vs. filter is not a style choice.** Skip a *malformed or technical*
  fault you can't process; filter (`ItemProcessor` returning `null`) a *valid but
  excluded* item. Swapping them logs routine exclusions as errors, or buries real
  faults as silent filters.
- **Write-skips are expensive.** The framework can't tell which item in a batched
  write failed, so one bad item forces a rollback and a per-item replay of the
  chunk — effectively `commit-interval` = 1 there. Keep skippable *write*
  exceptions rare.
- **The skip limit is blunt.** Too high masks a corrupt input by importing
  garbage; too low aborts on ordinary noise. A custom `SkipPolicy` encodes richer
  rules, but then the framework stops enforcing `skip-limit` — you own the limit.
- **Listener timing cuts both ways.** Callbacks fire just before the chunk commit,
  so a listener writing to the *same* transactional store as the chunk is rolled
  back with it; dead-letter to a separate resource to survive a later failure.
- **Skipping silently discards data unless you listen.** Without a `SkipListener`
  (or a log), a skipped item just vanishes — always pair a skip policy with a
  listener so "the job didn't crash" doesn't become "and nobody knows what it
  dropped."

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 8, "Implementing bulletproof jobs", sections 8.1-8.2, "What is a bulletproof job?" / "Skipping instead of failing", p. 223-234 — doc
- [Spring Batch API — SkipPolicy (org.springframework.batch.core.step.skip)](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/core/step/skip/SkipPolicy.html) — doc
- [Spring Batch API — SkipListener (org.springframework.batch.core.listener)](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/core/listener/SkipListener.html) — doc
- [Spring Batch Reference — Configuring Skip Logic](https://docs.spring.io/spring-batch/reference/step/chunk-oriented-processing/configuring-skip.html) — doc
- [Spring Batch 6.0 Migration Guide (package relocations)](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
