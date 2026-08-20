---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Learn how a Java application actually talks to Cassandra using the DataStax (now Apache) Java Driver: building and reusing a single `CqlSession`, moving from ad hoc `SimpleStatement`s to `PreparedStatement`s and understanding why preparation is a performance and correctness decision and not just a convenience, using the object mapper to work against entity classes instead of raw CQL, and issuing queries asynchronously with `CompletionStage`. The goal is to be able to read and write idiomatic driver code for a real service — the book's running example is a Reservation Service microservice — rather than treating the driver as a black box you copy-paste around a `session.execute(String)` call.

## Use Cases

- Writing the data-access layer of a Spring Boot or plain Java microservice that talks to Cassandra, and deciding how to structure a shared `CqlSession` so it is built once at startup and reused for the life of the application.
- Converting a prototype that builds CQL by string concatenation into production code that uses `PreparedStatement`/`BoundStatement`, both to avoid injection risk and to get proper token-aware routing.
- Choosing between four ways of producing a statement — raw string, `SimpleStatement`, `QueryBuilder`, or the object mapper's annotated DAOs — for a given piece of code (one-off script vs. a query executed on every request vs. a query with optional/variable predicates).
- Fanning out several queries in parallel with `executeAsync()` instead of blocking sequentially, or chaining a `SELECT` into a dependent `DELETE`/`INSERT` with `CompletionStage.thenCompose()`.
- Diagnosing connection-time failures (`NoHostAvailableException`, `AuthenticationException`) and choosing multiple contact points plus an explicit local datacenter for production deployments instead of the single-contact-point default that's fine for a laptop.
- Externalizing driver settings — contact points, timeouts, consistency level, page size — into an `application.conf` (HOCON) file instead of hardcoding them in the builder, and layering execution profiles on top for the handful of queries that need different settings than the default.
- Adding a Maven dependency for `java-driver-core` (and, if needed, `java-driver-query-builder` or the mapper modules) to a new service and knowing which groupId is current before copying an old snippet from a tutorial or Stack Overflow answer.

## Deep Dive

### `CqlSession`: one heavyweight object per application

The book frames the driver the way a Java developer already thinks about JDBC — a vendor-neutral API (`Statement`, `PreparedStatement`, `ResultSet`) backed by a vendor-specific implementation — and then immediately points out where the analogy breaks: `com.datastax.oss.driver.api.core.CqlSession` is both the connection and the client, built with a fluent builder:

```java
CqlSession cqlSession = CqlSession.builder()
    .addContactPoint(new InetSocketAddress("127.0.0.1", 9042))
    .build();
```

The nodes you list are **contact points** — used only to discover the rest of the cluster, analogous to Cassandra's own seed nodes. The driver's own single-contact-point default (`CqlSession.builder().build()`) is convenient for a laptop but the book is explicit that production code should list several contact points and set a local datacenter, so a single down node at startup time doesn't fail the whole application:

```java
CqlSession cqlSession = CqlSession.builder()
    .addContactPoint(new InetSocketAddress("<ip 1>", 9042))
    .addContactPoint(new InetSocketAddress("<ip 2>", 9042))
    .withLocalDatacenter("<data center name>")
    .build();
```

Older driver versions (3.x) split this into a separate `Cluster` object that produced `Session`s; the 4.0 driver merged the two into `CqlSession`, which is the callout the book gives its own sidebar to. A second sidebar is just as important operationally:

> **Sessions are expensive.** "Because a `CqlSession` maintains TCP connections to multiple nodes, it is a relatively heavyweight object. In most cases, you'll want to create a single `CqlSession` and reuse it throughout your application, rather than continually building up and tearing down `CqlSession`s. Another acceptable option is to create a `CqlSession` per keyspace, if your application is accessing multiple keyspaces."

Building a `CqlSession` also throws eagerly: a `NoHostAvailableException` if none of the contact points respond, or `AuthenticationException` if credentials are rejected — both are startup-time failures, not per-query ones, which is exactly why the object is meant to be built once and held for the application's lifetime rather than constructed per request.

### The statement ladder: string, `SimpleStatement`, `PreparedStatement`

`CqlSession.execute()` accepts a plain string and is really a convenience wrapper around `SimpleStatement.newInstance(...)`. That's fine for a one-off `SELECT * FROM ...` in a demo, but the book moves quickly past it to parameterized `SimpleStatement`s built with `SimpleStatementBuilder`, using `?` placeholders and `.addPositionalValue(...)`:

```java
SimpleStatement reservationInsert = SimpleStatement.builder(
    "INSERT INTO reservations_by_confirmation (confirm_number, hotel_id, " +
        "start_date, end_date, room_number, guest_id) VALUES (?, ?, ?, ?, ?, ?)")
    .addPositionalValue("RS2G0Z")
    .addPositionalValue("NY456")
    .addPositionalValue("2020-06-08")
    .addPositionalValue("2020-06-10")
    .addPositionalValue(111)
    .addPositionalValue("1b4d86f4-ccff-4256-a63d-45c905df2677")
    .build();
cqlSession.execute(reservationInsert);
```

That already avoids hand-built string concatenation and the injection risk that comes with it. But the book is deliberate about not stopping there, because most application queries are not one-offs — they're the same access-pattern query run repeatedly, which is exactly what `PreparedStatement` is designed for:

```java
PreparedStatement reservationSelectPrepared = cqlSession.prepare(
    "SELECT * FROM reservations_by_confirmation WHERE confirm_number=?");

BoundStatement reservationSelectBound =
    reservationSelectPrepared.bind("RS2G0Z");

cqlSession.execute(reservationSelectBound);
```

### Why prepared statements matter beyond convenience

It's tempting to read `prepare()` + `bind()` as just a nicer-looking `SimpleStatement`, but the book walks through three separate reasons preparation is a real performance and correctness decision:

**1. The query plan is sent once, not on every execution.** `cqlSession.prepare(...)` sends the CQL text to a node exactly once and gets back a unique identifier (visible via `PreparedStatement.getId()`); every subsequent execution sends only that identifier plus the bound values. The driver then proactively prepares the same statement on the *other* nodes in the cluster too, so any of them can serve it as coordinator. Since Cassandra 3.10, nodes persist prepared statements in a local system table (not just an in-memory cache), so they survive a node restart; the driver's `advanced.prepared-statements.reprepare-on-up` setting exists mainly to cover clusters still running older releases. If the driver ever hits a node where the statement wasn't prepared, it transparently re-prepares it — at the cost of one extra round trip, which is the exception path, not the common one.

**2. Token-aware routing depends on it.** This is easy to miss and the book ties it directly to the driver's default `LoadBalancingPolicy`: token awareness — routing a query straight to a replica for its partition key instead of an arbitrary coordinator — is described as something that happens "whenever you use a `PreparedStatement`." A `BoundStatement` carries typed, positional values the driver can use to compute the partition's token before sending the request; a raw string statement doesn't give the driver that structure to work with. So skipping prepared statements doesn't just cost you the round trip savings — it can also cost you optimal request routing.

**3. Security, the same way JDBC `PreparedStatement` gives it to you.** The book states this plainly: "In addition to improving efficiency, `PreparedStatement`s also improve security by separating the query logic of CQL from the data. This provides protection against injection attacks." A `PreparedStatement` is deliberately *not* a subtype of `Statement`, so you cannot accidentally hand an unbound prepared statement to `execute()` — you're forced through `bind()` first.

The practical pattern the book recommends: create one `PreparedStatement` per access pattern (typically one per query your data model was designed around) at startup, hold onto the `PreparedStatement` objects the same way you hold onto the `CqlSession`, and `bind()` fresh values per call.

### `QueryBuilder`: programmatic statements for variable structure

For queries whose *shape* varies — optional predicates, conditionally included columns — string templates and prepared statements get awkward. The driver's `QueryBuilder` (a separate Maven module, `java-driver-query-builder`) gives a fluent API that builds `Select`, `Insert`, `Update`, `Delete` objects programmatically:

```java
Select reservationSelect =
    selectFrom("reservation", "reservations_by_confirmation")
        .all()
        .whereColumn("confirm_number").isEqualTo(bindMarker());

PreparedStatement reservationSelectPrepared =
    cqlSession.prepare(reservationSelect.build());
```

Note the `bindMarker()` call — `QueryBuilder` output can itself be prepared, combining programmatic construction with the performance and security benefits above. Like prepared statements, it also protects against injection, since values are never spliced into the query text by hand.

### The object mapper: entities, DAOs, and a generated implementation

