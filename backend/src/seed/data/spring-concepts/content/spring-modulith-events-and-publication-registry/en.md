---
version: 1.0
updatedAt: 2026-09-30
---
## Objective

Once modules stop calling each other directly, events are the connective tissue: `publishing` announces `ContentPublished`, `notification` reacts. The obvious way to react, a plain Spring listener, brings back the coupling in a different form. Synchronous, and a mail outage makes publishing fail. `AFTER_COMMIT` and asynchronous, and a crash between the commit and the listener silently loses the notification: the content is in the database, nobody was told, nobody noticed.

Spring Modulith addresses both halves. `@ApplicationModuleListener` packages the right defaults for integrating modules (asynchronous, after commit, in a transaction of its own), and the **Event Publication Registry** writes a record of every publication to each transactional listener *in the same transaction as the business data*, then marks it completed when the listener succeeds. Failed or never-started deliveries stay in the registry and can be resubmitted. That is the transactional outbox pattern (see `outbox-pattern` in System Design) implemented inside the application, with no broker and no extra code in the listener. Event externalization then forwards selected events to Kafka, AMQP or JMS from the same registry. This concept covers Spring Modulith 2.x on Spring Boot 4.

## Use Cases

- **Integrating application modules without temporal coupling.** Publishing commits even while the notification side is down or slow.
- **At-least-once side effects.** E-mails, webhooks, search indexing, or calls to external systems that must eventually happen after a successful business transaction.
- **Surviving restarts.** Publications that were written but not completed before a crash or a deployment are picked up again (`republish-outstanding-events-on-restart`, or an explicit resubmission job).
- **Operational visibility of failed reactions.** The `EVENT_PUBLICATION` table shows, per listener, what is published, processing, completed or failed, which is where an ops endpoint or a dashboard can look.
- **Publishing domain events to other services.** `@Externalized` sends selected events to a broker after commit, reusing the registry as the outbox.

## Deep Dive

### @ApplicationModuleListener

```java
@Component
class NotificationListener {

    private final MailGateway mail;

    NotificationListener(MailGateway mail) {
        this.mail = mail;
    }

    @ApplicationModuleListener
    void on(ContentPublished event) {
        mail.send("New content: " + event.title());
    }
}
```

It is a composed annotation:

```java
@Async
@Transactional(propagation = Propagation.REQUIRES_NEW)
@TransactionalEventListener   // AFTER_COMMIT
```

Each part fixes one problem of a naive listener (see `spring-application-events`):

- **AFTER_COMMIT:** the listener only reacts to content that really exists, never to a rolled-back publication.
- **`@Async`:** the publisher does not wait; a slow listener adds no latency and cannot block the request thread.
- **`REQUIRES_NEW`:** the listener gets its own transaction. Its writes commit or roll back on their own, and its failure cannot reach the publisher's already-committed transaction.

The publisher side is unchanged: a `@Transactional` method calling `ApplicationEventPublisher.publishEvent(...)`. Spring Modulith ships a default async executor configuration; `spring.modulith.default-async-termination=true` (the default) makes the application wait for running listeners on shutdown.

### The Event Publication Registry

Add one starter for the persistence technology you already use:

| Store | Starter |
|---|---|
| JDBC | `spring-modulith-starter-jdbc` |
| JPA | `spring-modulith-starter-jpa` |
| MongoDB | `spring-modulith-starter-mongodb` |
| Neo4j | `spring-modulith-starter-neo4j` |

With it on the classpath, publishing an event that has transactional listeners inserts one row per listener into `EVENT_PUBLICATION`, **inside the publisher's transaction**. The row holds the listener id, the event type, the serialized event (JSON, via Jackson), the publication date and, since 2.0, a status. No application code changes.

```sql
CREATE TABLE IF NOT EXISTS event_publication (
  id                     UUID NOT NULL,
  listener_id            TEXT NOT NULL,
  event_type             TEXT NOT NULL,
  serialized_event       TEXT NOT NULL,
  publication_date       TIMESTAMP WITH TIME ZONE NOT NULL,
  completion_date        TIMESTAMP WITH TIME ZONE,
  status                 TEXT,
  completion_attempts    INT,
  last_resubmission_date TIMESTAMP WITH TIME ZONE,
  PRIMARY KEY (id)
);
```

(PostgreSQL shape; the starter ships DDL for H2, HSQLDB, MySQL, MariaDB, PostgreSQL, Oracle and SQL Server.)

