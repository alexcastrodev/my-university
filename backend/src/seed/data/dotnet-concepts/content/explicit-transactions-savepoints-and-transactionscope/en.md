---
version: 1.0
updatedAt: 2026-10-28
---
## Objective

The implicit transaction around one `SaveChanges` covers most writes. The rest of the time you need to control the transaction yourself: several `SaveChanges` that must commit together, raw ADO.NET or Dapper-style SQL that must roll back with EF's changes, an isolation level stronger than the default, or a retry when the database rejects a transaction. EF Core 10 gives you `Database.BeginTransactionAsync`, `AutoTransactionBehavior`, savepoints, `UseTransaction` and `GetDbTransaction`, and it also works with `System.Transactions.TransactionScope`. Several of these behave differently from what their names suggest: EF quietly adds a savepoint inside your transaction, a retrying execution strategy rejects your transaction, `TransactionScope` defaults to Serializable and silently loses the ambient transaction after an `await`, and two connections in one scope become a PostgreSQL prepared transaction. This lesson extends the transactions and optimistic concurrency lesson: I ran every case on SQLite and on a local PostgreSQL 18.6 with two real connections, logged EF's transaction events and the server's statement log, and quote the exceptions as they came out. Versions used: SDK 10.0.100, `Microsoft.EntityFrameworkCore.Sqlite` 10.0.14 (`Microsoft.Data.Sqlite.Core` 10.0.14), `Npgsql.EntityFrameworkCore.PostgreSQL` 10.0.3 (the 10.x line is the one built for EF Core 10, with `Npgsql` 10.0.3), PostgreSQL 18.6.

## Use Cases

- Saving an order, then calling `SaveChanges` again for its stock reservation, with both kept or both discarded.
- Running a Dapper-style query or a raw `NpgsqlCommand` inside the same transaction as EF's changes.
- Enforcing a rule across rows (at least one doctor on call, a balance that must not go negative) with Serializable isolation and a retry loop.
- Keeping an optional step (an audit row, a best-effort import line) from aborting the whole unit of work, with a savepoint.

## Deep Dive

### One transaction across several SaveChanges

My model is one `accounts` table with a unique index on `name`, seeded with `alice` and `bob`. Without an explicit transaction each `SaveChanges` commits on its own; with one, nothing is kept until `CommitAsync`:

```csharp
await using var tx = await db.Database.BeginTransactionAsync();
db.Accounts.Add(new() { Name = "carol" });
await db.SaveChangesAsync();
db.Accounts.Add(new() { Name = "dave" });
await db.SaveChangesAsync();
throw new InvalidOperationException("payment gateway said no"); // CommitAsync never runs
```

```text
no explicit transaction, second SaveChanges fails (duplicate name): DbUpdateException, rows: alice,bob,carol
explicit transaction, exception before commit:                     payment gateway said no, rows: alice,bob
```

Same result on SQLite and PostgreSQL. There is no catch block here: disposing the uncommitted transaction rolled it back, so always declare it with `await using`.

### AutoTransactionBehavior, seen in the log

`db.Database.AutoTransactionBehavior` decides whether `SaveChanges` opens its own transaction when none exists. I logged `TransactionStarted`, `CommandExecuted` and `TransactionCommitted` with `LogTo(filter, Action<EventData>)`:

```text
sqlite WhenNeeded, 1 insert:  INSERT ... RETURNING "id";                        (no transaction events)
sqlite WhenNeeded, 2 inserts: [TransactionStarted] isolation level 'Serializable', INSERT, INSERT, [TransactionCommitted]
sqlite Never, 2 inserts:      INSERT, INSERT                                     (no transaction events)
sqlite Always, 1 insert:      [TransactionStarted], INSERT, [TransactionCommitted]
pg WhenNeeded, 2 inserts:     [TransactionStarted] isolation level 'ReadCommitted', one command with both INSERTs, [TransactionCommitted]
pg Never, 2 inserts:          one command with both INSERTs                      (no transaction events)
```

