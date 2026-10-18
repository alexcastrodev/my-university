---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

The mapping concept showed how a value object becomes a few extra columns on its
owner's row, through an owned type or a complex type. This concept is about the
other storage option: putting the whole value, or a list of values, into a single
JSON column. EF Core 10 made complex types the recommended way to do it, added
collections of complex types, and taught `ExecuteUpdate` to change properties
inside the document. The focus here is what really reaches the database: the
column, the SQL generated to read and write inside the JSON, and where translation
stops. Every SQL listing below was logged from a run on SQLite with
`Microsoft.EntityFrameworkCore.Sqlite` 10.0.13; statements about SQL Server and
PostgreSQL come from their documentation and were not run.

## Use Cases

- A customer with a list of shipping addresses that is always read and written
  with the customer, where a child table would only add a join.
- User preferences or feature settings whose shape changes often and that nobody
  queries across rows, except for one or two fields.
- Tags or labels stored as a `List<string>` without a join table.
- A one-off data fix that changes one field inside the JSON of thousands of rows
  without loading them.

## Deep Dive

### One column per value object

The model below has a primitive collection, two complex properties (one
optional), a complex collection, and, for comparison, an owned type, all mapped
to JSON:

```csharp
class Customer
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public List<string> Tags { get; set; } = [];        // primitive collection
    public required Address Address { get; set; }       // complex, required
    public Address? Billing { get; set; }               // complex, optional (EF Core 10)
    public List<Address> Shipping { get; set; } = [];   // complex collection (EF Core 10)
    public required Prefs Prefs { get; set; }           // owned, for comparison
}
record Address(string Street, string City, string Country);

modelBuilder.Entity<Customer>(b =>
{
    b.ComplexProperty(c => c.Address, a => a.ToJson());
    b.ComplexProperty(c => c.Billing, a => a.ToJson());
    b.ComplexCollection(c => c.Shipping, a => a.ToJson());
    b.OwnsOne(c => c.Prefs, p => p.ToJson());
});
```

`GenerateCreateScript()` on SQLite gives one `TEXT` column per property, `NULL`
only for the optional one, and the rows store plain JSON (keys came out in
alphabetical order):

```
"Tags" TEXT NOT NULL      ["vip","beta"]
"Address" TEXT NOT NULL   {"City":"Lisboa","Country":"PT","Street":"Rua A"}
"Billing" TEXT NULL       NULL
"Shipping" TEXT NOT NULL  [{"City":"Porto","Country":"PT","Street":"Dock 1"}, ...]
```

`Tags` needed no configuration: since EF Core 8, a collection of primitives is
mapped to a JSON array by convention. The column type is the provider's choice.
According to What's new in EF Core 10, SQL Server uses the native `json` type when
you call `UseAzureSql` or set compatibility level 170 (SQL Server 2025), and
existing `nvarchar` JSON columns are converted by the next migration unless you
pin the column type. The Npgsql documentation says `ToJson` has been supported
since provider 8.0, recommends `jsonb` over `json`, and recommends complex types
over owned types from EF Core 10 on.

### What EF Core 10 changed

Before EF Core 10, JSON mapping existed only for owned types (since EF Core 7).
EF Core 10 adds, for complex types: `ToJson`, optional complex properties,
collections through `ComplexCollection`, and `struct` complex types. The model
validation confirms the rules, with these messages from my run:

```
ComplexCollection without ToJson  -> "must be mapped to a JSON column"
List<Point> (record struct)       -> "complex value type collections are not supported"
Note? with only nullable members  -> fails as columns ("requires at least one required
                                     property"), works with ToJson
```

The official guidance is to prefer complex types over owned types for JSON and
for table splitting, because owned types carry a hidden key: the same instance
cannot be assigned twice, comparisons are by identity, and, as shown below,
`ExecuteUpdate` does not work on them.

### Querying inside the document

Filters, ordering and projections on members inside the JSON translate to the
provider's JSON functions. On SQLite, EF Core 10 emits the `->>` operator and
`json_each`:

```csharp
db.Customers.Where(c => c.Address.City == "Lisboa")
// WHERE "c"."Address" ->> 'City' = 'Lisboa'

db.Customers.Where(c => c.Tags.Contains("vip"))
// WHERE 'vip' IN (SELECT "t"."value" FROM json_each("c"."Tags") AS "t")

db.Customers.Where(c => c.Shipping.Any(s => s.Country == "ES"))
// WHERE EXISTS (SELECT 1 FROM (
//     SELECT "s"."value" ->> 'Country' AS "Country"
//     FROM json_each("c"."Shipping", '$') AS "s") AS "s0"
//   WHERE "s0"."Country" = 'ES')

db.Customers.Select(c => c.Shipping[0].City)            // "c"."Shipping" ->> '$[0].City'
db.Customers.Select(c => c.Tags.Count)                  // json_array_length("c"."Tags")
db.Customers.OrderBy(c => c.Address.City)               // ORDER BY "c"."Address" ->> 'City'
```

