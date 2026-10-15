---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

Nullable reference types (NRT, C# 8) let you say which references may be
`null` (`string?`) and which may not (`string`), and the compiler then tracks a
null-state for every expression and warns when the two disagree. It is a static
analysis, not a type system change: the runtime never sees the difference.
This concept shows where the annotation lives in metadata, how the not-null /
maybe-null flow analysis works and where it is deliberately unsound, the
attributes that describe contracts the `?` cannot express, what `T?` means for
an unconstrained generic, what still has to be checked at run time, and how
`Nullable<T>` (the value-type `int?`) differs.

## Use Cases

- Making "this can be missing" visible in a signature instead of in a comment.
- Turning a `NullReferenceException` found in production into a compiler
  warning found at build time.
- Writing `TryGet`, `Normalize` or `Initialize` helpers whose callers get
  correct warnings without `!`.
- Migrating an older codebase file by file.
- Reading `int?` columns from a database and doing arithmetic on them.

## Deep Dive

### An annotation, not a type

`string` and `string?` are the same `System.String` at run time. The compiler
records the annotation in attributes, which ilspy shows on the compiled
method:

```csharp
public static string? Find(string key) => key == "x" ? "found" : null;
// decompiled: [NullableContext(1)] on the class, [return: Nullable(2)] on Find
// (1 = not annotated, 2 = annotated)

var m = typeof(Api).GetMethod(nameof(Api.Find))!;
Console.WriteLine($"{m.ReturnType} {m.GetParameters()[0].ParameterType}"); // System.String System.String
var ctx = new NullabilityInfoContext();
// ctx.Create(m.ReturnParameter).ReadState -> Nullable, parameter WriteState -> NotNull
```

Nothing is enforced. `Api.Length(null!)` compiles and throws
`NullReferenceException` inside; invoking `Echo(string s)` through reflection
with `null` simply passes `null`. Public APIs still need guard clauses
(`ArgumentNullException.ThrowIfNull`, see the guard clauses concept), because
callers can have NRT disabled, use reflection, or deserialize data.

The feature is switched on by `<Nullable>enable</Nullable>` (current templates
and file-based apps already do it) or per region with `#nullable enable`,
`disable` and `restore`. The setting has two flags: `annotations` (the `?`
means something) and `warnings` (the analysis reports). References declared
with annotations off are "nullable-oblivious": the compiler neither trusts nor
questions them.

### Null-state and flow analysis

Every expression is either not-null or maybe-null. A non-nullable variable
starts not-null, a nullable one maybe-null, and assignments and checks move the
state:

```csharp
string? maybe = Api.Find("y");
Console.WriteLine(maybe.Length);   // warning CS8602: Dereference of a possibly null reference.
Api.Length(maybe);                 // no warning: after the CS8602 the state is not-null
if (maybe is null) return;
Console.WriteLine(maybe.Length);   // no warning: the check proved it
string s = null;                   // warning CS8600: Converting null literal or possible null value to non-nullable type.
```

The second line is worth noticing: after warning once, the compiler assumes
the value is not null, to avoid a cascade of warnings for the same problem.
`is null`, `is not null`, `== null`, `?.`, `??`, `is { }` and patterns all feed
the analysis. Other common diagnostics: CS8603 (possible null return), CS8604
(possible null argument), CS8618 (non-nullable field not set by a constructor),
CS8625 (null literal to non-nullable).

### Where it is deliberately unsound

The analysis does not look inside the methods you call. A check on a field
stays "proven" even if a call in between sets it back to `null`:

```csharp
class Cache
{
    private string? _name = "cached";
    private void Reset() => _name = null;
    public int UnsafeLength()
    {
        if (_name is not null)
        {
            Reset();
            return _name.Length;   // no warning, NullReferenceException at run time
        }
        return 0;
    }
}
```

Copy the field into a local before checking it. The official docs list other
known holes: `default` of a struct with non-nullable fields, and
`new string[3]`, whose elements are `null` with no warning.

### `!`: the null-forgiving operator

`maybe!` changes the null-state to not-null and emits nothing. It is a promise
to the compiler, so each `!` is a spot the analysis stops protecting. `null!`
and `default!` are sometimes used for fields set by a framework after
construction, but `required`, a constructor parameter or `[MemberNotNull]` are
better because they keep the check.

### Attributes for contracts `?` cannot express

The attributes in `System.Diagnostics.CodeAnalysis` describe conditional
contracts:

| Attribute | Meaning |
|---|---|
| `[AllowNull]` / `[DisallowNull]` | input may / may not be null, whatever the type says |
| `[MaybeNull]` / `[NotNull]` | output may be null / is not null after the call |
| `[NotNullWhen(bool)]` / `[MaybeNullWhen(bool)]` | depends on the `bool` the method returns |
| `[NotNullIfNotNull(name)]` | return is not null when that argument is not null |
| `[MemberNotNull(names)]` / `[MemberNotNullWhen]` | the method initializes those members |
| `[DoesNotReturn]` / `[DoesNotReturnIf(bool)]` | the code after the call is unreachable |

Three of them in use, each verified by removing it and getting the warning
back:

```csharp
public static bool TryGet<TKey, TValue>(Dictionary<TKey, TValue> d, TKey key,
    [MaybeNullWhen(false)] out TValue value) where TKey : notnull => d.TryGetValue(key, out value);
// if (TryGet(map, "ana", out var c)) c.Name   -> no warning
// if (!TryGet(map, "x", out var c)) c.Name    -> warning CS8602

[return: NotNullIfNotNull(nameof(input))]
public static string? Normalize(string? input) => input?.Trim();
// string r = Normalize("  Bia ");  -> no warning; without the attribute CS8600

class Service
{
    private string? _connection;
    [MemberNotNull(nameof(_connection))]
    public void Connect() => _connection = "db-1";
    public int Use() { Connect(); return _connection.Length; } // no warning; without it CS8602
}
```

The same version of `TryGet` without the attribute compiled with a CS8601
warning inside the method and no warning at the call site, so callers were
told the value was safe even when the method returned `false`. The attributes
move the truth to where callers can use it. `[NotNullWhen(true)]` on Try
methods and `[DoesNotReturn]` on throw helpers are covered in the parsing and
guard clauses concepts.

### `T?` in generics and `notnull`

For an unconstrained `T`, `T?` means "the default of `T` is possible", not
`Nullable<T>`:

```csharp
public static T? FirstOrNone<T>(IReadOnlyList<T> items) => items.Count > 0 ? items[0] : default;
// FirstOrNone<int>([]) = 0, FirstOrNone<string>([]) = null
public static T Unconstrained<T>() => default;   // warning CS8603: Possible null reference return.
```

With `int` the result is `0`, not `null`: a `T?` only becomes `Nullable<T>`
under a `struct` constraint. The `notnull` constraint goes the other way and
rejects nullable arguments, which is why
`new Dictionary<string?, int>()` gives warning CS8714 ("Nullability of type
argument 'string?' doesn't match 'notnull' constraint").

### Nulls coming from outside

Data from the outside world is not analyzed. `System.Text.Json` ignores
annotations by default; since .NET 9 `RespectNullableAnnotations` makes it
check them:

```csharp
record Customer(string Name);
JsonSerializer.Deserialize<Customer>("""{"Name":null}""");   // Name = null accepted
JsonSerializer.Deserialize<Customer>("""{"Name":null}""",
    new JsonSerializerOptions { RespectNullableAnnotations = true });
// JsonException: The constructor parameter 'Name' on type 'Customer' doesn't allow null values. ...
```

The docs list its limits: a missing property is still accepted, and generic
members and collection elements are not checked. EF Core reads the same
annotations to decide whether a column is required (`string`) or optional
(`string?`), so enabling NRT on an existing model can change a migration.

### Migrating an existing codebase

The migration guide suggests choosing a default and moving file by file: either
enable the project and add `#nullable disable` to files not yet migrated, or
keep it disabled and add `#nullable enable` to migrated files. Setting
`<Nullable>warnings</Nullable>` first shows where `null` flows without forcing
you to annotate yet. Once a project is clean,
`<WarningsAsErrors>nullable</WarningsAsErrors>` keeps it clean.

### `Nullable<T>` in short

`int?` is a different thing: `Nullable<int>`, a struct with `HasValue` and
`Value`. Its operators are lifted, and comparisons with `null` are false in
both directions:

```csharp
int? a = 5, none = null;
// a + 1 = 6, none + 1 = null, none < 5 False, none >= 5 False, none == null True
bool? t = true, f = false, u = null;
// u & f = False, u | t = True, u & t = null, u | f = null
object boxed = a;          // boxes the int: boxed.GetType() is System.Int32
object? boxedNull = none;  // boxing an empty int? gives a real null
// a.GetType() is also System.Int32; (int?)boxed unboxes fine
_ = none.Value;            // warning CS8629, then InvalidOperationException: Nullable object must have a value.
```

There is no boxed `Nullable<int>`: the runtime boxes the underlying value or
produces `null`, which is why `GetType()` never reports `Nullable`.
`GetValueOrDefault()` (0 here) avoids the exception.

## Trade-offs

- **Warnings, not guarantees.** Keep guard clauses on public entry points and
  validate deserialized data.
- **The analysis is optimistic about fields.** It does not re-check after
  method calls; copy fields into locals before relying on a check.
- **`!` silences the one tool you enabled.** Prefer `required`, constructor
  parameters or attributes.
  ```csharp
  public required string Name { get; init; }   // instead of public string Name { get; set; } = null!;
  ```
- **Attributes are API surface.** A wrong `[NotNullWhen(true)]` is worse than
  none: callers lose warnings they needed.
- **Migration takes time.** File-level `#nullable` lets you move gradually;
  turning everything on at once usually ends in a pile of `!`.

## Documentation Links

- [Nullable reference types, C# fundamentals, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/null-safety/nullable-reference-types) (doc)
- [Nullable reference types, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/nullable-reference-types) (doc)
- [Attributes for null-state static analysis, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/attributes/nullable-analysis) (doc)
- [Resolve nullable warnings, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-messages/nullable-warnings) (doc)
- [Nullable migration strategies, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/update-applications/nullable-migration-strategies) (doc)
- [Nullable value types, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/nullable-value-types) (doc)
- [Respect nullable annotations, System.Text.Json, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/nullable-annotations) (doc)
- [Working with nullable reference types, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/miscellaneous/nullable-reference-types) (doc)
