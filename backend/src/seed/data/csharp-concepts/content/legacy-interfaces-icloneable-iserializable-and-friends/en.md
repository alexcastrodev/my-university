---
version: 1.0
updatedAt: 2026-11-20
---
## Objective

C# 1 and 2 books, and the old certification exam, taught a set of interfaces as
"the way": `ICloneable` for copying, `ISerializable` plus `[Serializable]` for
saving objects, `ArrayList` and `Hashtable` for collections, `IAsyncResult` with
`Begin/End` for async. You still meet them in legacy code and in the BCL, but almost none belongs in new code. This
concept measures what each one does on .NET 10 (the shallow-copy trap behind
`ICloneable`, what `Exception` still serializes, which serializer honors which
hook, what the obsolete diagnostics say, what boxing costs) and gives the
replacement for each. `BinaryFormatter` has its own concept, linked below.

Versions: .NET SDK 10.0.100, runtime 10.0.0, TFM `net10.0`, no NuGet packages,
macOS arm64 (Apple M4 Max). Timings are best of 7 runs and indicative only.

## Use Cases

- Maintaining a codebase that calls `.Clone()`, `ArrayList` or `BeginRead`, or reviewing a pull request that adds `ICloneable` or `[Serializable]`.
- Porting an old exception hierarchy and wondering about the serialization constructor.

## Deep Dive

### ICloneable: a contract that promises nothing

`ICloneable` has one member, `object Clone()`. The Learn page says it "does not
specify whether the cloning operation performs a deep copy, a shallow copy, or
something in between", and for that reason recommends that `ICloneable` not be
implemented in public APIs. The caller cannot know what it gets, and must cast an `object`. The usual implementation is `MemberwiseClone`, which copies
every instance field (private and `readonly` included) without running a
constructor:

```csharp
class Basket(string owner, List<string> items) : ICloneable
{
    public string Owner { get; set; } = owner;
    public List<string> Items { get; } = items;
    public object Clone() => MemberwiseClone();
}
var c = (Basket)a.Clone(); c.Items.Add("eggs"); c.Owner = "Bob";
// original=Ana/[milk,eggs] clone=Bob/[milk,eggs] sharedList=True
```

The value fields were copied, the reference field points at the same list, so
the "copy" mutated the original. The constructor did not run again and a
private `readonly` field was copied (`s3`), as `MemberwiseClone` does.

### What to write instead

- **A copy constructor** says exactly how deep it goes and returns the real
  type: `public Basket(Basket o) { Owner = o.Owner; Items = [.. o.Items]; }`
  gave `original=[milk] copy=[milk,eggs] shared=False`.
- **A record `with`** is also a shallow copy: `r1 with { Owner = "Bob" }` left
  `shared=True` for the list. Records and `with` are covered in
  [Records and with-expressions](/csharp-concepts/records-and-with-expressions),
  which also shows the copy-constructor fix.

`ICloneable` survives in the BCL, so you will call it. In the loaded assemblies 31 concrete public non-delegate types implement it: `String`,
`ArrayList`, `Hashtable`, `BitArray`, `CultureInfo`, the calendars, the
`Encoding` classes, `Version`, `AssemblyName`. `List<T>` and `Dictionary<,>` do
not. Two cases are worth knowing: `Array.Clone()` is shallow (a cloned
`List<int>[]` shares its element lists, with a new array object), and
`string.Clone()` returns the same reference (`ReferenceEquals` was `True`).

### [Serializable], ISerializable and the serialization constructor

The old model: mark the class `[Serializable]`, exclude fields with
`[NonSerialized]`, and for control implement `ISerializable`: `GetObjectData`
writes name/value pairs into a `SerializationInfo` and a constructor
`(SerializationInfo, StreamingContext)` reads them back. The Learn page says the constructor "should be protected if the class is not
sealed". A hand-written type, driven by calling the methods directly (no
formatter involved):

