---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

A global query filter is a predicate that EF Core adds to every query on an
entity type, as if you had written one more `Where`. It is how soft delete and
multi-tenancy are usually done: you state the rule once in the model instead of
remembering it in every query. The feature is simple to use and easy to get
subtly wrong, so this concept covers what the filter really becomes in SQL,
the EF Core 10 addition of named filters (several filters on one entity, each
switched off on its own), how to apply one rule to many entities, and the
required-navigation trap that silently drops rows.

## Use Cases

- Hiding soft-deleted rows everywhere, and showing them in an admin screen.
- Keeping each tenant of a shared table away from the other tenants' rows.
- Combining both rules, then disabling only the soft-delete rule in an
  "undelete" or audit query while the tenant rule stays on.
- Adding a rule such as "only published articles" without touching existing
  queries.

## Deep Dive

The snippets ran on EF Core 10.0.13 with SQLite. Query text is what
`ToQueryString()` printed; see the logging concept for how to see it.

### What a filter becomes in SQL

`HasQueryFilter` takes a lambda over the entity. Every query that starts from
that entity type gets it, and `IgnoreQueryFilters()` removes it for one query:

```csharp
modelBuilder.Entity<Blog>().HasQueryFilter(b => !b.IsDeleted);

db.Blogs.ToQueryString();
// SELECT "b"."Id", "b"."IsDeleted", "b"."Name", "b"."TenantId"
// FROM "Blogs" AS "b"
// WHERE NOT ("b"."IsDeleted")

db.Blogs.IgnoreQueryFilters().ToQueryString(); // same SELECT, no WHERE
```

The filter also applies when the entity is reached some other way. Composing
over raw SQL wraps your text and adds the filter outside it, `Count` and
`SingleOrDefault` carry it, and so do `ExecuteUpdate` and `ExecuteDelete`:

```csharp
db.Blogs.FromSql($"SELECT * FROM Blogs") // ... FROM (SELECT * FROM Blogs) AS "b" WHERE NOT ("b"."IsDeleted")
db.Blogs.ExecuteUpdate(s => s.SetProperty(b => b.Name, b => b.Name + "!"));
// UPDATE "Blogs" AS "b" SET "Name" = "b"."Name" || '!' WHERE NOT ("b"."IsDeleted")   -> 1 row (2 exist)
```

`Find` on a key that is not already tracked also ran a query with the filter
and returned `null` for a soft-deleted row, so do not use it to look at deleted
data.

### The filter can read the context, but the model is built once

Multi-tenancy needs the current tenant. The filter may refer to a field or
property of the `DbContext`, and EF Core turns that value into a parameter, so
the same compiled model serves different tenants:

```csharp
class NamedDb(string file, string tenantId) : DbContext { /* ... */
    protected override void OnModelCreating(ModelBuilder b) =>
        b.Entity<Blog>().HasQueryFilter(x => x.TenantId == tenantId);
}
// tenant "t1": .param set @ef_filter__tenantId 't1'   WHERE "b"."TenantId" = @ef_filter__tenantId  -> fish-t1
// tenant "t2": .param set @ef_filter__tenantId 't2'   same SQL text                                -> cats-t2
```

The catch: `OnModelCreating` runs once per context type and the model is cached.
In a test run, a context of the same type created without filters came first,
and every later context of that type had no filter at all. The
*shape* of the model, which filters exist, cannot depend on a constructor
argument. Only values read inside the filter lambda can vary per instance. A
related rule applies to pooled contexts, which must not keep per-request state
in their own fields (see the DbContext lifetime concept): resolve the tenant
from a scoped service instead.

### One filter per entity, before EF Core 10

Until EF Core 9, an entity had a single filter. Calling `HasQueryFilter` a
second time did not add a rule, it replaced the first one:

```csharp
b.Entity<Blog>().HasQueryFilter(x => !x.IsDeleted);
b.Entity<Blog>().HasQueryFilter(x => x.TenantId == tenantId); // replaces it
// WHERE "b"."TenantId" = @ef_filter__tenantId   -> fish-t1, fish-t1-deleted  (deleted row is back)
```

The workaround was to write one lambda with `&&`, which cannot be taken apart
later: ignoring the filter ignored both rules.

### Named filters (EF Core 10)

EF Core 10 adds an overload that takes a name. Each name is a separate filter,
and `IgnoreQueryFilters` has an overload that takes the names to turn off.
The documentation lists these on the "What's new in EF Core 10" and "Global
query filters" pages. Output is from a run with two named filters and tenant `t1`:

