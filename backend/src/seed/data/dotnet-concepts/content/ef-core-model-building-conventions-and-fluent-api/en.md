---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

EF Core builds its model from three sources of configuration: conventions that
read your classes, data annotations (attributes) on them, and the Fluent API in
`OnModelCreating`. When two of them disagree, one wins, and the rule is not
obvious in every case. This concept shows the precedence by inspecting the real
model and the real migration, how to apply a default to many properties without
breaking that precedence, how to keep configuration in one class per entity, how
`HasData` differs from runtime seeding in the generated migration, and when a
compiled model is worth generating.

## Use Cases

- Deciding where a rule such as "names are at most 100 characters" should live:
  an attribute, `OnModelCreating`, or a default for every string.
- Explaining why a `[MaxLength(50)]` on a property seems to be ignored.
- Splitting a 400-line `OnModelCreating` into something reviewable.
- Seeding lookup rows so they travel with the migrations.
- Reducing the first-query latency of an app with a very large model.

## Deep Dive

### Convention, annotation, Fluent API: who wins

EF Core records how each piece of configuration was made, as a
`ConfigurationSource`: `Convention`, `DataAnnotation` or `Explicit` (Fluent API).
A source can only be overridden by an equal or stronger one, so the order is
Fluent API over data annotation over convention. Take this entity:

```csharp
public class Product
{
    public int Id { get; set; }                  // convention: primary key
    public string Plain { get; set; } = "";      // convention: required (non-nullable string)
    [MaxLength(50)]
    public string Annotated { get; set; } = "";  // data annotation
    [MaxLength(50)]
    public string Both { get; set; } = "";       // annotation and Fluent API disagree
    public string? Optional { get; set; }        // convention: nullable reference type, nullable column
}
// OnModelCreating: modelBuilder.Entity<Product>().Property(p => p.Both).HasMaxLength(100);
```

Reading the design-time model (`IDesignTimeModel`, cast to `IConventionProperty`)
prints the value and the source of each facet:

```
property     maxLength  required  maxLength set by
Id           -          True      -
Plain        -          True      -
Annotated    50         True      DataAnnotation
Both         100        True      Explicit
Optional     -          False     -
```

`Both` is 100: the Fluent API beat the attribute. The nullable annotation of the
C# type (`string?`) decided `Optional`, which is the convention at work.

### A default for many properties, without losing precedence

Repeating `HasMaxLength` on every string is noise, so there are two ways to set a
default. They behave differently, and the difference is a trap. Pre-convention
configuration in `ConfigureConventions` runs before the conventions, but it counts
as explicit configuration:

```csharp
protected override void ConfigureConventions(ModelConfigurationBuilder b)
    => b.Properties<string>().HaveMaxLength(200);
```

Running the same entity with it gives:

```
Annotated    200   Explicit      <- the [MaxLength(50)] lost
Both         100   Explicit      <- a later Fluent call still wins
Plain        200   Explicit
Optional     200   Explicit
```

The official page says this directly: pre-convention configuration overrides all
conventions and data annotations. If you want a default that annotations can
still override, register a model finalizing convention, which uses the convention
builder and so never overrides an attribute or a Fluent call:

```csharp
class DefaultLength : IModelFinalizingConvention
{
    public void ProcessModelFinalizing(IConventionModelBuilder model, IConventionContext<IConventionModelBuilder> ctx)
    {
        foreach (var p in model.Metadata.GetEntityTypes()
                     .SelectMany(e => e.GetDeclaredProperties())
                     .Where(p => p.ClrType == typeof(string)))
            p.Builder.HasMaxLength(200);
    }
}
// ConfigureConventions: b.Conventions.Add(_ => new DefaultLength());
```

```
Annotated    50    DataAnnotation   <- the attribute survives
Both         100   Explicit
Plain        200   Convention
Optional     200   Convention
```

Use `Properties<T>()` for a rule that must hold everywhere (all `Money` values
use this converter) and a finalizing convention for a default that exceptions may
override. Custom conventions arrived in EF Core 7.

One practical trap when experimenting: EF Core builds the model once per context
type and caches it. My first run, with a single context class switched by a
constructor argument, printed identical results for every mode. Each variant
needed its own `DbContext` subclass.

### One configuration class per entity

`IEntityTypeConfiguration<T>` moves the Fluent calls out of `OnModelCreating`,
and one call finds them all:

```csharp
public class ProductConfiguration : IEntityTypeConfiguration<Product>
{
    public void Configure(EntityTypeBuilder<Product> b)
    {
        b.ToTable("products");
        b.Property(p => p.Sku).HasMaxLength(20);
        b.HasIndex(p => p.Sku).IsUnique();
        b.Property(p => p.Price).HasColumnName("unit_price");
        b.Property(p => p.Name).HasMaxLength(150);   // Name also has [MaxLength(100)]
    }
}

protected override void OnModelCreating(ModelBuilder mb)
    => mb.ApplyConfigurationsFromAssembly(typeof(ShopContext).Assembly);
```

