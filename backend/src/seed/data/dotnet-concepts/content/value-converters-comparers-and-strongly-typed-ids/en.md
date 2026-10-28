---
version: 1.0
updatedAt: 2026-10-28
---
## Objective

A value converter lets a property keep a domain type (`Email`, `Money`, `ProductId`, an enum) while the column stores something the database understands (a string, a decimal, a `Guid`). It is one of the most used EF Core features and one of the easiest to get subtly wrong: nulls bypass it, queries cannot look inside the converted type, mutable types need a value comparer or their changes are never saved, and a converted `Guid` key stops being generated. This concept runs each of those cases on EF Core 10 and shows what reached the database: built-in and custom `ValueConverter<TModel,TProvider>` types, `ConfigureConventions` for every property of a type, query translation and its failures, the `ValueComparer` bug and its fix, key comparers, strongly-typed ids as primary and foreign keys and over HTTP in a Minimal API, the built-in converters worth knowing, the cost per row, and when a complex type, an owned type or an entity fits better. The model-building concept already covers where configuration lives and why pre-convention configuration beats annotations; this one assumes it. Versions used: SDK 10.0.100 (ASP.NET Core runtime 10.0.0), `Microsoft.EntityFrameworkCore.Sqlite` 10.0.14, `Npgsql.EntityFrameworkCore.PostgreSQL` 10.0.3 against PostgreSQL 18.6.

## Use Cases

- Storing an enum as readable text, a `Money` value object as `numeric(18,2)` and an `Email` as a lowercased `varchar(254)`, while the entity keeps the domain types.
- Giving every aggregate a typed id (`ProductId`, `OrderId`) so that a product id can never be passed where an order id is expected, from the route to the column.
- Keeping a small list of tags in one column without losing changes made with `Add` or `Remove`.
- Normalizing values on the way in and out, such as `DateTime` always stored as UTC ticks.

## Deep Dive

### One converter per value

The entity keeps its domain types. Three properties get a converter, written three ways:

```csharp
public enum Status { Active, Pending, Archived }
public sealed record Email(string Value);
public readonly record struct Money(decimal Amount);
public class MoneyConverter() : ValueConverter<Money, decimal>(m => m.Amount, d => new Money(d));
public class EmailConverter() : ValueConverter<Email, string>(e => e.Value.ToLowerInvariant(), s => new Email(s));
// ConfigureConventions(ModelConfigurationBuilder b): one rule for every property of the type
b.Properties<Money>().HaveConversion<MoneyConverter>().HavePrecision(18, 2);
b.Properties<Email>().HaveConversion<EmailConverter>().HaveMaxLength(254);
// OnModelCreating: per property
c.Property(x => x.Status).HasConversion<string>().HasMaxLength(16);   // shortcut: EF picks the converter
c.Property(x => x.SeenAt).HasConversion(new ValueConverter<DateTime, long>(
    d => d.ToUniversalTime().Ticks, t => new DateTime(t, DateTimeKind.Utc)));
```

`HasConversion<string>()` names only the provider type; reading the model back, the property carried an `EnumToStringConverter<Status>`, the same class you would create by hand. The explicit `ValueConverter` instance is what you write when the conversion is yours or is shared. `GenerateCreateScript()` shows that the facets set next to the converter land on the converted column, and that `Email` and `Email?` (`Backup`) share one converter:

```text
SQLite                                    PostgreSQL
"Status" TEXT NOT NULL                    "Status" character varying(16) NOT NULL
"Email" TEXT NOT NULL                     "Email" character varying(254) NOT NULL
"Backup" TEXT NULL                        "Backup" character varying(254)
"Balance" TEXT NOT NULL                   "Balance" numeric(18,2) NOT NULL
"SeenAt" INTEGER NOT NULL                 "SeenAt" bigint NOT NULL
```

I saved `Status.Pending`, `new Email("Ana@X.io")`, `new Money(12.5m)` and a local `DateTime` of 10:00, with the process running under `TZ=America/Sao_Paulo`, on PostgreSQL:

```text
stored:    Pending | ana@x.io | NULL | 12.50 | 639287892000000000
read back: Pending Email { Value = ana@x.io } Money { Amount = 12.50 } 2026-10-28T13:00:00.0000000Z Utc
```

