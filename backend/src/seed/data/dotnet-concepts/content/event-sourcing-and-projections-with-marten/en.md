---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

Event sourcing stores what happened (immutable events appended to a per-aggregate stream) and derives the current state by folding them. Marten is a library that turns PostgreSQL
into an event store plus a document database, with no broker or extra server. This lesson runs it against a real PostgreSQL and measures what decides whether the idea fits: the
tables it writes, the cost of rebuilding streams of 10, 1,000 and 10,000 events, the exception two concurrent commands get, the read lag of an async projection, a 100,000-event
rebuild, snapshots, schema evolution and the bridge to an outbox. It ends with when not to use it.
Versions: `Marten` 9.62.0 (MIT, published 2026-11-16, checked on NuGet on 2026-11-19; `10.0.0-alpha` exists but is not stable) with `JasperFx` and `JasperFx.Events` 2.102.0,
`Weasel.Postgresql` 9.51.0 and `Npgsql` 9.0.4 as transitive dependencies, `Microsoft.Extensions.Hosting` 10.0.0, PostgreSQL 18.7 in Docker, TFM `net10.0`, SDK 10.0.100. The
projection API changed across Marten 6, 7, 8 and 9: this is the 9.x API. `WolverineFx.Marten` 6.64.2 (MIT) is docs only.

## Use Cases

- A domain where the history is the product: accounts, orders, claims, anything an auditor asks "how did it get here" about.
- Publishing integration messages without the dual-write problem, because the event is already a log.
- A read model you only think of next year, built over events recorded this year, with no data migration.

## Deep Dive

### State as a fold over facts

An event is a fact in the past tense (`MoneyDeposited`), not a command (`DepositMoney`). The state is `fold(events)`, so unlike CRUD plus an audit table there is nothing to keep in
sync: the events are the data. [Domain Events and Consistency Boundaries](domain-events-and-consistency-boundaries) raises events but still stores the new state as a row. Here the
events are the stored truth, and the aggregate follows [Aggregates, Entities, and Value Objects](aggregates-entities-and-value-objects). The concept is in
[Event Sourcing and CQRS](/system-design/system-design-concepts/event-sourcing-and-cqrs).

```csharp
public record AccountOpened(string Owner, decimal Initial);
public record MoneyDeposited(decimal Amount);
public record MoneyWithdrawn(decimal Amount);

public class Account   // Create for the first event, Apply for the rest, by convention
{
    public Guid Id { get; set; }  public string Owner { get; set; } = "";  public decimal Balance { get; set; }
    public static Account Create(AccountOpened e) => new() { Owner = e.Owner, Balance = e.Initial };
    public void Apply(MoneyDeposited e) => Balance += e.Amount;
    public void Apply(MoneyWithdrawn e) => Balance -= e.Amount;
}

using var store = DocumentStore.For(o => { o.Connection(cs); o.DatabaseSchemaName = "basics"; });  await using var s = store.LightweightSession();
s.Events.StartStream<Account>(id, new AccountOpened("Ana", 100m), new MoneyDeposited(50m));
await s.SaveChangesAsync();                                   // later: s.Events.Append(id, new MoneyWithdrawn(30m))
var acc = await q.Events.AggregateStreamAsync<Account>(id);   // fold in memory
```

### What is in PostgreSQL

`AutoCreate.All` created `mt_events`, `mt_streams`, `mt_event_progression`, `mt_event_projection_floors`, `mt_high_water_skips` and `mt_doc_deadletterevent`. After the three
events, in `psql`:

```text
 seq_id |  stream_id  | version | data                             | type            | mt_dotnet_type      | timestamp
      1 | 794cfe9d... |       1 | {"Owner": "Ana", "Initial": 100} | account_opened  | AccountOpened, App  | 2026-11-19 10:56:06.718894+00
      2 | 794cfe9d... |       2 | {"Amount": 50}                   | money_deposited | MoneyDeposited, App | 2026-11-19 10:56:06.718894+00
      3 | 794cfe9d... |       3 | {"Amount": 30}                   | money_withdrawn | MoneyWithdrawn, App | 2026-11-19 10:56:06.77234+00
```

`mt_events` also has `id` (one GUID per event), `data` as `jsonb`, `tenant_id` and `is_archived`. Two keys matter: `seq_id`, a global sequence that orders the whole store, and the
unique `(stream_id, version)`, which is the entire concurrency story below. `type` is an alias derived from the class name and `mt_dotnet_type` is the CLR type to read into (both
matter in the evolution section). The stream key is a `uuid` by default; `Events.StreamIdentity = StreamIdentity.AsString` made it `character varying` (`account-ana-001` worked),
so you choose once per store. The default `AppendMode` was `QuickWithServerTimestamps`: an append is one call to `mt_quick_append_events(...)`, one command, one transaction.