The highest-level abstraction the driver offers is annotation-driven object mapping, split across a compile-time processor module and a runtime module. You annotate a POJO as `@Entity` (optionally with a `@NamingStrategy` to convert Java camelCase to CQL's recommended snake_case), mark the partition key field with `@PartitionKey`, define a `@Dao` interface with `@Select`/`@Insert`/`@Delete`/`@Query` methods, and a `@Mapper` interface with a `@DaoFactory` method:

```java
@Entity
@NamingStrategy(convention = SNAKE_CASE_INSENSITIVE)
public class ReservationsByConfirmation {
    @PartitionKey
    private String confirmNumber;
    private String hotelId;
    private LocalDate startDate;
    private LocalDate endDate;
    private short roomNumber;
    private UUID guestId;
    // constructors, getters/setters, equals/hashCode
}

@Dao
public interface ReservationDao {
    @Select
    ReservationsByConfirmation findByConfirmationNumber(String confirmNumber);

    @Insert
    void save(ReservationsByConfirmation reservation);

    @Delete
    void delete(ReservationsByConfirmation reservation);
}

@Mapper
public interface ReservationMapper {
    @DaoFactory
    ReservationDao reservationDao();
}
```

The annotation processor generates the implementation at compile time; at runtime you wrap the `CqlSession` once — `new ReservationMapperBuilder(cqlSession).build()` — and pull DAOs from it. `Mapper.save()` compiles to an `INSERT`, and the book reiterates the reason that single method covers both create and update: "these are really the same operation to Cassandra" — the same upsert semantics from the CQL data model carry straight through the mapper. Entity classes can reference other `@Entity`-annotated classes to map user-defined types, and the mapper processes them recursively. As with the `CqlSession` itself, the mapper and DAO objects should be built once and reused, not recreated per call.

### Asynchronous execution with `CompletionStage`

`CqlSession.execute()` blocks. `executeAsync()` returns `CompletionStage<AsyncResultSet>` — the standard Java 8 concurrency type — which lets you compose dependent operations instead of running them sequentially and blocking between each one. (This is itself a driver-version detail worth knowing: the 3.x driver line used Guava's `ListenableFuture`; 4.0 switched to `CompletionStage`, dropping the Guava dependency from application code.) The book's worked example chains a lookup into a dependent delete:

```java
CompletionStage<AsyncResultSet> selectStage = session.executeAsync(
    "SELECT * FROM reservations_by_confirmation WHERE confirm_number=RS2G0Z");

CompletionStage<AsyncResultSet> deleteStage = selectStage.thenCompose(resultSet -> {
    Row reservationRow = resultSet.one();
    return session.executeAsync(SimpleStatement.newInstance(
        "DELETE FROM reservations_by_hotel_date WHERE hotel_id = ? AND " +
            "start_date = ? AND room_number = ?",
        reservationRow.getString("confirm_number"),
        reservationRow.getLocalDate("start_date"),
        reservationRow.getInt("room_number")));
});

deleteStage.whenComplete((resultSet, error) -> {
    if (error != null) {
        System.out.printf("Failed to delete: %s%n", error.getMessage());
    } else {
        System.out.println("Delete successful");
    }
});
```

The driver also exposes `closeAsync()`, `prepareAsync()`, an async build via `CqlSessionBuilder.buildAsync()`, and (since driver 4.4) a reactive-streams extension — `CqlSession` extends `ReactiveSession`, adding `executeReactive()` for `java.util.concurrent.Flow`-based backpressure-aware processing.

### Configuration: builder calls vs. `application.conf`

Everything shown above can be set programmatically on the builder, but the Java driver — uniquely among the DataStax-family drivers — also supports file-based configuration via the Typesafe Config library, using HOCON syntax and a classpath-scanned `application.conf`:

```
datastax-java-driver {
  basic {
    contact-points = [ "127.0.0.1:9042", "127.0.0.2:9042" ]
    session-keyspace = reservation
  }
}
```

The book recommends this over programmatic configuration for most settings, and separates "basic" options (contact points, keyspace, request timeout, default consistency level, page size, load-balancing policy) from a longer list of "advanced" options (connection pooling, retry policy, speculative execution, security, logging, metrics) that are used less often but are all still just configuration keys, reloaded on an interval (`config-reload-interval`, default 5 minutes) without a restart. **Execution profiles** layer named overrides — e.g., a `long_request` profile with a longer timeout and stronger consistency — on top of the defaults, applied per-statement with `statement.setExecutionProfileName(...)`.

Two configuration defaults are worth calling out because they reflect the driver's own opinionated design choices, described directly in the book: since the 4.0 rewrite, the driver ships a *single* default `LoadBalancingPolicy` (round-robin, token-aware, datacenter-aware, requiring an explicit local datacenter) instead of the composable 3.x policies, and a single opinionated `RetryPolicy` instead of the older `FallthroughRetryPolicy`/`DowngradingConsistencyRetryPolicy` choice — the book notes the downgrading policy was dropped partly because "if you are willing to accept a downgraded consistency level under some circumstances, do you really require a higher consistency level for the general case?"

### Book vs. today

The book already covers the 4.0 driver, which it correctly flags as a breaking rewrite from the 3.x line (merged `Cluster`/`Session` into `CqlSession`, `CompletionStage` replacing Guava futures, single opinionated load-balancing and retry policies). Two things have moved since:

> **Governance and Maven coordinates changed in 2024.** Starting with driver version **4.18**, the project was donated by DataStax to the Apache Software Foundation and now lives at `github.com/apache/cassandra-java-driver`. The practical consequence for a `pom.xml` copied from the book or an older tutorial: the groupId changed from `com.datastax.oss` to `org.apache.cassandra`, while the artifact names (`java-driver-core`, `java-driver-query-builder`, `java-driver-mapper-runtime`, `java-driver-mapper-processor`) stayed the same. As of this writing the driver is on the **4.19.x** line. This is a coordinates and ownership change, not an API rewrite — `CqlSession`, the builder pattern, `PreparedStatement`/`BoundStatement`, the mapper annotations, and the `CompletionStage`-based async API are all unchanged in shape from what the book demonstrates. Copying an old snippet still works; only the dependency declaration needs updating for a modern project.
>
> **Reactive streams support, mentioned as new in the book's own sidebar, is now an established part of the API.** `executeReactive()` (added in driver 4.4, before the ASF transition) remains available for teams using Project Reactor or another `java.util.concurrent.Flow`-based stack, and is unaffected by the ASF move.

Nothing in the book's description of *why* prepared statements matter — one-time preparation, token-aware routing, injection protection — has changed; those remain the driver's central performance and security story on the current 4.19.x line.

## Trade-offs

- **A raw string to `execute()` is the fastest way to get something wrong.** It's the shortest path to a working demo and the easiest way to reintroduce injection risk and lose token-aware routing at the same time. It's defensible for genuinely one-off diagnostic queries; it is not a pattern to leave in application code that runs on every request.
- **`PreparedStatement` trades an upfront round trip for cheaper and better-routed repeated execution.** Preparing a statement costs a network call to every node in the cluster the first time; that cost is amortized the moment the same access pattern runs more than a handful of times, which is the normal case for a service built around a fixed set of query-first tables. For a query that genuinely runs once, preparation is pure overhead — the book's own guidance is to reserve `SimpleStatement` for exactly that case.
- **`QueryBuilder` buys structural flexibility at the cost of a second API to learn and an extra dependency to manage.** It earns its place specifically for queries whose shape (not just their values) varies at runtime — optional filters, dynamically included columns. For fixed-shape queries it's strictly more code than a `PreparedStatement` built from a string literal, for no additional benefit.
- **The object mapper removes boilerplate but adds an annotation-processing layer between your code and the CQL it runs.** It shines when your domain model already mirrors the query-first, one-table-per-access-pattern shape Cassandra data modeling produces — the mapper is not a general ORM and will fight you if you expect join-like behavior or a single entity class to back multiple differently-shaped tables. Debugging generated DAO implementations is also a step removed from debugging a hand-written `PreparedStatement`.
- **Async execution buys throughput and composability, but pushes error handling and thread-safety onto the caller.** `CompletionStage` chains read cleanly in the happy path; the book's own delete-after-select example elides the null check on `resultSet.one()` for readability, which is exactly the kind of gap that turns into a `NullPointerException` in production. Chaining also means you're now reasoning about which executor callbacks run on, not just what CQL runs — a real cost for teams that don't already have async idioms elsewhere in the codebase.
- **A single, long-lived `CqlSession` is both the recommended pattern and a single point of configuration risk.** Reusing one `CqlSession` (or one per keyspace) is correct and necessary — it owns pooled TCP connections per node and is explicitly documented as too heavyweight to build per request. But because so much (load balancing, retry policy, default consistency, execution profiles) is configured once at the session or file level, a misconfigured default silently applies to every query in the application until someone notices, rather than failing one call at a time.

## Documentation Links

- [Jeff Carpenter and Eben Hewitt, "Cassandra: The Definitive Guide", Revised 3rd Edition (O'Reilly, 2022) — Chapter 8, "Application Development with Drivers"](https://www.oreilly.com/library/view/cassandra-the-definitive/9781492097143/) — doc
- [Java Driver for Apache Cassandra — official documentation (Apache Software Foundation)](https://apache.github.io/cassandra-java-driver/) — doc
- [Java Driver for Apache Cassandra — GitHub repository (org.apache.cassandra, 4.19.x)](https://github.com/apache/cassandra-java-driver) — doc
- [Java Driver for Apache Cassandra — CqlSession API reference](https://apache.github.io/cassandra-java-driver/4.19.0/api/com/datastax/oss/driver/api/core/CqlSession.html) — doc
- [Java Driver for Apache Cassandra — Object Mapper manual](https://apache.github.io/cassandra-java-driver/4.19.0/mapper/) — doc
- [Java Driver for Apache Cassandra — Asynchronous programming manual](https://apache.github.io/cassandra-java-driver/4.19.0/core/async/) — doc
- [Java Driver for Apache Cassandra — Configuration reference](https://apache.github.io/cassandra-java-driver/4.19.0/core/configuration/) — doc
