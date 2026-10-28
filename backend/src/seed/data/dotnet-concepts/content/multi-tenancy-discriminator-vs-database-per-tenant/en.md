---
version: 1.1
updatedAt: 2026-10-28
---
## Objective

A multi-tenant application serves many customers from one deployment, and the one bug it must never have is showing tenant A's rows to tenant B. EF Core gives you building blocks, not a feature: the docs list three isolation models (a `TenantId` discriminator column in shared tables, a database per tenant, a schema per tenant) and say EF supports the first through global query filters, the second through configuration, and the third not at all ("not directly supported by EF Core and is not a recommended solution"). This concept builds all three on EF Core 10 and measures where each one leaks: a filter that freezes the first tenant it saw, writes the filter never checks, a unique index that crosses tenants, PostgreSQL row-level security as a backstop (and the roles that bypass it), a pooled context that keeps the previous tenant's connection string, a cached model that sends tenant 2 to tenant 1's schema, and what migrations do with tenant databases and schemas. Versions used: SDK 10.0.100, `Microsoft.EntityFrameworkCore.Sqlite` 10.0.14, `Npgsql.EntityFrameworkCore.PostgreSQL` 10.0.3 (it requires EF Core `[10.0.4, 11.0.0)`, so EF Core resolved to 10.0.14, with `Npgsql` 10.0.3), `Microsoft.EntityFrameworkCore.Design` 10.0.14 with the `dotnet-ef` 10.0.12 tool, PostgreSQL 18.6 on a local throwaway cluster.

## Use Cases

- A SaaS API where every table has a `TenantId` and every request must see only its own tenant's rows, even when a developer forgets a `Where`.
- Adding a database-side guarantee (row-level security) for raw SQL, reporting tools and code paths that bypass EF's query filters.
- Giving large or regulated customers their own database, resolved per request, and onboarding a new one with `Database.MigrateAsync()`.
- Choosing a model before the product grows: isolation, noisy neighbors, per-tenant backup, migration cost and connection count.

## Deep Dive

### Discriminator column: the filter must read the context instance

The filters lesson showed how a filter becomes SQL and how named filters work; here the focus is everything around it. Shared-table runs used PostgreSQL with `A-100, A-200` for tenant 1 and `B-100, B-200` for tenant 2. The tenant comes from a scoped service that middleware fills from the authenticated user. The filter reads it through a member of the context, so EF turns it into a parameter:

```csharp
public class SharedDb(DbContextOptions options, ITenantProvider tenant) : DbContext(options)
{
    public int TenantId => tenant.TenantId;   // ITenantProvider is registered as Scoped
    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Order>().HasQueryFilter("Tenant", o => o.TenantId == TenantId);
        b.Entity<OrderLine>().HasQueryFilter("Tenant", l => l.TenantId == TenantId);
    }
}
```

I created two DI scopes in one process (tenant 1 and tenant 2), queried both contexts and printed `ToQueryString()` of the first (only its header and `WHERE` line shown):

```text
scope1 tenant1: A-100,A-200
scope2 tenant2: B-100,B-200
same model instance: True
-- @ef_filter__TenantId='1'
WHERE o."TenantId" = @ef_filter__TenantId
```

One model, one SQL text, a different parameter value per context instance. That is the whole trick, and it is easy to break.

### Two ways to freeze the tenant

Mistake 1: copying the tenant into a local inside `OnModelCreating` (`var current = TenantId;`). The model is built once per context type, so the lambda keeps the first tenant. Mistake 2: reading an ambient value (a static field, or an `AsyncLocal<int>`) in the filter. I ran tenant 1, then tenant 2, each with its own context:

```text
tenant1 ctx: A-100,A-200
tenant2 ctx: A-100,A-200
WHERE o."TenantId" = 1
static Ambient.TenantId=1: A-100,A-200 | SELECT o."Sku" FROM "Orders" AS o WHERE o."TenantId" = 1
static Ambient.TenantId=2: A-100,A-200 | SELECT o."Sku" FROM "Orders" AS o WHERE o."TenantId" = 1
AsyncLocal Value=1: A-100,A-200
AsyncLocal Value=2: A-100,A-200
```

The third line is the tenant 2 SQL of mistake 1. The static and `AsyncLocal` cases surprised me: I expected a race between concurrent requests, but EF 10.0.14 inlined the value as a constant when it compiled the query and reused that compiled query, so tenant 2 got tenant 1's rows with no concurrency at all. Only members reached through the context became parameters. If `ToQueryString()` does not show `@ef_filter__...`, the filter is wrong.