```csharp
[Serializable]
class CustomSer : ISerializable
{
    public string Name; public int Level; [NonSerialized] public string Hidden;
    protected CustomSer(SerializationInfo i, StreamingContext c) { Name = i.GetString("n")!; Level = i.GetInt32("l"); Hidden = "(default)"; }
    public void GetObjectData(SerializationInfo i, StreamingContext c) { i.AddValue("n", Name); i.AddValue("l", Level); }
}
// keys: n=x, l=7  ->  rebuilt: x/7/(default)
```

The attribute is still honored as metadata (`typeof(Person).IsSerializable` was
`True` with it, `False` without), but the pieces that drove it are marked
obsolete. SYSLIB0050 (since .NET 8) covers `FormatterConverter`,
`StreamingContextStates`, `IFormatterConverter`, `FormatterServices` and
`Type.IsSerializable`; every line of the test above that touched them warned.
SYSLIB0051 (since .NET 8) covers public or protected `.ctor(SerializationInfo,
StreamingContext)` constructors and implicit `GetObjectData` implementations
such as `Exception`'s. Implementing `ISerializable` yourself on a custom type
produced no compiler warning; with `AnalysisMode` set to `All`, only `CA2237` fired, for a missing `[Serializable]`.

### Where ISerializable still shows up: Exception

240 public types in the loaded assemblies implement `ISerializable`, 113 of
them exceptions and 82 delegates; others include `Dictionary<,>`, `HashSet<>`,
`StringBuilder`, `DateTime` and `FileInfo`. Calling `GetObjectData` on a thrown
`InvalidOperationException("boom", inner)` printed what an exception serializes:

```text
ClassName, Message, Data, InnerException, HelpURL, StackTraceString,
RemoteStackTraceString, RemoteStackIndex, ExceptionMethod, HResult, Source, WatsonBuckets
```

Twelve entries, including the stack trace text and the `Source` assembly name.
Reflection on `InvalidOperationException` listed the three public constructors
and `protected (SerializationInfo, StreamingContext) [Obsolete SYSLIB0051]`.
Deriving from `Exception` and writing the classic serialization constructor
`: base(info, ctx)` compiled with `warning SYSLIB0051` on the base call. The
SYSLIB0051 page's advice is to ask whether the exception needs to be
serializable at all: exception serialization is "primarily intended to support
remoting", dropped in .NET Core 1.0, so it says to remove `[Serializable]`, the
serialization constructor and the `GetObjectData` override (a library bound by
API compatibility can instead obsolete its own with SYSLIB0051). For new
exceptions write the three ordinary constructors (see
[Exceptions](/csharp-concepts/exceptions-try-catch-filters-and-finally)).

### Which serializer honors which hook

`[NonSerialized]`, `[OnDeserialized]` and `IDeserializationCallback` belong to
the old model, and the modern serializers disagree about them. The same
`[Serializable]` class with a `[NonSerialized]` field, an `[OnDeserialized]`
method and an `IDeserializationCallback`:

```text
System.Text.Json:       {"Name":"Ana","Age":3}
DataContractSerializer: <Person ...><Callback>false</Callback><Hooked>false</Hooked>
  <_x003C_Age_x003E_k__BackingField>3</_x003C_Age_x003E_k__BackingField>
  <_x003C_Name_x003E_k__BackingField>Ana</_x003C_Name_x003E_k__BackingField></Person>
DCS read back: Cache=null, OnDeserialized ran=True, IDeserializationCallback ran=True
STJ read back: OnDeserialized ran=False, IDeserializationCallback ran=False
STJ IncludeFields, [NonSerialized] field: {"Keep":1,"Skip":2}
```

