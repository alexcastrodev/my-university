---
version: 1.0
updatedAt: 2026-09-30
---
## Objective

A service that saves a blog post and then calls the notification service, the search indexer and the analytics recorder knows about all three. Every new reaction to "a post was published" means editing the publishing code, and a slow or broken reaction makes publishing slow or broken. Spring's application events invert that dependency: the publisher announces a fact (`ContentPublished`) through `ApplicationEventPublisher`, and any bean that cares declares a listener method. The publisher compiles without knowing who listens.

The part that is easy to get wrong is not the publishing, it is the relationship between a listener and the publisher's transaction. A plain `@EventListener` runs immediately, on the same thread, inside the transaction that has not committed yet. A `@TransactionalEventListener` waits for the transaction to reach a phase (after commit, by default) and is silently skipped when there is no transaction at all. Choosing between them decides whether a listener can veto the operation, whether it can see data that is later rolled back, and whether its failure can undo the publisher's work. This concept covers those rules in Spring Framework 7 / Spring Boot 4; they are also the foundation that Spring Modulith's `@ApplicationModuleListener` builds on (see `spring-modulith-events-and-publication-registry`).

## Use Cases

- **Side effects that must not block the main operation.** Sending an e-mail, updating a search index, or pushing a metric after an order is placed. The publisher should not care if there are zero or five of them.
- **Keeping a feature package independent of another.** In a package-by-feature codebase, `publishing` publishing an event that `notification` listens to removes the `publishing -> notification` compile-time dependency. This is exactly how Spring Modulith breaks module cycles.
- **Reacting only to work that really happened.** Indexing, cache eviction, or outbound messages that must never be sent for a transaction that rolls back.
- **Compensation and alerting on failure.** `AFTER_ROLLBACK` listeners that record or alert on operations that did not go through.
- **Validation hooks owned by another component.** A synchronous listener that throws to reject the operation, while the publisher stays unaware of the rule.

## Deep Dive

### Publishing an event

Any object can be an event since Spring 4.2; there is no need to extend `ApplicationEvent`. A record is the natural shape: immutable, with just the data a listener needs.

```java
public record ContentPublished(long id, String title) {}

@Service
public class ContentService {

    private final JdbcClient jdbc;
    private final ApplicationEventPublisher events;

    public ContentService(JdbcClient jdbc, ApplicationEventPublisher events) {
        this.jdbc = jdbc;
        this.events = events;
    }

    @Transactional
    public long publish(String title) {
        var keys = new GeneratedKeyHolder();
        jdbc.sql("INSERT INTO content (title) VALUES (:title)")
            .param("title", title)
            .update(keys, "id");
        long id = keys.getKey().longValue();
        events.publishEvent(new ContentPublished(id, title));
        return id;
    }
}
```

`publishEvent` is synchronous: it walks the listeners registered for `ContentPublished` (and its supertypes) and invokes each one before returning. There is no queue and no thread pool unless you add one. Every `ApplicationContext` is an `ApplicationEventPublisher`, so injecting the interface keeps the dependency narrow.

### @EventListener: same thread, same transaction

```java
@Component
class TitleValidator {

    @EventListener
    void on(ContentPublished event) {
        if (event.title().toLowerCase().contains("spam")) {
            throw new IllegalArgumentException("Rejected title: " + event.title());
        }
    }
}
```

A plain `@EventListener` runs right inside `publishEvent`. That has three consequences:

1. It shares the publisher's transaction, so it can read the row that was just inserted and not yet committed.
2. An exception propagates out of `publishEvent` into `publish()`, and `@Transactional` rolls the INSERT back. The listener can **veto** the operation.
3. The publisher waits for it. A slow listener is a slow `publish()`.

It also means a plain listener sees events for work that will be rolled back later. Suppose `publishAll(List.of("Intro", "Part 2", "Intro"))` runs in one transaction against a `UNIQUE` title column. Two events are published before the third INSERT fails. A search indexer written as `@EventListener` has already indexed "Intro" and "Part 2": ghost entries for rows that do not exist.

