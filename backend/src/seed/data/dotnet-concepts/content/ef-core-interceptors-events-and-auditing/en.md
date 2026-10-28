---
version: 1.1
updatedAt: 2026-10-28
---
## Objective

EF Core gives you two ways to run your own code around its work. Interceptors (`SaveChangesInterceptor`, `DbCommandInterceptor`, `DbConnectionInterceptor`, `DbTransactionInterceptor`, `IMaterializationInterceptor`, `IQueryExpressionInterceptor`, `IIdentityResolutionInterceptor`) sit inside the pipeline and can change or suppress the operation. .NET events (`SavingChanges`, `SavedChanges`, `SaveChangesFailed`, `ChangeTracker.Tracked`, `ChangeTracker.StateChanged`) only observe. The logging lesson already counts SQL with a command interceptor, and the domain events lesson dispatches from `SavingChangesAsync`; this one is about the machinery and the audit pattern most teams build with it. I ran every piece: the order in which hooks fire, registration versus DI lifetimes, the sync and async trap, short-circuiting with `InterceptionResult`, an audit interceptor that stamps `CreatedAt`/`UpdatedAt`/`UpdatedBy` and writes audit rows in the same transaction (with the two bugs my first version had), soft delete, what bypasses all of it, a slow-query log and a tenant id for row-level security on PostgreSQL, the events, and the cost of an interceptor over 10 000 queries. Versions used: SDK 10.0.100, `Microsoft.EntityFrameworkCore.Sqlite` 10.0.14 (EF Core 10.0.14), `Npgsql.EntityFrameworkCore.PostgreSQL` 10.0.3 (the major that matches EF Core 10) with Npgsql 10.0.3, against a local PostgreSQL 18.6.

## Use Cases

- Stamping `CreatedAt`, `UpdatedAt` and `UpdatedBy` and writing an audit trail without touching each command handler.
- Turning `Remove` into a soft delete for entities that must never physically disappear.
- Logging every SQL command slower than a threshold, with its text, in production.
- Setting a tenant id on the database session when a connection opens, so PostgreSQL row-level security enforces isolation.

## Deep Dive

### The families and the order their hooks fire

I registered one tracing interceptor per family on a file-based SQLite context, then ran a query, the same query again, and a `SaveChanges` with two inserts (pairs joined with `/` to save space):

```text
-- query
QueryExpression.QueryCompilationStarting
Connection.ConnectionOpening / ConnectionOpened
Command.CommandCreating (LinqQuery) / CommandInitialized / ReaderExecuting / ReaderExecuted
Materialization.CreatingInstance (Product) / CreatedInstance / InitializingInstance / InitializedInstance
Command.DataReaderClosing / DataReaderDisposing, Connection.ConnectionClosing / ConnectionClosed
-- same query again: identical, without the QueryExpression line
-- SaveChanges with two inserts
SaveChanges.SavingChanges, Connection.ConnectionOpening / ConnectionOpened, Transaction.TransactionStarting
Command.CommandCreating (SaveChanges) / ... / DataReaderDisposing   (same six hooks, twice)
Transaction.TransactionCommitting / TransactionCommitted, Connection.ConnectionClosing / ConnectionClosed
SaveChanges.SavedChanges (result=2)
```

The query expression hook is called `QueryCompilationStarting` and fired only once: the second run hit the compiled-query cache, so an expression rewrite there runs once per query shape, not per execution. A `SaveChanges` with a single `UPDATE` produced no transaction hooks at all, since EF Core did not open a transaction for one command. `CommandEventData.CommandSource` (`LinqQuery`, `SaveChanges`, `FromSqlQuery`, ...) is the cheap way to filter. The docs mark `IMaterializationInterceptor`, `IQueryExpressionInterceptor` and `IIdentityResolutionInterceptor` as singleton interceptors. The last one decides what happens when you attach an instance whose key is already tracked. Attaching `Product { Id = 1, Price = 99 }` over a tracked `Price` 1 threw `InvalidOperationException: The instance of entity type 'Product' cannot be tracked because another instance with the same key value for {'Id'} is already being tracked` without one; with the built-in `IgnoringIdentityResolutionInterceptor` the tracked instance kept `Price=1.0` (`Unchanged`), and with `UpdatingIdentityResolutionInterceptor` it became `Price=99` (`Modified`).