### The cost of rebuilding a stream

`AggregateStreamAsync` reads every event of the stream and folds it. Release build, PostgreSQL in local Docker, mean of 5 runs after a warm-up, Apple silicon:

```text
    10 events: aggregate 0.6 ms   fetch only 0.5 ms
  1000 events: aggregate 6.5 ms   fetch only 6.1 ms
 10000 events: aggregate 61.4 ms  fetch only 48.9 ms   (a first run gave 68.4 and 66.3)
```

Linear, and almost all of it is reading and deserializing JSON, not your `Apply`: about 6 microseconds per event. At 1,000 events per command it is invisible, at 10,000 it taxes
every write. The fixes are short streams by design (one aggregate per stream) or a snapshot (below), not a cache.

### Optimistic concurrency, provoked

`FetchForWriting<T>` is the command-side entry point: it loads the aggregate and remembers its version. Two commands read version 1 and both append a withdrawal:

```csharp
var sa = await a.Events.FetchForWriting<Account>(id);  var sb = await b.Events.FetchForWriting<Account>(id);   // both read v1
sa.AppendOne(new MoneyWithdrawn(30m));  sb.AppendOne(new MoneyWithdrawn(80m));
await a.SaveChangesAsync();                              // A saved
await b.SaveChangesAsync();                              // B fails
```

```text
B failed: JasperFx.Events.EventStreamUnexpectedMaxEventIdException
  message: Unexpected starting version number for event stream '12aa7b2b-...', expected 1 but was 2
Append(id, 1, event) on a stream at v2: ... expected 0 but was 2
```

The second line is the explicit `Append(streamId, expectedVersion, events)`: the number is the version the stream will have after your events, hence "expected 0" in the message. B
stored nothing: `SaveChangesAsync` is one PostgreSQL transaction and the `(stream_id, version)` key rejected the insert. The exception name is the measured one for 9.62.0; the
appending page of the docs names it only for a duplicate `StartStream` under tenant partitioning, so confirm it on your version. Without any check the same race is a data bug: both
commands saw balance 100, both withdrew 80, and the stream folded to `balance=-60`.

Marten does not retry for you. The policy is yours: reload, decide again on fresh state, append again.

```csharp
for (var attempt = 1; ; attempt++)   // fresh session, FetchForWriting, rule on fresh state, AppendOne, then:
    try { await s.SaveChangesAsync(); return; } catch (EventStreamUnexpectedMaxEventIdException) { /* loop */ }
```

With 20 concurrent withdrawals of 1: 139 to 155 retries, 77 to 83 ms, version 22, balance 50, none lost. `FetchForExclusiveWriting` locks the stream instead: 20 commands, zero
retries, 28 to 31 ms, queued. Optimistic wins when conflicts are rare, exclusive when one hot aggregate is hit constantly. For rows, see
[Transactions and Optimistic Concurrency in EF Core](transactions-and-optimistic-concurrency).

### Projections: three lifecycles over the same events

A projection is a read model computed from events. After one `SaveChangesAsync` that deposited 5000, three readers gave three answers:

```text
right after SaveChanges: inline=5100 live=5100 async=100 largeDeposits(inline EventProjection)=1
```

- **Inline** (`Snapshot<Account>(SnapshotLifecycle.Inline)`, or `Projections.Add<T>(ProjectionLifecycle.Inline)`): same transaction as the append, never stale. Cost: write latency,
  and a bug in it rejects the append (a projection that threw left the stream at 1 event, not 2, with `ApplyEventException`).
- **Live**: no stored document, `AggregateStreamAsync` and `FetchLatest` fold on demand.
- **Async**: a daemon (`AddMarten(...).AddAsyncDaemon(DaemonMode.Solo)`) reads events in pages, so readers see the past for a while. Several nodes need another `DaemonMode` (docs
  only).

The types that earn a place (9.x names): `SingleStreamProjection<TDoc, TId>` (one stream to one document, `Create` and `Apply` by convention), `MultiStreamProjection<TDoc, TId>`
(many streams to one document through an `Identity` rule; I grouped deposits per day), `EventProjection` (free-form writes, a `Project` method receiving `IDocumentOperations`) and
`FlatTableProjection` (plain SQL columns that reporting tools can read; it generated `select flat.mt_upsert_account_flat_accountopened(...)` upserts and left `balance=15,
deposits=2`). In 9.x these classes must be `partial` because a source generator emits the dispatch: without it the build fails with `JFXEVT003`. An `EventProjection.Create` that
returned `null` crashed with a `NullReferenceException`; storing conditionally through `ops.Store` worked.