`WhenNeeded` (the default) skips the transaction for a single statement, which is already atomic. `Never` is the risky one. With a duplicate in the second insert, SQLite kept the first row (`rows: alice,bob,carol`). PostgreSQL kept nothing (`rows: alice,bob`), because Npgsql sent both statements as one batch and the batch failed as a unit; with `MaxBatchSize(1)` it behaved like SQLite and kept `carol`. The result of `Never` depends on how the provider batches, and the docs warn that earlier commands may already be committed.

### The savepoint EF creates for you

When `SaveChanges` runs inside your transaction, EF wraps it in a savepoint. The EF log only says `Created transaction savepoint.`, so I turned on `log_statement = 'all'` in PostgreSQL. The second `SaveChanges` adds `dave` and a duplicate `alice`:

```text
BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED / SAVEPOINT "__EFSavePoint" / INSERT ... (carol) / RELEASE SAVEPOINT "__EFSavePoint"
SAVEPOINT "__EFSavePoint" / INSERT ... ; INSERT ... (dave, alice)
ERROR:  duplicate key value violates unique constraint "IX_accounts_name"
ROLLBACK TO "__EFSavePoint" / RELEASE SAVEPOINT "__EFSavePoint" / COMMIT

DbUpdateException: An error occurred while saving the entity changes. See the inner exception for details.
  inner PostgresException: 23505: duplicate key value violates unique constraint "IX_accounts_name"
tracked after failure: dave:Added,alice:Added
in tx: alice,bob,carol      after commit: alice,bob,carol
```

The failed `SaveChanges` was undone (`dave` is gone too), the earlier `carol` survived, and the transaction was still usable, so `CommitAsync` succeeded. SQLite logged the same event sequence (`CreatedTransactionSavepoint`, `RolledBackToTransactionSavepoint`, `ReleasedTransactionSavepoint`) with the same result. Two details: the change tracker still holds both entities as `Added`, so calling `SaveChanges` again repeats the failure until you fix or detach them; and on PostgreSQL this savepoint is what keeps the transaction alive. A raw statement that failed outside EF's savepoint (the same 23505) aborted the whole transaction, and the next `SaveChanges` got `PostgresException: 25P02: current transaction is aborted, commands ignored until end of transaction block`. The docs say EF does not create savepoints on SQL Server when MARS is enabled, and that the transaction may then be left in an unknown state after a failure.

### Your own savepoints

Inside the same transaction I called `tx.CreateSavepointAsync("BeforeOptional")`, saved `dave`, then `RollbackToSavepointAsync("BeforeOptional")`, `ReleaseSavepointAsync("BeforeOptional")` and `CommitAsync()`:

```text
SAVEPOINT "BeforeOptional" / SAVEPOINT "__EFSavePoint" / INSERT / RELEASE SAVEPOINT "__EFSavePoint"
ROLLBACK TO "BeforeOptional" / RELEASE SAVEPOINT "BeforeOptional" / COMMIT
after RollbackToSavepoint: carol:Unchanged:id=3,dave:Unchanged:id=4
after commit: alice,bob,carol      (SupportsSavepoints=True on both providers)
```

Rolling back to a savepoint undoes rows, not the change tracker: it still showed `dave` as `Unchanged` with id 4, a row that no longer exists. Clear or reload after it.

### Sharing the transaction with ADO.NET code

From EF to raw SQL, take the connection and the `DbTransaction` from the context:

```csharp
await using var tx = await db.Database.BeginTransactionAsync();
// ... SaveChanges adds carol
var conn = (NpgsqlConnection)db.Database.GetDbConnection();
await using var cmd = new NpgsqlCommand("INSERT ... 'raw-with-tx' ...", conn, (NpgsqlTransaction)tx.GetDbTransaction());
await cmd.ExecuteNonQueryAsync();   // a second command, 'raw-no-tx', omits the transaction argument
await tx.RollbackAsync();
```

```text
raw with Transaction: 1 row   raw without Transaction: 1 row   inside tx count: 5   after rollback: alice,bob
```

