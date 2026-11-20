---
version: 1.0
updatedAt: 2026-11-20
---
## Objective

The `System.Diagnostics` attributes change what a debugger shows and which
frames it steps into, and one of them, `[StackTraceHidden]`, changes the text of
every exception that crosses your code. A test project cannot drive a debugger,
so this concept measures what a program can observe: the attributes read with
`CustomAttributeData`, the BCL's own `List<T>` proxy, how `StackTrace`, `Exception.StackTrace` and `Environment.StackTrace`
react to each attribute, what `Debugger`, `Debug.Assert` and `Trace` do with no
debugger attached, and whether `dotnet-dump analyze` honors any of it. What the
Visual Studio, Rider or VS Code windows do is "docs only": no IDE ran here.

Versions: .NET SDK 10.0.100, runtime 10.0.0, TFM `net10.0`, `dotnet-dump`
10.0.750501, macOS arm64 (Apple M4 Max).

## Use Cases

- Make `Customer { First, Last, Orders }` read as `Ana Silva (2 orders)` in a
  watch window instead of `{Customer}`.
- Show a custom collection as its items, not its internals.

## Deep Dive

### The attributes, read from metadata

They read like any other attribute (see
[attributes](/csharp-concepts/attributes-custom-and-compiler-read) and
[reflection](/csharp-concepts/reflection-type-metadata-and-its-costs)). Their
`AttributeUsage`, measured:

```text
DebuggerDisplayAttribute       Assembly, Class, Struct, Enum, Property, Field, Delegate  multiple=True  inherited=True
DebuggerBrowsableAttribute     Property, Field                                           multiple=False inherited=True
DebuggerTypeProxyAttribute     Assembly, Class, Struct                                   multiple=True  inherited=True
DebuggerStepThroughAttribute   Class, Struct, Constructor, Method                        multiple=False inherited=False
DebuggerHiddenAttribute        Constructor, Method, Property                             multiple=False inherited=False
DebuggerNonUserCodeAttribute   Class, Struct, Constructor, Method, Property              multiple=False inherited=False
StackTraceHiddenAttribute      Class, Struct, Constructor, Method                        multiple=False inherited=False
```

`DebuggerHidden` is the only step attribute not allowed on a type, and none of
the step attributes nor `StackTraceHidden` is inherited.

### DebuggerDisplay: a string, not code

```csharp
[assembly: DebuggerDisplay("Money {Amount} {Currency,nq}", Target = typeof(Money))]

[DebuggerDisplay("{Name,nq} x{Qty}", Name = "line", Type = "OrderLine")]
public class OrderLine { public string Name { get; set; } = ""; public int Qty { get; set; } }
[DebuggerDisplay("{DebuggerDisplay,nq}")]          // the pattern from the docs
public class Customer
{
    public string First { get; set; } = ""; public string Last { get; set; } = "";
    public List<string> Orders { get; } = new();
    private string DebuggerDisplay => $"{First} {Last} ({Orders.Count} orders)";
}

[DebuggerDisplay("{Missing} and {Count - 2} and {Next()}")]
public class Dubious { public int Count = 8; public int Calls; public int Next() => ++Calls; }
```

`GetCustomAttributesData()` returns the text as written, the assembly-level
form (for a type you do not own) included:

```text
[DebuggerDisplayAttribute("{Name,nq} x{Qty}", Name = "line", Type = "OrderLine")]
[DebuggerDisplayAttribute("Money {Amount} {Currency,nq}", Target = typeof(Lab.Money))]
Dubious.Calls after reading its attribute "{Missing} and {Count - 2} and {Next()}": 0
```

Measured: the compiler does not parse the string (`{Missing}` names no member
and the build had 0 warnings, 0 errors); reading the attribute never evaluates
`{Next()}`; and the attribute stays in a Release assembly. Braces hold member
names as text, so a rename does not update them, but a constant interpolated
string keeps them in sync (same metadata as the hand-written one):

```csharp
[DebuggerDisplay($"{{{nameof(Name)},nq}} x{{{nameof(Qty)}}}")]   // -> "{Name,nq} x{Qty}"
```

Docs only, from the Visual Studio page: text in braces is evaluated as a field,
property or method; `,nq` removes the quotes; `Name` and `Type` change those
columns; `DebuggerDisplay` wins over an overridden `ToString()`; evaluating
expressions is "the most expensive operation in the debugger", happens on each
display and can change application state; and the "Show raw structure of
objects" option ignores the attribute. The tool you use to look at an object
runs your code, so `{Next()}` is the case to avoid.

### DebuggerBrowsable and DebuggerTypeProxy