### The lag of an async projection

I appended one event and polled the async document until it showed the new balance, 20 times per variant:

```text
default (SlowPollingTime 1 s):          min=698  median=1002 max=1007 ms
UseListenNotifyForEventAppends = true:  min=6    median=7    max=7    ms
SlowPollingTime = 100 ms:               min=48   median=101  max=107  ms
```

The default is not "a few milliseconds": the daemon wakes on a one-second poll. LISTEN/NOTIFY (channel `mt_events_appended`) cut the median to 7 ms. `mt_event_progression` shows
the machinery: `HighWaterMark` (the highest sequence that is safe to read, because gaps left by rolled-back transactions must not be skipped) and a row per projection
(`AsyncAccountView:All`) with its `last_seq_id`. Lag is the difference.

Async projections fail quietly. My `Apply` threw on a deposit of 13: the daemon did not stop, the event went to `mt_doc_deadletterevent`, and the stream had 3 events while the view
said `balance: 2` (the truth was 15). Skipping apply errors is the `JasperFx.Events` 2.0 default (`SkipApplyErrors`, per the package docs). Alert on dead letters and on lag, or a
broken view serves wrong data for weeks.

### Rebuild: the projection is disposable

`RebuildProjectionAsync` replays every event through a projection. I wrote 100,000 events in 1,000 streams in 1.7 s (60,000 events/s), then:

```text
rebuild #1: 6.2 s   docs=1000 sample balance=99
DeleteWhere<AsyncAccountView>(x => true) -> docs=0
rebuild #2: 6.1 s   docs=1000 sample balance=99
```

About 16,000 events/s, and the table can be emptied and refilled. That is the real value of the log: a new read model or a fixed `Apply` is a rebuild, not a migration. The cost is
time linear in history (a billion events is hours), so run it off peak.

### Snapshots against replay

A 10,000-event stream. The command is `FetchForWriting` + `AppendOne` + `SaveChanges`, 20 runs:

```text
no snapshot:     command 50.0 ms (58.7 in another run)   FetchLatest 17.8 ms (25.1)
Inline snapshot: command  1.4 ms (1.5)                    FetchLatest  0.3 ms (0.3)
```

The inline snapshot keeps the `Account` document current in the same transaction, so a command loads one row plus the tail: about 35 times faster, paid with one extra write, one
more table and one more copy to rebuild when `Apply` changes. Use it for long streams, not by default.

### Events are forever: upcasting and aliases

You never edit an event, you append the next one (a wrong invoice gets a credit note, not an `UPDATE`). A new field is a new version. Release 1 stored `account_opened` without a
currency; release 2 reads old rows through an upcast, with no migration:

```csharp
o.Events.MapEventType<AccountOpenedV2>("account_opened_v2");
o.Events.Upcast<AccountOpened, AccountOpenedV2>("account_opened",
    old => new AccountOpenedV2(old.Owner, old.Initial, "EUR"));   // owner=Ana currency=EUR balance=105
```

The stored JSON is untouched; the transformation runs on read. Renaming the C# type is the other danger. I rewrote `mt_dotnet_type` of a row to a name that no longer exists, to
simulate a rename:

```text
with MapEventType<AccountOpenedWithCurrency>("account_opened_v2"): reads as AccountOpenedWithCurrency
(the alias is the contract with the data, not the class name)
without the alias: UnknownEventTypeException: Unknown event type name alias 'Unable to load event type
  'AccountOpenedV2Old, App'.' ... or set StoreOptions.Projections.Errors.SkipUnknownEvents = true ...
```

### The event store as an outbox

The dual write (save, then publish) can lose the message. [Transactional Outbox, Inbox and Idempotent Consumers](transactional-outbox-inbox-and-idempotent-consumers) fixes it with
a second table in the same transaction. With an event store the events are that table: appended atomically with the state and ordered by `seq_id`. A subscription in the daemon
publishes them:

```csharp
public class FlakyPublisher : SubscriptionBase   // ProcessEventsAsync(EventRange page, ...): publish page.Events, throw if down
o.Events.Subscribe(new FlakyPublisher());       // plus AddAsyncDaemon
```

