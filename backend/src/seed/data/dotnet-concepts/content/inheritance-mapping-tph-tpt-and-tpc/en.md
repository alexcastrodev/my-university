---
version: 1.0
updatedAt: 2026-10-16
---
## Objective

A C# hierarchy (`Payment`, `CardPayment`, `PixPayment`) has no natural shape in a
relational database. EF Core offers three ways to flatten it: one table for the
whole hierarchy (TPH), one table per type joined by the key (TPT), or one
self-contained table per concrete type (TPC). This concept shows the real schema
and SQL that each strategy produces on EF Core 10 with SQLite, what silently goes
wrong when a derived type is not declared, how keys and foreign keys behave, and
how to choose.

## Use Cases

- A payments, notifications or documents model where the subtypes share most
  columns and differ by two or three.
- A legacy database where `Payments` already has a `Kind` column that must become
  a discriminator.
- Deciding whether a hierarchy that is queried mostly through its leaf types
  should be TPH or TPC.
- Reviewing a migration that adds a new subtype and wondering what it will do to
  production tables.

## Deep Dive

### Derived types must be declared

The examples use this model:

```csharp
public class Payment { public int Id { get; set; } public decimal Amount { get; set; } }
public class CardPayment : Payment { public string Last4 { get; set; } = ""; }
public class PixPayment : Payment { public string Key { get; set; } = ""; }
```

EF Core does not scan for subclasses. If the model only contains `Payment`, a
`CardPayment` instance is accepted by `Add` and saved as a plain `Payment`:

```csharp
b.Entity<Payment>();                                   // CardPayment never declared
db.Add(new CardPayment { Amount = 10, Last4 = "4242" });
db.SaveChanges();                                       // saved, no error
// table "Payments": ("Id", "Amount")   <- Last4 does not exist anywhere
```

There is no exception and `Last4` is lost. Declare the derived types with a
`DbSet`, or with `b.Entity<CardPayment>()` and `b.Entity<PixPayment>()`. The
rest of this concept assumes that.

### TPH: one table, a discriminator

TPH is the default. The schema for the three types:

```sql
CREATE TABLE "Payments" (
    "Id" INTEGER NOT NULL CONSTRAINT "PK_Payments" PRIMARY KEY AUTOINCREMENT,
    "Amount" TEXT NOT NULL,
    "Discriminator" TEXT NOT NULL,
    "Last4" TEXT NULL,
    "Key" TEXT NULL
)
```

`Last4` and `Key` are declared with non-nullable C# strings, yet the columns are
nullable: a `PixPayment` row has no `Last4`. That is the cost of TPH, the
database cannot enforce "a card payment must have `Last4`" with `NOT NULL`. A
query for the base type reads everything; a query for a leaf adds a filter:

```csharp
db.Payments.OfType<CardPayment>().Where(c => c.Last4 == "4242")
```
```sql
SELECT "p"."Id", "p"."Amount", "p"."Discriminator", "p"."Last4"
FROM "Payments" AS "p"
WHERE "p"."Discriminator" = 'CardPayment' AND "p"."Last4" = '4242'
```

You can rename the column and use readable values:

```csharp
b.Entity<Payment>().HasDiscriminator<string>("Kind")
    .HasValue<Payment>("base").HasValue<CardPayment>("card").HasValue<PixPayment>("pix");
```

