---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

Orleans is the .NET framework for virtual actors (the model of the 2014 Microsoft
Research paper): you write a class (a grain) that owns some state and handles one
request at a time, address it by a key, and the runtime decides where it lives,
creates it on the first call, removes it when idle and recreates it elsewhere if
its server dies. You never create, locate or destroy a grain, and you never write
a lock. This lesson measures it on one machine without Docker, up to a 2-silo
cluster where one silo is killed with `kill -9`. Versions: `Microsoft.Orleans.Server`,
`.Client`, `.Persistence.AdoNet` and `.Reminders.AdoNet` 10.4.2 (stable,
2026-10-30, `net10.0`), `Npgsql` 10.0.3, PostgreSQL 18 started locally with
`initdb`, `net10.0`, SDK 10.0.100.

## Use Cases

- One object per entity with state and a stream of commands: a game session, a
  shopping cart, a device twin, a chat room.
- Replacing "load, change, save, hope nobody else did" with one owner per key, and
  per-entity schedules that survive restarts (close an unpaid order in 30 minutes).

## Deep Dive

### Grain, silo and the host

A grain is an interface plus a class, a silo is a host process running the
runtime, and `IGrainFactory` hands out references by key. A reference is a proxy:
getting one calls nothing and creates nothing.

```csharp
[Alias("IHello")] public interface IHelloGrain : IGrainWithStringKey { [Alias("Hi")] Task<string> Hi(); }
public class HelloGrain : Grain, IHelloGrain   // OnActivateAsync/OnDeactivateAsync log ACTIVATE/DEACTIVATE
{
    int _calls;                                   // plain field, no lock
    public Task<string> Hi() => Task.FromResult($"hello from '{this.GetPrimaryKeyString()}', call #{++_calls}");
}

var b = Host.CreateApplicationBuilder();
b.UseOrleans(s => s.UseLocalhostClustering(siloPort: 5961, gatewayPort: 5962)
    .Configure<GrainCollectionOptions>(o => { o.CollectionAge = TimeSpan.FromSeconds(3); o.CollectionQuantum = TimeSpan.FromSeconds(1); }));
using var host = b.Build(); await host.StartAsync();   // IGrainFactory gf from host.Services: gf.GetGrain<IHelloGrain>("ana").Hi()
```

`UseLocalhostClustering` is the development clustering; `[Alias]` keeps wire names stable.

### Identity and activation on demand

The key is the identity: `IGrainWithStringKey`, `IGrainWithGuidKey`,
`IGrainWithIntegerKey`, or a compound `Guid` or `long` plus a string (all
measured). Calling `ana` twice, `bob`, idling 6 s with `CollectionAge` 3 s, `ana`:

```text
[  0.0s]   ACTIVATE   HelloGrain 'ana' ... call #1, call #2
[  0.0s]   ACTIVATE   HelloGrain 'bob'
[  3.9s]   DEACTIVATE HelloGrain 'ana' after 2 calls, reason: ActivationIdle
[  3.9s]   DEACTIVATE HelloGrain 'bob' after 1 calls, reason: ActivationIdle
[  6.0s]   ACTIVATE   HelloGrain 'ana' ... call #1
```

The activation appears on the first call, never on `GetGrain`. After the idle
collection `ana` came back with `call #1`: only the activation was removed, not
the grain, so fields are gone. The grain "always exists" for the caller, which is
what makes it virtual; what must survive needs persistence. Measured defaults:
`CollectionAge` 15 minutes, `CollectionQuantum` 1 minute (both lowered here).

### Turns: no race, no lock

Each activation runs one turn at a time. 100,000 `Inc()` calls fired together at
one grain, against the same loop on a plain shared `int`:

```text
grain Inc():          100000 of 100000 in 678 ms
grain IncSlow():       10000 of 10000 (read, await, write)
[Reentrant] IncSlow:       2 of 10000 (read, await, write)
shared int, Task.Run:  35922 of 100000 (no grain, no lock)
```

`IncSlow` is `var v = _n; await Task.Yield(); _n = v + 1;`, a lost update across
an `await`. It stays exact in a normal grain because the next request starts only
when the current one finishes, awaits included. `[Reentrant]` lets requests run
at the `await` (one thread, interleaved) and the result collapsed to 2. The
shared `int` lost about two thirds, a different number every run.

### Reentrancy and the A to B to A deadlock

Not being reentrant has a cost: A calls B, B calls back A, and A is still waiting
for B, so the new request never starts. The second run wraps A's call in
`using (RequestContext.AllowCallChainReentrancy())`.

