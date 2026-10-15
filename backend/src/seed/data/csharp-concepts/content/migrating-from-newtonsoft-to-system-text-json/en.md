---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

Moving a codebase from Newtonsoft.Json to System.Text.Json is rarely a rename.
The two libraries disagree on defaults (casing, quoting, comments, number and date
parsing), on what an unknown attribute does (silently nothing), and on a few
features that have no equivalent. The dangerous differences are the quiet ones:
`[JsonProperty]` ignored, a field no longer written, a null where a value used to
bind. This concept lists the behavior differences I measured by running the same
input through both libraries, shows how to configure System.Text.Json to be
stricter or more lenient, covers the DOM and `JObject` replacements, and suggests a
migration order that catches the silent changes with tests instead of production
data. Options and converters are covered in the previous concepts.

## Use Cases

- Moving an API's models off Newtonsoft.Json without changing its wire format.
- Deciding, for a library you maintain, which Newtonsoft features you actually use.
- Reviewing a pull request that swaps `JsonConvert.DeserializeObject` for `JsonSerializer.Deserialize`.
- Explaining why a payload that "always worked" now returns an empty object.

## Deep Dive

### Same input, different result

I ran identical payloads through Newtonsoft.Json 13.0.4 and System.Text.Json in
.NET 10.0.0 (SDK 10.0.100) with default settings on both sides. A failure column
means an exception.

| Input | Newtonsoft | System.Text.Json |
|---|---|---|
| `{"NAME":"a","age":3}` into `Name`, `Age` | binds both | binds nothing (`Name=""`, `Age=0`), no error |
| `/* c */` comment inside the object | accepted | `JsonException` |
| trailing comma | accepted | `JsonException` |
| single quotes, unquoted names | accepted | `JsonException` |
| `"Age":"3"` (number in quotes) | `3` | `JsonException` |
| `"Name":5` (number into string) | `"5"` | `JsonException` |
| `"Age":3.7` into `int` | `JsonReaderException` | `JsonException` |
| `"Age":null` into `int` | `JsonSerializationException` | `JsonException` |
| empty string input | returns `null` | `JsonException` (no tokens) |
| enum written as `"B"` without a converter | `B` | `JsonException` |
| unknown enum name `"Z"` | exception | exception |
| duplicate property | last wins | last wins |

The first row is the one that hurts: no exception, every property at its default.
The docs call the unquoted names, single quotes and non-string values for string
properties "not supported by design". For the others there is a switch, and the
equivalent configuration is:

```csharp
var o = new JsonSerializerOptions(JsonSerializerDefaults.Web)  // case-insensitive, camelCase, numbers from strings
{
    ReadCommentHandling = JsonCommentHandling.Skip,
    AllowTrailingCommas = true,
};
// {"name":"a", /* c */ "Age":3,}  ->  P(Name=a, Age=3)
```

Remember `Web` also changes the output casing to camelCase. Newtonsoft's default
output casing is the property name as written, which the default System.Text.Json
also keeps, so a migration that must not change the wire format should set
`PropertyNameCaseInsensitive = true` only, not the whole `Web` preset.

### What gets ignored or written differently

These are the silent ones. A test class had a public field, a property with a
private setter, and Newtonsoft attributes:

| Case | Newtonsoft output | System.Text.Json output |
|---|---|---|
| public field `Field` | written, and read back | not written, not read (needs `IncludeFields` or `[JsonInclude]`) |
| `[JsonProperty("old")]` | name `old` | attribute ignored, name `Old` |
| `[Newtonsoft.Json.JsonIgnore]` | omitted | **written anyway** (`{"Secret":7,...}`) |
| `ShouldSerializeX()` method | omits `X` when false | method ignored, `X` written |
| `[Newtonsoft.Json.JsonRequired]` on missing property | `JsonSerializationException` | no error, object created |
| private setter | not set | not set (needs `[JsonInclude]`) |

System.Text.Json has its own `[JsonPropertyName]`, `[JsonIgnore]`, `[JsonRequired]`
and `[JsonInclude]`, in `System.Text.Json.Serialization`. The Newtonsoft
attributes still compile and do nothing, so the migration does not fail loudly: a
model that keeps `using Newtonsoft.Json;` and a `[JsonIgnore]` leaks the field. Removing
that `using` makes the compiler list every attribute left to translate, and a
golden-JSON test per model (described below) catches the rest.

Output differences, from one object with accented text, `<`, `&`, a double `1.0`, a
large decimal, a `DateTime`, a `DateTimeOffset`, a null and a `Guid`:

- Text: Newtonsoft wrote `Ação <b> & é` as is; System.Text.Json wrote
  `Ação <b> & é`. Both are valid JSON that decodes the
  same, but a test that compares strings will fail. The docs describe this as
  "Strict character escaping, configurable"; `JavaScriptEncoder.UnsafeRelaxedJsonEscaping`
  relaxes it, which is only safe when the output is never embedded in HTML.