The column becomes `"Kind" TEXT NOT NULL`. The discriminator can also be mapped
to a real property. If the table holds a value that no entity type maps, reading
the base type throws ("No discriminators matched the discriminator value
'Mystery'"). `HasDiscriminator().IsComplete(false)` makes EF Core filter even the
base query, so unknown kinds are skipped instead of failing:

```sql
WHERE "p"."Discriminator" IN ('Payment', 'CardPayment', 'PixPayment')
```

### Sibling properties and shared columns

If `CardPayment` and `PixPayment` both declare `string Reference`, TPH creates two
columns, `Reference` and `PixPayment_Reference`. When the two are really the same
data, point them at one column:

```csharp
b.Entity<CardPayment>().Property(x => x.Reference).HasColumnName("Reference");
b.Entity<PixPayment>().Property(x => x.Reference).HasColumnName("Reference");
// one nullable column "Reference" in "Payments"
```

The docs warn that a cast such as `(p as PixPayment).Reference` on a shared
column does not add the discriminator predicate, so it can also return values
that belong to sibling rows.

### TPT: a table per type

```csharp
b.Entity<Payment>().UseTptMappingStrategy();
```

The base table keeps the common columns and each derived table has its own
columns plus a primary key that is also a foreign key to the base:

```sql
CREATE TABLE "CardPayment" (
    "Id" INTEGER NOT NULL CONSTRAINT "PK_CardPayment" PRIMARY KEY,
    "Last4" TEXT NOT NULL,
    CONSTRAINT "FK_CardPayment_Payments_Id" FOREIGN KEY ("Id") REFERENCES "Payments" ("Id") ON DELETE CASCADE
)
```

Now `Last4` is `NOT NULL`. The price is in the queries. Reading the whole
hierarchy joins every derived table, and the type is inferred from which join
matched:

```sql
SELECT "p"."Id", "p"."Amount", "c"."Last4", "p0"."Key", CASE
    WHEN "p0"."Id" IS NOT NULL THEN 'PixPayment'
    WHEN "c"."Id" IS NOT NULL THEN 'CardPayment'
END AS "Discriminator"
FROM "Payments" AS "p"
LEFT JOIN "CardPayment" AS "c" ON "p"."Id" = "c"."Id"
LEFT JOIN "PixPayment" AS "p0" ON "p"."Id" = "p0"."Id"
```

Even `OfType<CardPayment>()` still starts from `Payments` and joins. The number
of joins grows with the number of subtypes.

### TPC: a table per concrete type

```csharp
b.Entity<Payment>().UseTpcMappingStrategy();
```

Each table repeats the inherited columns (`Amount` appears in `CardPayment`,
`PixPayment` and `Payments`) and there is no `Discriminator`. If the base class is
`abstract`, it gets no table at all. Querying the base type becomes a
`UNION ALL`, but a leaf type reads one table with no filter:

```sql
SELECT "c"."Id", "c"."Amount", "c"."Last4", 'CardPayment' AS "Discriminator"
FROM "CardPayment" AS "c"
```

Two consequences matter. First, keys must be unique across the whole hierarchy,
and an identity column cannot do that because there is no shared table. SQL Server
uses a shared sequence by default; SQLite has neither sequences nor seed and
increment, so on SQLite the first attempt to save three new entities with
`Id = 0` failed with "another instance with the same key value for {'Id'} is
already being tracked". Assign the keys yourself, or use GUIDs. Second, a foreign
key that points at the base type cannot be enforced:

```csharp
public class Refund { public int Id { get; set; } public int PaymentId { get; set; } public Payment Payment { get; set; } = null!; }
// table "Refund": ("Id", "PaymentId") with no FOREIGN KEY at all
db.Add(new Refund { Payment = new CardPayment { Id = 7, ... } }); // no complaint about a missing row
```

With TPT the same `Refund` table gets `FOREIGN KEY ("PaymentId") REFERENCES
"Payments" ("Id")`. With TPC, integrity depends on every writer going through
EF Core.

### Choosing

The EF Core docs say TPH is a good default and that TPT is inferior in most
benchmarks, because it joins. Their sample benchmark (35000 rows, a 7-type
hierarchy, on their hardware) loaded everything in about 149 ms for TPH, 313 ms
for TPT and 158 ms for TPC, and they stress that you should measure your own
queries. EF Core 10 did not change the inheritance strategies; TPC arrived in EF
Core 7.

## Trade-offs

- **TPH gives up NOT NULL.** One wide table, no joins, but derived columns are
  nullable and rules like "card payments need `Last4`" move to code or to a
  `CHECK` constraint you write in a migration.
  ```csharp
  b.Entity<Payment>().ToTable(t => t.HasCheckConstraint("CK_Card", "Discriminator <> 'CardPayment' OR Last4 IS NOT NULL"));
  ```
- **TPT is the cleanest schema and usually the slowest.** Every query for the base
  type joins all derived tables. Choose it when something outside your control,
  such as an existing normalized database, requires it.
- **TPC is fast for leaf queries and weak on integrity.** Querying the base type
  unions all tables, there is no foreign key to the base, and keys need a
  strategy that spans tables.
- **Evolving the schema differs.** A new subtype is new nullable columns in
  TPH, a new table in TPT and TPC. A new column on the base class is one column in
  TPH and TPT, but one column in every concrete table in TPC.
- **Discriminator values are stored data.** Renaming a class does not rename the
  strings already in the column, so give the values explicit names with
  `HasValue` when the table will outlive the code.

## Documentation Links

- [Inheritance, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/inheritance) (doc)
- [Modeling for performance, inheritance mapping, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/performance/modeling-for-performance#inheritance-mapping) (doc)
- [What's new in EF Core 7, table-per-concrete-type mapping, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-7.0/whatsnew#table-per-concrete-type-tpc-inheritance-mapping) (doc)
- [SQLite EF Core database provider limitations, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/sqlite/limitations) (doc)
- [What's new in EF Core 10, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-10.0/whatsnew) (doc)
