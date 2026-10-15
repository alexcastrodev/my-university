---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

Attributes and options cover most JSON shapes. When they do not, System.Text.Json
gives you three escalating tools: a `JsonConverter<T>` that writes and reads one
type by hand, contract customization that edits the metadata the serializer built
for a type (without owning the type), and `JsonSchemaExporter`, which turns that
same contract into a JSON Schema document. This concept covers when each fits,
the rules that bite (null handling, registration precedence, a reader that
consumes the wrong number of tokens), and what the schema exporter says about a
type, including what it cannot know when a custom converter is involved. The
basics of options are in the serialization and options concept.

## Use Cases

- Writing a value object (`Money`, `EmailAddress`) as one JSON string instead of an object.
- Hiding every property whose name starts with `Internal` from a model you cannot annotate.
- Using a non-string type as a dictionary key.
- Publishing a JSON Schema for a request or a configuration type, for docs, validation or tooling.

## Deep Dive

### A converter for one type

Derive from `JsonConverter<T>`, then override `Read` and `Write`. All results
below are from .NET 10.0.0 (SDK 10.0.100), macOS.

```csharp
class MoneyConverter : JsonConverter<Money>
{
    public override Money Read(ref Utf8JsonReader r, Type t, JsonSerializerOptions o)
    {
        var parts = r.GetString()!.Split(' ');           // "12.5 EUR"
        return new Money(decimal.Parse(parts[0], CultureInfo.InvariantCulture), parts[1]);
    }
    public override void Write(Utf8JsonWriter w, Money m, JsonSerializerOptions o)
        => w.WriteStringValue(string.Create(CultureInfo.InvariantCulture, $"{m.Amount} {m.Currency}"));
}
// {"Id":"A-1","Total":"12.5 EUR","Lines":["1 USD"]}
```

The converter applied to `Total` and to each element of the `Money[]` array, since
the serializer picks a converter per type. Throwing `JsonException` from `Read`
gives the caller a normal serialization error with a path (`Bad money 'oops'`).
Pass `CultureInfo.InvariantCulture` to both sides: the default `ToString` on my
machine printed `12,5`.

Registration has a fixed precedence, per the docs: `[JsonConverter]` on a
property wins, then a converter in `options.Converters`, then `[JsonConverter]` on
the type. If several custom converters for one type are in the collection, the
first whose `CanConvert` returns true is used. I checked the middle rule: a `Temp`
record with `[JsonConverter(typeof(TempConverter))]` on the type was written as
`"from options"` when a different converter for it sat in `Converters`. A
property-level `[JsonConverter(typeof(Lower))]` beat the options converter on the
same string type (`"lower:a"` against `"B"` for the neighbor).

### Nulls skip your converter unless you ask

By default a converter is not called for `null` on reference types (the docs say to
override `HandleNull` to change that). With a converter that did not override it,
`{"Value":null}` was written and read back as `null` without `Read` or `Write` ever
running. With `HandleNull => true`, a null string was written as the `"(none)"` my
converter chose, and `Read` received a `Null` token and returned `<null>`. So
decide: if a null should become a sentinel, opt in and check `TokenType` in `Read`;
otherwise leave it. Note that the property-level converter in the previous test did
not set `HandleNull`, and its null stayed `null`.

### Readers must consume exactly one value

A converter that returns without consuming its whole value breaks the parse. My
`Read` called `r.Read()` once while the value was a nested object, and the
serializer threw `JsonException: The converter 'Bad' read too much or not enough`
with the path `$.V`. For an object, the converter must stop on its `EndObject`; for
a value like a string, on that token. When you delegate to the serializer, use
`JsonSerializer.Deserialize<T>(ref reader, options)`, which advances correctly.

### Factories for generic types

A converter for `Wrapper<T>` cannot be one class, because the code differs per `T`.
`JsonConverterFactory` answers `CanConvert` for the open generic and builds the
closed converter on demand:

```csharp
public override bool CanConvert(Type t) => t.IsGenericType && t.GetGenericTypeDefinition() == typeof(Wrapper<>);
public override JsonConverter CreateConverter(Type t, JsonSerializerOptions o)
    => (JsonConverter)Activator.CreateInstance(typeof(Inner<>).MakeGenericType(t.GetGenericArguments()[0]))!;
// Wrapper<int>(5) -> 5     Wrapper<string>("s") -> "s"
```

The docs say this factory pattern is required for open generics in .NET 10 and
earlier, and that .NET 11 lets `[JsonConverter]` take an open generic converter
directly. I only ran .NET 10. Note that `Activator` and `MakeGenericType` are
reflection, so under Native AOT the closed types must be known at compile time.

