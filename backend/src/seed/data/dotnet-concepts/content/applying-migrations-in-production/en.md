---
version: 1.0
updatedAt: 2026-10-04
---
## Objective

Generating a migration is the easy half. Applying it to a production database
that serves traffic, from more than one application instance, with old and new
code alive at the same time during a rollout, is where schema changes cause
outages. The default developer habit of calling `Migrate()` when the app starts
works on a laptop and becomes a risk as soon as there are several replicas, a
rolling deployment, or a change that takes a long lock. This concept covers the
safer ways to apply migrations (idempotent scripts and bundles), the
expand/contract pattern that keeps every deploy compatible with the previous
one, and the PostgreSQL detail that makes index creation non-blocking.

## Use Cases

- Deploying a new version to several replicas without each one trying to run
  the same migration at startup.
- Letting a DBA or a pipeline review and apply the SQL, while the application's
  own database user has no permission to change the schema.
- Renaming or splitting a column while the previous version of the application is
  still serving requests.
- Adding an index to a large, busy table without blocking writes.
- Applying a migration to databases that are at different versions, such as
  several tenants, without knowing which one is behind.

## Deep Dive

### Why `Migrate()` at startup is risky

```csharp
// Convenient in development, risky in production.
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<OrdersDbContext>();
    await db.Database.MigrateAsync();
}
```

With one instance this is fine. With several, every instance starts at the same
time and tries to apply the same pending migration. Since EF Core 9,
`Migrate` takes a database-wide lock (how it works depends on the provider), so
the instances queue up instead of corrupting each other, but three problems
remain:

- A rolling deployment runs the old code against the new schema while the first
  instance migrates, so a destructive change breaks the instances that have not
  been replaced yet.
- The application's database user needs DDL permission (`CREATE`, `ALTER`,
  `DROP`) for its whole lifetime, only to run something that happens once per
  release.
- A migration that takes minutes holds the startup of every instance, so health
  checks time out and the orchestrator restarts them in the middle of it.

Since EF Core 9, `Migrate()` also throws when the model has pending changes with
no migration, so a forgotten `migrations add` fails at startup instead of
leaving the schema out of date. Wrapping `Migrate` in your own transaction or
execution strategy throws too, because an outer transaction prevents the lock
from being acquired.

### Idempotent scripts

Generate SQL and let a pipeline or a person apply it with a deployment account.
`--idempotent` makes the script check the migrations history table, so it can run
against a database at any version and applies only what is missing (support
depends on the provider, and SQLite does not generate idempotent scripts):

```bash
dotnet ef migrations script --idempotent --output migrate.sql \
  --project Orders.Core --startup-project Host
```

The generated script is plain SQL, so it can be reviewed and diffed in a pull
request, which is also the easiest place to catch a destructive statement.

### Migration bundles

A bundle is a self-contained executable that carries the migrations and applies
them, with no .NET SDK and no project files on the machine that runs it:

```bash
dotnet ef migrations bundle --self-contained -r linux-x64 --output efbundle

./efbundle --connection "Host=db;Database=orders;Username=deployer;Password=..."
```

Build it once in the pipeline, run it as a step before rolling out the new
application version, and keep the deployment credentials out of the application
itself.

### Expand and contract

Because old and new code overlap during a rollout, split a breaking change into
steps where each deployed version works with the schema on both sides of every
step. To replace a `FullName` column with `FirstName` and `LastName`:

```csharp
// Release 1, expand: add the new columns as nullable. The old code ignores them.
migrationBuilder.AddColumn<string>("first_name", "customers", "customers", nullable: true);
migrationBuilder.AddColumn<string>("last_name",  "customers", "customers", nullable: true);

// Release 2: the application writes both the old and the new columns.
// Backfill existing rows in batches, outside the schema migration if the table is large.
migrationBuilder.Sql("UPDATE customers.customers SET first_name = split_part(full_name, ' ', 1) WHERE first_name IS NULL");

// Release 3: the application reads only the new columns. Make them required.
migrationBuilder.AlterColumn<string>("first_name", "customers", "customers", nullable: false, oldNullable: true);

// Release 4, contract: nothing reads full_name any more, so drop it.
migrationBuilder.DropColumn("full_name", "customers", "customers");
```

Each step is its own migration shipped in its own release, and every release can
be rolled back to the previous application version without a schema change.

### Non-blocking indexes in PostgreSQL

A plain `CREATE INDEX` blocks writes to the table until it finishes.
`CREATE INDEX CONCURRENTLY` does not, but PostgreSQL refuses to run it inside a
transaction, and EF Core wraps each migration in one (EF Core 9 used a single
transaction for all pending migrations, and EF Core 10 went back to one per
migration). Tell EF Core to run that statement outside a transaction:

```csharp
protected override void Up(MigrationBuilder migrationBuilder) =>
    migrationBuilder.Sql(
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_orders_customer_id ON orders.orders (customer_id)",
        suppressTransaction: true);
```

Keep that migration to the index alone. Without a transaction, a failure
halfway cannot roll back anything else in the same migration, and a failed
concurrent build leaves an invalid index that you must drop before retrying.
The Npgsql provider can also do this from the model: `HasIndex(...).IsCreatedConcurrently()`
makes it create the index concurrently, and its documentation tells you to read
the PostgreSQL implications first.

## Trade-offs

- **Startup migration is the simplest option and the least controlled.** For one
  instance, a staging environment, or a small internal tool, it removes a
  deployment step. The cost grows with the number of replicas and the size of
  the data.
- **Idempotent scripts and bundles add a pipeline step.** They need credentials
  with schema permission and an ordering guarantee that the migration finishes
  before the new application version starts receiving traffic.
- **Expand and contract multiplies releases.** A change that was one migration
  becomes four deployments over days, with code that writes to two places in the
  middle. That is the price of zero downtime, and for a small table with a
  maintenance window a single migration may be the better trade.
  ```csharp
  // During the overlap, every write keeps both representations consistent.
  customer.FullName = $"{first} {last}";
  customer.FirstName = first;
  customer.LastName = last;
  ```
- **Backfills in a migration hold a transaction.** An `UPDATE` over millions of
  rows inside the migration keeps locks and bloats the table. Run large backfills
  as a separate batched job, and let the migration only change the structure.
- **Concurrent index builds are slower and can fail.** They scan the table twice
  and wait for running transactions, and a failure leaves an invalid index.
  ```sql
  SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid; -- find leftovers, then DROP INDEX
  ```

## Documentation Links

- [Applying migrations, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/applying) (doc)
- [Migrations overview, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/) (doc)
- [EF Core tools reference (.NET CLI), Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/cli/dotnet) (doc)
- [Breaking changes in EF Core 9, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-9.0/breaking-changes) (doc)
- [Indexes, Npgsql EF Core provider](https://www.npgsql.org/efcore/modeling/indexes.html) (doc)
