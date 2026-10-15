---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

The serializer in the previous concept finds your types by reflection at run
time. That is convenient and has three costs: a slower first call, warnings
under trimming, and a hard failure under Native AOT. This concept covers the
alternative that moves that work to compile time (`JsonSerializerContext` and
`[JsonSerializable]`), what really changes when an app is trimmed, and the three
lower-level tools you pick when you do not want a full object model: `JsonDocument`,
`JsonNode`, and the `Utf8JsonReader` / `Utf8JsonWriter` pair, plus streaming
arrays with `DeserializeAsyncEnumerable`. Options and polymorphism are in the
serialization and options concept.

## Use Cases

- Shipping a trimmed or Native AOT service that must serialize without reflection.
- Reading one field out of a large response without building objects for the rest.
- Editing a JSON document whose shape you do not own (add a property, keep the rest).
- Processing a multi-megabyte array element by element as it arrives.

## Deep Dive

### What the source generator produces

Declare a partial class that derives from `JsonSerializerContext` and list the
root types. Every number below is from .NET 10.0.0 (SDK 10.0.100), macOS 27.0.1,
Apple M4 Max.

```csharp
[JsonSourceGenerationOptions(JsonSerializerDefaults.Web, UseStringEnumConverter = true)]
[JsonSerializable(typeof(Order))]
[JsonSerializable(typeof(Order[]))]
partial class AppJsonContext : JsonSerializerContext;

JsonSerializer.Serialize(order, AppJsonContext.Default.Order);
// {"id":1,"customer":"Ana","total":9.5,"tags":["a","b"],"status":"Shipped"}
```

For one 5-member record the generator emitted 569 lines in 9 files (with
`EmitCompilerGeneratedFiles`): a `JsonTypeInfo<Order>` factory, a constructor
delegate, and one serialize handler per type, including `int`, `string`,
`decimal`, `List<string>`, and the enum, which were found by walking the members.
Rules that surprised me:

- Member types are discovered, collections are not. With only `Order` listed,
  `GetTypeInfo(typeof(Status))` was found but `typeof(List<Order>)` was `null`;
  `Order[]` worked because I listed it.
- A type you did not list fails loudly: `InvalidOperationException: JsonTypeInfo
  metadata for type 'Person' was not provided by TypeInfoResolver of type
  'AppJsonContext'`, or `NotSupportedException` through an options instance.
- The context has its own options. `[JsonSourceGenerationOptions]` sets them at
  compile time, and `AppJsonContext.Default.Options` is read-only
  ("cannot be modified once encapsulated by a JsonSerializerContext"). A bare
  context uses the plain defaults: my first run read a lowercase payload with no
  error and bound nothing, until I added `JsonSerializerDefaults.Web`.
- Call the overloads that take `JsonTypeInfo<T>` or a context. To keep reflection
  as a fallback, `JsonTypeInfoResolver.Combine(AppJsonContext.Default, new
  DefaultJsonTypeInfoResolver())` serialized the unlisted `Person`, with the
  warnings back.

Two generation modes exist. The default (metadata) generates everything needed
for both directions. `GenerationMode = Serialization` (fast path) generates only
a write handler: it wrote `Order` fine, but reading threw "did not provide
property metadata", and a polymorphic `Shape` also failed to write. The docs say
polymorphism is supported in metadata mode only, so keep the default unless you
only write and profiling shows the need.

Speed, measured on a 5-member record: 0.52 us per call with the context against
0.60 us with reflection once warm, which is not why you adopt it. The measurable
gain is start-up: the first serialize plus deserialize in a fresh process took a
median of about 15.4 ms with the context and 19.9 ms with reflection (12 runs
each, framework-dependent `dotnet App.dll`). The other gains are in the next
section.

### What changes under trimming and AOT, without publishing AOT

I did not publish Native AOT. Trimming and the analyzers are enough to see the
contract. With `IsAotCompatible` set, the compiler warned on these calls:

| Call | Warning |
|---|---|
| `Serialize(o)` | IL2026 and IL3050 |
| `Serialize(o, optionsWithContextResolver)` | IL2026 and IL3050 (the overload is annotated, whatever the options hold) |
| `Serialize(o, JsonSerializerOptions.Web)` | IL2026 and IL3050, on the call and on `Web` itself |
| `Serialize(o, ctx.Order)` or `Serialize(o, typeof(Order), ctx)` | none |
| `new JsonStringEnumConverter()` | IL3050 |
| `new JsonStringEnumConverter<Status>()` | none |

The rule: pass a `JsonTypeInfo` or a context, never an options-only overload, and
use the generic enum converter (`[JsonConverter(typeof(JsonStringEnumConverter<Level>))]`
on the enum, or `UseStringEnumConverter = true` on the context).

At run time the picture is stricter than warnings. A `PublishTrimmed=true` app
wrote `System.Text.Json.JsonSerializer.IsReflectionEnabledByDefault: false` into
`runtimeconfig.json` (the docs say trimming turns reflection off unless you set
the property), and a plain `Serialize(o)` then threw `InvalidOperationException:
Reflection-based serialization has been disabled`. Forcing it back on with
`<JsonSerializerIsReflectionEnabledByDefault>true</...>` is worse in a quiet way:
for a class whose getters nothing else referenced, the trimmed app printed `{}`
while the same code untrimmed printed `{"Name":"gear","Teeth":12}`. The trimmer
removed members only reflection would have used. A context-based app published
trimmed in the same way printed the right JSON, which is the actual argument for the generator.

### JsonDocument versus JsonNode versus a POCO

