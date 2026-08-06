---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

Skipping (see `spring-batch-skip-policy-and-listeners`) throws an item away — right
for a *deterministic* fault like a malformed flat-file line. But many failures are
**transient**: a deadlock because another process held a lock, an optimistic-locking
clash, a web-service call that timed out on a flaky network. The item isn't bad —
the *moment* was. **Retry** re-attempts the failed operation, often succeeding on
the second try, instead of skipping a good record or failing the whole step.

The declarative `retry-limit`/`retryable-exception-classes` attributes and their
Java-config builder equivalents live in `spring-batch-fault-tolerant-step-configuration`
and are **not** repeated here. This entry goes deeper: `RetryPolicy` objects for control
over *how* retry decides, back-off to space attempts out, `RetryListener` hooks, the
standalone `RetryTemplate` for retrying **arbitrary code outside a step**, and transparent
AOP retry — composing with skip and restart (`spring-batch-restart-and-recovery`) to make
a chunk step (`spring-batch-chunk-processing`) bulletproof.

## Use Cases

- Retrying a chunk's item write that hit a `DeadlockLoserDataAccessException` from a
  concurrent job instead of failing — the lock is usually gone milliseconds later.
- Giving exception types different aggressiveness: retry generic concurrency errors 3
  times but deadlocks 5, via an `ExceptionClassifierRetryPolicy`.
- Backing off exponentially between attempts so a struggling database or web service
  isn't hammered by immediate retries.
- Wrapping a web-service call inside a custom `Tasklet` (not a chunk) with a
  `RetryTemplate` directly in application code.
- Retrying transparently through AOP so calling code has *no* retry logic, and logging
  every retried operation with a `RetryListener`.

## Deep Dive

### Retryable exceptions and the retry limit — where retry starts

By default any exception in a chunk-oriented step fails the step; declaring a retryable
exception and a `retry-limit` on the `chunk` turns that into bounded re-attempts. Two
behaviours matter: Spring Batch retries **only the processing and writing phases** (not
reading), and a retry triggers a **rollback**, so a chunk-scoped cache replays the items
without re-reading. Because replay crosses transactions, items are tracked by identity —
**override `equals()`/`hashCode()`** or Spring Batch can't tell which one to re-submit.
As with skip, `include` covers an exception *and its subclasses* and `exclude` carves the
hierarchy back out (retry every `TransientDataAccessException` *except*
`PessimisticLockingFailureException`).

Retry **composes with skip**: list the same exception in *both*
`retryable-exception-classes` and `skippable-exception-classes` (with `retry-limit` and
`skip-limit`), and Spring Batch retries it up to the retry limit, then — if it still
fails — skips it instead of failing the step. Retry wins first; skip catches the
exhausted attempt. That combined declarative config is shown in
`spring-batch-fault-tolerant-step-configuration`, and the skip half in
`spring-batch-skip-policy-and-listeners`.

### Full control with a RetryPolicy object

`retry-limit` + `retryable-exception-classes` is just the default `SimpleRetryPolicy`.
When exceptions deserve *different* treatment, wire a `retry-policy` bean on the chunk
instead. Spring Batch ships three (Table 8.3): `SimpleRetryPolicy` (retry a hierarchy
N times), `TimeoutRetryPolicy` (stop once an operation runs too long), and
`ExceptionClassifierRetryPolicy` (delegate to a different policy per exception type).
This retries generic concurrency errors 3 times but deadlocks 5:

```xml
<!-- on the chunk: retry-policy="retryPolicy" -->
<bean id="retryPolicy"
      class="org.springframework.batch.retry.policy.ExceptionClassifierRetryPolicy">
  <property name="policyMap">
    <map>
      <entry key="org.springframework.dao.ConcurrencyFailureException">
        <bean class="org.springframework.batch.retry.policy.SimpleRetryPolicy">
          <property name="maxAttempts" value="3"/>
        </bean>
      </entry>
      <entry key="org.springframework.dao.DeadlockLoserDataAccessException">
        <bean class="org.springframework.batch.retry.policy.SimpleRetryPolicy">
          <property name="maxAttempts" value="5"/>
        </bean>
      </entry>
    </map>
  </property>
</bean>
```