```csharp
modelBuilder.Entity<Blog>()
    .HasQueryFilter("SoftDeletionFilter", b => !b.IsDeleted)
    .HasQueryFilter("TenantFilter", b => b.TenantId == tenantId);

db.Blogs                                       // WHERE NOT ("b"."IsDeleted") AND "b"."TenantId" = @ef_filter__tenantId
db.Blogs.IgnoreQueryFilters(["SoftDeletionFilter"]) // WHERE "b"."TenantId" = @ef_filter__tenantId
db.Blogs.IgnoreQueryFilters(["TenantFilter"])       // WHERE NOT ("b"."IsDeleted")
db.Blogs.IgnoreQueryFilters()                       // no WHERE: every filter off
```

Results over the same data were `fish-t1`, then `fish-t1, fish-t1-deleted`,
then `fish-t1, cats-t2`, then all three rows. Two rules to remember:

- A name that does not exist is silently accepted. `IgnoreQueryFilters(["Typo"])`
  returned the normal filtered result with no exception, so a misspelled name
  keeps the filter on. Put the names in constants shared by the model and the
  queries.
- You cannot mix styles on one entity. An unnamed `HasQueryFilter` plus a named
  one threw `InvalidOperationException: Both anonymous and named query filters
  cannot be applied simultaneously. Specify either an anonymous filter or one or
  more named filters.` at model-building time.

### One rule for many entities

A soft-delete rule belongs to every entity that has the flag. Loop over the
model and set the same named filter on each. `SetQueryFilter(string,
LambdaExpression)` on the mutable entity type is the metadata-level equivalent
of the fluent call, and `GetDeclaredQueryFilters()` lets you inspect the result:

```csharp
foreach (var et in b.Model.GetEntityTypes().Where(t => typeof(ISoftDelete).IsAssignableFrom(t.ClrType)))
{
    var p = Expression.Parameter(et.ClrType, "e");
    var body = Expression.Equal(Expression.Property(p, nameof(ISoftDelete.IsDeleted)), Expression.Constant(false));
    et.SetQueryFilter("SoftDeletionFilter", Expression.Lambda(body, p));
}
// Comments.ToQueryString():  WHERE NOT ("c"."IsDeleted")
// model: key=SoftDeletionFilter  expr=e => (e.IsDeleted == False)
```

The write side is separate: the filter hides rows but does not stop a delete.
Overriding `SaveChanges` to turn `Deleted` into `Modified` with the flag set
makes `Remove` a soft delete. In the run, the entity was `Deleted` before the
save and `Unchanged` with `IsDeleted=True` after; the default query then
returned only `a`, and `IgnoreQueryFilters()` returned `a, b`.

### The required-navigation trap

If `Post` has a required relationship to `Blog` and `Blog` has a filter, a
query that includes the blog joins to the filtered blogs with an `INNER JOIN`,
so posts whose blog is hidden disappear too. With one alive and one deleted
blog, each with a post:

```csharp
db.Posts.ToList()                      // on-alive, on-deleted
db.Posts.Include(p => p.Blog).ToList() // on-alive            <- fewer rows than the first query
// FROM "Posts" AS "p"
// INNER JOIN (SELECT ... FROM "Blogs" AS "b" WHERE NOT ("b"."IsDeleted")) AS "b0" ON "p"."BlogId" = "b0"."Id"
```

EF Core warns about this when the model is created
(`Model.Validation[10622]: Entity 'Blog' has a global query filter defined and is the
required end of a relationship with the entity 'Post'...`). There are two fixes,
both checked in the run. Make the navigation optional (`IsRequired(false)`), and
the join becomes a `LEFT JOIN`: `on-alive/alive, on-deleted/null`. Or give
`Post` the matching filter (`!p.Blog.IsDeleted`), and both queries return just
`on-alive`. If you add `IgnoreQueryFilters()` to the query with the `Include`,
it turns off the filter on the included entity too (`on-alive/alive,
on-deleted/deleted`), because the flag belongs to the whole query. One more
detail: when the result is projected (`.Select(p => p.Title)`), EF drops the
`Include`, so the missing-rows symptom only appears when entities are really
materialized.

## Trade-offs

- **A filter hides data silently.** A missing row looks like a bug elsewhere,
  and a support engineer querying through the same context never sees deleted
  or foreign rows. Log the SQL while debugging, and give admin code an explicit
  `IgnoreQueryFilters` path.
  ```csharp
  var withDeleted = await db.Blogs.IgnoreQueryFilters(["SoftDeletionFilter"]).ToListAsync(ct);
  ```
- **It is a convenience, not a security boundary.** `IgnoreQueryFilters()` is one
  call away, and SQL you execute yourself (`ExecuteSql`, ADO.NET) is not a LINQ
  query, so no filter is added. For strong tenant isolation, add a database-level
  control as well.
- **Name typos fail open for the filter.** A wrong name in
  `IgnoreQueryFilters([...])` keeps the filter on and raises nothing, which
  shows up as "undelete finds nothing". Use shared constants and cover it with
  a test.