`GroupBy` on a JSON member, `ToUpper().StartsWith(...)` on one, and `Distinct`
over a projected collection also translated. One trap while checking this:
`ToQueryString()` printed the `json_each` subqueries with an empty `FROM ( )`,
although the query ran correctly. The SQL in the `LogTo` output is the one that
executed, so read that one.

### What does not translate

Three failures and one surprise came out of the same run:

- A C# method over the value (`Where(c => Util.IsEu(c.Address))`) throws "could
  not be translated", like any other method EF Core does not know.
- `SelectMany(c => c.Shipping)` threw "requires the SQL APPLY operation, which is
  not supported on SQLite". This is a SQLite limitation, and the same query may
  translate on another provider.
- `ExecuteUpdate` on a property of an owned JSON type throws, with a message that
  suggests mapping the type as a complex type instead.
- Comparing whole values, `Where(c => c.Billing == c.Address)`, translated to
  `"c"."Billing" = "c"."Address"`, a comparison of JSON text. After rewriting
  `Billing` with the same values but different key order, the query returned no
  rows, while `ana.Billing == ana.Address` in .NET was `true`. Comparing with a
  parameter did the same: the parameter is serialized and compared as text. On
  SQLite, value equality holds only for documents that EF Core itself wrote.

### Writing: SaveChanges and ExecuteUpdate

With `SaveChanges`, the complex JSON column was always rewritten whole. Changing
one city with `with`, mutating a property of a mutable complex class in place,
replacing one element of the collection, or adding one, all produced:

```sql
UPDATE "Customers" SET "Shipping" = @p0 WHERE "Id" = @p1 RETURNING 1;
```

The owned JSON type behaved differently: changing one property produced a
partial update, `SET "Prefs" = json_set("Prefs", '$.Theme', @p0)`, and changing
two properties went back to rewriting the whole document. These are observations
on SQLite with 10.0.13, not documented guarantees.

`ExecuteUpdate` is where EF Core 10 adds real power. It can now target members
inside a complex JSON column and emits a partial update:

```csharp
await db.Customers
    .Where(c => c.Address.Country == "PT")
    .ExecuteUpdateAsync(s => s.SetProperty(c => c.Address.City, c => c.Address.City + "!"));
```

```sql
UPDATE "Customers" AS "c"
SET "Address" = json_set("c"."Address", '$.City', ("c"."Address" ->> 'City') || '!')
WHERE "c"."Address" ->> 'Country' = 'PT'
```

Setting a whole complex value or a whole primitive collection sends one
serialized parameter. For SQL Server 2025, the release notes show the same
operation using the `json` type's `modify` method, and older SQL Server versions
are supported with `nvarchar(max)` columns.

Indexing into a collection inside `ExecuteUpdate` also works, and it is where I
found the sharpest edge. `SetProperty(c => c.Shipping[0].City, "X")` without a
filter became `json_set("c"."Shipping", '$[0].City', @p)` for every row. For a
customer whose list was empty, SQLite created the element, so the column became
`[{"City":"X"}]`. Loading that customer did not throw: it returned an `Address`
with `Street` and `Country` set to `null`, even though both are non-nullable
`string`. Nothing in the database checks the shape of the JSON, so filter on the
collection first (`Where(c => c.Shipping.Count > 0)`).

## Trade-offs

- **No schema inside the column.** The database checks the column, not the
  document. A bulk update, a manual fix, or another service can write a shape your
  types do not expect, and EF Core materializes it anyway.
  ```csharp
  .ExecuteUpdateAsync(s => s.SetProperty(c => c.Shipping[0].City, "X")); // [] became [{"City":"X"}]
  ```
- **Querying inside JSON is slower to index.** A filter on `Address ->> 'City'`
  cannot use a normal column index. The complex types page lists indexes on paths
  inside complex types as an EF Core 11 feature, so on EF Core 10 an expression
  index has to be created in a migration with raw SQL, if the database supports
  one. If you filter on a field often, it probably wants to be a real column.