The email was lowercased by the converter, and the local 10:00 came back as 13:00 UTC with `Kind = Utc`. Two notes from the same run: the length 254 does not appear in the SQLite DDL (SQLite has no lengths), and `ConfigureConventions` applies to every `Money` and `Email` property in the model, including ones added next year.

### Null never reaches the converter

The docs say a `null` is never passed to a converter: null in the column is null on the entity and vice versa. I mapped an optional `Email?` with a converter that would throw on null (`e => e!.Value`) and saved a contact without an email:

```text
stored Email: NULL      read back Email is null: True
Where(c => c.Email == null)  ->  WHERE "c"."Email" IS NULL
```

No exception. The converter can only ever see non-null values, which is why one converter serves `Email` and `Email?`. Converting null itself is possible through a constructor flag, `convertsNulls: true`, but the compiler flags it: `warning EF1001: ... is an internal API that supports the Entity Framework Core infrastructure`. I tried it anyway, mapping `string? Nick` to `""` in the database:

```csharp
c.Property(x => x.Nick).HasConversion(new ValueConverter<string?, string>(
    v => v ?? "", s => s == "" ? null : s, convertsNulls: true));
// stored Nick: '' (an empty string)          read back Nick is null: True
// Where(c => c.Nick == null)  ->  WHERE "c"."Nick" IS NULL     count: 0
```

Writing and reading agreed, but the query still translated `== null` to `IS NULL` and found nothing, while the row's `Nick` was null in .NET. The XML docs of that constructor warn about exactly this (broken queries, GitHub issue 26230). Keep nulls as nulls.

### Queries on converted members

Inside a query, EF Core can treat a converted property only as a whole value: it converts the parameter and compares columns. I ran each of these against three customers on SQLite (the PostgreSQL SQL is shown where it differs):

```text
c.Email == new Email("B@X.IO")       WHERE "c"."Email" = @target   (@target = 'b@x.io')    1 row
list.Contains(c.Email)               WHERE "c"."Email" IN (@list1, @list2)                 2 rows
                                     PostgreSQL: WHERE c."Email" = ANY (@list)
c.Email.Value.Contains("x.io")       InvalidOperationException (could not be translated)
c.Email.Value.ToUpper() == "A@X.IO"  InvalidOperationException (could not be translated)
c.Balance.Amount > 5                 InvalidOperationException (could not be translated)
c.Status > Status.Pending            WHERE "c"."Status" > 'Pending'                        0 rows
OrderBy(c => c.Status)               Active, Archived, Pending
```

The equality worked even with different casing, because the parameter went through `EmailConverter` too. Reaching a member of the value object failed with the standard message:

```text
The LINQ expression 'DbSet<Customer>()
    .Where(c => c.Email.Value.ToUpper() == "A@X.IO")' could not be translated. Either rewrite the query in a form that can be translated, or switch to client evaluation explicitly by inserting a call to 'AsEnumerable', 'AsAsyncEnumerable', 'ToList', or 'ToListAsync'.
```

The docs list this as a known limitation (issue 10434) and point to JSON columns instead. The enum comparison is the quiet one: in C#, `Archived > Pending` is true, but the database compared the strings `'Archived'` and `'Pending'` and returned no row, and `OrderBy` sorted alphabetically. Store enums as numbers if you sort or range-filter on them. One cast did translate on both providers: `((string)(object)c.Email).Contains("x.io")` became `instr(CAST("c"."Email" AS TEXT), 'x.io') > 0` on SQLite and `c."Email"::text LIKE '%x.io%'` on PostgreSQL, and `Sum(c => (decimal)(object)c.Balance)` returned 30.0. I did not find this on the value conversions page, so cover it with a test if you rely on it.

### Mutable types need a ValueComparer

Change tracking works by snapshot: EF Core copies each value when the entity is loaded and compares at `SaveChanges`. The docs say that for a converted type it uses the type's `Equals` and, for a reference type, keeps the same reference as the snapshot, so a mutated object compares equal to itself. I stored `List<string> Tags` as a comma-joined string with `HasConversion(to, from)` only. The model validation logged:

```text
warn: CoreEventId.CollectionWithoutComparer[10620] (Microsoft.EntityFrameworkCore.Model.Validation)
      The property 'Post.Tags' is a collection or enumeration type with a value converter but with no value comparer. Set a value comparer to ensure the collection/enumeration elements are compared correctly.
```

Then I loaded a post, called `post.Tags.Add("sqlite")` and `post.Blob[0] = 9` (a plain `byte[]`, no converter), `DetectChanges()`, and saved:

```text
Post {Id: 1} Unchanged
    Blob: '0x090203'
    Tags: 'System.Collections.Generic.List`1[System.String]'
SaveChanges returned 0             (no UPDATE in the log)
in the database: ef,dotnet | 010203
```

Both edits were lost without an error. The docs explain the `byte[]` case: non-key arrays are compared by reference on purpose, so replacing the array is detected and mutating it is not. The fix is a comparer with equality, hash and snapshot expressions, where the snapshot must be a deep copy:

```csharp
p.Property(x => x.Tags).HasConversion(to, from, new ValueComparer<List<string>>((a, b) => a!.SequenceEqual(b!),
    l => l.Aggregate(0, (h, s) => HashCode.Combine(h, s.GetHashCode())),
    l => l.ToList()));
p.Property(x => x.Blob).Metadata.SetValueComparer(new ValueComparer<byte[]>((a, b) => a!.SequenceEqual(b!), a => a.Aggregate(0, (h, x) => HashCode.Combine(h, x)), a => a.ToArray()));
```

```text
Post {Id: 1} Modified
    Blob: '0x090203' Modified Originally '0x010203'
    Tags: 'System.Collections.Generic.List`1[System.String]' Modified Originally 'System.Collections.Generic.List`1[System.String]'
UPDATE "Posts" SET "Blob" = @p0, "Tags" = @p1 WHERE "Id" = @p2 RETURNING 1;
SaveChanges returned 1             in the database: ef,dotnet,sqlite | 090203
```

The warning disappeared. For a new design, a `List<string>` needs no converter at all: EF Core maps primitive collections to JSON by convention (see the JSON columns concept). The docs say immutable classes with value equality, and structs, need no comparer either, which is the main reason to make value objects immutable.

The same comparer decides key identity: which tracked entity a key belongs to, and what `Find` can answer from memory. I made an id a plain class without `Equals` (`sealed class ShopId(Guid value)`), saved a shop, then called `Find(new ShopId(g))` and `Attach` with another instance carrying the same Guid:

```text
no comparer:   Find -> SELECT ... FROM "Shops" (went to the database)   Attach duplicate key: accepted, tracked=3
with comparer: Find -> no SQL (identity map)                            Attach duplicate key: "The instance of entity type 'Shop' cannot be tracked because another instance with the same key value..."
```

Without a comparer, one row ended up tracked three times. The model reported a separate provider-side comparer too (`GetProviderValueComparer()` was the default one for `Guid`); `HasConversion(converter, valueComparer, providerValueComparer)` sets both, and the docs mention `SetKeyValueComparer` for the rare case where keys need different semantics. A `record` or `record struct` id gets value equality for free and avoids all of this.

### Strongly-typed ids

One marker interface, one generic converter, and a reflection loop in `ConfigureConventions` cover every id type:

```csharp
public interface IStrongId { Guid Value { get; } }
public readonly record struct ProductId(Guid Value) : IStrongId;
public readonly record struct OrderId(Guid Value) : IStrongId;
public class StrongIdConverter<T>() : ValueConverter<T, Guid>(id => id.Value, FromGuid()) where T : struct, IStrongId
{
    static Expression<Func<Guid, T>> FromGuid()   // g => new T(g): C# has no "new T(arg)" for a type parameter
    { var g = Expression.Parameter(typeof(Guid)); return Expression.Lambda<Func<Guid, T>>(Expression.New(typeof(T).GetConstructor([typeof(Guid)])!, g), g); }
}
// ConfigureConventions
foreach (var t in typeof(IStrongId).Assembly.GetTypes().Where(t => t.IsValueType && typeof(IStrongId).IsAssignableFrom(t)))
    b.Properties(t).HaveConversion(typeof(StrongIdConverter<>).MakeGenericType(t));
