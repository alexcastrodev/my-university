---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

EF Core writes the SQL for you, so the first debugging question is always the
same: what did it actually send, how many times, and from which line of my
code? This concept covers the tools that answer it: `ToQueryString` for one
query, `LogTo` and `ILogger` for live traffic, query tags to connect a SQL
statement back to its LINQ query, and interceptors when you want to count or
change commands in code. It also explains the two switches that change what
the log contains, `EnableSensitiveDataLogging` and `EnableDetailedErrors`,
because they are the difference between a useful log and a leak. The habit of
reading the SQL starts in the related-data concept (N+1 and `ToQueryString`);
this one is the full toolbox.

## Use Cases

- Checking the `WHERE` and `JOIN` of a query before it ever runs.
- Finding which of several similar queries is the slow one in a production log.
- Failing a test when an endpoint starts issuing more commands than before.
- Turning a vague "the data is NULL" exception into one that names the property.
- Adding timing or an audit comment to every command without touching each query.

## Deep Dive

All snippets below ran on EF Core 10.0.13 with the SQLite provider
(`Microsoft.EntityFrameworkCore.Sqlite`). The shape of the logs is the same on
other relational providers, but the SQL text and parameter types are not.

### ToQueryString: one query, no execution

`ToQueryString()` is an extension on `IQueryable`, so it works on a query you
have composed but not enumerated. It never touches the database, which makes it
the cheapest tool in this list. It prints parameters as a `.param set` header
(that is the SQLite flavour; the provider decides the format) followed by the
SQL:

```csharp
var min = 20.0;
var q = db.Products.Where(p => p.Price > min).OrderBy(p => p.Name);
Console.WriteLine(q.ToQueryString());
// .param set @min 20.0
//
// SELECT "p"."Id", "p"."Name", "p"."Price"
// FROM "Products" AS "p"
// WHERE "p"."Price" > @min
// ORDER BY "p"."Name"
```

It only exists on a query that is still an `IQueryable`. `First`, `Count`,
`ToList` and friends execute immediately and return a value, so there is
nothing left to print. Note that the output includes the parameter value, so
treat it like sensitive data (see the trade-offs).

### Simple logging with LogTo

`LogTo` takes any `Action<string>` and needs no extra package, which is why it
is the right default while developing. You can filter by minimum level, by
event ids, by category, or with a custom `(EventId, LogLevel)` predicate.
Filtering at that point is cheaper than filtering in your delegate, because a
message that is filtered out is never even built.

```csharp
options.LogTo(Console.WriteLine,
    [RelationalEventId.CommandExecuted],   // id 20101
    LogLevel.Information,
    DbContextLoggerOptions.None);
// Executed DbCommand (0ms) [Parameters=[@min='?' (DbType = Double)], CommandType='Text', CommandTimeout='30']
// SELECT "p"."Id", "p"."Name", "p"."Price"
// FROM "Products" AS "p"
// WHERE "p"."Price" > @min
```

The ids live in `CoreEventId`, `RelationalEventId` and, per provider, classes
such as `SqlServerEventId`. `RelationalEventId.CommandExecuting` is 20100,
`CommandExecuted` is 20101 and `CommandError` is 20102 (printed by running
`.Id`). `CommandExecuted` carries the elapsed time, `CommandExecuting` does
not, and the error event is how a failing command shows up:

```csharp
db.Products.FromSql($"SELECT * FROM NoSuchTable").ToList();
// Failed executing DbCommand (0ms) [Parameters=[], CommandType='Text', CommandTimeout='30']
// SELECT * FROM NoSuchTable
// SqliteException: SQLite Error 1: 'no such table: NoSuchTable'.
```

### Sensitive data and detailed errors

Look again at `@min='?'` in the log above. By default EF Core hides parameter
values, because they are user data. `EnableSensitiveDataLogging()` shows them:

```csharp
options.LogTo(...).EnableSensitiveDataLogging();
// Executed DbCommand (0ms) [Parameters=[@min='20'], ...]
// and on SaveChanges: [Parameters=[@p0='Secret-name' (Nullable = false) (Size = 11), @p1='5'], ...]
```

That is exactly why it must stay a development switch: the insert above wrote a
customer-supplied string into the log. It also adds values to exception
messages, such as key values in a concurrency error.

`EnableDetailedErrors()` solves a different problem. For speed, EF Core does
not wrap each value read in a try-catch, so a NULL where the model says
non-null fails with a generic provider message. With the switch on, EF adds the
catch and names the property. Same query, same data, two messages:

