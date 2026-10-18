---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

`System.Text.Json` looks simple (`Serialize`, `Deserialize`) and its defaults are
deliberately conservative, which means most surprises come from what it quietly
does not do: a property whose name differs by case is skipped and left at its
default, a missing constructor argument becomes `0` or `null`, a derived type is
written as its base. This concept is about the `JsonSerializerOptions` object
that controls all of that: why you must reuse it (with a measurement of what
happens when you do not), what `JsonSerializerDefaults.Web` and the .NET 10
`Strict` preset change, naming policies, `JsonIgnoreCondition`, numbers and
enums, polymorphism with `[JsonDerivedType]`, `required` members, constructors,
and null handling. Source generation, `JsonNode` and the low-level reader are in
the next concept.

## Use Cases

- Choosing one set of options for an HTTP API so every endpoint and every client
  agrees on casing, enums and nulls.
- Making a configuration or message reader fail loudly on typos and missing
  fields instead of filling in defaults.
- Serializing a class hierarchy (shapes, events, commands) and getting the right
  subtype back.
- Finding out why a field you sent never arrives, or why a hot path allocates
  tens of kilobytes per serialization.

## Deep Dive

### The defaults are lenient on read and silent on loss

All numbers below were produced on .NET 10.0.0 (SDK 10.0.100), macOS 27.0.1,
Apple M4 Max. Start with a positional record and a payload with the wrong casing:

```csharp
record Order(int Id, string Customer, decimal Total, string? Note, Status Status, DateOnly Date);

var json = """{"ID":2,"customer":"Bo","total":1,"status":"Pending"}""";
JsonSerializer.Deserialize<Order>(json);
// Order { Id = 0, Customer = , Total = 0, Note = , Status = Pending, Date = 01/01/0001 }
```