Because the registry write shares the business transaction, the three interesting cases line up exactly:

| Situation | `content` table | `EVENT_PUBLICATION` |
|---|---|---|
| Listener succeeded | row committed | `COMPLETED`, completion date set |
| Listener threw | row committed | `FAILED` |
| Publisher rolled back | no row | no row |
| Process died after commit, before the listener finished | row committed | still `PUBLISHED` / `PROCESSING` |

The last line is the one plain Spring events cannot handle: the fact that a reaction is owed survives the crash.

The registry tracks publications to **any** transactional event listener, not only `@ApplicationModuleListener`; a plain `@TransactionalEventListener` is recorded too (its exception is logged by Spring and the publication stays `FAILED`). What `@ApplicationModuleListener` adds is the async execution and the listener's own transaction.

### Publication lifecycle (2.0+)

Spring Modulith 2.0 introduced an explicit status (`EventPublication.Status`):

```
PUBLISHED -> PROCESSING -> COMPLETED
                 |
                 v
               FAILED -> RESUBMITTED -> PROCESSING -> ...
```

`EventPublication` also exposes `getCompletionAttempts()` and `getLastResubmissionDate()`. A **staleness monitor** can mark publications stuck in `PUBLISHED`, `PROCESSING` or `RESUBMITTED` as `FAILED` after a configurable time (`spring.modulith.events.staleness.published`, `.processing`, `.resubmitted`, checked every `spring.modulith.events.staleness.check-interval`, one minute by default). Without it, a listener that died mid-flight would stay `PROCESSING` forever.

### Resubmitting

Three APIs, all beans you can inject:

```java
@Service
public class NotificationRecovery {

    private final FailedEventPublications failed;

    NotificationRecovery(FailedEventPublications failed) {
        this.failed = failed;
    }

    @Scheduled(fixedDelay = 60_000)
    public void retryFailed() {
        failed.resubmit(ResubmissionOptions.defaults()
            .withMinAge(Duration.ofMinutes(1))
            .withBatchSize(100));
    }
}
```

- **`FailedEventPublications.resubmit(ResubmissionOptions)`** (2.0+): resubmits publications in state `FAILED`. `ResubmissionOptions` controls batch size, maximum in flight, minimum age, and a filter on the publication.
- **`IncompleteEventPublications`**: `resubmitIncompletePublications(Predicate)`, `resubmitIncompletePublicationsOlderThan(Duration)`, or with `ResubmissionOptions`. Covers everything not completed.
- **`spring.modulith.events.republish-outstanding-events-on-restart=true`**: one sweep of incomplete publications at startup. Convenient on a single instance; with several instances each one republishes on start, so an explicit, scheduled resubmission (ideally with a lock) is usually safer.

Resubmission calls the listener again with the deserialized event. Delivery is therefore **at least once**: the listener must be idempotent.

### Completed publications

`spring.modulith.events.completion-mode` decides what happens on success:

| Mode | Effect |
|---|---|
| `update` (default) | sets the completion date and status; rows stay in `EVENT_PUBLICATION` |
| `delete` | removes the row; the table only holds outstanding work |
| `archive` | moves the row to an archive table (`EVENT_PUBLICATION_ARCHIVE`) |

With `update`, the table grows forever unless you purge it. `CompletedEventPublications` offers `findAll()`, `deletePublications(Predicate)` and `deletePublicationsOlderThan(Duration)`, typically called from a scheduled job.

### Schema management

In Spring Modulith 2.1 the JDBC registry creates its table on startup when it does not exist: the auto-configuration for `spring.modulith.events.jdbc.schema-initialization.enabled` matches when the property is missing (verified on 2.1.1, even though the property metadata lists the default as `false`; older 1.x versions required you to enable it). In production, set it to `false` and own the DDL in Flyway or Liquibase, copying the script for your database from the Spring Modulith appendix. `spring.modulith.events.jdbc.schema` puts the table in a specific schema; `use-legacy-structure=true` keeps the pre-2.0 table layout for applications that have not migrated yet.

### Externalizing events to a broker

```java
@Externalized("content.published::#{#this.id()}")
public record ContentPublished(long id, String title) {}
```