- **Soft delete leaves the data in the table.** Unique indexes still see the
  deleted row, so re-creating a record with the same unique value fails, and the
  table grows. On SQLite, a unique index with `HasFilter` fixed it (the second
  insert of `dup` threw `UNIQUE constraint failed: Blogs.Name` without it and
  succeeded with it). The filter string is raw SQL for your provider, so check
  its support and syntax.
  ```csharp
  b.Entity<Blog>().HasIndex(x => x.Name).IsUnique().HasFilter("\"IsDeleted\" = 0");
  ```
- **Soft delete is not cascade.** Only tracked entities are converted by the
  `SaveChanges` override, so children that were not loaded stay alive under a
  deleted parent.
- **Every query pays for the predicate.** Think about indexes that cover the
  filtered columns (`IsDeleted`, `TenantId`) and measure on your database.
- **The filter set is fixed per context type.** Different filter shapes per
  tenant or per request need different context types or a custom model cache
  key, not a constructor flag.
- **Filters are easy to forget in tests.** Test the filtered and the
  `IgnoreQueryFilters` result for each rule, with data that would change the
  answer (one deleted row, one row of another tenant).

## Lab

In this lab you declare soft delete and multi-tenancy once in the model, switch off one rule at a time with named filters, and apply one rule to every entity that has the flag. You receive `AppDbContext` with two entities that have `IsDeleted` and a tenant id on `Blog`, but no filters, so every query returns every row of every tenant. Your job is to add the filters and then the queries that deliberately bypass one of them. The core idea is that naming the filters (EF Core 10) lets you ignore just one, instead of the all-or-nothing `IgnoreQueryFilters()` that also drops tenant isolation.

**The scenario**

A blog belongs to a tenant and can be soft deleted, and a post can also be soft deleted.

- `Entities.cs`: the `ISoftDelete` interface, `Blog` (with `TenantId` and `IsDeleted`) and `Post` (with `IsDeleted`).
- `AppDbContext.cs`: the context, which receives the `tenantId`, and the constants `SoftDeletionFilter` and `TenantFilter`. Sharing the names between the model and the queries avoids typos, which `IgnoreQueryFilters` accepts silently.
- `BlogQueries.cs`: `Visible` (ready), plus `IncludingDeleted`, `AcrossTenants` and `Undelete` to adjust.

The tests use in-memory SQLite and seed blogs for two tenants (`t1` and `t2`), each with one deleted blog.

**What you will do, step by step**

1. **Tenant filter (TODO-00).** In `OnModelCreating`, add a named filter `TenantFilter` on `Blog`: only rows whose `TenantId` equals `_tenantId`, using the `HasQueryFilter` overload that takes a name. The lambda reads the field, and EF turns it into a parameter per context instance.
2. **Soft delete everywhere (TODO-01).** Loop over the entity types that implement `ISoftDelete` and give each one a named filter `SoftDeletionFilter` for `IsDeleted == false`. The lambda has to be built with `System.Linq.Expressions` and applied with `entityType.SetQueryFilter(name, lambda)`.
3. **Include deleted (TODO-02).** In `IncludingDeleted`, ignore only the soft-delete filter: the tenant still applies.
4. **Cross tenants (TODO-03).** In `AcrossTenants`, ignore only the tenant filter: deleted rows stay hidden.
5. **Undelete safely (TODO-04).** In `Undelete`, find the blog with only the soft-delete filter off. The tenant filter must stay on, so another tenant's blog stays out of reach.

**How you know you are done**

`dotnet test` is green. You should be able to explain why `Undelete` with an unnamed `IgnoreQueryFilters()` would be a security bug, why `Blog` has two filters and `Post` only one, and why each context instance sees its own tenant.

**Optional challenges**

- **TODO-05:** call `IgnoreQueryFilters(["Typo"])` and check the result. Does EF Core complain about a name that does not exist?
- **TODO-06:** add an unnamed `HasQueryFilter` next to the named ones and read the exception raised when the model is built. There is no test for these two challenges.

**Prerequisites:** basic EF Core (`DbContext`, `DbSet`, LINQ queries), lambdas and expression trees (read the code, you will build one) and the .NET 10 SDK. The tests use in-memory SQLite, no Docker.

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. `OnModelCreating` is empty with `TODO-00` and `TODO-01` comments, and `IncludingDeleted`, `AcrossTenants` and `Undelete` do not ignore any filter yet, so the red tests show what is left.

## Documentation Links

- [Global query filters, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/filters) (doc)
- [What's new in EF Core 10, named query filters, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-10.0/whatsnew) (doc)
- [Multi-tenancy in EF Core applications, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/miscellaneous/multitenancy) (doc)
- [EntityTypeBuilder.HasQueryFilter, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.entityframeworkcore.metadata.builders.entitytypebuilder-1.hasqueryfilter) (doc)
- [EntityFrameworkQueryableExtensions.IgnoreQueryFilters, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.entityframeworkcore.entityframeworkqueryableextensions.ignorequeryfilters) (doc)