```text
after 3.9s: TimeoutException: Response did not arrive on time in 00:00:03 for message: Request [...]->[... ping/A] IPingGrain[(IPingGrain)PingGrain].StartChain(...)
AllowCallChainReentrancy(), after 2 ms: A2 got: B2 got: pong from A2
```

There is no deadlock detector: the call waits for `SiloMessagingOptions.ResponseTimeout`
(30 seconds by default, 3 here) and fails with `TimeoutException`. Call-chain
reentrancy re-admits only calls of the same chain, so the cycle resolves in 2 ms
without making the grain reentrant (`[AlwaysInterleave]`, `[ReadOnly]`: docs only).

### Persistence with IPersistentState

State is a class with `[GenerateSerializer]` and `[Id(n)]` members, injected as
`IPersistentState<T>` and saved only when you call `WriteStateAsync()`:

```csharp
public class CartGrain([PersistentState("cart", "store")] IPersistentState<CartState> cart) : Grain, ICartGrain
{
    public async Task<string> Add(string item, bool save)
    {   // OnActivateAsync logs cart.RecordExists, cart.State.Items.Count, cart.Etag
        cart.State.Items.Add(item);
        if (save) { cart.State.Writes++; await cart.WriteStateAsync(); }
        return Show();
    }
}
// silo: s.AddMemoryGrainStorage("store");   or
//       s.AddAdoNetGrainStorage("store", o => { o.Invariant = "Npgsql"; o.ConnectionString = pg; });
```

One process adds `apple` and saves, a new process reads, for memory and for
PostgreSQL (the `OrleansQuery` and `OrleansStorage` scripts from the Orleans
repository, run once). A second PostgreSQL run adds `pear` without saving:

```text
memory  run 1: after add: [apple] writes=1 etag=7c28f1c17cb542e89e602627e95d08b1
memory  run 2: RecordExists=False, items=0, etag=null
adonet  run 1: after add: [apple] writes=1 etag=1
adonet  run 2: RecordExists=True, items=1, etag=1 ; after add: [apple,pear] writes=1 etag=1 (no WriteStateAsync)
adonet  run 3: RecordExists=True, items=1 ; [apple] writes=1
```

Memory storage loses everything on a restart. PostgreSQL kept the state, and
`pear` was lost because nobody called `WriteStateAsync`: changing `State` is not
saving it. `Etag` is the row version (a stale write faults with
`InconsistentStateException`, docs only). The ADO.NET provider ships no SQLite
script (SQL Server, MySQL, PostgreSQL, Oracle), so PostgreSQL was the local storage.

### Timers against reminders

A grain timer lives in the activation; a reminder is a row in a table.

```csharp
this.RegisterGrainTimer(() => { Log($"timer tick {++_ticks}"); return Task.CompletedTask; },
    new GrainTimerCreationOptions { DueTime = TimeSpan.FromSeconds(1), Period = TimeSpan.FromSeconds(1), KeepAlive = false });
await this.RegisterOrUpdateReminder("wake-up", TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(8));  // + IRemindable.ReceiveReminder
```

Both registered, `CollectionAge` 3 seconds, reminders in PostgreSQL:

```text
[  2.0s]   timer tick 2 ; REMINDER 'wake-up' fired (this activation had 2 timer ticks)
[  7.0s]   timer tick 7
[  7.8s]   DEACTIVATE ClockGrain (ActivationIdle)
[ 10.0s]   ACTIVATE   ClockGrain
[ 10.0s]   REMINDER 'wake-up' fired (this activation had 0 timer ticks)
```

The timer ticked for 7 seconds without blocking idle collection (`KeepAlive`
false is the default; with `true` it ticked to the end of the run). After the
deactivation the timer was gone and the reminder activated the grain again with
zero ticks. The reminder is durable: a new silo that received no grain call
activated the grain and fired it 1.1 seconds after starting, while
`UseInMemoryReminderService` fired nothing after a restart. Periods below
`ReminderOptions.MinimumReminderPeriod` (1 minute by default, 1 second here) are
rejected: reminders are for coarse schedules.

### StatelessWorker, placement and a 2-silo cluster

`[StatelessWorker]` turns one key into a pool of interchangeable activations,
local to each silo, that grows while the existing ones are busy:

```text
StatelessWorker: 10 concurrent calls (200 ms each) to key 1 -> 10 activations, 230 ms (cores: 14)
normal grain:    10 concurrent calls (200 ms each) to key 1 -> 1 activation, 2010 ms
```

The cap per silo is the core count, and the activations are not individually
addressable (caches, validators, stateless entry points). For placement, silos
`5963` (gateway `5964`) and `5965` (gateway `5966`, primary `5963`) are two
processes sharing PostgreSQL, and a client connects to both gateways. 40 grains
per strategy (a class attribute):