With `spring-modulith-events-kafka` (or `-amqp`, `-jms`, `-messaging`) on the classpath, events annotated `@Externalized` (or jMolecules `@Externalized`) are sent to the broker by a registry-backed listener after the transaction commits. The value is `target::key`, both parts may be SpEL with the event as root: Kafka uses them as topic and message key, AMQP as exchange and routing key. Because the send goes through the registry, a broker outage leaves a `FAILED` publication instead of a lost message. Programmatic routing (`EventExternalizationConfiguration`) avoids annotating the event types. Since 2.1, `spring.modulith.events.externalization.mode=outbox` can delegate the sending to a dedicated outbox implementation (`spring-modulith-starter-namastack` for relational databases, or `spring-modulith-starter-jobrunr`) instead.

### Testing

Transactional, asynchronous listeners need tests that let the transaction commit and then wait:

```java
@SpringBootTest   // not @Transactional
class EventPublicationRegistryTest {

    @Test
    void failingListenerKeepsPublication() {
        mail.setDown(true);

        publishing.publish("Written during an outage");

        assertThat(contentRows()).isEqualTo(1);
        await().atMost(Duration.ofSeconds(5)).untilAsserted(() ->
            assertThat(statuses()).containsExactly("FAILED"));
    }
}
```

Inside a single module, `@ApplicationModuleTest` with `Scenario` does the transaction and the waiting for you (see `spring-modulith-testing-and-documentation`).

## Trade-offs

- **At least once, never exactly once.** The registry guarantees the listener will be called until it completes; it cannot guarantee it runs only once. A listener that sent the e-mail and then failed to commit its own transaction will send it again on resubmission. Make listeners idempotent (a dedup key, an upsert, checking state first):
  ```java
  @ApplicationModuleListener
  void on(ContentPublished event) {
      if (sentLog.alreadySent(event.id())) return;   // idempotency guard
      mail.send(...);
      sentLog.record(event.id());
  }
  ```
- **Eventual consistency inside one application.** Right after `publish()` returns, the notification has not happened yet. Code and tests that read "the other side" immediately after the call will see stale state. That is the same mental model as between microservices, now inside a monolith, and it has to be designed for (UI messages, read models).
- **The registry is extra writes on the hot path.** Every publication to N transactional listeners is N extra inserts in the business transaction, plus updates on completion. For most applications this is negligible; for very high event volumes, measure it and consider `delete` completion mode and a fast purge.
- **Completed rows accumulate.** With the default `update` mode nothing is ever deleted. Plan a purge or pick `delete`/`archive` from day one:
  ```yaml
  spring.modulith.events.completion-mode: delete
  ```
- **Resubmission is your job.** The registry records failures; it does not retry on its own (apart from the optional restart sweep). Without a scheduled `resubmit`, a staleness configuration and some monitoring, `FAILED` rows just sit there. Multi-instance deployments also need to avoid several nodes resubmitting the same publication concurrently.
- **Events are serialized and must stay readable.** Publications are stored as JSON and deserialized on resubmission, possibly after a deployment. Renaming or reshaping an event record breaks pending publications. Treat event types as a contract with versioning, as you would a message schema (see `data-encoding-formats-and-schema-evolution` in System Design).
- **Async listeners lose the caller's context.** The listener runs on another thread: no request scope, no `SecurityContext` unless propagated, no guaranteed ordering between events. Put everything the listener needs into the event.

## Documentation Links

- [Spring Modulith Reference: Working with Application Events](https://docs.spring.io/spring-modulith/reference/events.html): `@ApplicationModuleListener`, the Event Publication Registry, lifecycle, resubmission, completion modes, externalization.
- [Spring Modulith Reference: Appendix](https://docs.spring.io/spring-modulith/reference/appendix.html): registry DDL per database and all `spring.modulith.events.*` properties.
- [Spring Modulith Javadoc: FailedEventPublications](https://docs.spring.io/spring-modulith/docs/current/api/org/springframework/modulith/events/FailedEventPublications.html): resubmission API added in 2.0.
- [Oliver Drotbohm: Spring Modulith 2.0 GA](https://spring.io/blog/2025/11/21/spring-modulith-2-0-ga-1-4-5-and-1-3-11-released/): release notes for the publication lifecycle and staleness monitor.
- [Spring Modulith 2.1 GA release notes](https://spring.io/blog/2026/06/11/spring-modulith-2-1-ga-2-0-7-and-1-4-12-released/): outbox-backed externalization (Namastack, JobRunr) and events seen from all threads in tests.
- [Dan Vega: Introduction to Spring Modulith, Modular Monoliths in Spring Boot (video)](https://www.youtube.com/watch?v=xHlDyKVyvig): breaking a cycle with events and making them durable with the registry.