### Registration and lifetimes

`AddInterceptors` takes instances, in `OnConfiguring` or inside `AddDbContext`; the docs say interceptors "are registered per DbContext instance when the context is configured". With `AddDbContext` the options action ran once per scope, so I could resolve the interceptor from the scope. I registered one that takes a scoped `ICurrentUser` in three ways and opened two scopes each:

```csharp
s.AddScoped<ICurrentUser, CurrentUser>();
s.AddScoped<UserStamp>();   // then AddSingleton<UserStamp>(), then AddDbContextPool
s.AddDbContext<Shop>((sp, o) => o.UseSqlite(cs).AddInterceptors(sp.GetRequiredService<UserStamp>()));
```

```text
scoped:                 scope 0 sees user-1 (scope has user-1), scope 1 sees user-2 (scope has user-2)
singleton, validation:  InvalidOperationException: Cannot consume scoped service 'ICurrentUser' from singleton 'UserStamp'.
singleton, no valid.:   scope 0 sees user-3 (scope has user-4), scope 1 sees user-3 (scope has user-5)
pool, validation:       InvalidOperationException: Cannot resolve scoped service 'UserStamp' from root provider.
```

Without scope validation the singleton captured the first user forever, so every later request would be audited as `user-3`. With `AddDbContextPool` the options come from the root provider, so per-request data must come from a singleton accessor (for example one backed by `AsyncLocal`, like `IHttpContextAccessor`), not from a constructor. For the singleton families the docs warn that a new instance per configuration "will eventually trigger a `ManyServiceProvidersCreatedWarning`". I built 30 contexts with a `new` interceptor each. A command interceptor was fine; a materialization interceptor threw, because EF Core 10 raises that warning as an exception by default: `InvalidOperationException: An error was generated for warning '...ManyServiceProvidersCreatedWarning': More than twenty 'IServiceProvider' instances have been created for internal use by Entity Framework.`

### Sync and async are separate hooks

One interceptor overrode only `SavingChangesAsync`, another only `SavingChanges`; I called each API once:

```text
after SaveChanges():      asyncOnly=0 syncOnly=1
after SaveChangesAsync(): asyncOnly=1 syncOnly=1
```

Neither base method forwards to the other, so an audit written only for the async path silently skips every `SaveChanges()`, which is what a seeding script or an old test calls. The docs: "Overriding both sync and async methods ensures that auditing will happen regardless of whether `SaveChanges` or `SaveChangesAsync` are called"; they also suggest throwing from the sync method to force async.

### Short-circuiting with InterceptionResult

Every "-ing" hook receives an `InterceptionResult` and returns one. Returning it unchanged lets EF Core continue, `SuppressWithResult(...)` skips the operation and hands EF Core your value, and `HasResult` tells a later interceptor that an earlier one already did. I cached a query tagged `cache`, put an observer after it, renamed the row between two runs, and traced the SQLite engine itself with `sqlite3_trace`:

```csharp
public override InterceptionResult<DbDataReader> ReaderExecuting(DbCommand c, CommandEventData e, InterceptionResult<DbDataReader> r)
    => c.CommandText.StartsWith("-- cache") && _cached is not null
        ? InterceptionResult<DbDataReader>.SuppressWithResult(_cached.CreateDataReader())   // DataTable filled in ReaderExecuted
        : r;
```

```text
query 1:  [observer] HasResult=False
          [sqlite engine] -- cache  SELECT "p"."Name" FROM "Products" AS "p" WHERE NOT ("p"."IsDeleted")
          [log] Executed DbCommand (3ms) [Parameters=[], CommandType='Text', CommandTimeout='30']
          -> [kb]
          [sqlite engine] UPDATE Products SET Name = 'renamed'
query 2:  [cache] hit, suppressing the command
          [observer] HasResult=True
          [log] Executed DbCommand (0ms) [Parameters=[], CommandType='Text', CommandTimeout='30']
          -> [kb]
```

