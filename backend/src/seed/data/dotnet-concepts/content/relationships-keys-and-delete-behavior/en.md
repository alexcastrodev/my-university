---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

A relationship in EF Core is a foreign key plus, optionally, navigations on
either side. Whether that foreign key is nullable decides if the relationship is
required or optional, and that one decision drives the `ON DELETE` clause in the
schema, what `SaveChanges` does when a parent disappears, and whether removing a
child from a collection deletes it. This concept builds one model on SQLite with
EF Core 10, prints the DDL, and runs each delete scenario with the SQL log on,
so every claim below comes with the statement that produced it. It also covers
composite and alternate keys, shadow foreign keys, and many-to-many with skip
navigations.

## Use Cases

- Deciding whether `Product.SupplierId` should be `int` or `int?`, knowing what
  each choice does on delete.
- Explaining a `FOREIGN KEY constraint failed` that appears only in production,
  where the children were not loaded.
- Mapping a legacy table whose key is two columns, or whose children point at an
  email instead of the id.
- Adding a "tagged on" date to a many-to-many without losing the skip navigation.
- Keeping foreign key properties out of a domain class.

## Deep Dive

### The model under test

```csharp
public class Product
{
    public int Id { get; set; }
    public int CategoryId { get; set; }            // int: required
    public Category Category { get; set; } = null!;
    public int? SupplierId { get; set; }           // int?: optional
    public Supplier? Supplier { get; set; }
    public List<Tag> Tags { get; } = [];           // skip navigation
}
public class Review { public int Id { get; set; } public Product Product { get; set; } = null!; } // no FK property

[PrimaryKey(nameof(OrderId), nameof(LineNo))]
public class OrderLine { public int OrderId { get; set; } public int LineNo { get; set; } }

// OnModelCreating
b.Entity<Product>().HasMany(p => p.Tags).WithMany(t => t.Products)
    .UsingEntity<ProductTag>(j => j.Property(e => e.AddedOn).HasDefaultValueSql("CURRENT_TIMESTAMP"));
b.Entity<Order>().HasOne(o => o.Customer).WithMany(c => c.Orders)
    .HasForeignKey(o => o.CustomerEmail).HasPrincipalKey(c => c.Email);
```

`Database.GenerateCreateScript()` prints what EF Core will create (trimmed):

```sql
CREATE TABLE "Products" (
    "Id" INTEGER NOT NULL CONSTRAINT "PK_Products" PRIMARY KEY AUTOINCREMENT,
    "CategoryId" INTEGER NOT NULL,
    "SupplierId" INTEGER NULL,
    CONSTRAINT "FK_Products_Categories_CategoryId" FOREIGN KEY ("CategoryId") REFERENCES "Categories" ("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_Products_Suppliers_SupplierId" FOREIGN KEY ("SupplierId") REFERENCES "Suppliers" ("Id"));
CREATE TABLE "Reviews" ( ..., "ProductId" INTEGER NOT NULL,
    CONSTRAINT "FK_Reviews_Products_ProductId" FOREIGN KEY ("ProductId") REFERENCES "Products" ("Id") ON DELETE CASCADE);
CREATE TABLE "Customers" ( ..., "Email" TEXT NOT NULL, CONSTRAINT "AK_Customers_Email" UNIQUE ("Email"));
CREATE TABLE "OrderLine" ( "OrderId" INTEGER NOT NULL, "LineNo" INTEGER NOT NULL, ...,
    CONSTRAINT "PK_OrderLine" PRIMARY KEY ("OrderId", "LineNo"), ...);
CREATE TABLE "ProductTag" ( "ProductId" INTEGER NOT NULL, "TagId" INTEGER NOT NULL,
    "AddedOn" TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    CONSTRAINT "PK_ProductTag" PRIMARY KEY ("ProductId", "TagId"), ... ON DELETE CASCADE);
CREATE INDEX "IX_Products_SupplierId" ON "Products" ("SupplierId");
```

Four conventions are visible. The required relationship got `ON DELETE CASCADE`;
the optional one got no `ON DELETE` at all, which means the database default,
so the constraint is still enforced. Every foreign key got an index. And `Review`,
which has only a navigation, got a shadow `ProductId` column that is `NOT NULL`
because the navigation is a non-nullable reference type.

### Required versus optional, and the delete behaviors

The `DeleteBehavior` enum configures two things at once: what EF Core does to
tracked dependents, and the `ON DELETE` it writes in the schema. The default is
`Cascade` for required relationships and `ClientSetNull` for optional ones. Only
`Cascade` and `SetNull` make the database act; `ClientSetNull`, `ClientCascade`,
`ClientNoAction` and `NoAction` leave the database default, and `Restrict`
writes `ON DELETE RESTRICT`. The `Client*` values exist so the work happens in
EF Core, on entities it is tracking.

That split is the source of most surprises. Deleting the supplier without
loading its products:

```csharp
db.Remove(db.Suppliers.Single());
db.SaveChanges();
// DbUpdateException: SQLite Error 19: 'FOREIGN KEY constraint failed'.
```

`ClientSetNull` only nulls foreign keys of products in the change tracker, and
there were none. The same delete with `Include(s => s.Products)` works, and the
log shows EF Core doing the work:

```sql
UPDATE "Products" SET "SupplierId" = @p0 WHERE "Id" = @p1 RETURNING 1;
UPDATE "Products" SET "SupplierId" = @p0 WHERE "Id" = @p1 RETURNING 1;
DELETE FROM "Suppliers" WHERE "Id" = @p0 RETURNING 1;
```

Deleting the category without loading anything sent one statement,
`DELETE FROM "Categories" WHERE "Id" = @p0`, and afterwards the counts were
`products left: 0, reviews left: 0, join rows: 0`. The database cascaded from
categories to products, then to reviews and to the join table, none of which
EF Core saw. If you want "set null even when not loaded", configure
`OnDelete(DeleteBehavior.SetNull)` so the database does it.

### Orphans

A required dependent cannot exist without a principal, so severing it deletes it.
Removing a loaded product from `category.Products` produced:

```sql
DELETE FROM "Products" WHERE "Id" = @p0 RETURNING 1;
```

No `Remove` was called on the product. In an optional relationship the same code
sets the foreign key to null instead. Databases have no notion of orphans, so
this only works when both sides are loaded; the official cascade delete page has
the full matrix of behavior, loaded versus not loaded.

### Composite and alternate keys

Conventions never invent a composite key for a normal entity; you declare it with
`[PrimaryKey]` (EF Core 7 and later) or `HasKey(x => new { x.OrderId, x.LineNo })`.
An alternate key is a second unique identifier that can be the target of a
foreign key. `HasPrincipalKey(c => c.Email)` created one by convention, named
`AK_Customers_Email`. Alternate keys are read-only in EF Core:

```csharp
customer.Email = "ana@new.example.com";
db.SaveChanges();
// InvalidOperationException: The property 'Customer.Email' is part of a key and so
// cannot be modified or marked as modified. ...
```

If you only need uniqueness, use a unique index (`HasIndex(...).IsUnique()`),
which stays updatable. Use an alternate key when another table really joins on
that column, which is common in legacy schemas.

### Shadow foreign keys

`Review` has no `ProductId` property, yet the column exists and can be queried:

```csharp
db.Reviews.Select(r => new { r.Text, ProductId = EF.Property<int>(r, "ProductId") }).Single();
// SELECT "r"."Text", "r"."ProductId" FROM "Reviews" AS "r" LIMIT 2
// { Text = great, ProductId = 1 }
```

Shadow keys keep the domain class clean, which fits the DDD mapping concept, but
the value no longer travels with the object. The docs suggest a private foreign
key property as a compromise when entities are serialized or reattached.

### Many-to-many with skip navigations

`Product.Tags` and `Tag.Products` skip over a join entity. Without `UsingEntity`,
EF Core creates a shared-type join entity and a table named by convention
(`ProductTag` with `ProductsId` and `TagsId`). The documentation says not to
depend on its CLR type, currently `Dictionary<string, object>`. Declaring
`UsingEntity<ProductTag>` keeps the skip navigations and adds a class where a
payload can live, here `AddedOn` with a database default. Reading it back:

```sql
SELECT "p"."ProductId", "p"."TagId", "p"."AddedOn" FROM "ProductTag" AS "p" LIMIT 2
-- join row 1/1 added 2026
```

The composite primary key on the two foreign keys means one association per pair,
and both foreign keys cascade, so deleting either side removes the association.

## Trade-offs

- **`int?` is a delete policy, not just a type.** Making a foreign key nullable
  turns cascade into `ClientSetNull`, which fails if the children are not loaded.
  ```csharp
  b.Entity<Product>().HasOne(p => p.Supplier).WithMany(s => s.Products)
      .OnDelete(DeleteBehavior.SetNull); // database nulls it, loaded or not
  ```
- **Cascade is invisible in the log.** One `DELETE` removed rows in three other
  tables. That is efficient, and also how a soft-delete design ends up hard
  deleting; the docs warn against database cascades with soft delete.
- **Cascade paths are provider-specific.** SQL Server rejects a schema with
  multiple cascade paths to one table; SQLite accepted this model. Switch one
  path to `ClientCascade` or make it optional, and test the real provider.
- **Alternate keys freeze a column.** Joining on `Email` makes email changes
  impossible through EF Core. A surrogate key plus a unique index is easier to
  live with when you own the schema.
- **Shadow keys trade convenience for purity.** Clean classes, but
  `EF.Property` strings in queries and no key in serialized objects.
- **Implicit join entities are hard to extend.** Adding a payload later means a
  class, `UsingEntity<T>` and a migration; start with an explicit join class if
  the association is likely to grow data.

## Documentation Links

- [Introduction to relationships, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/relationships) (doc)
- [Foreign and principal keys in relationships, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/relationships/foreign-and-principal-keys) (doc)
- [Cascade delete, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/saving/cascade-delete) (doc)
- [Many-to-many relationships, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/relationships/many-to-many) (doc)
- [Keys, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/keys) (doc)
- [Shadow and indexer properties, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/shadow-properties) (doc)
- [Changing foreign keys and navigations, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/change-tracking/relationship-changes) (doc)
