---
version: 1.0
updatedAt: 2026-10-28
---
## Objective

An attribute is a class whose instances are stored as metadata on an assembly,
type, member, parameter or return value. Code and frameworks read them at run
time through reflection; the compiler reads others while it builds, and they
change what it emits or reports. This concept, on .NET 10 / C# 14, declares a
custom attribute and its compile errors, reads it with each reflection API,
measures `Inherited` on overrides and the cost of every lookup, tours the
attributes the compiler acts on, and builds a `[Command("name")]` dispatcher.

## Use Cases

- Tagging classes so a startup scan builds a registry without a manual list.
- Guard and assert helpers that report the caller and the failing expression.
- Deprecating or previewing a library API with its own diagnostic id and link.
- Removing debug-only calls from release builds and annotating null contracts.

## Deep Dive

### Declaring an attribute

An attribute class derives from `Attribute` and by convention ends in
`Attribute`; the suffix is optional at the use site, so `[Tag]` and
`[TagAttribute]` bind to the same class. `[AttributeUsage]` says where it may
appear (`AttributeTargets`), whether it may repeat (`AllowMultiple`) and whether
derived classes and overriding members see it (`Inherited`).

```csharp
[AttributeUsage(AttributeTargets.All, AllowMultiple = true, Inherited = false)]
sealed class TagAttribute(string name) : Attribute
{
    public string Name { get; } = name;      // positional: a constructor parameter
    public int Priority { get; set; }        // named: a public read-write property
    public string[]? Kinds { get; set; }
    public Type? Target { get; set; }
}

[Tag("billing", Priority = 2, Kinds = ["pdf", "csv"], Target = typeof(Invoice))]
[Tag("audit")]
class Invoice { /* ... */ }
```

A class with no `[AttributeUsage]` reports `All False True` (any target, no
repetition, inherited). Arguments are baked into metadata, so they must be
compile-time values. One build with the mistakes (`OnlyClass` allows only
classes) gives:

```text
[Tag(DateTime.Now.ToString())]  CS0182: An attribute argument must be a constant expression,
                                typeof expression or array creation expression of an
                                attribute parameter type
ctor(decimal amount)            CS0181: Attribute constructor parameter 'amount' has type
                                'decimal', which is not a valid attribute parameter type
[OnlyClass] on a method         CS0592: Attribute 'OnlyClass' is not valid on this
                                declaration type. It is only valid on 'class' declarations.
[OnlyClass, OnlyClass]          CS0579: Duplicate 'OnlyClass' attribute
```

Setting a get-only property by name is CS0617, a non-`Attribute` class CS0616,
and both `Foo` and `FooAttribute` existing makes `[Foo]` ambiguous (CS1614).

### Targets: assembly, return, field and property

A prefix picks the element that receives the attribute (`assembly`, `module`,
`field`, `event`, `method`, `param`, `property`, `return`, `type`). The docs note
that `return:` is required even when `AttributeUsage` allows only return values.

```csharp
[assembly: AssemblyMetadata("Team", "payments")]
class Invoice
{
    [field: Tag("backing")] public int Amount { get; set; }   // the backing field
    [property: Tag("prop")] public int Tax { get; set; }      // the property (default)
    [field: Tag("field-kw")] public string Note { get; set => field = value.Trim(); } = "";
    [return: Tag("money")] public decimal Total() => Amount + Tax;
}
// <Amount>k__BackingField and <Note>k__BackingField: CompilerGenerated, DebuggerBrowsable, Tag
// property Tax: Tag    Total().ReturnParameter: money    assembly: Team=payments
```

`[field:]` works on an auto-property and on a C# 14 property using `field`, since
both get a generated backing field. With hand-written accessors there is none,
and it is only warning CS0657 (`'field' is not a valid attribute location for
this declaration. ... All attributes in this block will be ignored.`).

### Reading attributes, and what each lookup costs