```csharp
// default : The data is NULL at ordinal 1. This method can't be called on NULL values. Check using IsDBNull before calling.
// detailed: An error occurred while reading a database value for property 'Product.Name'.
//           The expected type was 'System.String' but the actual value was 'null'.
```

### Categories, levels and ILogger

In an ASP.NET Core app the usual route is `Microsoft.Extensions.Logging`, which
EF Core uses when the context is built through the service provider. Every
message has a hierarchical category, and the one that carries SQL is
`Microsoft.EntityFrameworkCore.Database.Command` (`DbLoggerCategory.Database.Command.Name`
in code). Because categories are a tree, a filter on `...Database` covers
`.Connection`, `.Command` and `.Transaction`. In `appsettings.json`:

```json
{ "Logging": { "LogLevel": {
    "Microsoft.EntityFrameworkCore": "Warning",
    "Microsoft.EntityFrameworkCore.Database.Command": "Information" } } }
```

The same thing in code, with a plain `LoggerFactory`, printed one SQL line:

```csharp
var lf = LoggerFactory.Create(b => b
    .AddSimpleConsole(o => o.SingleLine = true)
    .SetMinimumLevel(LogLevel.Warning)
    .AddFilter("Microsoft.EntityFrameworkCore.Database.Command", LogLevel.Information));
// info: Microsoft.EntityFrameworkCore.Database.Command[20101] Executed DbCommand (0ms) [...] SELECT COUNT(*) FROM "Products" AS "p"
```

This keeps command logging on and everything else quiet, which is the setup
you want when you chase slow queries. `ConfigureWarnings` is the companion: it
can lower, raise, ignore or throw on a specific event, for example turning the
warning for several collection includes into an exception.

### Query tags

A log full of `SELECT ... FROM "Products"` does not tell you which controller
issued it. `TagWith("text")` adds a SQL comment above the statement, tags
accumulate when you call it several times, and `TagWithCallSite()` adds the
source file and line:

```csharp
db.Products.TagWith("Catalog: expensive products")
           .TagWith("Called from the price list screen")
           .TagWithCallSite()
           .Where(p => p.Price > 20);
// -- Catalog: expensive products
// -- Called from the price list screen
// -- File: .../log1.cs:48
//
// SELECT "p"."Id", "p"."Name", "p"."Price"
// FROM "Products" AS "p"
// WHERE "p"."Price" > 20.0
```

Because the tag is part of the SQL text it also shows up in the database's own
tooling (a slow query log, `pg_stat_statements`, a profiler), not only in your
application log. That is its real value.

### Interceptors: counting and changing commands

Logging observes. An interceptor can also modify or suppress the operation.
`DbCommandInterceptor` is the base class for commands, and you register it with
`AddInterceptors`, either in `OnConfiguring` or inside `AddDbContext`. A tiny
one that counts commands is enough to guard against N+1 in a test:

```csharp
public sealed class CommandCounter : DbCommandInterceptor
{
    public int Count; public List<string> Sql = [];
    public override InterceptionResult<DbDataReader> ReaderExecuting(
        DbCommand command, CommandEventData e, InterceptionResult<DbDataReader> result)
    { Count++; Sql.Add(command.CommandText); return result; }
}

var ids = db.Products.Select(p => p.Id).ToList();               // 1 command
foreach (var id in ids) _ = db.Products.Single(p => p.Id == id); // N commands
// commands: 4   (1 + 3 rows)
```

Every hook has a sync and an async version, and they are separate methods. In
the run above the counter stayed at 0 after a `ToListAsync()` and moved to 1
only on a sync `ToList()`, because it overrides only `ReaderExecuting`.
Override `ReaderExecutingAsync` too, or an async endpoint passes your test
without being counted. Other interceptor types cover connections, transactions,
`SaveChanges` and materialization.

## Trade-offs

- **`EnableSensitiveDataLogging` and `ToQueryString` leak data.** Both print
  parameter values, so a logged `INSERT` contains whatever the user typed.
  ```csharp
  if (env.IsDevelopment()) options.EnableSensitiveDataLogging();
  ```
- **`EnableDetailedErrors` has a runtime cost.** The try-catch per read is what
  makes the message good, and it is also why it is off by default. Turn it on
  while diagnosing, not as a permanent production setting without measuring.
- **`LogTo` is for development, `ILogger` is for production.** `LogTo` has no
  sinks, scopes or structured output. In a real app, send EF Core through the
  same logging pipeline as everything else and filter by category.
- **Command logs are noisy at scale.** Logging every statement at `Information`
  floods a busy service. Filter to `Warning` and enable the command category
  only when investigating, or log just slow commands from an interceptor.