`[DebuggerBrowsable(state)]` takes `Never` (hide), `Collapsed` or `RootHidden`
(show the elements, not the value). Read back from a class that sets all three,
plus an auto-property:

```text
Field   Secret                  Never
Field   Flat                    RootHidden
Field   Folded                  Collapsed
Field   <Plain>k__BackingField  Never        <- Debug build
Field   <Plain>k__BackingField               <- Release build, no attribute
```

The last two lines were the only difference between the Debug and Release
outputs: the compiler adds `DebuggerBrowsable(Never)` to an auto-property's
backing field only in Debug (SDK 10.0.100, one property).

`[DebuggerTypeProxy(typeof(P))]` replaces the type's expansion with the public
members of `P`, whose constructor takes the target. The BCL does this for
`List<T>`; this program read that attribute, built the proxy by reflection and
read its properties:

```text
List`1: [DebuggerTypeProxyAttribute(typeof(System.Collections.Generic.ICollectionDebugView`1))]
        [DebuggerDisplayAttribute("Count = {Count}")]
  proxy ICollectionDebugView`1 (public=False): Items : Int32[]  RootHidden  value=[10, 20, 30]
```

The `dotnet/runtime` source matches (`T[] Items` with `RootHidden`, copied on
each read). The same pattern for your own collection:

```csharp
[DebuggerTypeProxy(typeof(BagDebugView<>))][DebuggerDisplay("Count = {Count}")]
public class Bag<T> : IEnumerable<T> { /* ... */ }

public sealed class BagDebugView<T>(Bag<T> bag)    // reflection read Items as String[] [x, y]
{
    [DebuggerBrowsable(DebuggerBrowsableState.RootHidden)] public T[] Items => bag.ToArray();
}
```

Docs only: the debugger builds a proxy "every time it needs to display a
variable", so keep the constructor cheap; only public members show; a C# target
must be an open generic (`Bag<>`).

### Frames: step, hide and non-user code

`[DebuggerStepThrough]`, `[DebuggerHidden]` and `[DebuggerNonUserCode]` are
instructions to a stepping debugger (docs only). What a program sees is that none
of them changes an exception. One chain, throwing in `Thrower`, with one
attribute on the middle method (Debug and Release identical with `NoInlining`;
inlining was not varied):

```text
attribute on the middle frame   ex.StackTrace   new StackTrace(ex).FrameCount   frames in the object
(none)                          4 lines         4                              Thrower > Plain > lambda > Case
[StackTraceHidden]              3 lines         4                              Thrower > HiddenTrace > lambda > Case
[DebuggerHidden], [DebuggerStepThrough], [DebuggerNonUserCode]: each 4 lines, 4 frames, same as none
```

Only `[StackTraceHidden]` (.NET 6) edits the text, and the frame is still in
`GetFrames()`, so code that walks frames sees a stack the text does not show. Two
more placements. On the method that throws, the throw line disappears and the
top frame is the caller, `at Lab.Stacks.Plain(Action a) ... line 11` (`FrameCount`
4, 3 lines). On a static class `Guard`, its `NotNull` vanished and the first
line was the caller of `Guard.NotNull(null)` (`FrameCount` 3, 2 lines).
`Environment.StackTrace` follows the same rule. From inside a method called
through a hidden one:

```text
new StackTrace().FrameCount = 4   (Inside > HiddenTrace > Run > Main)
StackTrace.ToString():     Inside, Run, Main
Environment.StackTrace:    get_StackTrace, Inside, Run, Main
```

The BCL is a heavy user. Declared members of `System.Private.CoreLib` 10.0.0, by reflection: `DebuggerHidden` on 342 members, `DebuggerStepThrough` on
63 members and 6 types, `StackTraceHidden` on 49 members and 7 types,
`DebuggerDisplay` on 56 types, `DebuggerTypeProxy` on 38, `DebuggerVisualizer`
on none. It does not hide every throw helper: `ThrowIfNull(null)` still showed
`at System.ArgumentNullException.Throw(String paramName)`. Use it on your own
helpers when the frame would only distract (see
[guard clauses](/csharp-concepts/guard-clauses-throwing-and-rethrowing) and
[exceptions](/csharp-concepts/exceptions-try-catch-filters-and-finally)).

### Debugger, Debug.Assert and Trace without a debugger

Plain processes, no debugger anywhere, exit codes from `$?`:

```text
                              Debug build                                          Release build
IsAttached, then Launch()     False; Launch() returned True, IsAttached still False   same
Debugger.Break()              continued, exit 0                                    same
Debug.Assert(false, "msg")    "Process terminated. Assertion failed.", exit 134    call removed, exit 0
Trace.Assert(false, "msg")    "Process terminated. Assertion Failed", exit 134    same, exit 134
Debug/Trace.WriteLine         nothing on the console (only DefaultTraceListener)
  + ConsoleTraceListener      both lines                                           only the Trace line
```

Three surprises. `Debugger.Launch()` returned `True` while `IsAttached` stayed
`False`: nothing was launched on macOS (Windows behavior is docs only). `Debugger.Break()` is a no-op
without a debugger and is not `[Conditional]`, so a forgotten one ships. And
`Trace.Assert` kills a Release process: reflection confirms `Debug.Assert` and
`Debug.WriteLine` carry `Conditional("DEBUG")`, `Trace.Assert` and
`Trace.WriteLine` carry `Conditional("TRACE")`, and `TRACE` is defined in
Release (see
[preprocessor directives](/csharp-concepts/preprocessor-directives-and-conditional-compilation)).
An invariant that must never stop production is a `Debug.Assert`.

### dotnet-dump does not apply them

Does `dotnet-dump analyze` show a display string or a proxy? I ran a Release
build holding an `OrderLine`, a `Customer`, a `Bag<string>`, a `Money` and a
`List<int>`, took `dotnet-dump collect --type Heap` (354 MB, from a private
runtime copy with `createdump` made executable, as in the
[dotnet-trace, dump and gcdump](/dotnet-concepts/diagnosing-production-with-dotnet-trace-dump-and-gcdump)
concept) and ran `dumpobj` on each. The output is the raw object, e.g. for `Lab.Customer`
three fields named `<First>k__BackingField`, `<Last>k__BackingField` and
`<Orders>k__BackingField` with addresses as values.

No `Ana Silva (2 orders)` and no `Count = 2`; a `List<string>` showed `_items` and
`_size 2`, and `help` has no command about display strings or proxies.
`[DebuggerVisualizer]` names a separate assembly that a debugger loads to draw a
value in its own window: docs only (see the Visual Studio page on custom
visualizers).

### Book vs today

Older .NET books present `DebuggerDisplay`, `Debug.Assert` and `Debug.WriteLine`
as the diagnostics toolkit. The display and proxy attributes are unchanged and
still worth three lines for a type you inspect daily. What moved: `Debug.WriteLine` printed nothing here without a listener,
where `ILogger`, OpenTelemetry and EventPipe are what production reads (see
[structured logging](/dotnet-concepts/structured-logging-with-serilog-and-log-sinks));
a failing assert ends this runtime's process (exit 134); `[StackTraceHidden]` is
new since .NET 6, so older material has no way to shorten an exception text;
and post-mortem work goes through `dotnet-dump`, where the display attributes
are not used (measured above; the IDE's dump window was not run).

## Trade-offs

- **The display string is unchecked text that can run your code.** `{Missing}`
  built with 0 warnings, and `{Next()}` is a call on every refresh. Use `nameof`
  as above and keep the logic in a private property with no side effects.
- **A proxy copies.** `Items` calls `ToArray()` on each expansion: costly for a
  lazy or huge sequence. Cap it.
- **`[StackTraceHidden]` removes evidence.** On a throwing method the text named
  its caller. Reserve it for tiny helpers and keep logging the full exception.
- **`Trace.Assert` and a forgotten `Debugger.Break()` ship.** The first ended a
  Release process (exit 134); the second is a no-op until a debugger attaches.

## Documentation Links

- [Display custom info using DebuggerDisplay, Visual Studio, Microsoft Learn](https://learn.microsoft.com/en-us/visualstudio/debugger/using-the-debuggerdisplay-attribute) (doc)
- [Use the DebuggerTypeProxy attribute, Visual Studio, Microsoft Learn](https://learn.microsoft.com/en-us/visualstudio/debugger/using-debuggertypeproxy-attribute) (doc)
- [Enhancing debugging with the debugger display attributes, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/framework/debug-trace-profile/enhancing-debugging-with-the-debugger-display-attributes) (doc)
- [Create custom visualizers of data, Visual Studio, Microsoft Learn](https://learn.microsoft.com/en-us/visualstudio/debugger/create-custom-visualizers-of-data) (doc)
- [StackTraceHiddenAttribute class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.stacktracehiddenattribute) (doc)
- [ICollectionDebugView.cs, dotnet/runtime, GitHub](https://github.com/dotnet/runtime/blob/main/src/libraries/System.Private.CoreLib/src/System/Collections/Generic/ICollectionDebugView.cs) (doc)
- [dotnet-dump, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-dump) (doc)