The engine never saw the second SELECT and the stale name came back. EF Core still logged `Executed DbCommand (0ms)` for the suppressed command, so the EF log alone does not prove a statement reached the database. My first version cached whole `Product` rows and failed with `InvalidCastException: Unable to cast object of type 'System.Int64' to type 'System.Int32'`: SQLite returns `INTEGER` as `Int64` and the shaper calls `GetInt32` on the replacement reader. The docs warn EF Core "may behave in unexpected ways if it gets an abnormal result". The same works one level up: `InterceptionResult<int>.SuppressWithResult(0)` from `SavingChanges` made `SaveChanges()` return 0, wrote nothing and left the entity `Added`. A `NonQueryExecuting` guard that suppresses a `DELETE` without `WHERE` made `IgnoreQueryFilters().ExecuteDelete()` return -1 with the row still there.

### An audit interceptor in the same transaction

In `SavingChanges`, walk `ChangeTracker.Entries()`, stamp the columns, and add `AuditLog` entities to the same context; the same `SaveChanges` inserts them, so they commit or roll back with the business change.

```csharp
void Stamp(DbContext db)   // called from SavingChanges AND SavingChangesAsync
{   var now = clock.GetUtcNow().UtcDateTime; var logs = new List<AuditLog>();
    foreach (var entry in db.ChangeTracker.Entries().Where(x => x.Entity is not AuditLog))   // Entries() runs DetectChanges
    {   if (entry.Entity is IAudited && entry.State == EntityState.Added) entry.Property("CreatedAt").CurrentValue = now;
        if (entry.Entity is IAudited && entry.State == EntityState.Modified)
        { entry.Property("UpdatedAt").CurrentValue = now; entry.Property("UpdatedBy").CurrentValue = user.Name; }
        if (entry.State is EntityState.Added or EntityState.Modified or EntityState.Deleted)
            logs.Add(ToAudit(entry, user.Name, now)); }   // table, action, key, "Prop:old->new"
    db.Set<AuditLog>().AddRange(logs); }
```

```text
audit #1 Added Products key=-2147482647 (temporary) by=ana [CreatedAt=10/28/2026 12:00:00 PM, ..., Name=mouse, Price=10, ...]
audit #2 Added Products key=-2147482646 (temporary) by=ana [..., Name=pad, Price=5, ...]
row: CreatedAt=12:00 UpdatedAt=12:05 UpdatedBy=ana
audit #3 Modified Products key=1 by=ana [Price:10.0->12, UpdatedAt:->10/28/2026 12:05:00 PM, UpdatedBy:->ana]
```

The key of an inserted row is still temporary (`-2147482647`) in `SavingChanges`, because the database has not generated it. Use client-generated keys (`Guid.CreateVersion7()`) or fill it in `SavedChanges`, which then needs a second save after the commit. My first version also set the stamps through the entity (`a.UpdatedAt = now`): they were saved, because `SaveChanges` runs `DetectChanges` after the interceptor, but audit #3 listed only `Price`. `entry.Property(...).CurrentValue` marks them modified at once.

### Failures, retries, and what bypasses the interceptor

I made `SaveChanges` fail with a duplicate `Name` (unique index) while it also carried a valid price change:

```text
DbUpdateException: SQLite Error 19: 'UNIQUE constraint failed: Products.Name'.
audit rows before=3 after=3, pad price in db=5.0, SaveChangesFailed calls=1
AuditLog entities still tracked as Added: 2
after fixing the name and saving again: audit rows=7
```

The rollback worked, but the two `AuditLog` entities stayed tracked and the retry wrote them plus two new ones: four rows for two changes, one describing an insert that never happened. Detaching them in `SaveChangesFailed` and `SaveChangesFailedAsync` (`foreach (var a in e.Context!.ChangeTracker.Entries<AuditLog>().Where(x => x.State == EntityState.Added).ToList()) a.State = EntityState.Detached;`) fixed it: the same retry wrote 2 rows. The docs add that a concurrency conflict calls `ThrowingConcurrencyException` and cancellation calls `SaveChangesCanceled` instead of `SaveChangesFailed`. Then I went around `SaveChanges` on the same context with `ExecuteUpdate` on `pad`, `ExecuteSql($"UPDATE Products SET Price = 8 ...")` and `ExecuteDelete` on `mouse-2`. The run printed `interceptor calls +0, audit rows +0, pad.Price=7.0 pad.UpdatedAt=12:05 (unchanged)` and `mouse-2 rows incl. filtered: 0`. The docs call `ExecuteUpdate`/`ExecuteDelete` "completely unaware of EF's change tracker", and the consequence is real: no stamp, no audit row, and a physical delete of a row the soft-delete rule below would have kept. A command interceptor still sees these statements; a `SaveChangesInterceptor` does not.

