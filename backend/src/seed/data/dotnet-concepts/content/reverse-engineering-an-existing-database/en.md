---
version: 1.0
updatedAt: 2026-10-16
---
## Objective

When the database exists before the C# code, `dotnet ef dbcontext scaffold` reads
the schema and writes a `DbContext` and one class per table. This concept runs the
scaffolder on EF Core 10 against a small legacy SQLite database and reads what it
produced: names, keys, defaults, join tables, views, tables without a primary key.
Then it covers the options that matter, how to re-run the command without losing
your own code, and how to change the generated code with T4 templates.

## Use Cases

- Starting an API on top of a database that another system owns.
- Producing a first model for a large schema, then keeping it by hand.
- Re-scaffolding on every release because the database team, not your code, is the
  source of truth for the schema.
- Auditing a legacy schema: what the scaffolder cannot express tells you where the
  database and the object model disagree.

## Deep Dive

### Setup and the legacy schema

The project needs the provider package and `Microsoft.EntityFrameworkCore.Design`
(mark it `PrivateAssets="all"` so it does not flow to consumers), plus the
`dotnet-ef` tool (`dotnet tool install --global dotnet-ef`). The legacy schema
uses upper-case snake names on purpose:

```sql
CREATE TABLE CUSTOMER (cust_id INTEGER PRIMARY KEY, cust_name TEXT NOT NULL, email TEXT,
  status TEXT NOT NULL DEFAULT 'A', created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX UX_CUSTOMER_EMAIL ON CUSTOMER (email);
CREATE TABLE ORDER_HDR (ord_id INTEGER PRIMARY KEY, cust_id INTEGER NOT NULL REFERENCES CUSTOMER,
  total NUMERIC NOT NULL, net NUMERIC GENERATED ALWAYS AS (total * 0.9) STORED);
CREATE TABLE ORDER_LINE (ord_id INTEGER NOT NULL REFERENCES ORDER_HDR, line_no INTEGER NOT NULL,
  sku TEXT NOT NULL, qty INTEGER NOT NULL, PRIMARY KEY (ord_id, line_no));
CREATE TABLE TAG (tag_id INTEGER PRIMARY KEY, label TEXT NOT NULL);
CREATE TABLE ORDER_TAG (ord_id INTEGER NOT NULL REFERENCES ORDER_HDR,
  tag_id INTEGER NOT NULL REFERENCES TAG, PRIMARY KEY (ord_id, tag_id));
CREATE TABLE AUDIT_LOG (at TEXT, what TEXT);
CREATE VIEW V_ORDER_TOTALS AS SELECT c.cust_id, c.cust_name, SUM(o.total) AS total_spent
  FROM CUSTOMER c JOIN ORDER_HDR o ON o.cust_id = c.cust_id GROUP BY c.cust_id, c.cust_name;
```

```
dotnet ef dbcontext scaffold "Data Source=legacy.db" Microsoft.EntityFrameworkCore.Sqlite \
  --output-dir Models --context LegacyDb
```

The two required arguments are the connection string and the provider package
name. The command compiles the project first, so it must build.

### What comes out

Names are cleaned up to .NET style and the original names are kept in the mapping:
`CUSTOMER` becomes `Customer`, `cust_id` becomes `CustId`, `ORDER_HDR` becomes
`OrderHdr`.

```csharp
modelBuilder.Entity<Customer>(entity =>
{
    entity.HasKey(e => e.CustId);
    entity.ToTable("CUSTOMER");
    entity.HasIndex(e => e.Email, "UX_CUSTOMER_EMAIL").IsUnique();
    entity.Property(e => e.CustId).ValueGeneratedNever().HasColumnName("cust_id");
    entity.Property(e => e.Created).HasDefaultValueSql("CURRENT_TIMESTAMP").HasColumnName("created");
    entity.Property(e => e.Status).HasDefaultValue("A").HasColumnName("status");
});
```

Things worth noticing, each one a decision the scaffolder made for you:

- **The composite key** of `ORDER_LINE` became `HasKey(e => new { e.OrdId, e.LineNo })`.
- **The join table** `ORDER_TAG` has no class. It became a many-to-many with
  `UsingEntity<Dictionary<string, object>>`, and `OrderHdr.Tags` and `Tag.Ords`
  skip navigations. This is only done for plain join tables: two foreign keys and
  nothing else.
- **Every foreign key** got `OnDelete(DeleteBehavior.ClientSetNull)`, because the
  database declared no `ON DELETE` action. That is the right reading of the
  schema, and rarely what you want for an order line.
- **`AUDIT_LOG` has no primary key**, so it became a keyless entity:
  `HasNoKey().ToTable("AUDIT_LOG")`. It can be queried but not updated.
- **The view** became a keyless entity too, `HasNoKey().ToView("V_ORDER_TOTALS")`.
- **The computed column** `net` came out as `HasComputedColumnSql()` with no
  expression, since the SQLite provider did not recover the formula. Do not feed
  that model back into migrations.
- **`INTEGER PRIMARY KEY`** came out as `ValueGeneratedNever()`. SQLite makes such
  a column an alias of the row id, but the schema never said `AUTOINCREMENT`, so
  EF Core believes the application supplies the key. Adding two customers without
  an id failed with "another instance with the same key value for {'CustId'} is
  already being tracked". A column declared `INTEGER PRIMARY KEY AUTOINCREMENT`
  scaffolded without `ValueGeneratedNever`, so what you get depends on how the
  key was declared and on the provider; check every key.