All three rows disappeared with the rollback, including the command created without a `Transaction`: the Npgsql docs say every command on a connection with an open transaction takes part in it, and recommend setting it anyway for portability. Microsoft.Data.Sqlite is stricter. `conn.CreateCommand()` copied the pending transaction into the command, but `new SqliteCommand(sql, conn)` failed with `InvalidOperationException: Execute requires the command to have a transaction object when the connection assigned to the command is in a pending local transaction.  The Transaction property of the command has not been initialized.`

From raw SQL to EF, open the connection and transaction yourself, build the context on that connection and call `UseTransactionAsync`:

```csharp
await using var dbtx = await conn.BeginTransactionAsync();   // conn: an open NpgsqlConnection
// raw: UPDATE accounts SET balance = balance - 30 WHERE name = 'alice'
await using var db = new Shop(new DbContextOptionsBuilder<Shop>().UseNpgsql(conn).Options);
await db.Database.UseTransactionAsync(dbtx);
db.Accounts.Add(new() { Name = "erin", Balance = 30 });
await db.SaveChangesAsync();
await dbtx.CommitAsync();
```

```text
EF CurrentTransaction is ours: True    after commit: alice,bob,erin    alice balance: 70
```

### Execution strategy and your own transaction

With `EnableRetryOnFailure`, `BeginTransactionAsync` itself returned normally. The first EF operation inside it failed, for `SaveChanges` and for a query alike, with `InvalidOperationException: The configured execution strategy 'NpgsqlRetryingExecutionStrategy' does not support user-initiated transactions. Use the execution strategy returned by 'DbContext.Database.CreateExecutionStrategy()' to execute all the operations in the transaction as a retriable unit.`

`ExecuteSqlRawAsync("SELECT 1")` in the same transaction did not throw, so raw SQL slips past this check. The working form passes the whole unit to the strategy, and it ran with `attempts=1, rows: alice,bob,carol,dave`:

```csharp
await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
{
    db.ChangeTracker.Clear();   // a retry must start from a clean tracker
    await using var tx = await db.Database.BeginTransactionAsync();
    // ... two SaveChanges
    await tx.CommitAsync();
});
```

### Isolation levels on PostgreSQL, measured with two connections

Transaction A reads alice (balance 100) through EF; connection B sets it to 50 and commits; A reads again, then subtracts 10 from its tracked entity and saves. The theory is in the system design lesson Transactions, ACID, and Isolation Levels; this is what EF and PostgreSQL did:

```text
ReadCommitted:  A read 1: 100, A read 2: 50 (non-repeatable read), A update + commit ok, final alice: 90
RepeatableRead: A read 1: 100, A read 2: 100 (snapshot)
  InvalidOperationException: An exception has been raised that is likely due to a transient failure.
    inner DbUpdateException: An error occurred while saving the entity changes. See the inner exception for details.
    inner PostgresException: 40001: could not serialize access due to concurrent update
  final alice: 50
```

Read Committed lost B's update: EF wrote `balance = 90` computed from a stale read. Repeatable Read refused the write instead. Note the outer exception: even without `EnableRetryOnFailure`, the default (non-retrying) Npgsql execution strategy wraps a transient error (`IsTransient=True` for 40001) in that `InvalidOperationException`, so `catch (DbUpdateException)` does not catch it.

Serializable also catches write skew, where two transactions read the same rows and update different ones. Rule: at least one account must stay on call. A and B both count 2, then each turns a different account off:

```text
RepeatableRead: A commit ok, B commit ok, on call now: 0          (rule broken)
Serializable:   A commit ok, B SaveChanges:
  inner PostgresException: 40001: could not serialize access due to read/write dependencies among transactions
  DETAIL: Reason code: Canceled on identification as a pivot, during write.
  on call now: 1
```

The DETAIL line appeared only after I added `Include Error Detail=true` to the connection string; by default Npgsql redacts it. For SQL Server, the docs say the default is `READ COMMITTED` with locking (row versioning when `READ_COMMITTED_SNAPSHOT` is `ON`, the default on Azure SQL Database), and that `SNAPSHOT` isolation must be enabled per database and reports update conflicts as error 3960. I did not run SQL Server.

Serializable is only correct with a retry of the whole transaction that reads again on each attempt. The Npgsql retrying strategy treated 40001 as transient, so with `UseNpgsql(cs, n => n.EnableRetryOnFailure(3, TimeSpan.FromMilliseconds(200), null))` it can be the loop:

```csharp
await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
{
    db.ChangeTracker.Clear();
    await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
    if (await db.Accounts.CountAsync(x => x.OnCall) < 2) return;   // rule would break: give up
    (await db.Accounts.SingleAsync(x => x.Name == "alice")).OnCall = false;
    await db.SaveChangesAsync();
    await tx.CommitAsync();
});
```

```text
attempt 1: sees 2 on call at 124 ms   (a rival transaction turns bob off meanwhile, SaveChanges fails with 40001)
attempt 2: sees 1 on call at 149 ms   -> rule would break, giving up
```

The retry re-read the data and made the right decision. A hand-written loop that catches `PostgresException { SqlState: "40001" }` anywhere in the inner exceptions does the same.

### SQLite: IsolationLevel is a minimum

I called `SqliteConnection.BeginTransaction` with every `IsolationLevel` value:

```text
Chaos, Snapshot                     -> ArgumentException: The IsolationLevel 'Chaos' is not supported. (same for 'Snapshot')
ReadUncommitted, ReadCommitted, RepeatableRead, Serializable, Unspecified -> tx.IsolationLevel=Serializable (PRAGMA read_uncommitted = 0)
with Cache=Shared: ReadUncommitted  -> tx.IsolationLevel=ReadUncommitted (PRAGMA read_uncommitted = 1)
```

The docs say the level is a minimum promoted to read uncommitted or serializable, and that read uncommitted needs a shared cache. `BeginTransactionAsync(IsolationLevel.Snapshot)` through EF threw the same `ArgumentException`, so code written for SQL Server snapshot isolation breaks in SQLite-based tests.

### TransactionScope and async

`TransactionScope` sets an ambient `Transaction.Current` that the provider enlists in when a connection opens. With the default `TransactionScopeAsyncFlowOption.Suppress` it is stored per thread. I forced the continuation of an `await` onto another thread (a `LongRunning` task), as happens on a busy thread pool. The scope was created on thread 6; after the `await` I was on thread 11 with `Transaction.Current` null; `SaveChanges` then ran with no ambient transaction and autocommitted (`rows: alice,bob,carol`), although `Complete()` was never called.

When `Dispose` ran on a different thread from the constructor it threw `InvalidOperationException: A TransactionScope must be disposed on the same thread that it was created.`; in a run where the work had been enlisted and `Complete()` called, the row was not saved, and the next EF call failed with `The current TransactionScope is already complete.`. Which thread you land on changed from run to run, so this fails intermittently.

With `new TransactionScope(TransactionScopeAsyncFlowOption.Enabled)` it all worked, and leaving out `Complete()` rolled back (`no Complete: alice,bob`). The server log showed one more surprise, `BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE`: a scope defaults to Serializable unless you pass `TransactionOptions`.

Nested scopes: an inner `Required` scope without `Complete()`, inside an outer one that called it, ended in `TransactionAbortedException: The transaction has aborted.` with `rows: alice,bob`; an inner `RequiresNew` that completed, inside an outer one that did not, left `rows: alice,bob,audit-log`. `Required` joins the outer transaction, so one inner vote to abort dooms the whole thing. `RequiresNew` (here with its own context and connection) commits on its own and survives the outer rollback, which is the pattern for an audit row.

### Two connections in one scope: prepared transactions, not MSDTC

Two contexts saving one after the other inside one scope used the same backend (`pids: 14289 14289`) and a plain `COMMIT`; the Npgsql docs say it reuses the connection when the two are never open at the same time. Then I opened both connections before saving. With the default `max_prepared_transactions = 0` the scope failed on `Dispose` with `TransactionAbortedException: The transaction has aborted.`, inner `PostgresException: 55000: prepared transactions are disabled`, and nothing was saved. After restarting PostgreSQL with `max_prepared_transactions = 10` it committed, and the server log showed a two-phase commit coordinated in-process, with no promotion (`DistributedIdentifier` stayed all zeros):

