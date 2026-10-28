---
version: 1.0
updatedAt: 2026-10-28
---
## Objective

ADO.NET is the layer every .NET relational driver implements and every ORM runs on: `DbConnection`, `DbCommand`, `DbParameter`, `DbDataReader`, `DbTransaction`, plus `DbBatch` (.NET 6) and `DbDataSource` (.NET 7). Writing it by hand is easy; writing it so it does not leak connections, inject SQL or pay a round trip per row takes knowing what the pool and the reader really do. This concept goes deep on ADO.NET itself (the EF Core vs Dapper vs ADO.NET choice lives in the prerequisite) and measures everything on two providers that implement the same `System.Data.Common` abstractions: Npgsql against a throwaway PostgreSQL 18.6 cluster and Microsoft.Data.Sqlite. SQL Server was not available, so every Microsoft.Data.SqlClient fact below is attributed to its docs. I ran: a SQL injection and the statement the server actually logged, the execute methods and `CommandBehavior` flags, 1 million row reads with three accessors, a leak that exhausts the pool, what `Close()` leaves on the server, `Pooling=false`, idle pruning, a killed backend and a server restart, `DbDataSource` in DI, `DbBatch` and binary `COPY`, streaming vs `ToList` memory, and EF Core borrowing the same pool. Versions used: SDK 10.0.100, `Npgsql` 10.0.3, `Npgsql.DependencyInjection` 10.0.3, `Npgsql.EntityFrameworkCore.PostgreSQL` 10.0.3 (with EF Core 10.0.4), `Microsoft.Data.Sqlite` 10.0.14, PostgreSQL 18.6, macOS 27.0.1 on an Apple M4 Max, client and server on 127.0.0.1.

## Use Cases

- A hot read path or a reporting query where you want the SQL and the row mapping in your hands, with no ORM in between.
- A service that dies under load with "The connection pool has been exhausted" and you need to find the leak.
- Bulk loading thousands of rows, where 1 round trip per `INSERT` is the bottleneck.
- A Native AOT tool or a library that must work with any provider, written only against `System.Data.Common`.

## Deep Dive

### One object model, two providers

I wrote one method using only `System.Data.Common` types and ran it against SQLite and PostgreSQL through their `DbProviderFactory`:

```csharp
static async Task<object?> CountUsers(DbProviderFactory f, string cs)
{
    await using var conn = f.CreateConnection()!;
    conn.ConnectionString = cs;
    await conn.OpenAsync();
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = "SELECT count(*) FROM users WHERE id > @min";
    var p = cmd.CreateParameter(); p.ParameterName = "min"; p.Value = 1;
    cmd.Parameters.Add(p);
    return await cmd.ExecuteScalarAsync();
}
```

```text
SqliteConnection / SqliteCommand / SqliteParameter / CanCreateBatch=False  -> 2 (Int64)
NpgsqlConnection / NpgsqlCommand / NpgsqlParameter / CanCreateBatch=True   -> 2 (Int64)
```

The abstraction holds for the basics, and `CanCreateBatch` is how you ask a provider whether it supports `DbBatch` (SQLite does not, see below). The SQL text is still provider-specific: `@min` works on both only because Npgsql rewrites named placeholders; the Npgsql docs recommend native positional `$1` for new code.

### Parameters, not concatenation: what the server received

I started the cluster with `log_statement=all` and sent the input `' OR 1=1 --` twice:

```csharp
var input = "' OR 1=1 --";
new NpgsqlCommand($"SELECT name, secret FROM users WHERE name = '{input}'", conn);   // concatenated
var good = new NpgsqlCommand("SELECT name, secret FROM users WHERE name = @name", conn);
good.Parameters.AddWithValue("name", input);                                       // parameterized
```

The concatenated query returned all 3 rows (alice, bob and carol, with their secrets); the parameterized one returned 0. The PostgreSQL log shows why. The first statement is a different query; the second has a placeholder and the value travels apart from the SQL:

```text
LOG:  execute <unnamed>: SELECT name, secret FROM users WHERE name = '' OR 1=1 --'
LOG:  execute <unnamed>: SELECT name, secret FROM users WHERE name = $1
DETAIL:  Parameters: $1 = ''' OR 1=1 --'
```

Npgsql turned `@name` into `$1` before sending. Parameters only cover values: a table or column name cannot be a parameter, so whitelist identifiers in code.

### Execute methods and CommandBehavior

```text
ExecuteScalar -> 3 (Int64)                  first column of the first row; count(*) is bigint
ExecuteScalar no row -> True                null when there is no row
ExecuteNonQuery UPDATE -> 2                 rows affected
ExecuteNonQuery SELECT -> -1                not meaningful for a query
SingleRow rows read -> 1                    3 rows matched, the reader stopped after one
Sequential col2 -> a-secret
Sequential back to col0 -> InvalidOperationException: Invalid attempt to read from column ordinal '0'. With CommandBehavior.SequentialAccess, you may only read from column ordinal '2' or greater.
CloseConnection: before reader dispose Open
CloseConnection: after reader dispose Closed
```