All three read JSON without a type of your own. `JsonDocument` is a read-only
view over a pooled buffer (so it is `IDisposable`); `JsonNode` is a mutable tree
of objects. The same task, summing `total` of rows whose `status` is `"paid"` in
a 2,000 row, 277,561 byte array, 300 repetitions:

| Approach | Time per run | Allocated per run |
|---|---|---|
| deserialize to a record array (source gen) | 2.3 ms | 1,141 KB |
| `JsonDocument` | 1.0 ms | 0.1 KB (buffers are pooled) |
| `JsonNode` | 1.8 ms | 2,850 KB |
| `Utf8JsonReader` | 0.43 ms | 0 KB |

All four returned 666499.75. The reader is fastest and allocates nothing, but my
loop only works because `status` precedes `total` in every row: it keeps state
by hand. Behaviors to know:

- `JsonDocument`: `GetProperty` on a missing name throws `KeyNotFoundException`
  (use `TryGetProperty`); `GetInt32` on a string throws `InvalidOperationException`.
  A `JsonElement` used after `Dispose` throws `ObjectDisposedException`, so
  `Clone()` it first (the clone survived disposal).
- Numbers keep their text: `1.10` stayed `1.10` through `GetRawText` and through
  `JsonNode`, and a 20 digit number read as `double` lost precision (`1.2345678901234567E+19`)
  while `GetDecimal` kept `12345678901234567890.123456789`.
- `JsonNode`: a missing key returns `null`, so `node["nope"]["x"]` is a
  `NullReferenceException`. A node has one parent: assigning an already attached
  node to another place threw "already has a parent"; use `DeepClone()`. `Add`
  with an existing key throws, the indexer replaces.
- Per the docs, `JsonSerializerOptions` passed to a `JsonNode` or `JsonDocument`
  only contributes custom converters, so `DefaultIgnoreCondition` does not apply.

### Utf8JsonReader and Utf8JsonWriter

`Utf8JsonReader` is a forward-only `ref struct` over `ReadOnlySpan<byte>` or
`ReadOnlySequence<byte>`. It cannot be a field of a class, cannot cross an
`await`, and must be passed by `ref`, because it is mutable and a copy would lose
position. Walking a small object showed what `Read()` yields: one token each for
`StartObject`, `PropertyName`, `Number`, and so on, with `CurrentDepth` and
`TokenStartIndex` (byte offset). Compare names with `ValueTextEquals("status"u8)`,
which avoids allocating and handles escapes. `Skip()` jumped over a nested
object to the next property.

Failures are specific: `{"a":1,}` gave a `JsonReaderException` naming the trailing
comma and its byte position, and `GetInt32` on a string token threw
`InvalidOperationException`. For data that arrives in pieces, pass
`isFinalBlock: false` and the previous `CurrentState`, then re-feed the bytes
after `BytesConsumed`. Feeding 7 bytes at a time produced 14 tokens, the same as
reading the whole buffer. The buffer must be at least as large as the largest
token (docs).

`Utf8JsonWriter` writes to an `IBufferWriter<byte>` or a stream and buffers until
`Flush` (0 bytes visible before, 2 after for `{}`). It validates structure: a
number directly inside an object, without a property name, threw
`InvalidOperationException`; with `SkipValidation = true` it wrote the invalid
`{1}`. Its default encoder is conservative: `Ação <b> + é` became
`Ação <b> + é`, and
`JavaScriptEncoder.UnsafeRelaxedJsonEscaping` kept the text readable, which is
only safe when the output is never embedded in HTML.

### Streaming arrays with DeserializeAsyncEnumerable

`JsonSerializer.DeserializeAsyncEnumerable<T>(stream)` yields each element of a
top-level array as soon as its closing brace has been read. With a pipe writing
one row every 300 ms, the rows came out at 1 ms, 303 ms, and 604 ms, not at the
end. It reads from a `Stream` or a `PipeReader` (.NET 10). It expects an array: a
single top-level object failed with a "could not be converted" error. Passing
`topLevelValues: true` instead reads a sequence of whitespace-separated values
(2 objects in my test). The endpoint side of this is in the async streams concept.

## Trade-offs

- **Source generation moves failures to compile time and adds a registration
  chore.** Every root type and every collection must be listed, and a forgotten
  one fails at run time.
  ```csharp
  [JsonSerializable(typeof(List<Order>))] // without this line, List<Order> has no metadata
  ```
- **The generator removes reflection, not options discipline.** The context
  carries its own casing and ignore rules, so a context and a shared
  `JsonSerializerOptions` can disagree. Set the defaults on the context.
- **Fast-path mode is write-only and not polymorphic.** It is smaller, but a
  later "we also read this type" change fails at run time.
- **`JsonDocument` is cheap and fragile.** Pooled memory means disposal rules:
  return a `Clone()`, never the element. Property lookup is sequential.
- **`JsonNode` is convenient and allocates.** It cost 2.5x the memory of a typed
  read of the same payload here, for edit flexibility.
- **`Utf8JsonReader` is fast and unforgiving.** Order-dependent logic, manual
  partial buffers, no `await` inside the loop. Use it for hot paths and for
  skipping large payloads, not as a default.
- **Numbers are text until you ask.** `GetDouble` can lose digits that
  `GetDecimal` keeps, so choose by the meaning of the field.

## Documentation Links

- [How to use source generation in System.Text.Json, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/source-generation) (doc)
- [Source-generation modes, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/source-generation-modes) (doc)
- [How to use a JSON DOM, JsonDocument and JsonNode, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/use-dom) (doc)
- [How to use Utf8JsonReader, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/use-utf8jsonreader) (doc)
- [How to use Utf8JsonWriter, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/use-utf8jsonwriter) (doc)
- [What's new in .NET libraries for .NET 10, PipeReader support, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-10/libraries) (doc)