It threw on the first page: the daemon logged the error and wrote no progress row for `FlakyPublisher:All`; on the next start it received sequences 1 to 3 again, and only then
stored `last_seq_id = 3`. That is at-least-once (progress is saved after success), so the consumer must be idempotent, and the event `id` is a natural message id. Docs only:
`WolverineFx.Marten` wires the same flow to a broker. See [The Transactional Outbox Pattern](/system-design/system-design-concepts/outbox-pattern) and, for the flow across
services, [The Saga Pattern](/system-design/system-design-concepts/saga-pattern).

### Not the same thing, and the alternatives

Event sourcing is a storage choice, CQRS splits the write model from the read model (it works with plain tables:
[CQRS, Mediator and Vertical Slices](cqrs-mediator-and-vertical-slices)), and event-driven is how services talk through messages. They combine well and none implies another.
Alternatives: a hand-made events table with EF Core (you then write the version check, the fold, projections, rebuild and daemon yourself); KurrentDB (formerly EventStoreDB), a
purpose-built event database with its own server (docs only); Axon, on the JVM with its own server (docs only). Marten adds the store, projections, daemon, snapshots and upcasting
over `jsonb`, with ordinary `mt_doc_*` tables and no infrastructure beyond PostgreSQL. [Orleans persistent state](orleans-virtual-actors-grains-and-persistence) is a different bet:
state per actor, not a log. Book vs today: older material builds the read side with a bus and hand-written denormalizers; Marten 9 does it as a library inside your process.

### When not to use it

- Plain CRUD (a catalog admin, a settings screen): the ceremony buys nothing.
- Ad hoc reporting: "events by customer and region" needs a projection first.
- Erasure laws (LGPD, GDPR): immutability fights deletion. Principle only: keep personal data out of events (an id, not a name), or encrypt it per person and delete the key
  (crypto-shredding). Marten has masking rules (`AddMaskingRuleForProtectedInformation`, docs only), and the page I read said crypto-shredding was only under consideration.
- A team without the habit: wrong event names and fat events are permanent.

| Concern | Marten mechanism | Guarantee | Trap |
|---|---|---|---|
| Atomic write | one transaction per `SaveChangesAsync` | all events or none | one aggregate per command |
| Concurrent commands | `FetchForWriting`, unique `(stream_id, version)` | the loser gets `EventStreamUnexpectedMaxEventIdException` | no automatic retry |
| Fresh read | Inline projection, Live aggregate | same transaction | a buggy inline projection rejects the write |
| Cheap read | Async projection plus daemon | eventual, resumable | 1 s default lag, errors skipped to dead letters |
| New read model | `RebuildProjectionAsync` | events are the truth | linear in history (100k in 6 s) |
| Long streams | `Snapshot<T>` | one row plus the tail | one more copy to rebuild |
| Changed event | `Upcast`, `MapEventType` | old rows stay readable | renaming a class without an alias |
| Publish | `Subscribe`, Wolverine | at-least-once, ordered | idempotent consumer needed |

## Trade-offs

- **The history is the benefit and the bill.** Audit and rebuilds are free, storage only grows, and deleting is hard by design (archiving and stream compacting exist, docs only).
- **Eventual consistency reaches the user.** An async view lags up to the poll interval. Read your own write from the aggregate, or use Inline where a screen must not lag.
- **You adopt conventions.** Partial projection classes, event aliases, `mt_*` tables, PostgreSQL only: leaving means migrating the log.

## Documentation Links

- [Event Store, Marten](https://martendb.io/events/) (doc)
- [Appending Events, concurrency and exclusive locks, Marten](https://martendb.io/events/appending.html) (doc)
- [Asynchronous Projections and the daemon, Marten](https://martendb.io/events/projections/async-daemon.html) (doc)
- [Rebuilding Projections, Marten](https://martendb.io/events/projections/rebuilding.html) (doc)
- [Flat Table Projections, Marten](https://martendb.io/events/projections/flat.html) (doc)
- [Event Subscriptions, Marten](https://martendb.io/events/subscriptions.html) (doc)
- [Event Versioning, Marten](https://martendb.io/events/versioning.html) (doc)
- [Marten, GitHub](https://github.com/JasperFx/marten) (doc)
- [Wolverine with Marten event sourcing, Wolverine](https://wolverinefx.net/guide/durability/marten/event-sourcing.html) (doc)
- [Event Sourcing, Martin Fowler](https://martinfowler.com/eaaDev/EventSourcing.html) (doc)
- [Event Sourcing pattern, Azure Architecture Center, Microsoft Learn](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing) (doc)
- [NOTIFY, PostgreSQL documentation](https://www.postgresql.org/docs/current/sql-notify.html) (doc)
- [KurrentDB documentation, Kurrent](https://docs.kurrent.io/getting-started/) (doc)