No exception, and not one property was bound: the default matching is
case-sensitive, so every member silently stayed at its default (`Status` shows
`Pending` only because that is the enum's zero value). This is the single most
common serializer bug report, and it is why the options matter more than the
call.

`JsonSerializerDefaults.Web` (or the shared `JsonSerializerOptions.Web`
singleton, available since .NET 9) changes three things: camelCase names on
write, case-insensitive names on read, and `AllowReadingFromString` for numbers.
The docs list exactly these three, and reading the properties back confirmed
them. With the Web options the same payload no longer loses the keys, though it
now fails on `"status":"Pending"` because enums are numbers unless you add a
converter (below). ASP.NET Core uses these web defaults for its own endpoints.

### Reuse the options instance, and know what a "fresh" one costs

The documentation says to reuse `JsonSerializerOptions` instead of creating one
per call, because the type metadata is cached on the instance. I measured it with
a 7-property record, 20,000 calls on one shared instance versus new instances:

| Options per call | Time per `Serialize` | Allocated per call |
|---|---|---|
| one shared instance | 1.0 us | about 540 B |
| `new JsonSerializerOptions(Web)` each time | 1.0 us | about 770 B |
| new options + `new JsonStringEnumConverter()` each time | 58 us | about 33 KB |
| new options + a new custom naming policy object each time | 57 us | about 33 KB |

The second row surprised me: creating a fresh instance with identical settings
was not slower. The reason is in the runtime source (`JsonSerializerOptions.Caching.cs`,
v10.0.0): once an options instance is used, it looks up a shared caching context
among tracked ones, matched by a conservative equality that compares nearly every
setting, with the type-info resolver and each converter compared by reference.
Identical plain settings share metadata. A new converter or policy object does
not match anything, so every call rebuilds the metadata, which is the 58x and the
33 KB. The tracking array holds a limited number of entries (64 in that source),
so do not rely on this cache as a design. The rule that holds regardless: build
the options once, in a static field or the DI container, and pass it everywhere.

An options instance becomes read-only on first use. Changing it afterwards throws
`InvalidOperationException` ("read-only or has already been used"). To derive a
variant, copy it: `new JsonSerializerOptions(shared) { WriteIndented = true }`.
The copy does not carry over the metadata cache, per the docs, so it is a new
instance for cost purposes. `JsonSerializerOptions.Default` and `.Web` are
read-only singletons.

### Names, casing and dictionary keys

`PropertyNamingPolicy` rewrites member names on write and is also applied when
matching on read. Built-in policies: `CamelCase`, `SnakeCaseLower`,
`SnakeCaseUpper`, `KebabCaseLower`, `KebabCaseUpper`. For `FirstName`, `LastName`,
`HTTPCode` the results were:

```csharp
// CamelCase     {"firstName":"a","lastName":"b","httpCode":"c"}
// SnakeCaseLower {"first_name":"a","last_name":"b","http_code":"c"}
// KebabCaseUpper {"FIRST-NAME":"a","LAST-NAME":"b","HTTP-CODE":"c"}
```

Two details that bite: the naming policy does not touch dictionary keys (a key
`FirstKey` stayed `FirstKey`; you need `DictionaryKeyPolicy` for that), and a
`[JsonPropertyName("Custom-Name")]` attribute always wins over any policy.

### Ignoring members and the null/default family

```csharp
record Ign(int Count, string? Note, string Keep, [property: JsonIgnore] string Secret);
new Ign(0, null, "x", "y");
// default            {"Count":0,"Note":null,"Keep":"x"}
// WhenWritingNull    {"Count":0,"Keep":"x"}
// WhenWritingDefault {"Keep":"x"}
```

`JsonIgnoreCondition.WhenWritingDefault` drops everything that equals its type's
default, which includes the number `0` (see `Count` above). That is almost never what an
API wants for a real zero, so prefer `WhenWritingNull` globally and put
`[JsonIgnore(Condition = ...)]` on the one property that needs the other rule.
`[JsonIgnore]` alone means "never", on read and write.

Visibility rules matter for round trips. Public fields are ignored unless
`IncludeFields = true` (or `[JsonInclude]`). A property with a private setter is
skipped on read (it stayed `0`) unless it has `[JsonInclude]`, and a get-only
property is never filled. Unknown JSON members are dropped silently by default.

### Numbers and enums

`long` and `decimal` are written as JSON numbers, so a `long.MaxValue` reaches a
JavaScript client rounded; `JsonNumberHandling.WriteAsString` produces
`{"L":"1","D":"2","I":"3"}` for that case. Reading a quoted number into a `long`
throws by default and works with `AllowReadingFromString`, which the Web preset
turns on. `NaN` and infinity cannot be written unless you opt in with
`AllowNamedFloatingPointLiterals` (otherwise `ArgumentException`), and `1.5`
read into an `int` is a `JsonException`, not a truncation. A `double` writes
`0.1 + 0.2` as `0.30000000000000004` while `decimal` writes `0.3`.

Enums are numbers by default (`Shipped` becomes `1`), and the default reader
accepts any integer, even an undefined one: `7` into a two-member enum gave back
`7` with no error. Add `JsonStringEnumConverter` to write names, and pass
`allowIntegerValues: false` to reject numbers (it then threw on `7`). The same
converter, built with a naming policy, matched `"shipped"` and wrote it back in
camelCase, and a `[Flags]` value became `"Read, Write"`. For trimmed and AOT
builds use the generic `[JsonConverter(typeof(JsonStringEnumConverter<Level>))]`
on the enum, as the next concept explains.

### Polymorphism with [JsonDerivedType]

Without annotation, `System.Text.Json` serializes the static type you ask for.
`Serialize<Animal>(new Dog("Rex", 4))` wrote `{"Name":"Rex"}` and dropped
`Legs`, while `Serialize<object>(...)` wrote `{"Legs":4,"Name":"Rex"}`.
Deserializing always creates the declared type. To round-trip a hierarchy,
declare the derived types and, for reading, a discriminator:

```csharp
[JsonPolymorphic(TypeDiscriminatorPropertyName = "kind")]
[JsonDerivedType(typeof(Circle), "circle")]
[JsonDerivedType(typeof(Square), "square")]
abstract record Shape;
record Circle(double Radius) : Shape;
record Square(double Side) : Shape;

JsonSerializer.Serialize<Shape>(new Circle(2));  // {"kind":"circle","Radius":2}
JsonSerializer.Serialize(new Circle(2));         // {"Radius":2}   (static type is Circle)
JsonSerializer.Deserialize<Shape>("""{"kind":"square","Side":5}""");  // Square { Side = 5 }
```

The default discriminator name is `$type`. Three behaviors I confirmed: an
unknown value throws `JsonException`; the discriminator must come first in the
object, and `{"Side":5,"kind":"square"}` fails with a `NotSupportedException`
whose message ("must specify a type discriminator") is misleading, because the
discriminator is there but late. Setting `AllowOutOfOrderMetadataProperties = true`
fixes that, at the cost of buffering during streaming reads, as the docs warn.
Finally, a runtime subtype you did not declare (`Kitten : Cat`, only `Cat`
declared) throws `NotSupportedException` on write unless the base opts in with
`UnknownDerivedTypeHandling = FallBackToBaseType`, which wrote `{"Name":"Mia"}`
and so lost the extra member.

### required, constructors and nulls

Three things control "must be present". The C# `required` modifier and
`[JsonRequired]` mean the same to the serializer (the docs say both map to
`JsonPropertyInfo.IsRequired`) and both throw `JsonException` when the member is
absent. Constructor parameters are the gap: a positional record with
`Pos(string Name, int Age)` read from `{"Name":"x"}` produced `Age = 0` with no
error, until `RespectRequiredConstructorParameters = true` made it throw
("missing required properties including: 'Age'"). A parameter with a default
value (`int Age = 7`) is optional and gets that value.

Nulls have a separate switch. By default a `null` for a non-nullable `string`
is accepted, and so is a missing property: the annotation is ignored. With
`RespectNullableAnnotations = true`, `{"Name":null}` throws, and so does
serializing a `null` that a property says cannot be null. `null` for a plain
`int` always fails, and `null` for `int?` is fine. Note that `required` plus a
`null` value still passes without `RespectNullableAnnotations`: presence and
nullness are checked independently.

### The strict options in .NET 10

.NET 10 adds `JsonSerializerOptions.Strict`, a read-only preset. The "What's new
in .NET libraries for .NET 10" page lists it as: disallow unmapped members,
disallow duplicate properties, keep case-sensitive matching, and enable
`RespectNullableAnnotations` and `RespectRequiredConstructorParameters`. Reading
the properties confirmed `Unmapped=Disallow Dup=False Nullable=True ReqCtor=True
CaseInsensitive=False`. Behavior on the earlier payloads:

```csharp
Deserialize<Person>("""{"Name":"a","Age":1,"Extra":1}""", Strict);   // JsonException: 'Extra' could not be mapped
Deserialize<Person>("""{"Name":"a","Name":"b","Age":1}""", Strict);   // JsonException: Duplicate property 'Name'
Deserialize<Person>("""{"name":"a","AGE":1}""", Strict);              // JsonException (case-sensitive, unmapped)
Deserialize<Person>("""{"Name":"a","Age":1}""", Strict);              // Person { Name = a, Age = 1 }
```

Without it the same duplicate payload silently kept the last value (`b`).
`AllowDuplicateProperties = false` is also available on its own, and the docs
note the same switch exists on `JsonDocumentOptions`. The docs describe `Strict`
as read-compatible with `Default`: what `Default` wrote, `Strict` reads, and
`Strict` read back a record with a polymorphic property written by `Default`.
Start from it with
`new JsonSerializerOptions(JsonSerializerOptions.Strict) { ... }` and add only
what you need, such as `WriteIndented` or a naming policy.

### Smaller controls worth knowing

`[JsonPropertyOrder]` changes write order (lower first, default `0`).
`[JsonExtensionData]` on a `Dictionary<string, JsonElement>` captures unmapped
members and writes them back. By default a list property with an initializer
is replaced on read; `PreferredObjectCreationHandling = Populate` appends into
the existing list instead (`["a","b"]` plus `["c"]` gave `["a","b","c"]`).
`ReadCommentHandling = Skip` and `AllowTrailingCommas = true` are needed for
config-style JSON: comments and a trailing comma both throw by default.

## Trade-offs

- **Strict catches contract drift and rejects harmless extras.** A client that
  adds a field breaks a `Strict` reader. Good for configuration and internal
  messages, risky for a public API you do not control.
  ```csharp
  Deserialize<Person>("""{"Name":"a","Age":1,"NewField":true}""", Strict); // JsonException
  ```
- **Web defaults trade correctness for forgiveness.** Case-insensitive matching
  and quoted numbers accept sloppy clients, and hide client bugs. Decide per
  boundary, not per project.
- **`WhenWritingDefault` conflates "absent" with "zero".** It removes a real `0`
  (`Count` vanished in the example above). Use `WhenWritingNull` globally and be explicit
  per property.
- **Polymorphism ties the wire format to your type names.** Discriminator strings
  are a contract: renaming a class is safe only because you chose `"circle"`
  instead of relying on the type name, and a new subtype breaks old readers that
  throw on unknown discriminators.
- **Options reuse is a lifecycle decision.** One static instance is fastest and
  immutable after first use, so late changes (per-tenant naming, say) need a copy.
  A copy that carries a new converter instance pays the metadata cost again.
- **Records and `required` are checked differently.** `required` and
  `[JsonRequired]` are enforced by default, positional parameters are not.
  Relying on a record's constructor for validation needs
  `RespectRequiredConstructorParameters`, or `Strict`.

## Lab

In this lab you get `JsonCodec`, a wrapper around `JsonSerializer` whose `Write`, `Read`, `ReadStrict`, `ReadConfig`, `WriteForJavaScript` and `ReadFromJavaScript` methods are **already written**, but with the four `JsonSerializerOptions` instances empty and the `Shape` hierarchy unannotated. Your job is to build the option sets a real application needs and see how each setting changes what is written, what is accepted and what fails loudly. The defaults of `System.Text.Json` are lenient on read and silent on loss, so most tests check that a bad payload now throws or that a name is now matched.

**The scenario**

Four shared option sets: the everyday one, a strict one for contracts, a lenient one for config files and one for JavaScript clients.

- `JsonCodec.cs`: `Options`, `StrictOptions`, `ConfigOptions` and `JavaScriptOptions` (all `new()` for now) and the wrapper methods.
- `Models.cs`: `Order` (with `Status` and a nullable `Note`), `Person`, `Ledger` (a `long` and a `decimal`) and the `Shape`, `Circle`, `Square` hierarchy.

The options must be built **once** and reused: creating a converter or a `JsonSerializerOptions` per call is expensive.

**What you will do, step by step**

1. **Build the everyday options (TODO-00).** Start from `JsonSerializerDefaults.Web` (camelCase names, case-insensitive reads, quoted numbers accepted). On top of that, omit null properties when writing and write enums as camelCase strings while rejecting enum numbers when reading (`JsonStringEnumConverter` with `allowIntegerValues: false`). Create the converter once.
2. **Use the .NET 10 strict preset (TODO-01).** Point `StrictOptions` at the strict preset: unmapped members, duplicate properties and missing constructor arguments must all fail.
3. **Make the hierarchy round-trip (TODO-02).** Annotate `Shape` with `[JsonPolymorphic]` and `[JsonDerivedType]` for `Circle` and `Square`, with the discriminator values `"circle"` and `"square"` and the discriminator property named `"kind"`. An unknown discriminator must fail.
4. **Accept config files (TODO-03).** Derive `ConfigOptions` from `Options` with the copy constructor, skipping comments and allowing trailing commas.
5. **Serve JavaScript clients (TODO-04).** JavaScript loses precision above 2^53. Derive `JavaScriptOptions` from `Options`, write numbers as strings and still accept quoted numbers on read.

**How you know you are done**

`dotnet test` is all green. You should be able to explain why a payload with differently cased names is accepted by `Options` and why an extra member only fails with `StrictOptions`, and why the discriminator is written first when the static type is the base.

**Optional challenges**

- **TODO-05:** measure `JsonSerializer.Serialize` 20,000 times with one shared options instance and with a `new JsonSerializerOptions { Converters = { new JsonStringEnumConverter() } }` per call. Compare time and allocated bytes.

**Prerequisites:** C# records and attributes, basic JSON and the .NET 10 SDK.

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. The `TODO-NN` comments sit above each option and above `Shape`, and the red tests show what is still missing.

## Documentation Links

- [How to instantiate JsonSerializerOptions, reuse and Web defaults, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/configure-options) (doc)
- [What's new in .NET libraries for .NET 10, Serialization, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-10/libraries) (doc)
- [Serialize properties of derived classes, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/polymorphism) (doc)
- [Require properties for deserialization, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/required-properties) (doc)
- [Customize property names and values, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/customize-properties) (doc)
- [Handle overflow or missing members, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/missing-members) (doc)
- [Ignore properties, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/ignore-properties) (doc)