`@EventListener` has a `condition` attribute (a SpEL expression on `#event` or `#root.event`) and can return a value or a collection, which Spring publishes as new events. Ordering between listeners of the same event is undefined unless you add `@Order`.

### @TransactionalEventListener: wait for the outcome

```java
@Component
class SearchIndexer {

    @TransactionalEventListener   // phase = TransactionPhase.AFTER_COMMIT
    void on(ContentPublished event) {
        index.add(event.title());
    }
}

@Component
class RollbackAlerter {

    @TransactionalEventListener(phase = TransactionPhase.AFTER_ROLLBACK)
    void on(ContentPublished event) {
        alerts.add(event.title());
    }
}
```

When the event is published inside an active transaction, Spring does not call these methods yet. It registers a transaction synchronization and calls the listener when the transaction reaches the chosen phase:

| Phase | Runs when | Typical use |
|---|---|---|
| `BEFORE_COMMIT` | just before commit, still inside the transaction | last-moment checks or writes that must be part of the commit |
| `AFTER_COMMIT` (default) | after a successful commit | notifications, indexing, outbound messages |
| `AFTER_ROLLBACK` | after a rollback | alerts, compensation |
| `AFTER_COMPLETION` | after commit or rollback | cleanup that does not care about the outcome |

With the same failing batch, the `AFTER_COMMIT` indexer sees nothing, and the `AFTER_ROLLBACK` alerter sees exactly "Intro" and "Part 2", the events published before the failure.

Two details matter in practice:

- **An exception in an `AFTER_COMMIT` listener does not reach the publisher.** The transaction is already committed; Spring logs `TransactionSynchronization.afterCompletion threw exception` and moves on. You cannot veto from there, and a failure is easy to miss. That is the gap the Spring Modulith Event Publication Registry closes.
- **Writes inside an `AFTER_COMMIT` listener are not in a transaction you control.** The original transaction is finished. If the listener needs to write to the database, give it its own: `@Transactional(propagation = Propagation.REQUIRES_NEW)` on the listener method.

### No transaction, no call

```java
@Service
class DraftService {
    public void saveDraft(String title) {          // no @Transactional
        events.publishEvent(new DraftSaved(title));
    }
}

@Component
class DraftNotifier {
    @TransactionalEventListener(fallbackExecution = true)
    void on(DraftSaved event) { ... }
}
```

If an event is published while no transaction is active, a `@TransactionalEventListener` is **silently skipped**: no error, no log line at the default level. `fallbackExecution = true` tells Spring to run it immediately in that case. This bites when a method loses its `@Transactional` during a refactoring, or when the publishing method is called through `this` (self-invocation bypasses the transactional proxy), and a listener that used to fire simply stops.

### Asynchronous listeners

```java
@EnableAsync
@SpringBootApplication
class Application {}

@Component
class AnalyticsRecorder {

    @Async
    @TransactionalEventListener
    void on(ContentPublished event) { ... }
}
```