The view shows a limit of reading a schema. `SUM(...)` has no declared type in
SQLite, the scaffolder saw an empty type and generated `public byte[]? TotalSpent`;
reading it printed `System.Byte[]`. After changing the view to
`CAST(SUM(o.total) AS REAL)` the property became `double?`. Review the types of
every view column, and prefer fixing the view, or a `SqlQuery<T>` with your own
type, over trusting the guess.

### Options that matter

- `--table CUSTOMER --table ORDER_HDR` limits the output; `--schema` selects whole
  schemas. By default every table and view is scaffolded.
- `--data-annotations` moves what attributes can express into the class
  (`[Table("CUSTOMER")]`, `[Column("cust_id")]`, `[Key]`, `[Index(...)]`,
  `[ForeignKey]`, `[InverseProperty]`). The Fluent API stays for the rest: the
  `ValueGeneratedNever`, the computed column, the delete behavior and the
  many-to-many are still in `OnModelCreating`. No attribute exists for them, so
  the flag cannot remove the Fluent API.
- `--use-database-names` and `--no-pluralize` keep names as they are in the
  database: `CUSTOMER.cs`, `public int cust_id`, `DbSet<CUSTOMER> CUSTOMER`.
- `--context-dir`, `--output-dir`, `--namespace` and `--context-namespace` place
  the files.
- `--no-onconfiguring` removes the `OnConfiguring` method. Without it the
  connection string, here an absolute path, is written into the source with a
  `#warning`. The docs suggest `Name=ConnectionStrings:Legacy` instead, but it only
  resolves when the project builds a host with `IConfiguration`; in this plain
  console project the command failed with "named connection string ... was not
  found in the application's configuration". Prefer `--no-onconfiguring` and
  register the context with `AddDbContext`.
- Without `--force` a second run refuses to touch existing files ("The following
  file(s) already exist ... Use the Force flag to overwrite these files").

### Re-running without losing your code

`--force` overwrites the generated files, so never edit them. Two seams exist:
every entity and the context are `partial`, and the context calls
`OnModelCreatingPartial` at the end of `OnModelCreating`. Fluent calls made there
override the generated ones:

```csharp
public partial class LegacyDb
{
    partial void OnModelCreatingPartial(ModelBuilder modelBuilder)
        => modelBuilder.Entity<OrderLine>()
            .HasOne(l => l.Ord).WithMany(o => o.OrderLines)
            .HasForeignKey(l => l.OrdId)
            .OnDelete(DeleteBehavior.Cascade);
}
public partial class Customer { public string Display => $"{CustName} ({Status})"; }
```

After `ALTER TABLE CUSTOMER ADD COLUMN phone TEXT` and a `--force` re-scaffold,
`Customer.Phone` appeared, `Display` still compiled, and the delete behavior of
`OrderLine` printed `Cascade`. The one thing a partial class cannot do is change a
generated property, such as the type of `TotalSpent`; that needs a template or a
database change.

### Templates

Since EF Core 7 the generated code comes from T4 templates you can own. The docs
add them with `dotnet new install Microsoft.EntityFrameworkCore.Templates` followed
by `dotnet new ef-templates`, which creates `CodeTemplates/EFCore/DbContext.t4` and
`EntityType.t4` in the project. I took the same two files from the NuGet package
without installing a global template, and added one line before the class:

```
/// <summary>Scaffolded from <#= EntityType.GetTableName() ?? EntityType.GetViewName() #>.</summary>
public partial class <#= EntityType.Name #>
```

The next `scaffold --force` printed `/// <summary>Scaffolded from CUSTOMER.</summary>`
above `Customer` and `V_ORDER_TOTALS` above `VOrderTotal`. A third template,
`EntityTypeConfiguration.t4`, produces one `IEntityTypeConfiguration<T>` class per
entity, and commenting out the `IsSimpleManyToManyJoinEntityType()` check makes the
join tables into classes. After a package upgrade, diff your copies against the new
templates.

## Trade-offs

- **Scaffold once or scaffold forever.** Once means the generated code becomes
  yours and EF migrations take over the schema; forever means the database is the
  source of truth and your changes live only in partial classes and templates.
  Mixing them leads to migrations that fight a database you do not own.
- **Legacy names leak into the model.** `OrderHdr` and `CustId` are legible but not
  your domain language. A partial class cannot rename a generated property, so
  rename through a template or accept the names.
- **Guesses on the edge of the schema.** Views, computed columns and database
  specific types depend on the provider. Check them; the `byte[]` above compiled
  fine and failed only in use.
- **What the schema cannot say is never scaffolded.** Inheritance, owned types,
  table splitting and most concurrency tokens do not exist in a database, so they
  do not come out. The inheritance concept shows how to add the first by hand.
- **Generated keys.** `ValueGeneratedNever` on every integer key is safe for
  existing rows and wrong for new ones when the database really does generate the
  value. Fix it in `OnModelCreatingPartial` with
  `modelBuilder.Entity<Customer>().Property(c => c.CustId).ValueGeneratedOnAdd()`;
  with that line, the two inserts that failed before succeeded.

## Documentation Links

- [Reverse engineering, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/managing-schemas/scaffolding/) (doc)
- [Custom reverse engineering templates, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/managing-schemas/scaffolding/templates) (doc)
- [EF Core tools reference, .NET CLI, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/cli/dotnet) (doc)
- [Connection strings, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/miscellaneous/connection-strings) (doc)
- [Keyless entity types, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/keyless-entity-types) (doc)