```csharp
typeof(Invoice).IsDefined(typeof(TagAttribute));       // True, no instance built
typeof(Invoice).GetCustomAttributes<TagAttribute>();   // both Tag instances
typeof(Invoice).GetCustomAttribute<TagAttribute>();    // for non-repeating attributes:
// AmbiguousMatchException: Multiple custom attributes of the same type 'TagAttribute' found.
foreach (var d in typeof(Invoice).GetCustomAttributesData()) Console.WriteLine(d);
// [System.Runtime.CompilerServices.NullableContextAttribute((Byte)1)]  (added by the compiler)
// [TagAttribute("billing", Priority = 2, Kinds = new String[2] { "pdf", "csv" }, Target = typeof(Invoice))]

var a1 = typeof(Invoice).GetCustomAttribute<OneAttribute>();
var a2 = typeof(Invoice).GetCustomAttribute<OneAttribute>();
ReferenceEquals(a1, a2);   // False, and the constructor ran twice
a1.Value = "mutated";      // the next lookup still returns "v1"
```

`GetCustomAttributesData()` never ran the constructor (a counter stayed at 0);
other lookups build a new instance. Over 100,000 Release calls,
`GetCustomAttribute<T>` took about 70 ms and 400 bytes per call, `IsDefined`
about 35 ms and 96 bytes, a `static readonly` cached result under 1 ms and 0.

### Inherited, measured on classes and overrides

Per the docs `Inherited` covers "derived classes and overriding members", and
`MemberInfo` methods ignore `inherit` for properties and events. With `[Inh]`
(`Inherited = true`) and `[NoInh]` (`false`) on a base class and its virtual
members, overridden in a derived class, and `inherit: true` on every call:

```text
derived class         Inh=True  NoInh=False
override method       Inh=True  NoInh=False   (MemberInfo and Attribute agree)
override property     MemberInfo.IsDefined=False     Attribute.IsDefined=True
override event        MemberInfo.IsDefined=False     Attribute.IsDefined=True
override's parameter  ParameterInfo.IsDefined=False  Attribute.IsDefined=True
class implementing an [Inh] interface: False with both APIs
```

### Caller information: guards and asserts