`@Async` moves the listener to a task executor (Spring Boot auto-configures one; with virtual threads enabled via `spring.threads.virtual.enabled=true` it uses them). The publisher no longer waits and a slow listener no longer adds latency. The price: the listener has no transaction of its own unless you declare one, its exceptions go to an `AsyncUncaughtExceptionHandler` instead of anyone who could react, and tests have to wait for the result (Awaitility, or Spring Modulith's `Scenario`). `@Async` combined with a plain `@EventListener` is usually a mistake: the listener may start before the publisher commits and not find the row it is supposed to process.

Spring Modulith's `@ApplicationModuleListener` is exactly the combination most integration listeners want, in one annotation: `@Async` + `@Transactional(propagation = REQUIRES_NEW)` + `@TransactionalEventListener` (AFTER_COMMIT).

### Testing listeners

Transactional listeners only fire when a transaction really commits or rolls back. A test class annotated `@Transactional` wraps every test in one transaction that is rolled back at the end, so `AFTER_COMMIT` listeners never run and `AFTER_ROLLBACK` listeners run only after the assertions. Keep such tests non-transactional and clean up explicitly:

```java
@SpringBootTest   // deliberately NOT @Transactional
class ApplicationEventsTest {

    @BeforeEach
    void reset() {
        contentService.deleteAll();
        searchIndexer.clear();
    }

    @Test
    void indexerIgnoresRolledBackBatch() {
        assertThatThrownBy(() -> contentService.publishAll(List.of("Intro", "Part 2", "Intro")))
            .isInstanceOf(DataIntegrityViolationException.class);

        assertThat(searchIndexer.indexed()).isEmpty();
    }
}
```

`RecordApplicationEvents` / `ApplicationEvents` from `spring-test` can capture the events published during a test when you only need to assert that an event was published.

## Trade-offs

- **Decoupled at compile time, still coupled at run time.** The publisher no longer imports the listener, but a synchronous listener still runs in its thread and transaction, and its exception still rolls the publisher back. Events hide the dependency from the code reader without removing it. Pick the listener type deliberately:
  ```java
  @EventListener                 // part of the operation: can veto, adds latency
  @TransactionalEventListener    // consequence of the operation: runs only after commit
  ```
- **After commit means the failure has nowhere to go.** Once the transaction committed, an exception in an `AFTER_COMMIT` listener is logged and dropped; if the process dies between commit and listener, the reaction is lost too. For anything that must eventually happen (e-mails, messages to other systems), plain Spring events are "at most once". Durable delivery needs an outbox, which Spring Modulith provides as the Event Publication Registry.
- **Implicit control flow is harder to follow.** "Find usages" on `publishEvent` does not show the listeners; debugging means searching for the event type. With many events and listeners, a flow that was a readable sequence of method calls becomes spread across the codebase. Spring Modulith's documentation (`Documenter`) lists published and consumed events per module, which helps.
- **Silent skipping is a real failure mode.** A `@TransactionalEventListener` without an active transaction does nothing and says nothing. Tests that are themselves `@Transactional`, a missing `@Transactional`, or self-invocation all produce "the listener never fires" bugs. `fallbackExecution = true` is the explicit escape hatch, not a default to apply everywhere.
- **Async adds throughput and removes guarantees.** `@Async` isolates latency, but ordering between events is no longer guaranteed, exceptions leave the caller's view, and the listener needs its own transaction:
  ```java
  @Async
  @Transactional(propagation = Propagation.REQUIRES_NEW)
  @TransactionalEventListener
  void on(ContentPublished event) { ... }   // what @ApplicationModuleListener expands to
  ```
- **In-process only.** Application events never leave the JVM. Another service, or another instance of the same service, does not see them. Crossing the process boundary means a broker (`spring-kafka-messaging`, `spring-rabbitmq-messaging`) or Spring Modulith's event externalization.

## Documentation Links

- [Spring Framework Reference: Standard and Custom Events](https://docs.spring.io/spring-framework/reference/core/beans/context-introduction.html#context-functionality-events): `ApplicationEventPublisher`, `@EventListener`, conditions, ordering, async listeners.
- [Spring Framework Reference: Transaction-bound Events](https://docs.spring.io/spring-framework/reference/data-access/transaction/event.html): `@TransactionalEventListener`, phases, `fallbackExecution`.
- [Spring Framework Javadoc: TransactionPhase](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/transaction/event/TransactionPhase.html): the four phases.
- [Spring Framework Reference: Application Events in tests](https://docs.spring.io/spring-framework/reference/testing/testcontext-framework/application-events.html): `@RecordApplicationEvents` and `ApplicationEvents`.
- [Spring Modulith Reference: Working with Application Events](https://docs.spring.io/spring-modulith/reference/events.html): how `@ApplicationModuleListener` and the Event Publication Registry build on these rules.