`SequentialAccess` streams a row instead of buffering it, which the Npgsql performance docs recommend for rows larger than the 8 KB read buffer; the price is reading columns strictly in order, once. `CloseConnection` is for a method that returns a reader to a caller who never sees the connection: disposing the reader closes it.

### Ordinals, names and `GetFieldValue<T>`

I summed the `id` column of a 1,000,000 row table with `r.GetInt32(0)`, `(int)r["id"]`, `r.GetFieldValue<int>(0)` and `r.GetInt32(ordId)` (with `ordId = r.GetOrdinal("id")` once, before the loop), three rounds after a warm-up, measuring time and `GC.GetTotalAllocatedBytes`. The same loop also ran on in-memory SQLite, with no network:

```text
rounds 2 and 3          PostgreSQL   allocated    in-memory SQLite
GetInt32(0)             96-100 ms    0.6-0.8 MB   about 78 ms
reader["id"]            99-100 ms    23.2 MB      about 108 ms
GetFieldValue<int>(0)   98-99 ms     0.6-0.7 MB   about 85 ms
GetOrdinal once         97-101 ms    0.6 MB       (not run)
```

Over a socket, the wire dominates and the four are equal within noise. What does not disappear is 23 MB of garbage: the indexer returns `object`, so each `int` is boxed (1 million boxes of 24 bytes). With SQLite, where there is no network, the name lookup was about 35 to 40% slower. The best of both is to call `GetOrdinal` once before the loop and use typed getters: robust to column reordering and allocation-free.

### Dispose or leak: exhausting the pool

`await using` returns the connection to the pool even when an exception is thrown. I removed it on purpose: with `Maximum Pool Size=5;Timeout=2`, I opened 5 `NpgsqlConnection` objects without disposing them, then opened a sixth:

```text
backends after 5 leaked opens: 5
6th OpenAsync after 2.00 s -> Npgsql.NpgsqlException: The connection pool has been exhausted, either raise 'Max Pool Size' (currently 5) or 'Timeout' (currently 2 seconds) in your connection string.
  inner: TimeoutException: The operation has timed out.
after disposing one leaked connection, open took 0.2 ms
```

The sixth caller waited the full `Timeout` before failing, so in production a leak looks like latency first and errors later. With the defaults the Npgsql docs give (100 connections, 15 s) the symptom is a 15 second stall. The SqlClient docs give the same defaults: `Max Pool Size` 100, `Connect Timeout` 15. A reader you forget to dispose leaks differently: the connection stays busy, and the next command on it failed with `NpgsqlOperationInProgressException: A command is already in progress: SELECT id, name, secret FROM users ORDER BY id`. SQL Server can run several readers on one connection only with `MultipleActiveResultSets=True`, which the docs say is disabled by default; Npgsql 10.0.3 rejected the second command with the exception quoted here.

### What Close() does, and how a pool is keyed

I counted rows in `pg_stat_activity` for the application name, from a separate unpooled admin connection:

```text
before open: 0
after Open: 1 state=Open pid=12074
after Close: 1 state=Closed server: 12074:idle
reopen same object: pid=12074
new object, same string: pid=12074
string with one extra space: pid=12074 backends=1
after ClearPool(one string): 0
```

`Close()` on a pooled connection does not log off: the server session stays alive and `idle`, and the next open with the same string gets the same backend (same PID). The Npgsql docs say the session state is reset with `DISCARD ALL`, sent lazily with the next statement. `NpgsqlConnection.ClearPool(conn)` closed the idle physical connection for that one string, and `ClearAllPools()` exists for every pool. The SqlClient docs describe the same two methods, and add that connections in use when you clear are discarded when they are closed. One difference: the SqlClient docs say pools are matched by exact connection string, so keywords in a different order create a new pool. Npgsql 10.0.3 put my string with an extra space in the same pool.

### Pooling=false, Minimum Pool Size and idle pruning

200 iterations of open, `SELECT 1`, close, three rounds:

```text
round 1: pooling on     18 ms (0.09 ms each)  pooling off    289 ms (1.44 ms each)
round 2: pooling on     19 ms (0.09 ms each)  pooling off    282 ms (1.41 ms each)
round 3: pooling on     18 ms (0.09 ms each)  pooling off    278 ms (1.39 ms each)
```

About 15 times slower without the pool, on loopback with trust authentication; with TLS and a password over a real network a new physical connection costs much more. Then pruning, with `Minimum Pool Size=3;Connection Idle Lifetime=2;Connection Pruning Interval=1`:

```text
one open, Minimum Pool Size=3: backends=1
8 open: backends=8
t=1s after closing all 8: backends=8
t=2s after closing all 8: backends=3
t=7s after closing all 8: backends=3
```

The Npgsql minimum is a floor for pruning, not a pre-warm: one open created one backend. The SqlClient docs say the opposite for SqlClient: when a pool is created, connections are opened to satisfy `Min Pool Size`. The Npgsql defaults per its docs are `Connection Idle Lifetime` 300 s and `Connection Pruning Interval` 10 s, and `Connection Lifetime` (maximum age of a physical connection) is 3600 s since Npgsql 9.0; the SqlClient docs give `Connection Lifetime` a default of 0 (no limit) and say idle connections are removed after about 4 to 8 minutes.

### Dead connections: a killed backend and a server restart

The pool does not ping a connection before handing it out. I killed a pooled idle backend with `pg_terminate_backend(pid)` (it returned `true`) and opened again; then I left 5 idle connections in a `NpgsqlDataSource` pool and restarted the server with `pg_ctl restart -m fast`:

```text
pooled idle connection pid=12083, server: 12083:idle
OpenAsync succeeded, pid=12083, state=Open
first use after 5 ms -> Npgsql.PostgresException: 57P01: terminating connection due to administrator command
next call: SELECT 1 -> 1 on pid=12087

5 idle pooled connections: 16634:idle 16635:idle 16636:idle 16637:idle 16638:idle
call 1: PostgresException: 57P01: terminating connection due to administrator command
call 2: ok, pid=16654
call 3: ok, pid=16654
call 4: ok, pid=16654
```

`OpenAsync` handed back the dead connection and the first command failed. After the restart, only the first call failed: calls 2 to 4 got a new backend, not one of the four remaining stale ones. Either way one request sees an exception, so a retry policy on transient errors belongs around database calls. The SqlClient docs describe the same thing: a severed connection is detected only on first use.

### DbDataSource: one per database, from DI

`DbDataSource` (.NET 7+) represents the database: it owns the configuration and the pool and hands out connections or runs commands directly. The Npgsql docs call it the recommended entry point and say direct `new NpgsqlConnection(cs)` is discouraged. I registered it with `Npgsql.DependencyInjection`:

```csharp
services.AddNpgsqlDataSource(cs, b => b.EnableParameterLogging(false)); // the lambda configures NpgsqlDataSourceBuilder
var dbds = sp.GetRequiredService<DbDataSource>();
await using (var cmd = dbds.CreateCommand("SELECT count(*) FROM users")) await cmd.ExecuteScalarAsync();
await using (var conn = await dbds.OpenConnectionAsync()) { /* several commands, a transaction */ }
```

```text
NpgsqlDataSource same instance as DbDataSource: True  type=PoolingDataSource
DbDataSource.CreateCommand (no connection object): 3
  cmd.Connection -> NotSupportedException: Connection and transaction access is not supported on commands created from DbDataSource.
OpenConnectionAsync: NpgsqlConnection Open
SqliteFactory.CreateDataSource -> System.Data.Common.DefaultDataSource: 42
```

One registration serves both `NpgsqlDataSource` and the abstract `DbDataSource`, so a provider-agnostic class can take `DbDataSource` in its constructor. A command from the data source borrows a connection only for its execution; for a transaction or several dependent commands, open a connection. Providers without their own data source still get one: `DbProviderFactory.CreateDataSource` returned a generic `DefaultDataSource` for SQLite. Compared to passing a connection string around, the Npgsql docs show the builder as the one place where logging, type mappings and password rotation are configured.

### DbBatch and binary COPY: fewer round trips

100 inserts on one open connection, three rounds after a warm-up:

```csharp
await using var batch = new NpgsqlBatch(conn);
for (var i = 0; i < 100; i++)
    batch.BatchCommands.Add(new("INSERT INTO items(name, qty) VALUES ($1, $2)") { Parameters = { new() { Value = "item" + i }, new() { Value = i } } });
await batch.ExecuteNonQueryAsync();                         // returned 100

await using var w = await conn.BeginBinaryImportAsync("COPY items(name, qty) FROM STDIN (FORMAT BINARY)");
for (var i = 0; i < 100; i++) { await w.StartRowAsync(); await w.WriteAsync("item" + i); await w.WriteAsync(i); }
await w.CompleteAsync();                                    // returned 100
```

```text
round 1: 100 commands    9.7 ms | 1 NpgsqlBatch   1.4 ms | binary COPY   0.3 ms
round 2: 100 commands    9.4 ms | 1 NpgsqlBatch   1.4 ms | binary COPY   0.3 ms
round 3: 100 commands    9.5 ms | 1 NpgsqlBatch   1.4 ms | binary COPY   0.3 ms
binary COPY of 100,000 rows: 111 ms
```

