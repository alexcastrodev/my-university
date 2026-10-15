---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

Reflection and runtime code generation are how .NET libraries used to discover
your types, and they are exactly what trimming and Native AOT cannot see
through. A source generator moves that work to compile time: it reads your code
and adds new C# files to the compilation, so the result is ordinary, visible,
analyzable code. This concept shows the generators the platform ships
(`[GeneratedRegex]`, `JsonSerializerContext`, `[LoggerMessage]`), how to read
what they emit, what the AOT analyzers say about the reflection-based
alternative, and how small a custom incremental generator can be.

## Use Cases

- Making a console app or minimal API safe to trim or publish with Native AOT.
- Replacing a hot-path `new Regex(...)` with code the compiler can optimize.
- Removing boilerplate such as `ToString`, mappers or `INotifyPropertyChanged`
  with your own generator.
- Debugging "what did the framework generate for my type?"
- Getting faster startup by skipping reflection-based discovery.

## Deep Dive

### The three platform generators in one project

All three come with the SDK or a Microsoft package; none needs a reference to
Roslyn. This `net10.0` console project (SDK 10.0.100) uses them together, with
`IsAotCompatible` turned on so the trim and AOT analyzers run during a normal
build:

```csharp
var m = Rx.Order().Match("order-42");
Console.WriteLine($"regex: {m.Success} {m.Groups[1].Value}");

var json = JsonSerializer.Serialize(new Item("pen", 3), AppJson.Default.Item);
Console.WriteLine($"json: {json}");

using var lf = LoggerFactory.Create(b => b.AddSimpleConsole());
Log.Created(lf.CreateLogger("demo"), 42);

record Item(string Name, int Qty);

[JsonSerializable(typeof(Item))]
partial class AppJson : JsonSerializerContext;

static partial class Rx
{
    [GeneratedRegex(@"^order-(\d+)$")]
    public static partial Regex Order();
}

static partial class Log
{
    [LoggerMessage(Level = LogLevel.Information, Message = "Created order {Id}")]
    public static partial void Created(ILogger logger, int id);
}
```

```text
regex: True 42
json: {"Name":"pen","Qty":3}
info: demo[165548891]
      Created order 42
```

The strange number is the event id: I omitted `EventId`, so the generator
produced one. Each generator is triggered by an attribute on a `partial` type or
method and supplies the missing half. The docs say so for the regex generator
and for `[LoggerMessage]`, whose method must be `partial` and return `void`; a
static one must receive the `ILogger` as a parameter. The logging page also
notes that the generator needs a C# 9 or later compiler.

### Seeing what was generated

Add two properties and the files land on disk:

```xml
<EmitCompilerGeneratedFiles>true</EmitCompilerGeneratedFiles>
<CompilerGeneratedFilesOutputPath>$(MSBuildProjectDirectory)/generated</CompilerGeneratedFilesOutputPath>
```