```text
default (resource-opt.) silo 5963: 18 grains  silo 5965: 22 grains
[RandomPlacement]       silo 5963: 20 grains  silo 5965: 20 grains
PreferLocal             silo 5963: 20 grains  silo 5965: 20 grains
HashBased               silo 5963: 29 grains  silo 5965: 11 grains
ActivationCountBased    silo 5963: 20 grains  silo 5965: 20 grains
```

`PreferLocal` means the silo that received the call, and the client rotated
gateways. `HashBased` gave 29 to 11 in every run: it is a function of the key. The
no-attribute default has been resource-optimized (CPU and memory aware) since
Orleans 9.2, not random, and its split varied between runs.

Failover: ten carts saved to PostgreSQL, silos restarted, cart `c3` on `5965`, a
client calling it every 500 ms while `kill -9` hit the `5965` process:

```text
[  0.0s] c3 -> [apple] writes=1 silo=5965
[  5.0s] c3 -> OrleansMessageRejectionException: Exception while sending message: Orleans.Runtime.Messaging.ConnectionFailedException: Unable to conn...
[  5.5s] c3 -> [apple] writes=1 silo=5963
```

One call failed with a connection error; the next, 0.5 seconds later, was served
by the surviving silo, which activated `c3` and read its state from PostgreSQL.
The caller never knew an address: the grain "always exists". The client must
retry that failed call, Orleans does not. With memory storage the item also
survived, probably because that provider keeps data in storage grains of the
cluster (`NumStorageGrains`) and the killed silo did not hold that one: not
durability. Failure detection was faster than the defaults (1 s probe, 2 missed
probes, 1 vote; defaults 5 s, 3, 2). With `UseLocalhostClustering` the primary is
the membership table, so I killed the secondary; production uses a real table
(ADO.NET, Azure, Redis, Kubernetes), docs only.

### What "one activation" really guarantees

The docs say at most one activation exists at any time, yet the default
in-cluster directory is eventually consistent and "allows occasional duplicate
activations during cluster instability". The strongly consistent one
(`AddDistributedGrainDirectory`, preview for Orleans 10 in the docs, present in
10.4.2) prevents them at the cost of coordination; the docs disagree on which one
is the default. I did not measure duplicates: assume the default can produce
them, and that a silo declared dead runs until it reads its own status.

## Trade-offs

- **Orleans vs a stateless HTTP service with a database.** The service scales out
  trivially, but every update is read, change, write with a lock or an optimistic
  retry. Orleans gives one owner per key and in-memory state, at the price of a
  runtime, a membership table and a new mental model. Hot, small, chatty entities
  fit; reports over the whole dataset do not.
- **Orleans vs Akka.NET vs Dapr actors.** Akka.NET (not run here) is explicit: you
  create and supervise actors, more control and more code. Orleans hides the
  lifecycle. Dapr actors give the same idea through a sidecar, from any language,
  with extra hops (not measured). Orleans is in-process .NET with typed calls.
- **When not to use it.** CRUD with no contention, batch analytics, queries across
  entities (a grain has no secondary index), a team that will not operate a
  cluster, or one instance that fits a process (a `ConcurrentDictionary`).
- **Consistency is weaker than "one writer" sounds.** Duplicates are possible
  during instability, a failed call may or may not have run, and a blocked grain
  (`.Result`) stalls its key: make commands idempotent. Cross-grain atomicity
  needs Orleans transactions or a saga (docs only).
- **State and timers.** `State` changed without `WriteStateAsync` is lost on
  deactivation, and it is read in full on every activation, so keep it small. A
  timer dies with the activation; a reminder survives but costs a table row and a
  minimum period of 1 minute by default.

## Documentation Links

- [Request scheduling and reentrancy, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/orleans/grains/request-scheduling) (doc)
- [Grain persistence, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/orleans/grains/grain-persistence/) (doc)
- [Timers and reminders, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/orleans/grains/timers-and-reminders) (doc)
- [Grain placement, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/orleans/grains/grain-placement) (doc)
- [Grain directory, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/orleans/host/grain-directory) (doc)
- [Cluster management, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/orleans/implementation/cluster-management) (doc)
- [Orleans repository and releases, GitHub](https://github.com/dotnet/orleans) (doc)
- [Orleans: Distributed Virtual Actors for Programmability and Scalability, Bernstein et al., Microsoft Research 2014](https://www.microsoft.com/en-us/research/publication/orleans-distributed-virtual-actors-for-programmability-and-scalability/) (paper)