### What the filter does not cover

From a tenant 1 context over 4 orders, then from a context that filters `Order` but not `OrderLine` (6 lines, 2 of tenant 1):

```text
Orders.Count: 2
IgnoreQueryFilters().Count: 4
FromSql(SELECT * FROM Orders).Count: 2
ExecuteUpdate rows: 2
SqlQuery<int>(count(*)): 4
ExecuteSql UPDATE rows: 4
OrderLines.Count: 6
OrderLines.Include(Order).Count: 2
```

LINQ paths (including `FromSql` composition and `ExecuteUpdate`) carry the filter; `Database.SqlQuery` and `ExecuteSql` see every tenant. Every tenant-owned entity needs its own filter, and the `Include` hid the missing one: as the filters lesson showed, a required navigation to a filtered entity becomes an `INNER JOIN` to the filtered rows. A test that always includes the parent will not catch a missing child filter.

### Writes: stamping TenantId and refusing other tenants

Filters only touch queries. I overrode `SaveChanges` and `SaveChangesAsync` to fill `TenantId` on insert and refuse rows of another tenant:

```csharp
foreach (var e in ChangeTracker.Entries<ITenantOwned>())
{
    if (e.State == EntityState.Added && e.Entity.TenantId == 0) e.Entity.TenantId = TenantId;
    if (e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted
        && (e.Entity.TenantId != TenantId || (e.State != EntityState.Added && e.Property(x => x.TenantId).OriginalValue != TenantId)))
        throw new InvalidOperationException($"{e.Metadata.ClrType.Name} belongs to tenant {e.Entity.TenantId}, current tenant is {TenantId}.");
}
```

Then I tried what a client can send to any "update by id" endpoint: tenant 2's order `Id = 3`, posted by tenant 1 with `TenantId = 1` and attached with `Update`:

```text
added without TenantId -> TenantId=1
InvalidOperationException: Order belongs to tenant 2, current tenant is 1.
Update(Id=3, TenantId=1) rows: 1
tenant 2 now sees: B-200
tenant 1 now sees: A-100,A-200,A-300,stolen
```

The guard passed because the entity claimed the right tenant, and `UPDATE ... WHERE "Id" = @p` moved tenant 2's row to tenant 1. Load the entity through the filtered `DbSet` before changing it, or let the database refuse it (below).

### Unique indexes must include TenantId

With `HasIndex(o => o.Sku).IsUnique()`, tenant 2 could not create a SKU that tenant 1 already had: `DbUpdateException` with inner `PostgresException: 23505: duplicate key value violates unique constraint "IX_Orders_Sku"`. Besides the false conflict, the error tells tenant 2 the value exists somewhere (Npgsql redacted the key in `DETAIL` by default). With `HasIndex(o => new { o.TenantId, o.Sku }).IsUnique()`, tenant 2's `A-100` saved and only a second `A-100` in the same tenant failed, on `IX_Orders_TenantId_Sku`.

### Row-level security as the backstop

PostgreSQL can enforce the same rule below EF. I created the table as `postgres`, gave a separate login role only DML grants, and added a policy over a session setting:

```sql
CREATE ROLE app_user LOGIN;
GRANT SELECT, INSERT, UPDATE, DELETE ON "Orders", "OrderLines" TO app_user;
ALTER TABLE "Orders" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Orders"
    USING ("TenantId" = NULLIF(current_setting('app.tenant', true), '')::int)
    WITH CHECK ("TenantId" = NULLIF(current_setting('app.tenant', true), '')::int);
```

A `DbConnectionInterceptor` overrides `ConnectionOpened` and `ConnectionOpenedAsync` and runs `SELECT set_config('app.tenant', '<id>', false)` on the new connection (the id is an int from the tenant provider, never user text). Connected as `app_user` for tenant 1, I repeated the bypasses, the stolen-row update and a raw `INSERT` with `TenantId = 2`:

```text
IgnoreQueryFilters().Count: 2
SqlQuery count(*): 2
ExecuteSql UPDATE all rows: 2
DbUpdateConcurrencyException: The database operation was expected to affect 1 row(s), but actually affected 0 row(s); data may have been modified or deleted since entities were loaded. ...
PostgresException: 42501: new row violates row-level security policy for table "Orders"
```

