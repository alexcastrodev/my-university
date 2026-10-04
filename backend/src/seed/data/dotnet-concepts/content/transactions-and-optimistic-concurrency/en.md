---
version: 1.0
updatedAt: 2026-10-04
---
## Objective

Every `SaveChanges` is already a transaction, so most code never opens one.
What deserves attention is what that transaction does not do. It does not stop
two users from editing the same row at the same time, and it does not play well
with a retry strategy once you start your own transaction. Optimistic
concurrency answers the first problem by detecting the conflict at write time
instead of locking rows while a user thinks. The execution strategy answers the
second by retrying the whole unit of work, not a single command.

## Use Cases

- Two staff members open the same order, and the second one to save must not
  silently overwrite the first one's change (a lost update).
- Saving an order and its lines together so either all of it is stored or none
  of it is.
- A transaction that must span a `SaveChanges` and a raw SQL command.
- A database connection that drops for a second during a deployment, and the
  request should succeed on a retry instead of failing.

## Deep Dive

### SaveChanges is one transaction

When a `SaveChanges` produces several commands (an `INSERT` for the order and
one per line), EF Core wraps them in a single transaction, so a failure rolls
back all of them. You only open a transaction yourself when the unit of work
needs more than one `SaveChanges` or mixes in commands EF Core does not track:

```csharp
await using var tx = await db.Database.BeginTransactionAsync(ct);

db.Orders.Add(order);
await db.SaveChangesAsync(ct);

await db.Database.ExecuteSqlAsync($"UPDATE stock SET reserved = reserved + {qty} WHERE sku = {sku}", ct);

await tx.CommitAsync(ct); // an exception before this point rolls everything back on dispose
```

### Concurrency tokens

A concurrency token is a column whose value must be unchanged since you read the
row. EF Core adds it to the `WHERE` of the `UPDATE` and checks how many rows were
affected. If the row changed, zero rows match and EF Core throws
`DbUpdateConcurrencyException`:

```csharp
// UPDATE orders SET status = @p0 WHERE id = @p1 AND version = @p2;
// 0 rows affected -> DbUpdateConcurrencyException
```

On SQL Server the natural token is a `rowversion` column, mapped to a `byte[]`
property. On PostgreSQL there is no such column type, but every row has a system
column `xmin` holding the transaction id of its last write, which works the same
way. The Npgsql provider maps a `uint` property configured as a row version to
`xmin`:

```csharp
public byte[] Version { get; set; } = [];  // SQL Server: rowversion
public uint Version { get; set; }          // PostgreSQL (Npgsql): xmin

builder.Property(o => o.Version).IsRowVersion(); // same call for both providers
// or [Timestamp] on the property
```

A plain `[ConcurrencyCheck]` on a regular property works as well, as long as
every write changes it.

### Handling the conflict

The exception carries the entries that failed. What to do is a business
decision: let the database win, let the client win, or merge. The simplest
useful reaction in a web app is to report the conflict and let the user reload:

```csharp
try
{
    await db.SaveChangesAsync(ct);
}
catch (DbUpdateConcurrencyException ex)
{
    var entry = ex.Entries.Single();
    var current = await entry.GetDatabaseValuesAsync(ct); // null if the row was deleted

    if (current is null) return Results.NotFound();
    return Results.Conflict(new { message = "Someone else changed this order. Reload and try again." });
}
```

For an HTTP API, send the token to the client (an `ETag` or a `version` field)
and require it back with the update, so the conflict is detected across requests,
not only inside one request.

### Retry strategies and your own transactions

`EnableRetryOnFailure` makes EF Core retry commands that fail with transient
errors. A retry replays a command, so it cannot resume a transaction that you
began yourself, and EF Core refuses to start one unless you hand it the whole
unit of work through the execution strategy:

```csharp
builder.Services.AddDbContext<OrdersDbContext>(o =>
    o.UseNpgsql(connectionString, n => n.EnableRetryOnFailure(maxRetryCount: 3)));

var strategy = db.Database.CreateExecutionStrategy();
await strategy.ExecuteAsync(async () =>
{
    await using var tx = await db.Database.BeginTransactionAsync(ct);
    // ... one or more SaveChanges, raw SQL
    await tx.CommitAsync(ct);
});
```

The lambda may run more than once, so it must be safe to repeat: no side effects
outside the transaction, such as sending an email, inside it.

## Trade-offs

- **Optimistic concurrency detects, it does not prevent.** The second user does
  the work and then gets an error. That is right when conflicts are rare, and
  poor for a hot row (a counter, a stock level) where retries pile up. Use an
  atomic `UPDATE ... SET x = x + 1` or a lock there.
- **One token per aggregate.** The token lives on the aggregate root, so editing
  two unrelated parts of a large aggregate conflicts. That is a reason to keep
  aggregates small.
- **A conflict is a business event, not an exception to swallow.** Retrying
  blindly with the client's values turns the check into a last-writer-wins write
  and brings the lost update back.
  ```csharp
  await entry.ReloadAsync(ct); // database wins: discard the client's change
  entry.OriginalValues.SetValues(await entry.GetDatabaseValuesAsync(ct)); // client wins: keep the change
  ```
- **A retry strategy forces the lambda shape.** Code that begins a transaction
  outside `ExecuteAsync` fails with an exception about the configured execution
  strategy, which surprises people who only added `EnableRetryOnFailure` in
  startup.
- **Repeating the unit of work repeats its side effects.** If the lambda calls an
  external service and then fails on commit, the retry calls it again, so
  external calls need idempotency keys or belong after the commit.
- **A failure during commit leaves the outcome unknown.** If the connection
  drops while the transaction is committing, the strategy retries as if it had
  rolled back, which can duplicate a row with a store-generated key. The
  documentation suggests client-generated keys such as a `Guid` (so a duplicate
  fails instead of inserting twice), or verifying the result with
  `ExecuteInTransactionAsync` and its `verifySucceeded` delegate.

## Documentation Links

- [Transactions, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/saving/transactions) (doc)
- [Handling concurrency conflicts, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/saving/concurrency) (doc)
- [Connection resiliency, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/miscellaneous/connection-resiliency) (doc)
- [Concurrency tokens, Npgsql EF Core provider](https://www.npgsql.org/efcore/modeling/concurrency.html) (doc)
