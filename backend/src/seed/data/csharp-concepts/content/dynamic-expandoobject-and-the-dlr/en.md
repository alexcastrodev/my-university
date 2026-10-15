---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

`dynamic` turns off the compiler for every expression it touches: member
lookup, overload resolution and operators are decided at run time, and a typo
becomes an exception instead of a build error. The machinery behind it is the
dynamic language runtime (DLR), and the two classes you meet most are
`ExpandoObject` (a bag you can add members to) and `DynamicObject` (a base class
for your own dynamic behavior). This concept explains what `dynamic` is at
compile time and at run time, how the DLR caches work, what the two classes
do, what it costs, and why `JsonNode` or a typed model is almost always the
better choice in new code.

## Use Cases

- Calling a COM API (Office automation) without a cast on every `object`.
- Reading an object whose shape is known only at run time, such as a loosely
  structured payload in a script or a test helper.
- Building a fluent, member-style wrapper (`config.Database.Port`) over a
  dictionary with `DynamicObject`.
- Recognizing the `RuntimeBinderException` in a log and knowing where it comes
  from.

## Deep Dive

### What `dynamic` is

`dynamic` is a static type, but an expression of that type bypasses static type
checking: the compiler assumes it supports any operation. The compiler packages
what each statement wants to do to the value, and the runtime examines that
information when the statement executes. Observed in .NET 10:

```csharp
dynamic d = 5;
Console.WriteLine(d + 1);                 // 6
Console.WriteLine(((object)d).GetType()); // System.Int32
d = "text";
Console.WriteLine(d.Length);              // 4
try { Console.WriteLine(d.Missing); }
catch (RuntimeBinderException e) { Console.WriteLine(e.Message); }
// 'string' does not contain a definition for 'Missing'
```

The same variable held an `int`, then a `string`, and every member lookup used
the run-time type. At run time `dynamic` is just `object`:
`typeof(List<dynamic>) == typeof(List<object>)` printed `True`, and the type
printed as `List<Object>`. The result of most dynamic operations is itself
`dynamic`; conversions from `dynamic` to another type and constructor calls
with a dynamic argument are not (`var x = new Foo(d)` is a `Foo`).

### Overload resolution moves to run time

If any argument, or the receiver, is `dynamic`, overload resolution happens at
run time using the run-time types. With overloads for `int`, `string` and
`object`:

```csharp
object o = "s"; dynamic dy = "s";
Console.WriteLine($"{Who(o)} {Who(dy)}");   // object string
```

The static variable picked `object` and the dynamic one picked `string`.
Passing a `dynamic` argument to a method that has no matching overload
compiles, then fails at run time. That is the whole risk: refactoring tools,
the compiler and nullable analysis cannot see these call sites.

### The DLR and call sites

The DLR provides the infrastructure for `dynamic` in C# (and for languages
such as IronPython). Each place where you apply an operation to a dynamic value
(`a + b`, `a.b()`) is a call site. The first execution asks a binder to build
the rules for that operation, expressed as expression trees, and the DLR
caches the characteristics of the operands (usually their types) so the next
execution with the same types skips the binding work.

A rough measurement on one machine (Release, 5 million calls of
`GetHashCode()` on an `int`; numbers vary by hardware and runtime, so treat
only the order of magnitude as meaningful):

| Call | Time |
|---|---|
| static `int` | 6 ms |
| `dynamic` | 38 ms |
| `MethodInfo.Invoke` | 43 ms |

`dynamic` was close to cached reflection and several times slower than a direct
call. The first call at each site also pays the binding cost, so a rarely
executed site never amortizes it.

### ExpandoObject

`ExpandoObject` lets you add and remove members at run time. It implements
`IDictionary<string, object>`, so you can enumerate members and, since C# has no
syntax for deleting a member, remove one through the dictionary cast. It also
implements `INotifyPropertyChanged`. Members can be delegates and be invoked
like methods:

```csharp
dynamic ex = new ExpandoObject();
ex.Name = "Ana";
ex.Age = 30;
ex.Greet = (Func<string>)(() => "hi " + ex.Name);
Console.WriteLine($"{ex.Name} {ex.Age} {ex.Greet()}");   // Ana 30 hi Ana
var dict = (IDictionary<string, object?>)ex;
Console.WriteLine(string.Join(",", dict.Keys));           // Name,Age,Greet
dict.Remove("Age");
try { Console.WriteLine(ex.Age); }
catch (RuntimeBinderException e) { Console.WriteLine(e.Message); }
// 'System.Dynamic.ExpandoObject' does not contain a definition for 'Age'
```