### Soft delete, and how it splits with the query filter

In the same loop, a `Deleted` entry that implements `ISoftDelete` becomes an update of two columns:

```csharp
if (entry.State == EntityState.Deleted && entry.Entity is ISoftDelete)
{   entry.State = EntityState.Unchanged;                 // cancel the DELETE
    entry.Property("IsDeleted").CurrentValue = true;     // only these two become Modified
    entry.Property("DeletedAt").CurrentValue = now; }
```

```text
[sql] UPDATE "Products" SET "DeletedAt" = @p0, "IsDeleted" = @p1 WHERE "Id" = @p2 RETURNING 1;
state after SaveChanges: Unchanged, IsDeleted=True
default query: [pad]  IgnoreQueryFilters: [mouse,pad]
```

My first version set `entry.State = EntityState.Modified`, which marks every property modified: the `UPDATE` rewrote all seven columns. The interceptor owns the write side; the global query filter (`HasQueryFilter(p => !p.IsDeleted)`, its own lesson) owns the read side. Neither covers `ExecuteDelete` or raw SQL.

### A slow-query log on PostgreSQL

EF Core measures `CommandExecutedEventData.Duration`, so a slow-query log is one comparison in the "-ed" hooks (I overrode `ReaderExecuted` and `ReaderExecutedAsync`, printing to the console; `NonQueryExecuted` and `ScalarExecuted` need the same check to cover `ExecuteUpdate` and scalars), plus `CommandFailed` for errors. With a 200 ms threshold I ran `SELECT 1`, then `pg_sleep(0.3)`, then a division by zero:

```csharp
if (e.Duration > threshold) logger.LogWarning("{Ms} ms ({Source}): {Sql}", e.Duration.TotalMilliseconds, e.CommandSource, c.CommandText);
```

```text
fast query done (nothing logged above)
  [slow] 303 ms (FromSqlQuery): SELECT 1 AS "Value" FROM pg_sleep(0.3)
  [failed] after 2 ms: 22012: division by zero
  caller got PostgresException
```

### Tenant context on the connection

A `DbConnectionInterceptor` can run SQL right after the connection opens. I set a setting that a row-level security policy reads, and connected as a role that does not own the table (the PostgreSQL docs say owners and superusers bypass RLS):

```csharp
public override async Task ConnectionOpenedAsync(DbConnection c, ConnectionEndEventData e, CancellationToken ct = default)
{   await using var cmd = c.CreateCommand();
    cmd.CommandText = "SELECT set_config('app.tenant_id', @t, false)";
    cmd.Parameters.Add(new NpgsqlParameter("t", tenantId.ToString()));
    await cmd.ExecuteNonQueryAsync(ct); }   // and the same in the sync ConnectionOpened
// policy: USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::int), same WITH CHECK
```

```text
no interceptor: []
tenant 1:       [t1-a,t1-b]
tenant 2:       [t2-a]
tenant 1 inserts tenant 2 row: 42501: new row violates row-level security policy for table "orders"
next pooled context without interceptor: app.tenant_id='', rows=[]
next pooled context without interceptor;No Reset On Close=true: app.tenant_id='1', rows=[t1-a,t1-b]
```

The `nullif` exists because my first policy failed with `22P02: invalid input syntax for type integer: ""`: after Npgsql reset a pooled connection, the setting came back as an empty string, not NULL. With the default reset the next borrower saw nothing; with `No Reset On Close=true` a context without the interceptor read tenant 1's rows. Set the value on every open and never rely on the previous one. The PostgreSQL docs say `set_config(..., true)` limits the value to the current transaction.

### .NET events instead of an interceptor

I subscribed to all five events next to a `SaveChangesInterceptor` (`db.SavingChanges += ...`, `db.ChangeTracker.StateChanged += ...`, and so on), then loaded, modified and saved, and finally made a save fail:

```text
-- query + modify + save                       -- failing save
event Tracked Product FromQuery=True ...       event Tracked Product FromQuery=False state=Added
event SavingChanges acceptAll=True             event SavingChanges acceptAll=True
SaveChanges.SavingChanges   (interceptor)      SaveChanges.SavingChanges   (interceptor)
event StateChanged Unchanged->Modified         event SaveChangesFailed DbUpdateException
event StateChanged Modified->Unchanged
SaveChanges.SavedChanges (result=1)
event SavedChanges count=1
```

The event fires just before the interceptor on the way in and just after it on the way out, and `Unchanged->Modified` appeared only after the interceptor, which is the `DetectChanges` that `SaveChanges` runs at that point. The event args (`AcceptAllChangesOnSuccess`, `EntitiesSavedCount`, `Exception`) have no result to replace, so an event cannot suppress or alter anything, and the docs note events are sync only. Events are enough for stamping or notifications on a context you build yourself; an interceptor is needed to suppress, replace results, do async I/O, see commands and connections, or come from DI for every context.

### What an interceptor costs

I ran 10 000 single-row queries on in-memory SQLite (Release, 7 rounds, median) with no interceptor, with one whose `ReaderExecuting` just returns `result`, and with an empty subclass of `DbCommandInterceptor`:

```text
none            median 106 ms (min 104, max 290) = 10.6 us/query
empty override  median 114 ms (min 112, max 327) = 11.4 us/query
no override     median 117 ms (min 113, max 317) = 11.7 us/query
```

A second run gave 107, 114 and 114 ms. Registering any command interceptor added about 0.7 to 1 microsecond per query, overridden or not: roughly 7% of a query that does almost nothing, and noise next to a network round trip. What you put inside the hook is what costs.

### Interceptor, event, SaveChanges override or trigger

| | Interceptor | .NET event | Override `SaveChanges` | Database trigger |
|---|---|---|---|---|
| Suppress or change the result | Yes | No | Yes | Yes, in SQL |
| Async I/O | Yes, separate async hooks | No | Yes, in `SaveChangesAsync` | Not applicable |
| Sees commands and connections | Yes | No | No | Not applicable |
| Applied to every context from DI | Yes | Wired per instance | Via a base class | Per table |
| Sees `ExecuteUpdate`, `ExecuteDelete`, raw SQL | Command level only | No | No | Yes |
| Knows the application user | Yes | Yes | Yes | Only via session context |

I checked the trigger column on the bulk paths: an SQLite `AFTER UPDATE` trigger wrote a row for both `ExecuteUpdate` and raw SQL (`Price 1.0->2.0`, `Price 2.0->3`), each with `user=<null>`, since the trigger cannot know the application user unless you push it into the session as in the tenant example.

## Trade-offs

- **The audit is only as complete as the write path.** `ExecuteUpdate`, `ExecuteDelete`, raw SQL and other applications skip a `SaveChangesInterceptor`. If the audit is a compliance requirement, a trigger (alone or in addition) is the honest answer.
- **Same-transaction audit couples failures.** An exception while building audit rows fails the business save. That is usually right for audit, but keep network calls out of the interceptor.
- **Override both hooks, every time.** Sync and async never forward to each other, and a test suite that calls only one passes either way. If you want async only, make the sync hook throw instead of leaving it empty.
- **Lifetimes fail silently.** A singleton interceptor with a scoped dependency audits every request as the first user when scope validation is off. With `AddDbContextPool`, read per-request data from an accessor.
- **Suppression hides from the log.** A suppressed command is still logged as `Executed DbCommand (0ms)`, and a replacement reader must return the exact CLR types. Keep such interceptors rare and documented.
- **Session state and pooling.** A tenant id set on a connection must be set on every open; turning off the pool reset leaked tenant 1's rows to the next context in my run.
- **Small cost, every operation.** About 1 microsecond per query for the dispatch; a hook that allocates, logs or does I/O multiplies that by every command.

## Documentation Links

- [Interceptors, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/logging-events-diagnostics/interceptors) (doc)
- [.NET events in EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/logging-events-diagnostics/events) (doc)
- [Change detection and notifications, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/change-tracking/change-detection) (doc)
- [SaveChangesInterceptor class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.entityframeworkcore.diagnostics.savechangesinterceptor?view=efcore-10.0) (doc)
- [ExecuteUpdate and ExecuteDelete, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/saving/execute-insert-update-delete) (doc)
- [Row Security Policies, PostgreSQL documentation](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) (doc)