Three findings. `DataContractSerializer` treats `[Serializable]` as "write every
field", so the auto-property backing fields appear with mangled names and
`[NonSerialized]` is honored (`Cache` was not written), while it calls
`[OnDeserialized]` and `IDeserializationCallback`. System.Text.Json calls
neither hook, and ignores `[NonSerialized]`: with `IncludeFields` it wrote the
field marked `[NonSerialized]`. So putting `[Serializable]` on a DTO for
convenience changes the XML shape and does nothing for JSON. Use
`[JsonIgnore]` and `IJsonOnDeserialized`, covered in
[System.Text.Json](/csharp-concepts/system-text-json-serialization-and-options).

### BinaryFormatter, in one paragraph

[BinaryFormatter](/csharp-concepts/binaryformatter-removal-and-safe-serialization)
consumed all this machinery. On .NET 10 code that uses it fails to build with
`error SYSLIB0011: 'BinaryFormatter' is obsolete`; with the diagnostic silenced,
`Serialize` threw `PlatformNotSupportedException: BinaryFormatter serialization
and deserialization have been removed`. The risk is by design (the payload picks
the types), so the migration guide says stop using it even for trusted data. The
linked concept has the migration path and `NrbfDecoder`; only the compiler and
runtime refusal are shown here.

### Book vs today: the legacy interfaces and their replacements

| Legacy (book, .NET 1 and 2) | What it costs or does | Use today |
|---|---|---|
| `ICloneable` | ambiguous depth, returns `object` | copy constructor, `with`, immutable types |
| `[Serializable]`, `ISerializable` | formatter model, SYSLIB0050/0051 | System.Text.Json, protobuf, MessagePack |
| `BinaryFormatter` | removed in .NET 9 | JSON or a contract binary format |
| `ArrayList`, `Hashtable`, `Queue`, `Stack` | `object` slots, boxing | `List<T>`, `Dictionary<,>`, `Queue<T>`, `Stack<T>` |
| `IEnumerable`, `IEnumerator`, `ICollection`, `IList` | untyped | the generic versions; the old ones stay as bases |
| `IComparable` (non-generic) | boxes structs | `IComparable<T>`, `Comparer<T>.Default` |
| `IAsyncResult`, `Begin/End` (APM) | callback and handle plumbing | `Task`, `async`/`await` |
| `ISynchronizeInvoke` | marshal to a UI thread, `Control` era | `SynchronizationContext`, the UI framework's dispatcher |
| `EventArgs` for every event | a class per event | `EventHandler<T>` with any `T` |

The non-generic collections carry no compiler diagnostic, but the Learn pages
for `ArrayList`, `Hashtable`, `Queue` and `Stack` each say "we don't recommend
that you use" them "for new development". The interface rows are not removed
either: `IEnumerable<T>` inherits `IEnumerable`, and `string` implements both
`IComparable` and `IComparable<string>`. What changes is what you write.

### What the non-generic versions cost

`GC.GetAllocatedBytesForCurrentThread`, 100,000 `int`s, Release, best of 7 for
time. The "add" rows include the backing array (the generics concept counts only
the boxes, 2,401,488 bytes):

```text
ArrayList.Add               3,200,096 bytes  0.417 ms   List<int>.Add           400,096 bytes  0.064 ms
Hashtable[i]=i              8,554,624 bytes  0.788 ms   Dictionary<int,int>   2,172,792 bytes  0.224 ms
Queue.Enqueue               3,200,112 bytes  0.450 ms   Queue<int>.Enqueue      400,104 bytes  0.201 ms
foreach IEnumerable (object) 2,400,072 bytes 0.589 ms   foreach IEnumerable<int>     72 bytes  0.133 ms
((IComparable)v1).CompareTo   2,424,016 bytes 0.249 ms  Comparer<Ver>.Default         40 bytes  0.052 ms
ArrayList.Sort              4,000,120 bytes  6.219 ms   List<int>.Sort          400,096 bytes  0.792 ms
```