The book's examples retry *immediately*, but the same infrastructure spaces attempts
out with a `BackOffPolicy`. Hammering an already-struggling resource makes things
worse; an `ExponentialBackOffPolicy` waits longer after each failure (0.5s, 1s, 2s, …),
giving the deadlock or overloaded service time to recover:

```java
RetryTemplate retryTemplate = new RetryTemplate();
retryTemplate.setRetryPolicy(retryPolicy);
ExponentialBackOffPolicy backOff = new ExponentialBackOffPolicy();
backOff.setInitialInterval(500);   // 0.5s, then *2 each time
backOff.setMultiplier(2);
retryTemplate.setBackOffPolicy(backOff);
```

### Listening to retries with RetryListener

Retried operations always degrade performance, so knowing *what* is being retried
helps fix the root cause. `RetryListener` has `open`/`close`/`onError` lifecycle
methods; extend the `RetryListenerSupport` adapter and override only `onError`, then
register it with the dedicated `<retry-listeners><listener ref="..."/></retry-listeners>`
element (distinct from skip-listener registration in
`spring-batch-skip-policy-and-listeners`):

```java
public class Slf4jRetryListener extends RetryListenerSupport {   // org.springframework.batch.retry.listener
    private static final Logger LOG = LoggerFactory.getLogger(Slf4jRetryListener.class);

    @Override
    public <T> void onError(RetryContext context, RetryCallback<T> callback, Throwable throwable) {
        LOG.error("retried operation", throwable);
    }
}
```

### Wrapping arbitrary code with the standalone RetryTemplate

Retry isn't only for chunk steps. When a custom `Tasklet` calls a web service that
can fail transiently, the `RetryOperations` interface and its `RetryTemplate`
implementation add **programmatic retry to any block of code** — inside a tasklet, or
even a plain web application:

```java
RetryTemplate retryTemplate = new RetryTemplate();
SimpleRetryPolicy retryPolicy = new SimpleRetryPolicy();
retryPolicy.setMaxAttempts(3);
retryTemplate.setRetryPolicy(retryPolicy);

List<Discount> discounts = retryTemplate.execute(
    new RetryCallback<List<Discount>>() {
        @Override
        public List<Discount> doWithRetry(RetryContext context) throws Exception {
            return discountService.getDiscounts();   // the risky call
        }
    });
```

`RetryOperations.execute(RetryCallback)` runs the callback and re-invokes it per the
policy on a retryable exception; the `RetryTemplate` can equally be injected as a bean.

### Transparent retry with AOP: RetryOperationsInterceptor

Hardcoding the `RetryTemplate` couples the tasklet to retry logic and complicates
testing. AOP removes it: `RetryOperationsInterceptor` is an advice that proxies the
target service and handles retry, so the tasklet just calls
`discountService.getDiscounts()` with **no retry code at all**:

```xml
<bean id="retryAdvice"
      class="org.springframework.batch.retry.interceptor.RetryOperationsInterceptor">
  <!-- retryOperations = a RetryTemplate bean holding a SimpleRetryPolicy(maxAttempts=3) -->
  <property name="retryOperations" ref="retryTemplate"/>
</bean>

<aop:config>
  <aop:pointcut id="retriedOps"
                expression="execution(* com.manning.sbia.ch08.retry.DiscountService.*(..))"/>
  <aop:advisor pointcut-ref="retriedOps" advice-ref="retryAdvice"/>
</aop:config>
```

Any call matching the pointcut is retried transparently. The annotation-driven
successor to this interceptor is `@Retryable` on a method (see *Book vs. today*),
which needs no `<aop:config>` at all.

### Book vs. today: retry left Spring Batch, then became a Spring Framework core feature

This is the big one — the retry API's home moved **twice**:

- **2012 book (Spring Batch 2.1):** every class above lives *inside* Spring Batch
  under `org.springframework.batch.retry.*` — `SimpleRetryPolicy`, `RetryTemplate`,
  `RetryCallback`, `RetryListenerSupport`, `RetryOperationsInterceptor` — configured
  with the `batch:` XML namespace.
- **Spring Batch 2.2 (2013):** the retry engine was extracted into the standalone
  **Spring Retry** library, `org.springframework.retry.*`, which added the
  `@Retryable`/`@Recover` annotations with `@EnableRetry` (the annotation form of the
  interceptor above). Spring Batch 3.x–5.x's `.faultTolerant()` step depended on it.
- **Spring Framework 7 / Spring Batch 6.0 (2025):** Spring Framework grew a **native**
  retry feature in `org.springframework.core.retry` (`RetryTemplate`, `Retryable`,
  `RetryPolicy`, `RetryListener`) plus declarative `@Retryable` + `@EnableResilientMethods`
  in `org.springframework.resilience.annotation`. The Spring Batch reference now states
  the fault-tolerant step "does **not** use Spring Retry... and is now based on the core
  retry feature provided by Spring Framework 7.0." The native API renames `maxAttempts`
  to `maxRetries` and uses a builder —
  `RetryPolicy.builder().includes(...).maxRetries(4).delay(...).multiplier(2).jitter(...).build()`
  — driven by `retryTemplate.invoke(() -> ...)`.

Two cross-cutting shifts: imports moved `javax.*` → `jakarta.*` (Spring Batch
5+/Jakarta EE 9+), and the `batch:` XML namespace is **deprecated since 6.0** (removal
in 7.0) in favor of Java config — so today the whole retry story is expressed on
`FaultTolerantStepBuilder`/`ChunkOrientedStepBuilder` (see
`spring-batch-fault-tolerant-step-configuration`), not XML, and `FaultTolerantStepBuilder`
plus the internal `BatchRetryTemplate` are themselves deprecated in 6.0. Confirmed via
the Spring Batch 6.0 reference "Retry" page, the Spring Framework 7 "Resilience
Features" reference, and the Spring Batch 6.0 Migration Guide.

## Trade-offs

- **Retry only for nondeterministic errors.** A deadlock or network blip may succeed
  on retry; a constraint violation or malformed record never will — retrying it just
  burns attempts before failing anyway. Skip (or filter) those.
- **Retry is expensive: it rolls back.** A retryable exception rolls back and replays
  the chunk, so retrying too many items too often degrades throughput. Keep
  `retry-limit` small and reserve retry for genuinely transient faults.
- **Immediate retries can make things worse.** Re-hitting a contended row or overloaded
  service instantly can re-trigger the same failure; an `ExponentialBackOffPolicy`
  trades latency for a far higher success rate.
- **Retry needs stable item identity.** Because replay crosses transactions, items must
  implement `equals()`/`hashCode()` (e.g. by database id) or Spring Batch can't reliably
  re-submit the right item.
- **AOP/annotation retry hides the retry.** Transparent retry keeps calling code clean,
  but silent retries can mask a systemic problem and inflate latency; pair them with a
  `RetryListener` or logging so retries are observable.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 8, "Implementing bulletproof jobs", section 8.3, "Retrying on error", p. 234-242 — doc
- [Spring Batch Reference — Retry (6.0: now uses Spring Framework core retry)](https://docs.spring.io/spring-batch/reference/retry.html) — doc
- [Spring Framework Reference — Resilience Features (@Retryable, RetryTemplate, RetryPolicy)](https://docs.spring.io/spring-framework/reference/core/resilience.html) — doc
- [Spring Framework API — org.springframework.core.retry.RetryPolicy](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/core/retry/RetryPolicy.html) — doc
- [Spring Retry project (org.springframework.retry)](https://github.com/spring-projects/spring-retry) — doc
- [Spring Batch 6.0 Migration Guide (deprecated FaultTolerantStepBuilder / batch: namespace)](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