Adding a migration with `dotnet ef migrations add Initial` shows the combined
result of all three sources. The columns below came out of the generated file:

```csharp
migrationBuilder.CreateTable(
    name: "products",                                   // Fluent: ToTable
    columns: table => new
    {
        Id = table.Column<int>(type: "INTEGER", nullable: false)
            .Annotation("Sqlite:Autoincrement", true),  // convention: int key
        Name = table.Column<string>(type: "TEXT", maxLength: 150, nullable: false), // Fluent beat [MaxLength(100)]
        Sku = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
        unit_price = table.Column<decimal>(type: "TEXT", nullable: false),
        CategoryId = table.Column<int>(type: "INTEGER", nullable: false),           // convention: required FK
        Note = table.Column<string>(type: "TEXT", nullable: true)
    },
    constraints: table =>
    {
        table.PrimaryKey("PK_products", x => x.Id);
        table.ForeignKey("FK_products_Categories_CategoryId", x => x.CategoryId,
            principalTable: "Categories", principalColumn: "Id",
            onDelete: ReferentialAction.Cascade);       // convention: required relationship cascades
    });
```

Notice two provider facts. A `decimal` is stored as `TEXT` on SQLite, and the
`maxLength: 80` the model carries for a `[MaxLength(80)]` property never reaches
the SQLite `CREATE TABLE`, which just says `TEXT`. The model keeps the metadata;
whether the database enforces it is up to the provider.

### HasData versus runtime seeding, in the migration

`HasData` is part of the model, so it lands in the migration. `UseSeeding` is code
that runs after `Migrate()`, so it does not. Both were configured in the same
project:

```csharp
// CategoryConfiguration: b.HasData(new Category { Id = 1, Name = "Books" }, new Category { Id = 2, Name = "Games" });
// OnConfiguring: UseSeeding(... add Category { Id = 3, Name = "Added at runtime" } if missing ...)
```

The migration contains `InsertData` for rows 1 and 2 only. After `Migrate()` the
table held `1 Books`, `2 Games` and `3 Added at runtime`. The CRUD and seeding
concept covers the trade-off between the two; the model-building angle is that
`HasData` needs explicit key values and turns every edit to the data into a new
migration.

### Compiled models

`dotnet ef dbcontext optimize` generates C# that builds the model directly
(five files for the two-entity model here). You opt in with
`options.UseModel(Shop.CompiledModels.ShopContextModel.Instance)`. With it on, my
queries ran and `OnModelCreating` was not called. The official guidance is to use
compiled models only when startup is slow, which means models with hundreds to
thousands of entity types, and lists limitations: no global query filters, no lazy
loading or change-tracking proxies, and the model must be regenerated by hand
whenever its definition changes. In my test `Migrate()` still ran
`OnModelCreating`, because it needs the design-time model.

## Trade-offs

- **Pre-convention defaults silently beat annotations.** A developer adds
  `[MaxLength(50)]`, the column stays at the global default, and nothing warns.
  ```csharp
  b.Properties<string>().HaveMaxLength(200); // [MaxLength(50)] on a property no longer applies
  ```
  Prefer a finalizing convention when attributes should keep working.
- **Annotations put persistence rules on the entity.** `[MaxLength]` and
  `[Column]` are readable next to the property, but they couple a domain class to
  EF Core, which matters for the DDD style in the mapping concept. Keep rich
  models clean and configure them in `IEntityTypeConfiguration<T>`.
- **Conventions change the database without a visible line of code.** A non-null
  `int CategoryId` made the relationship required and the delete cascade. Check
  the generated migration, not just the C#.
  ```csharp
  public int? CategoryId { get; set; } // optional: ClientSetNull, no ON DELETE CASCADE in the DDL
  ```
- **Several places can configure the same facet.** The last explicit call wins, so
  a `HasMaxLength` in `OnModelCreating` after `ApplyConfigurationsFromAssembly` can
  override the configuration class. Keep each facet in one place.
- **Provider mapping varies.** `decimal` became `TEXT` on SQLite, and lengths are
  not enforced there. A test on SQLite does not prove the SQL Server column shape.
- **Compiled models go stale.** Change the model and forget to run
  `dotnet ef dbcontext optimize`, and the app runs with the old shape. Regenerate
  in the build, and skip the feature for small models.

## Documentation Links

- [Creating and configuring a model, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/) (doc)
- [Model bulk configuration, ConfigureConventions and custom conventions, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/bulk-configuration) (doc)
- [Entity properties, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/entity-properties) (doc)
- [Data seeding, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/data-seeding) (doc)
- [Compiled models, advanced performance topics, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/performance/advanced-performance-topics#compiled-models) (doc)
- [EF Core tools reference, dotnet ef, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/cli/dotnet) (doc)
- [SQLite EF Core database provider limitations, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/sqlite/limitations) (doc)