Each boxed `int` is 24 bytes, so `ArrayList` and `Queue` allocate 8 times what
`List<int>` and `Queue<T>` do for the same data (`Hashtable` about 4 times what
`Dictionary` does) and ran 2 to 8 times slower here (the sort
includes building the list). A non-generic `foreach (object x in (IEnumerable)intArray)`
boxed every element; the generic loop allocated only the enumerator. The same
`IComparable` boxing hits a struct on every comparison: 24 bytes per call.
Reading an `ArrayList` of ints allocated nothing per element (88 bytes total),
because unboxing does not allocate: the cost is in writing, not reading.

### APM and the other async relics

`IAsyncResult` with `BeginX/EndX` is the .NET 1 model; the Learn page says the
Task-based pattern "supersedes both APM and EAP". Measured on .NET 10:

```text
delegate BeginInvoke: PlatformNotSupportedException: Operation is not supported on this platform.
FileStream.BeginRead/EndRead: 9 bytes, IAsyncResult type TaskAsyncResult
Task.Factory.FromAsync wrapped: 9 bytes
ReadAsync: 9 bytes
```

Two surprises for old code: `Func<,>.BeginInvoke` (the "free async call" of
C# 1 tutorials) throws on .NET (Core), while stream `BeginRead` still works as
a wrapper over the Task machinery (`TaskAsyncResult`), and
`Task.Factory.FromAsync` turns a surviving `Begin/End` pair into an awaitable
`Task`, so wrap such a library at the edge instead of rewriting it. `ISynchronizeInvoke` is a Windows Forms-era contract (`Invoke` on the
owner's thread); no type in the loaded assemblies implemented it on this macOS
run, and `SynchronizationContext` does its job now. `EventHandler<int>` compiled and ran: on .NET Core the
`TEventArgs` no longer has to derive from `EventArgs`, as
[Events](/csharp-concepts/events-observer-pattern-and-memory-leaks) explains.

## Trade-offs

- **Do not add `ICloneable`, but do not rip it out.** Wrap it:
  `public Basket Copy() => new(this)` is typed and honest about depth.
  `MemberwiseClone` suits only types with nothing but value fields.
- **Keeping `[Serializable]` on exceptions is mostly noise.** The serialization
  constructor now warns (SYSLIB0051). Delete it in a hierarchy you control; in a
  public library with compatibility constraints, obsolete your own copy instead.
- **A `[Serializable]` DTO has two lives.** `DataContractSerializer` writes all
  fields and honors the hooks, System.Text.Json writes properties and honors
  none. Pick the serializer first, then the attributes.
- **Replacing `ArrayList` is often a free win.** `List<int>` removed 2.8 MB of
  allocation for 100,000 items, but a genuinely mixed list is `List<object>`.

## Documentation Links

- [ICloneable Interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.icloneable) (doc)
- [Object.MemberwiseClone, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.object.memberwiseclone) (doc)
- [ISerializable Interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.serialization.iserializable) (doc)
- [SYSLIB0050: Formatter-based serialization is obsolete, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/syslib-diagnostics/syslib0050) (doc)
- [SYSLIB0051: Legacy serialization support APIs are obsolete, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/syslib-diagnostics/syslib0051) (doc)
- [SYSLIB0011: BinaryFormatter serialization is obsolete, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/syslib-diagnostics/syslib0011) (doc)
- [BinaryFormatter migration guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/binaryformatter-migration-guide/) (doc)
- [Commonly used collection types, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/collections/) (doc)
- [Non-generic collections shouldn't be used, dotnet/platform-compat](https://github.com/dotnet/platform-compat/blob/master/docs/DE0006.md) (doc)
- [Asynchronous Programming Model (APM), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/asynchronous-programming-patterns/asynchronous-programming-model-apm) (doc)
- [Interop with other asynchronous patterns and types, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/asynchronous-programming-patterns/interop-with-other-asynchronous-patterns-and-types) (doc)
- [ISynchronizeInvoke Interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.componentmodel.isynchronizeinvoke) (doc)