```

The shorter `b.Properties<IStrongId>().HaveConversion(typeof(StrongIdConverter<>))` compiled but did not apply: model building failed with "The 'ProductId' property 'Product.Id' could not be mapped because the database provider does not support this type." With the loop, `Product.Id`, `Order.Id` and the foreign key `Order.ProductId` became `TEXT` on SQLite (`Product.Id` was `uuid` on PostgreSQL), the relationship and index were created by convention, `Find(prod.Id)` worked, and `Where(o => o.ProductId == prod.Id)` sent a plain parameter.

The trap is value generation. A plain `Guid` key is `ValueGenerated=OnAdd` by convention; the converted one was not:

```text
Product.Id   ValueGenerated=Never   converter=StrongIdConverter`1
after Add: product id = 00000000-0000-0000-0000-000000000000
second Add: The instance of entity type 'Product' cannot be tracked because another instance with the same key value for {'Id'} is already being tracked.
```

With one product, EF Core happily inserted the all-zero Guid. Adding `.ValueGeneratedOnAdd()` to the key fixed it, and ids were assigned client side at `Add`, before `SaveChanges`: `after Add: fbd37c9a-... / f6715b49-...`. The EF Core 7 release notes say converted keys can use generated values if the underlying type supports it; you have to ask. For an `int` id (`SeqId`) with `ValueGeneratedOnAdd`, PostgreSQL created `GENERATED BY DEFAULT AS IDENTITY` and SQLite created `INTEGER ... PRIMARY KEY` without `AUTOINCREMENT` (values 1 and 2 still came from the rowid). The SQLite provider docs say EF Core 10 lets you add `UseAutoincrement()` for a converted key. Alternatively, let the domain create the id (for example a factory that wraps `Guid.CreateVersion7()`) and keep `ValueGeneratedNever`, as the domain mapping concept does.

### The id over HTTP

The id must also cross the API boundary as a plain string. Without help, both sides break. A route parameter of a record struct without `TryParse` does not even compile: `error ASP0020: Parameter 'id' of type RawId should define a bool TryParse(string, IFormatProvider, out RawId) method, or implement IParsable<RawId>`. And System.Text.Json serialized it as an object: `{"id":{"value":"0f8fad5b-..."}}`. Implementing `IParsable<T>` and a small `JsonConverter<T>` fixed both:

```csharp
[JsonConverter(typeof(ProductIdJsonConverter))]
public readonly record struct ProductId(Guid Value) : IParsable<ProductId>
{
    public override string ToString() => Value.ToString();
    public static ProductId Parse(string s, IFormatProvider? p) => new(Guid.Parse(s, p));
    public static bool TryParse([NotNullWhen(true)] string? s, IFormatProvider? p, out ProductId r) { var ok = Guid.TryParse(s, p, out var g); r = new(g); return ok; }
}
public sealed class ProductIdJsonConverter : JsonConverter<ProductId>
{
    public override ProductId Read(ref Utf8JsonReader r, Type t, JsonSerializerOptions o) => new(r.GetGuid());
    public override void Write(Utf8JsonWriter w, ProductId v, JsonSerializerOptions o) => w.WriteStringValue(v.Value);
}
app.MapGet("/products/{id}", (ProductId id) => store.TryGetValue(id, out var p) ? Results.Ok(p) : Results.NotFound());
```

```text
GET  /products/0f8fad5b-d9cb-469f-a165-70867728950e  -> 200 {"id":"0f8fad5b-d9cb-469f-a165-70867728950e","name":"Pen"}
GET  /products/not-a-guid                            -> 400 (empty body)
POST /products {"id":"7c9e6679-...","name":"Ink"}    -> 201 Location: /products/7c9e6679-7425-40de-944b-e07fc1f90ae7
POST /products {"id":"oops","name":"Ink"}            -> 400
```

### Built-in converters and how a Guid is stored

I mapped one row with `BoolToZeroOneConverter<int>`, `DateTimeToBinaryConverter`, `EnumToStringConverter<Status>` and `GuidToBytesConverter`, plus a plain `Guid` key, all set to the Guid `0f8fad5b-d9cb-469f-a165-70867728950e`:

```text
            SQLite                                      PostgreSQL
Id (Guid)   TEXT  0F8FAD5B-D9CB-469F-A165-70867728950E  uuid   0f8fad5b-d9cb-469f-a165-70867728950e
Active      INTEGER 1                                   integer 1
When        INTEGER 5250973802427387904                 bigint 5250973802427387904
S           TEXT Archived                               text Archived
Ref (bytes) BLOB 5BAD8F0FCBD99F46A16570867728950E       bytea 5bad8f0fcbd99f46a16570867728950e
```

SQLite stores a plain `Guid` as uppercase text, 36 characters, while PostgreSQL has a native 16-byte `uuid`. `GuidToBytesConverter` uses .NET byte order, so the first three groups come out reversed (`5BAD8F0F` for `0f8fad5b`): raw SQL or another tool reading that column must know it. `DateTimeToBinaryConverter` (the docs list it as what `HasConversion<long>()` does for a `DateTime`) packs the ticks and the `Kind` into one `long`, unlike the plain ticks of my custom converter. The docs list the rest, such as `BoolToStringConverter`, `TimeSpanToTicksConverter` and `CastingConverter`.

### The cost per value

A converter runs once per value read or written. I loaded 100 000 rows with `AsNoTracking().ToList()` from SQLite in a Release build, 20 timed rounds, alternating order: one entity with `Guid`, `string`, `decimal`, `int`, and one with `ProductId`, `Email`, `Money` and a string enum:

```text
plain:     median 68 ms (min 60, max 99),  allocated 44 MB
converted: median 78 ms (min 72, max 127), allocated 50 MB     (second run: 66 against 78 ms)
```

About 15 percent slower and about 6 MB more, much of it the extra `Email` objects: real, but small next to the database round trip.

### Converter, complex type, owned type or entity

| Need | Use |
|---|---|
| A single value with rules (`Email`, `Money` in one currency, an id, an enum) | Value converter |
| A value object with several fields, replaced whole, queried by field (`Address`, `Money` with currency) | Complex type (columns or JSON) |
| A part with a hidden identity, or an existing owned mapping (the docs now steer new JSON mappings to complex types) | Owned type |
| Something with its own lifecycle, referenced from elsewhere, or a large growing list | Separate entity |

A converter maps to exactly one column and hides the inside of the value from LINQ. A complex type maps each member to a column, or to a JSON column queryable by member, as the JSON columns concept shows.

## Trade-offs

- **The inside of a converted value is invisible to LINQ.** Equality and `Contains` on whole values translate; members, methods and ranges do not, and string enums sort alphabetically.
- **Mutable converted types lose writes silently.** Without a comparer, in-place edits leave the entity `Unchanged`. EF Core warned (event 10620) for the converted `List<string>`, and said nothing about the mutated `byte[]`. Prefer immutable types.
- **Converted Guid keys are not generated by default.** `ValueGenerated=Never` means a forgotten id is the all-zero Guid. Add `ValueGeneratedOnAdd()` or create the id in the domain.
- **A strongly-typed id touches every layer.** Converter, comparer (if a class), `IParsable<T>`, `JsonConverter<T>`, raw SQL parameters (the docs say value-converted types cannot be used as raw SQL parameters). The EF Core docs themselves warn the pattern adds complexity; use it where mixing ids is a real risk.
- **Nulls are not yours to convert.** `convertsNulls` is an internal API and broke `== null` queries in my run.
- **Storage format leaks.** Lowercasing, UTC ticks or `GuidToBytesConverter` byte order are invisible in C# and obvious to every other reader of the table. Choose formats other tools can read.

## Documentation Links

- [Value conversions, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/value-conversions) (doc)
- [Value comparers, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/value-comparers) (doc)
- [Model bulk configuration, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/bulk-configuration) (doc)
- [What's new in EF Core 7, value generation for guarded keys, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-7.0/whatsnew) (doc)
- [SQLite value generation, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/sqlite/value-generation) (doc)
- [Parameter binding in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/parameter-binding?view=aspnetcore-10.0) (doc)