My run produced one folder per generator: `RegexGenerator.g.cs`, six
`AppJson*.g.cs` files and `LoggerMessage.g.cs`. The regex file begins with an
explanation of the pattern as XML comments ("Match the string "order-"", "1st
capture group"). Reading these files is the fastest way to learn what a
generator really does, and you can set breakpoints in them.

One trap, hit for real: when the output folder lives inside the project, the
next build sees those `.cs` files as normal sources and also receives the
generator output, so every member is defined twice. The build failed with errors
like `CS0102: The type 'AppJson' already contains a definition for 'String'`. Fix
it by excluding the folder:

```xml
<ItemGroup><Compile Remove="generated/**" /></ItemGroup>
```

### What the analyzers say about the reflection path

With `IsAotCompatible` on, I added the classic reflection-based call next to the
generated one:

```csharp
JsonSerializer.Serialize(new Item("pen", 3));
```

```text
warning IL2026: Using member 'JsonSerializer.Serialize<TValue>(TValue, JsonSerializerOptions)'
which has 'RequiresUnreferencedCodeAttribute' can break functionality when trimming...
Use the overload that takes a JsonTypeInfo or JsonSerializerContext...
warning IL3050: ... which has 'RequiresDynamicCodeAttribute' can break functionality
when AOT compiling... Use System.Text.Json source generation for native AOT applications.
```

The overload that takes `AppJson.Default.Item` produced no warning. That is the
whole idea: the context lists the types at compile time, so the trimmer and the
AOT compiler see every constructor and property. A plain `new Regex(pattern)`
gave no warning in my build; the regex page recommends the generator for
startup, throughput and trimmability, and says the analyzer `SYSLIB1045`
suggests the conversion for patterns known at compile time. Regexes the
generator cannot implement (for example `RegexOptions.NonBacktracking`, per the
docs) fall back to a cached `Regex` instance.

### Writing a small incremental generator

A custom generator is a class implementing `IIncrementalGenerator` in a
separate project. Mine targeted `netstandard2.0`, referenced
`Microsoft.CodeAnalysis.CSharp` 4.14.0, and loaded fine in the SDK 10 compiler.
It emits an `[AutoToString]` attribute and, for each annotated class, a
`ToString`:

```csharp
[Generator]
public sealed class ToStringGenerator : IIncrementalGenerator
{
    public void Initialize(IncrementalGeneratorInitializationContext context)
    {
        context.RegisterPostInitializationOutput(c =>
            c.AddSource("AutoToStringAttribute.g.cs", AttributeSource));

        var models = context.SyntaxProvider.ForAttributeWithMetadataName(
            "Gen.AutoToStringAttribute",
            predicate: static (node, _) => node is ClassDeclarationSyntax,
            transform: static (ctx, _) => /* read symbol, return a small model */);

        context.RegisterSourceOutput(models, static (spc, m) =>
            spc.AddSource($"{m.Name}.g.cs", /* build the partial class text */));
    }
}
```

The app references it as an analyzer, not as a library:

```xml
<ProjectReference Include="../Gen/Gen.csproj"
                  OutputItemType="Analyzer" ReferenceOutputAssembly="false" />
```

With `[AutoToString] public partial class Person` the output was
`Person { Name=Ada, Age=36 }`, and the emitted `Person.g.cs` was the three-line
partial class one would write by hand. Two design rules matter. The pipeline
should pass between stages only small, value-equatable models (strings,
arrays of strings), never `ISymbol` or syntax nodes, so the compiler can see
that nothing changed and skip regenerating; the Roslyn cookbook linked below
covers this, and I did not benchmark it here. And the cheap `predicate` filters
syntax first, so the costly `transform` runs only for candidates.

## Trade-offs

- **Generated code is AOT-safe and fast**, but it is code in your assembly: many
  regexes or JSON types grow the binary, and a rarely used regex may not
  deserve the generator.
- **Source-generated JSON** needs every serialized type registered in a
  `JsonSerializerContext`; a type you forget is simply not covered by the context,
  so check the generated members.
- **Partial members** are the contract: the attribute only works on `partial`
  types and methods, so you edit declarations you used to leave alone.
- **Custom generators** remove boilerplate, but they run inside the compiler and
  IDE, are hard to debug, need an extra project, and can slow the editor if the
  pipeline is not incremental.
- **`EmitCompilerGeneratedFiles`** helps reviews and debugging, but the output
  folder must be excluded from compilation and from source control noise.

## Documentation Links

- [Roslyn SDK and source generators overview](https://learn.microsoft.com/en-us/dotnet/csharp/roslyn-sdk/)
- [Incremental generators cookbook](https://github.com/dotnet/roslyn/blob/main/docs/features/incremental-generators.cookbook.md)
- [.NET regular expression source generators](https://learn.microsoft.com/en-us/dotnet/standard/base-types/regular-expression-source-generators)
- [System.Text.Json source generation](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/source-generation)
- [Compile-time logging source generation](https://learn.microsoft.com/en-us/dotnet/core/extensions/logging/source-generation)
- [Introduction to AOT warnings](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/fixing-warnings)