The compiler fills optional parameters marked with caller-info attributes at
each call site (an explicit argument wins); `CallerArgumentExpression` (C# 10)
gets the source text of another argument, see the guard clauses concept.

```csharp
static int Positive(int value, [CallerArgumentExpression(nameof(value))] string? expr = null)
    => value > 0 ? value : throw new ArgumentOutOfRangeException(expr, value, "must be positive");
static void That(bool condition, [CallerArgumentExpression(nameof(condition))] string? expr = null,
    [CallerMemberName] string member = "", [CallerLineNumber] int line = 0)
{ if (!condition) throw new InvalidOperationException($"Check failed in {member} line {line}: {expr}"); }

Positive(qty * 2);          // must be positive (Parameter 'qty * 2')  Actual value was -6.
That(qty > 0 && qty < 10);  // Check failed in <Main>$ line 87: qty > 0 && qty < 10
```

### Conditional, Obsolete and Experimental

`[Conditional("SYMBOL")]` removes the calls, argument expressions included, when
the symbol is not defined; the method must return `void` (CS0578 otherwise).

```csharp
[Conditional("DEBUG")] static void Debug(string s) => Console.WriteLine($"debug {s}");
Debug(Expensive());   // Debug: "Expensive() ran", "debug x".  Release: nothing.
```

`TRACE` is defined in both configurations, so `[Conditional("TRACE")]` calls
ran in Release too. Calls into a referenced library report:

```text
[Obsolete("Use NewPay instead")]          warning CS0618: 'Api.OldPay()' is obsolete: 'Use NewPay instead'
[Obsolete("Removed in v3", error: true)]  error CS0619: 'Api.Gone()' is obsolete: 'Removed in v3'
[Obsolete("Use Sum2", DiagnosticId = "LIB0001", UrlFormat = "https://example.com/obsolete/{0}")]
    warning LIB0001: 'Api.Sum()' is obsolete: 'Use Sum2' (https://example.com/obsolete/LIB0001)
[Experimental("LIBEXP01")]
    error LIBEXP01: 'Lib.Api.Preview()' is for evaluation purposes only and is subject to
    change or removal in future updates. Suppress this diagnostic to proceed.
```

A custom `DiagnosticId` lets consumers silence one deprecation, not every CS0618.
`Experimental` is an **error** under your id (no CSxxxx code), although the C#
attributes page calls it a warning; it fires inside the declaring assembly too,
`#pragma warning disable LIBEXP01` lets the call compile, and an empty id is CS9211.

### Other attributes the compiler reads

- **Nullable analysis**: `[NotNull]`, `[MaybeNull]`, `[NotNullWhen(true)]` and
  `[MemberNotNull]` state what a method guarantees; `b.Name.Length` after an
  `Init()` marked `[MemberNotNull(nameof(Name))]` is clean, without it CS8602.
  The nullable reference types concept has the full table.
- **`[DoesNotReturn]`** marks throw helpers for that analysis; a marked method
  that can return gets CS8763 (`A method marked [DoesNotReturn] should not return.`).
- **`[ModuleInitializer]`** runs when the assembly loads, before `Main`; a method
  that is not static, parameterless and `void` gets CS8815.
- **`[SetsRequiredMembers]`**: a constructor that skips a `required` property
  forces an initializer (CS9035), and the attribute makes the compiler trust the
  constructor unchecked: an empty marked one compiled and left `Name` null, with
  only nullable warning CS8618 as a hint.
- **`[InlineArray(8)]`** on a one-field struct makes a fixed buffer:
  `Unsafe.SizeOf<Buffer8>()` is 32 for `int`, and it converts to `Span<int>`.
- **`[StringSyntax]`** tells editors and analyzers what a string holds; the build
  reports nothing. `Regex`'s constructor parameter carries `StringSyntax("Regex")`.

### A [Command] dispatcher, and its trimming warnings

```csharp
[AttributeUsage(AttributeTargets.Class)]
sealed class CommandAttribute(string name) : Attribute { public string Name { get; } = name; }
[Command("greet")] sealed class Greet : ICommand { public string Run(string[] a) => $"hello, {a[0]}"; }

var commands = typeof(Program).Assembly.GetTypes()
    .Where(t => typeof(ICommand).IsAssignableFrom(t) && !t.IsAbstract)
    .Select(t => (attr: t.GetCustomAttribute<CommandAttribute>(), t))
    .Where(x => x.attr is not null)
    .ToDictionary(x => x.attr!.Name, x => (ICommand)Activator.CreateInstance(x.t)!,
                  StringComparer.OrdinalIgnoreCase);
// with an [Command("add")] class too: "greet ana" -> hello, ana   "ADD 2 3" -> 5
```

The scan runs once and the dictionary is the cache, but the trimmer cannot
follow it: `-p:EnableTrimAnalyzer=true` reports IL2026 on `GetTypes()` (`...
can break functionality when trimming application code. Types might be
removed.`) and IL2077 on `Activator.CreateInstance(Type)`. `t.GetMethods()` on a
plain `Type` parameter is IL2070, removed by annotating the parameter with
`[DynamicallyAccessedMembers(DynamicallyAccessedMemberTypes.PublicMethods)]`
(see the native AOT concept). Source generators read attributes from the
compilation instead, as `[GeneratedRegex]` and `[JsonSerializable]` do, and could
emit this dictionary as code. Frameworks read theirs at run time: ASP.NET Core
`[HttpGet]`, DataAnnotations `[Required]`, EF Core `[Key]`.

## Trade-offs

- **Run-time reading costs on every call.** Each lookup decodes metadata and
  allocates a fresh instance; cache per type or member, as the dispatcher does.
- **`[field:]` can vanish silently.** Without a backing field it is only CS0657:
  ```xml
  <WarningsAsErrors>$(WarningsAsErrors);CS0657</WarningsAsErrors>
  ```
- **Compiler-read attributes act far from their declaration.** A `[Conditional]`
  call also skips its arguments' side effects, and `[SetsRequiredMembers]`
  disables a check instead of performing one.
- **Reflection scans fight trimming.** A source generator does not.

## Documentation Links

- [Attributes and reflection, C# guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/reflection-and-attributes/) (doc)
- [Attributes interpreted by the compiler: Miscellaneous, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/attributes/general) (doc)
- [Attributes interpreted by the compiler: Tracking caller information, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/attributes/caller-information) (doc)
- [Attributes interpreted by the compiler: Nullable static analysis, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/attributes/nullable-analysis) (doc)
- [AttributeUsageAttribute class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.attributeusageattribute) (doc)