The lambda is cast to a delegate type, as in the documentation example.
Serialization needs care too: `JsonSerializer.Serialize(ex)` with the
`Greet` delegate still inside threw `NotSupportedException` (delegates are
unsupported), while the same object with only `Name` and `Age` produced
`{"Name":"Ana","Age":31}`.

### DynamicObject

Derive from `DynamicObject` when you want to decide what a member access
means. Override the `Try...` methods you need and return `true` when you
handled the operation (`false` produces a `RuntimeBinderException`):

```csharp
class Bag : DynamicObject
{
    readonly Dictionary<string, object?> _d = new();
    public override bool TrySetMember(SetMemberBinder b, object? v) { _d[b.Name] = v; return true; }
    public override bool TryGetMember(GetMemberBinder b, out object? r) => _d.TryGetValue(b.Name, out r);
    public override bool TryInvokeMember(InvokeMemberBinder b, object?[]? a, out object? r) { r = "called " + b.Name; return true; }
    public override bool TryGetIndex(GetIndexBinder b, object[] i, out object? r) { r = "idx " + i[0]; return true; }
}

dynamic bag = new Bag();
bag.Color = "red";
Console.WriteLine(bag.Color);      // red
Console.WriteLine(bag.Whatever()); // called Whatever
Console.WriteLine(bag["k"]);       // idx k
```

This is the extension point behind dynamic wrappers over XML, JSON or script
objects: the library decides the meaning of `obj.Count += 1` and the caller
gets natural syntax.

### Dynamic JSON, and the alternative

Deserializing to `ExpandoObject` with System.Text.Json does not give you
Expando members. In .NET 10 the values come back as `JsonElement`, so
`jd.a + 1` threw `RuntimeBinderException: Operator '+' cannot be applied to
operands of type 'System.Text.Json.JsonElement' and 'int'`. The better tool is
the DOM:

```csharp
var node = JsonNode.Parse("""{"name":"Ana","tags":["a","b"],"n":{"x":1}}""")!;
Console.WriteLine($"{node["name"]} {node["tags"]![1]} {node["n"]!["x"]!.GetValue<int>()}"); // Ana b 1
Console.WriteLine(node["missing"] is null);   // True
```

`JsonNode` is typed, navigable, null-aware (a missing key is `null`, not an
exception) and does not need the DLR. For a known shape, deserialize into a
`record`.

## Trade-offs

- **Dynamic dispatch gives flexibility and loses every compile-time check.** A
  misspelled member compiles and fails in production
  (`d.Missing` above). Mitigation: confine `dynamic` to a small boundary method
  and convert to a typed value immediately (`int i = d;` applies the conversion
  at run time).
- **The DLR cache makes repeated calls fast enough and never as fast as static
  code.** About 6x slower than a direct call in the measurement above, with a
  binding cost on the first call of each site. Mitigation: do not use it in hot
  loops, and prefer generics or an interface when the operation set is known.
- **`ExpandoObject` is a dictionary with member syntax.** You get enumeration
  and removal for free, and a typo in a name silently creates or misses a
  member. If you find yourself reading it through `IDictionary` casts, use a
  `Dictionary<string, object?>` directly.
- **`DynamicObject` is powerful and hard to discover.** Callers see no members
  in IntelliSense and no signature. Use it for library-style wrappers where the
  syntax is the product, not for ordinary application models.
- **Dynamic JSON via `dynamic` is a trap.** `JsonElement` values break
  arithmetic, as shown. Use `JsonNode` or a typed model.

## Documentation Links

- [Using type dynamic, C# advanced topics, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/interop/using-type-dynamic) (doc)
- [Dynamic Language Runtime Overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/framework/reflection-and-codedom/dynamic-language-runtime-overview) (doc)
- [ExpandoObject class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.dynamic.expandoobject) (doc)
- [DynamicObject class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.dynamic.dynamicobject) (doc)
- [Use JsonDocument and JsonNode (DOM), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/use-dom) (doc)
- [How to access Office interop objects by using C# features, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/interop/how-to-access-office-interop-objects) (doc)