### RLS pitfalls I hit

My first policy had no `NULLIF`. Running without the interceptor:

```text
no interceptor, reused pooled connection: PostgresException: 22P02: invalid input syntax for type integer: ""
no interceptor, brand-new connection (Pooling=false): IgnoreQueryFilters().Count = 0
NULLIF policy, no interceptor, reused pooled connection: IgnoreQueryFilters().Count = 0
pid 23145 set to 1
pid 23145 next open: app.tenant = ''
[No Reset On Close] pid 23232 set to 1
[No Reset On Close] pid 23232 next open: app.tenant = '1'
```

Npgsql resets session state when a connection returns to the pool, but a custom setting that was set once comes back as an empty string, not NULL, so the cast failed. With `No Reset On Close=true` the previous tenant's value survived on the reused connection, the very leak RLS should stop. Setting the value on every open avoids depending on either. Then the roles (each sets `app.tenant` to 1 and counts):

```text
postgres (superuser, owner): 4
app_owner (owner, not superuser): 4
app_user: 2
after FORCE ROW LEVEL SECURITY: app_owner 2, postgres 4
```

The PostgreSQL docs say superusers and `BYPASSRLS` roles always bypass row security and table owners normally do; `FORCE ROW LEVEL SECURITY` covers the owner, not the superuser, as I saw. Migrate as the owner, run the app as another role.

### Database per tenant: the connection string per context

The docs' sample resolves the connection string in `OnConfiguring` from the scoped tenant service. I did the same with one SQLite file per tenant, `if (!b.IsConfigured) b.UseSqlite(catalog.For(tenant.TenantId));`, then onboarded two tenants, switched tenant inside one scope, and tried both factory lifetimes:

```text
tenant 1: file exists before=False, pending=20261028164656_Init
tenant 1: applied=20261028164656_Init, conn=tenant1.db
tenant 2: applied=20261028164656_Init, conn=tenant2.db
tenant 2: same model as tenant 1: True
Scoped: before switch customer-of-1; after switch customer-of-1 (same instance: True)
Transient: before switch customer-of-1; after switch customer-of-2 (same instance: False)
Singleton factory: InvalidOperationException: Cannot resolve scoped service 'ITenantProvider' from root provider.
Scoped factory: customer-of-2
```

Only the connection string changes, so all tenants share one cached model, which is correct. `MigrateAsync()` on a missing file created it and applied the migration: that is onboarding. A scoped context keeps its tenant for the whole scope, so switching tenants mid-scope needs `Transient`, as the docs' table says. `AddDbContextFactory` defaults to a singleton factory, which cannot use the scoped tenant service (with `ValidateScopes` on); `ServiceLifetime.Scoped` fixed it.

### A pooled context keeps the last connection string

The docs say a pooled context's `OnConfiguring` runs once per instance, so I used `AddPooledDbContextFactory` with `UseSqlite()` and no connection string, and called `db.Database.SetConnectionString(...)` after `CreateDbContextAsync()`. The second rental skipped that call (path shortened):

```text
rent 1: customer-of-1
rent 2 without SetConnectionString: conn='Data Source=.../tenants/tenant1.db'
rent 2 query: customer-of-1
```

The pool did not reset the connection string, so a rental that forgets to set it reads the previous tenant's database. Wrap the factory so setting the tenant is not optional.

### Schema per tenant: the stale model

`HasDefaultSchema($"tenant_{id}")` in `OnModelCreating` compiles, but the model is cached per context type:

```text
--- HasDefaultSchema per tenant, custom IModelCacheKeyFactory: False
tenant 1: customer-of-1 | SELECT c."Id", c."Name" FROM tenant_1."Customers" AS c
tenant 2: customer-of-1 | SELECT c."Id", c."Name" FROM tenant_1."Customers" AS c
--- HasDefaultSchema per tenant, custom IModelCacheKeyFactory: True
tenant 1: customer-of-1 | SELECT c."Id", c."Name" FROM tenant_1."Customers" AS c
tenant 2: customer-of-2 | SELECT c."Id", c."Name" FROM tenant_2."Customers" AS c
```

No error, just tenant 2 reading tenant 1. The fix is a key with everything that changes the model: `Create(DbContext context, bool designTime)` returns `(context.GetType(), s.Schema, designTime)` for `SchemaDb`, registered with `ReplaceService<IModelCacheKeyFactory, SchemaCacheKeyFactory>()`. The same holds for any per-tenant model difference (an extra column, another table name); a different connection string alone never needs it.