```text
[17373] PREPARE TRANSACTION '00000000-0000-0000-0000-000000000000/17373'   (then 17374 the same)
[17373] COMMIT PREPARED '00000000-0000-0000-0000-000000000000/17373'       (then 17374 the same)
```

The Npgsql docs say it does not implement the recovery part and discourage relying on it: a crash between PREPARE and COMMIT PREPARED leaves a prepared transaction holding locks until someone resolves it by hand. A real promotion is not available here: forcing one with two durable enlistments on macOS gave `PlatformNotSupportedException: This platform does not support distributed transactions.`, and the EF docs say distributed transactions work only on Windows, since .NET 7. The system design lesson on distributed transactions and two-phase commit covers why this is fragile.

### Do not hold a transaction across think time or HTTP calls

Connection A updates alice and leaves the transaction open, as code does while it waits for a user or a remote API. Connection B runs `BEGIN; SET LOCAL lock_timeout = '2s';` and updates the same row:

```text
B after 2.00 s: 55P03: canceling statement due to lock timeout
B (no timeout) in pg_stat_activity: state=active wait=Lock/transactionid blocked_by={18517} (A pid 18517)
B unblocked after 3.01 s, when A committed
A with idle_in_transaction_session_timeout = '1s', idle 2 s, then COMMIT:
  PostgresException: 25P03: terminating connection due to idle-in-transaction timeout   (bob balance: 100, work lost)
```

Without a timeout, B waits as long as A stays open. `SET LOCAL` limits the setting to the current transaction (the next attempt had no timeout), and `idle_in_transaction_session_timeout` is the server-side guard that kills a forgotten transaction.

### Choosing the tool

| Need | Use | Watch out for |
|---|---|---|
| One unit of changes | Implicit `SaveChanges` | Nothing; `WhenNeeded` already makes it atomic |
| Several `SaveChanges`, raw SQL, another isolation level | `BeginTransactionAsync` | Wrap in `CreateExecutionStrategy().ExecuteAsync` when retries are on |
| Undo part of a transaction | Savepoint (EF adds one per `SaveChanges`) | The change tracker is not rolled back |
| Code that cannot receive a `DbTransaction` (several libraries) | `TransactionScope` with `AsyncFlowOption.Enabled` | Serializable by default, prepared transactions with two open connections |

## Trade-offs

- **An explicit transaction holds locks for as long as your code runs.** Read, decide and call remote APIs before `BeginTransactionAsync`, or use optimistic concurrency across requests instead of a long transaction.
- **Stronger isolation turns anomalies into exceptions.** Repeatable Read and Serializable on PostgreSQL are only correct with a retry of the whole unit, which must re-read data and have no external side effects.
- **`TransactionScope` hides a lot.** Serializable by default, no ambient transaction after `await` without `AsyncFlowOption.Enabled`, a synchronous commit inside `Dispose` (the docs say), and two-phase commit without recovery on Npgsql. Prefer `BeginTransactionAsync` unless you truly need the ambient pattern, and if you do, pass `new TransactionOptions { IsolationLevel = IsolationLevel.ReadCommitted }`.
- **Savepoints are cheap insurance, not a full undo.** They keep the PostgreSQL transaction usable after a failed `SaveChanges`, but you must still fix or clear the tracked entities. Likewise `AutoTransactionBehavior.Never` saves a round trip only where partial success is acceptable.
- **The same code behaves differently per provider.** SQLite is always Serializable and rejects `Snapshot`; SQL Server's defaults differ from PostgreSQL's. Test isolation-sensitive code on the real database.

## Documentation Links

- [Transactions, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/saving/transactions) (doc)
- [Connection resiliency, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/miscellaneous/connection-resiliency) (doc)
- [TransactionScope class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.transactions.transactionscope?view=net-10.0) (doc)
- [Transactions in Microsoft.Data.Sqlite, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/data/sqlite/transactions) (doc)
- [Transaction locking and row versioning guide, SQL Server, Microsoft Learn](https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-transaction-locking-and-row-versioning-guide?view=sql-server-ver17) (doc)
- [Transaction Isolation, PostgreSQL documentation](https://www.postgresql.org/docs/current/transaction-iso.html) (doc)