- Numbers: `1.0` became `1` and `12345678901234567890m` lost its `.0`.
- `DateTime`, `DateTimeOffset`, `Guid`, `TimeSpan`, `Uri`, `byte[]` and non-string
  dictionary keys wrote identically. ISO 8601 is the default in both.
- Dates on read: `"2024-01-02"` parsed in both. The old `"/Date(1704164645000)/"`
  format parsed in Newtonsoft and threw in System.Text.Json, as did
  `"2024-01-02 03:04"` (with a space instead of `T`). Data from old systems needs a
  custom converter.

### Cycles, depth and reference handling

A self-referencing object failed in both with different exceptions
(`JsonSerializationException: Self referencing loop` against
`JsonException: A possible object cycle was detected`). Both default to a maximum
depth of 64 (the docs also note that ASP.NET Core lowers it to 32 for its own use).
The ignore options do not produce the same JSON: Newtonsoft's
`ReferenceLoopHandling.Ignore` produced `{"Name":"a"}`, while System.Text.Json's
`ReferenceHandler.IgnoreCycles` produced `{"Name":"a","Next":null}`. If a client
parses that shape, you have a wire change.

### object, dictionaries and the DOM

Anything typed `object` is a sharp edge. `Dictionary<string, object>` from the same
JSON produced `Int64`, `String`, `JArray`, `JObject`, `Double` in Newtonsoft and a
`JsonElement` for every value in System.Text.Json (the docs list "inferred type to
`object`" as not supported out of the box). Either type the values, use
`JsonNode`, or write a converter for `object`.

The DOM replacements are `JsonNode` (mutable, like `JObject`) and `JsonDocument`
(read-only). A missing key returned `null` on both. Differences I measured: a date
string stays a string in `JsonNode` (kind `String`) but becomes a `Date` token in
`JObject.Parse`; `(int)node["a"]` and `GetValue<string>()` read typed values, and
`(string)node["a"]` on a number threw `InvalidOperationException`. The docs state
there is no JSONPath query (`SelectToken` has no equivalent). `JsonNode.GetPath()`
only returns the path of a node (`$.a[1].b`), so you navigate with indexers or LINQ.

### Populating existing objects

`JsonConvert.PopulateObject` has no direct equivalent (docs: "not supported,
workaround"). Starting in .NET 8 (docs) there is `JsonSerializerOptions.PreferredObjectCreationHandling
= JsonObjectCreationHandling.Populate`, also available as an attribute on a type or
property, which fills an existing collection instead of replacing it. With
`Items = ["a"]` initialized and `["b"]` in the JSON: Newtonsoft gave `a,b`,
System.Text.Json by default gave `b`, and with `Populate` it gave `a,b`. It applies
to members that already hold a value, not to a whole object you pass in, and the
docs note it does not currently work for types with a parameterized constructor.

### A migration order that finds the silent changes

1. List the Newtonsoft features you use: grep for `JsonProperty`, `JsonConverter`,
   `JObject`, `TypeNameHandling`, `ShouldSerialize`, `PopulateObject`, `SelectToken`.
2. For each model, keep a golden JSON string captured from Newtonsoft and assert
   that System.Text.Json produces the same bytes (or the same parsed tree) and reads
   the same inputs. This catches a missed `[JsonProperty]`, a field, or an enum.
3. Migrate one boundary at a time (one endpoint, one message type), not the whole
   solution; the two libraries can coexist in one process.
4. Treat the features with no equivalent as design decisions: `TypeNameHandling`
   becomes explicit `[JsonDerivedType]` (the output differs: `{"$type":"dog",...}` with
   a name you choose, instead of an assembly-qualified name), and JSONPath becomes
   code.

## Trade-offs

- **Stricter defaults find bugs and break lenient producers.** A client that sends
  single quotes or comments must be fixed or served with a custom parse.
  ```csharp
  new JsonSerializerOptions { ReadCommentHandling = JsonCommentHandling.Skip, AllowTrailingCommas = true }
  ```
- **No exception does not mean no change.** Case sensitivity, missing fields and
  ignored attributes produce an object, not an error. Only tests see them.
- **Migrating buys speed and AOT, and costs features.** Source generation and a
  smaller dependency are real; JSONPath, `TypeNameHandling` and lenient parsing are
  not coming back.
- **A custom converter for `object` or legacy dates is a permanent cost.** Write it
  once, test it with the old payloads, and keep those payloads as fixtures.
- **Keeping Newtonsoft is also valid.** If the code leans on JSONPath, `JObject`
  gymnastics or lenient inputs, the migration cost may exceed the benefit.

## Documentation Links

- [Migrate from Newtonsoft.Json to System.Text.Json, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/migrate-from-newtonsoft) (doc)
- [System.Text.Json overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/overview) (doc)
- [How to use a JSON DOM, JsonDocument and JsonNode, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/use-dom) (doc)
- [Customize character encoding, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/character-encoding) (doc)
- [How to preserve references and handle cycles, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/preserve-references) (doc)