### Schema per tenant and migrations

`dotnet ef migrations add` (design-time factory with tenant 1) wrote `EnsureSchema(name: "tenant_1")` and `schema: "tenant_1"` into the migration and `HasDefaultSchema("tenant_1")` into the snapshot. Applying it per tenant, with the fixed cache key, then listing the tables:

```text
tenant 1: migrated
tenant 2: InvalidOperationException: An error was generated for warning 'Microsoft.EntityFrameworkCore.Migrations.PendingModelChangesWarning': The model for context 'SchemaDb' has pending changes. Add a new migration before updating the database. ...
tenant 2, warning ignored: pending before = []
tenant 2, warning ignored: MigrateAsync returned
public.__EFMigrationsHistory, tenant_1.Customers
```

The history table sits in `public` and is shared, so once tenant 1 ran, the migration counted as applied for everyone; ignoring the warning created nothing for tenant 2. Schema per tenant needs your own runner (a per-schema history table via `MigrationsHistoryTable`, schema-neutral migrations): that is the "not supported" in the docs.

### Onboarding and the "migrate 500 tenants" problem

I migrated 20 fresh SQLite files in a loop, then ran it again with nothing pending:

```text
run 1 (fresh files): 20 databases in 57 ms
run 2 (already migrated): 20 databases in 25 ms
```

About 3 ms per tiny local database. The rest is reasoning, not measured: on a real server each tenant costs a connection, a history read and the DDL, a long migration multiplies by the tenant count, and a failure at tenant 237 leaves the fleet on two schema versions. Run it as a deployment job with bounded parallelism and a per-tenant result log, and ship code that works with both versions during the rollout.

### Blazor Server and the comparison

Not run here: the Blazor EF Core docs say scoped services live as long as the user's circuit, so a scoped `DbContext` is shared by all of that user's components, and `DbContext` is not thread-safe; they recommend a factory and a context per operation, and the multi-tenancy docs add that the factory must be `Scoped` when the connection string depends on the user.

| | Discriminator + filter (+ RLS) | Schema per tenant | Database per tenant |
|:--|:--|:--|:--|
| Isolation | Logical; a missed filter or raw query leaks (RLS closes most) | Namespace | Physical |
| Noisy neighbor | Shares everything | Shares the server | Own database, server may be shared |
| Per-tenant backup/restore | Hard (rows in shared tables) | Per-schema dump | Native |
| Migration cost | Once | Per schema, custom tooling | Per database, N runs |
| Connection pools | One | One | One per connection string |
| EF Core support (docs) | Global query filter | Not supported, not recommended | Configuration |

For the pool row I opened and closed 5 connections to each of 3 tenant databases: `t1=5, t2=5, t3=5` idle server connections stayed open, 15 where one shared database would hold 5. The docs call their examples "working practices", not best practices, and do not rank the first and last options.

## Trade-offs

- **The filter is only as safe as how it reads the tenant.** Through a context member it is a parameter; a local or static value froze at first use. A test can assert that `ToQueryString()` contains `@ef_filter__TenantId`.
- **Filters do not protect writes.** An attached entity is updated by key whatever its tenant. Load before modifying, guard `SaveChanges`, or let RLS reject it.
- **RLS adds a guarantee and a setup tax.** It needs a non-owner, non-superuser role, a setting on every connection open, and a policy that tolerates an empty setting.
- **Database per tenant multiplies operations.** Pools, migrations, monitoring and backups are per tenant (the ADO.NET pooling lesson explains why each connection string is its own pool), and with context pooling `SetConnectionString` survived the return to the pool, so set the tenant in a wrapper factory every time.
- **Schema per tenant is the least supported path.** Model cache key, migrations and history table are all yours to build.

## Documentation Links

- [Multi-tenancy, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/miscellaneous/multitenancy) (doc)
- [Global query filters, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/filters) (doc)
- [DbContext lifetime, configuration, and initialization, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/dbcontext-configuration/) (doc)
- [Alternating between multiple models with the same DbContext type, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/dynamic-model) (doc)
- [ASP.NET Core Blazor with Entity Framework Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/blazor-ef-core?view=aspnetcore-10.0) (doc)
- [Row Security Policies, PostgreSQL documentation](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) (doc)