For dictionary keys, `Dictionary<Point, int>` threw `NotSupportedException` ("The
type 'Point' is not a supported dictionary key"). Overriding `ReadAsPropertyName`
and `WriteAsPropertyName` on a `JsonConverter<Point>` fixed it: it wrote
`{"1,2":5}` and read the key back as `Point { X = 1, Y = 2 }`.

### Contract customization: edit the metadata, not the type

Starting in .NET 7 (per the docs) the serializer builds a `JsonTypeInfo` per type,
and a resolver can change it before use. With `DefaultJsonTypeInfoResolver` you add
modifiers, which are `Action<JsonTypeInfo>` callbacks run in order:

```csharp
var resolver = new DefaultJsonTypeInfoResolver();
resolver.Modifiers.Add(ti =>
{
    if (ti.Kind != JsonTypeInfoKind.Object) return;
    foreach (var p in ti.Properties.ToList())
        if (p.Name.StartsWith("Internal", StringComparison.Ordinal)) ti.Properties.Remove(p);
});
// Customer("ana","secret",3) -> {"Name":"ana","Visits":3,"display":"ANA"}
```

In my run the same modifier also added a computed `display` property with
`ti.CreateJsonPropertyInfo(typeof(string), "display")` and a `Get` delegate. Other
verified levers: `JsonPropertyInfo.ShouldSerialize` (a `Visits` of 0 was omitted
and 2 was written), `Set` for deserialization, and `JsonTypeInfo.NumberHandling`.
Check `Kind` first: per the docs, `Object` allows the most; types with a custom
converter report `None` and have nothing to edit. Because the modifier works on
names and types, one rule covers every model, including ones from another assembly.

The contract freezes on first use. After one serialize call on an options instance,
assigning `TypeInfoResolver` threw `InvalidOperationException` ("read-only or has
already been used"), and adding to `resolver.Modifiers` afterwards threw as well.
Build the resolver completely, then create the options.

### JsonSchemaExporter

`JsonSchemaExporter` (introduced in .NET 9, per the docs) describes the contract the
serializer would use. `options.GetJsonSchemaAsNode(typeof(Order))` returned for a
record with `int Id`, `string? Note`, `decimal Total`, an enum and a `List<string>`:
integer, nullable string, number, `"integer"` for the enum, an array of nullable
strings, and `"format": "date-time"` for the `DateTime`. The `required` list held
every constructor parameter that had no default, nullable or not.

The schema follows your options, which is the point:

- With `JsonSerializerDefaults.Web` the keys became `id`, `note` and so on, and `id`
  turned into `["string","integer"]` with a `pattern`, because Web defaults allow
  reading numbers from strings.
- Adding `JsonStringEnumConverter` changed the enum to `{"enum":["New","Shipped"]}`.
- The root was `["object","null"]` and `Tags` items were nullable; setting
  `TreatNullObliviousAsNonNullable = true` made the root `"object"` and the items
  `"string"`, while `Note` stayed nullable because it is annotated.
- `TransformSchemaNode` runs on every node. Reading `DescriptionAttribute` from
  `context.PropertyInfo.AttributeProvider` put `"description": "Order key"` on `id`.

Two traps. A new options instance with no resolver threw `InvalidOperationException`
("must specify a TypeInfoResolver setting before being marked as read-only"), so set
`TypeInfoResolver` (for example `new DefaultJsonTypeInfoResolver()`) or use a source
generation context. And a custom converter hides the shape: for the `Invoice` using
my `MoneyConverter`, the schema said `"Total": true` (anything) and `"Lines":
{"type":"array"}` with no `items`. The exporter cannot see inside code, so give such
types a schema in `TransformSchemaNode`.

## Trade-offs

- **A converter is total control with total responsibility.** You own nulls, errors
  and cursor position.
  ```csharp
  throw new JsonException($"Bad money '{s}'"); // gives the caller a path, not a crash
  ```
- **Converters hide the type from the tooling.** The schema exporter reported
  `true` for `Money`; a modifier that edits properties cannot touch it either.
- **Contract modifiers scale better than attributes** for cross-cutting rules
  (hide `Internal*`), but they run per type at first use and need `Kind` checks.
- **Frozen options mean ordering matters.** Build resolver and modifiers first;
  changing them after the first call throws.
- **A schema describes the serializer's contract, not business rules.** It has
  types, nullability and `required`; it does not know that `Total` must be positive
  unless you add that in a transform.
- **Reflection in factories costs AOT.** `MakeGenericType` needs the closed types
  known ahead of time; prefer the source-generated path for AOT apps.

## Documentation Links

- [How to write custom converters for JSON serialization, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/converters-how-to) (doc)
- [Custom serialization and deserialization contracts, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/custom-contracts) (doc)
- [JSON schema exporter, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/extract-schema) (doc)
- [JsonSchemaExporter Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.text.json.schema.jsonschemaexporter) (doc)
- [DefaultJsonTypeInfoResolver Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.text.json.serialization.metadata.defaultjsontypeinforesolver) (doc)