- **Tags are string literals and never parameters.** A tag cannot carry a user
  id or request id, because it is baked into the SQL text, so a per-request tag
  produces a different statement text for every request.
  ```csharp
  db.Orders.TagWith($"user {userId}"); // new SQL text per user: avoid
  ```
- **A shared mutable interceptor is a concurrency bug.** Command interceptors
  are not singletons by default, but if you register one instance for many
  contexts, `Count++` is not thread-safe. Use one instance per context in tests,
  and `Interlocked` or a lock if you share it.
- **Interceptors can change behaviour, so keep them boring.** An interceptor that
  rewrites SQL is hard to find later. Prefer `LogTo` or `ILogger` when you only
  need to observe.

## Lab

In this lab you answer the question "what did EF Core actually send to the database?" with `ToQueryString`, `ILogger` categories and event ids, query tags and an interceptor, and you see what `EnableSensitiveDataLogging` and `EnableDetailedErrors` change. You receive a tiny catalog (`Product`) on in-memory SQLite, with no Docker or server, and several `TODO` points in the code. The core idea is that EF Core diagnostics come in layers (log, tags, interceptors) and each one shows something different: the SQL text, the parameters and how many commands were issued.

**The scenario**

The tests capture what EF Core logs with a test `ILoggerProvider` that you finish first, and then check the SQL text, the parameters in the log and the number of commands.

- `LogCapture.cs`: `ListLoggerProvider`, which stores `LogEntry` (category, level, event id, message). `Log` is empty.
- `CatalogQueries.cs`: `ExpensiveSql` and `Expensive` to implement, and `LoadOneByOne` already working (the classic N+1: one command for the ids and one per row).
- `DbFactory.cs`: `Create`, which builds the `DbContext` on SQLite and receives the logger factory, the two diagnostic flags and the interceptors.
- `CommandCounter.cs`: a `DbCommandInterceptor` that must count commands.
- `Catalog.cs` (ready): `Product`, the context and the seed.

**What you will do, step by step**

1. **Record the logs (TODO-00).** In `ListLogger.Log`, add to the owner a `LogEntry` with the category, the level, the event id and the formatted message (`formatter(state, exception)`).
2. **SQL without executing (TODO-01).** In `ExpensiveSql`, return the SQL (with the parameter header) of "products priced above `min`, ordered by name" without executing it. The variable `min` must be captured so it becomes the `@min` parameter.
3. **Tags (TODO-02).** In `Expensive`, return the same query as an `IQueryable`, tagged twice with `TagWith` ("Catalog: expensive products" and "Called from the price list screen"). Tags become comments above the SQL.
4. **Logger and flags (TODO-03).** In `DbFactory.Create`, send the EF logs to `loggerFactory` and turn sensitive data logging and detailed errors on or off according to the two flags. Read the `Executed DbCommand` message with the flags off and on (`@min='?'` versus `@min='20'`).
5. **Interceptors (TODO-04).** Still in `Create`, register the interceptors you receive.
6. **Count commands (TODO-05 and TODO-06).** In `CommandCounter`, count the command and store its text in `ReaderExecuting`, and do the same in `ReaderExecutingAsync`, which is a separate hook.

**How you know you are done**

`dotnet test` is green. You should be able to explain why `ToQueryString` does not show up in the execution log, why parameter values are hidden by default, what `EnableDetailedErrors` changes for a null property, and how the counter reveals the N+1 (1 plus the number of rows).

**Optional challenges**

- **TODO-07:** add `ExpensiveWithCallSite`, which also calls `TagWithCallSite()`. What does the comment contain?
- **TODO-08:** add `DbFactory.CreateWithLogTo(connection, Action<string> sink)`, which logs only `RelationalEventId.CommandExecuted` at `Information` through `LogTo`. The current tests do not cover these two items.

**Prerequisites:** basic EF Core queries, `Microsoft.Extensions.Logging` and the .NET 10 SDK.

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. The main methods throw `NotImplementedException` and the other points (`Log`, `Create`, `CommandCounter`) are empty with `TODO-NN` comments, so the red tests show what is left.

## Documentation Links

- [Simple logging, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/logging-events-diagnostics/simple-logging) (doc)
- [Using Microsoft.Extensions.Logging in EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/logging-events-diagnostics/extensions-logging) (doc)
- [Query tags, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/tags) (doc)
- [Interceptors, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/logging-events-diagnostics/interceptors) (doc)
- [How queries work, ToQueryString, EF Core, Microsoft Learn] (doc)