About 7 times faster as a batch and about 30 times as `COPY`, on loopback where a round trip costs about 0.1 ms; with 1 ms of real network latency, the 100 round trips of the first column alone would add about 100 ms. Through the abstraction, `DbConnection.CreateBatch()` gave two result sets read with `NextResultAsync`. On SQLite, `CanCreateBatch` is `False` and `CreateBatch()` threw `NotSupportedException: Specified method is not supported.`

### Streaming vs ToList, transactions, EF Core underneath

I read 1,000,000 rows (`int`, `text`, `numeric`) into a record, each mode in its own process, sampling `Environment.WorkingSet` every 5 ms, two runs each. From a 69 MB baseline, the peak was 231 and 239 MB with a `List`, and 108 and 108 MB streaming with `while (await r.ReadAsync())`: the list cost about 125 to 130 MB more. Transactions at this level are `await using var tx = await conn.BeginTransactionAsync()` plus `cmd.Transaction = tx`; my `DELETE` of 102,400 rows was undone by `RollbackAsync` (savepoints, isolation and `TransactionScope` are in the sibling concept). EF Core runs on the same objects: with `UseNpgsql(dataSource)` and `Maximum Pool Size=1`:

```text
GetDbConnection: NpgsqlConnection, state before any query: Closed
EF CountAsync=3, state after: Closed, backends=1
raw ADO.NET on the same data source: 3 pid=12167, backends=1
raw open while EF holds the only pooled connection, after 3.0 s -> NpgsqlException: The connection pool has been exhausted, either raise 'Max Pool Size' (currently 1) or 'Timeout' (currently 3 seconds) in your connection string.
command on GetDbConnection() itself: 3
```

EF opens and closes per query, and both used one backend. While EF held the connection open (`Database.OpenConnectionAsync()`), the raw code had to run its command on `GetDbConnection()` instead of opening another.

`DataSet`, `DataTable` and `DataAdapter` are the disconnected model from the .NET Framework books. They still work: `new NpgsqlDataAdapter(sql, conn).Fill(table)` returned 3 rows with typed columns (`id:Int32, name:String`) and left the connection `Closed`. Today a reader into your own records, or EF Core, replaces them in new code.

### Do this, not that

| Do this | Not that |
|---|---|
| One `NpgsqlDataSource` per database, from DI | `new NpgsqlConnection(cs)` scattered across the code |
| `await using` on connection, command, reader | Relying on the GC to return a connection |
| Parameters (`$1` or `@name`) | String interpolation of values |
| `GetOrdinal` once, then `GetInt32`/`GetFieldValue<T>` | `reader["col"]` in a million-row loop |
| `DbBatch` or `BeginBinaryImport` for many rows | One `ExecuteNonQuery` per row |
| `while (await r.ReadAsync())` for large results | `ToList` of a million rows |
| Retry transient errors (57P01 after a restart) | Assuming a pooled connection is alive |

## Trade-offs

- **The pool hides cost and leaks equally well.** Open, `SELECT 1` and close took about 0.09 ms with the pool, so open late and close early; but a forgotten dispose shows up only under load, as a stall of `Timeout` seconds and then an exception.
- **Pool size is a contract with the server.** Each pool of 100 per process, times replicas, must fit under the server's `max_connections` (100 on my cluster). A server-side pooler fits better when many processes share one database.
- **Provider-agnostic code stops at the SQL.** `System.Data.Common` let one method run on SQLite and PostgreSQL, but placeholders, `COPY`, batching support and error codes differ, as `CanCreateBatch=False` showed.
- **`COPY` is fastest and least flexible.** It is PostgreSQL-only, takes typed values in column order and is not an `INSERT` (no `ON CONFLICT`, no `RETURNING`); `DbBatch` keeps normal SQL semantics with one round trip.
- **Raw ADO.NET means you own the mapping.** Each typed getter must match the column type the provider returns (`count(*)` is `Int64`, not `Int32`).

## Documentation Links

- [SQL Server connection pooling (ADO.NET), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/framework/data/adonet/sql-server-connection-pooling) (doc)
- [DbDataSource class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.data.common.dbdatasource?view=net-10.0) (doc)
- [DbBatch class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.data.common.dbbatch?view=net-10.0) (doc)
- [Npgsql basic usage, Npgsql documentation](https://www.npgsql.org/doc/basic-usage.html) (doc)
- [Npgsql connection string parameters, Npgsql documentation](https://www.npgsql.org/doc/connection-string-parameters.html) (doc)
- [Npgsql performance, Npgsql documentation](https://www.npgsql.org/doc/performance.html) (doc)