- **Writes can be bigger than the change.** In the SQLite run, changing one city
  rewrote the whole `Shipping` array. Large documents that change often cost more
  than the same data in rows.
- **Text equality is not value equality.** Comparing two JSON values in a query
  compared strings on SQLite, so key order and formatting decide the result.
  ```csharp
  db.Customers.Where(c => c.Billing == c.Address) // false after reordering keys
  ```
- **Owned JSON types are a dead end for bulk work.** They reject `ExecuteUpdate`
  and carry a hidden identity. In my run both kinds stored the same JSON shape
  (property names as keys), so switching is mostly a configuration change, but
  generate a migration and read it before trusting that.
- **Provider behavior differs.** `SelectMany` over a JSON collection failed on
  SQLite, the column type differs per provider, and partial updates are generated
  differently. Run integration tests against the database you deploy on.

## Lab

In this lab you store value objects and lists in JSON columns with EF Core 10 complex types, query inside the document and change one member of it, both with a single statement and through change tracking. You receive the `Customer` entity and the `ShopDbContext` with nothing mapped, and the queries in `CustomerQueries` throw `NotImplementedException`. The core idea is to see that without the mapping `Address` becomes nothing useful, and that with it EF translates filters on JSON members into SQL and knows how to update a piece of the document.

**The scenario**

A customer has a required address, an optional billing address, a list of shipping addresses and a list of tags.

- `Customer.cs`: `Customer` (`Address`, `Billing?`, `Shipping` as `List<Address>`, `Tags` as `List<string>`) and the `record Address(Street, City, Country)`.
- `ShopDbContext.cs`: `OnModelCreating` with the mapping `TODO`s.
- `CustomerQueries.cs`: the queries and updates to implement.

The tests run on in-memory SQLite, seed three customers (Ana, Bruno, Clara) and inspect the stored JSON with `json_extract`. Notice that `Tags` needs no configuration: find out why (it is a collection of primitives).

**What you will do, step by step**

1. **Map the complex types (TODO-00 to TODO-02).** In `OnModelCreating`, map `Address` as a complex property stored in one JSON column, do the same for the optional `Billing`, and map `Shipping` as a complex collection in a JSON column.
2. **Filter inside the JSON (TODO-03).** In `NamesByCityAsync`, return, ordered, the names of customers whose `Address.City` equals the requested city.
3. **Primitive collection (TODO-04).** In `NamesWithTagAsync`, filter customers whose `Tags` list contains the tag.
4. **Complex collection (TODO-05).** In `NamesShippingToAsync`, use `Shipping.Any(...)` to find customers with at least one shipping address in the country.
5. **Change through tracking (TODO-06).** In `MoveAsync`, load the customer, replace the `Address` with a copy that has the new city (it is a record) and call `SaveChanges`.
6. **Change in bulk (TODO-07).** In `AppendToCityAsync`, write one `ExecuteUpdate` that appends a suffix to `Address.City` of every customer in the country, without loading entities, and return the affected row count.

**How you know you are done**

`dotnet test` is green. You should be able to explain the difference between replacing the whole complex value (TODO-06) and updating one member inside the document (TODO-07), and why the query by city does not load any customer into memory to filter.

**Optional challenges**

- **TODO-08:** update `Shipping[0].City` in bulk without creating elements for customers with an empty list (without that filter SQLite creates a half-empty element).
- **TODO-09:** read the stored JSON text of an address with raw SQL (`Database.SqlQuery<string>`, with the column aliased as `Value`).

**Prerequisites:** basic EF Core and LINQ, C# records and the .NET 10 SDK.

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. The tests use in-memory SQLite. Each query method throws `NotImplementedException` with a `TODO-NN` comment and, without the mapping, the read and write tests also fail, so the list of red tests is your checklist.

## Documentation Links

- [Complex types, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/complex-types) (doc)
- [What's new in EF Core 10, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-10.0/whatsnew) (doc)
- [What's new in EF Core 8, primitive collections, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-8.0/whatsnew#primitive-collections) (doc)
- [ExecuteUpdate and ExecuteDelete, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/saving/execute-insert-update-delete) (doc)
- [Owned entity types, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/owned-entities) (doc)
- [JSON data type, SQL Server, Microsoft Learn](https://learn.microsoft.com/en-us/sql/t-sql/data-types/json-data-type) (doc)
- [JSON mapping, Npgsql EF Core provider](https://www.npgsql.org/efcore/mapping/json.html) (doc)
- [SQLite EF Core database provider limitations, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/sqlite/limitations) (doc)
