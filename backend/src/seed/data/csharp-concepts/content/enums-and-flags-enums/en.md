---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

A C# enum is not a class with a fixed set of instances, as it is in Java. It is
a value type that wraps an integer and gives some of its values names. Every
integer of the underlying type is a legal value of the enum, named or not, and
almost every enum bug comes from forgetting that: a `default` that matches no
member, a cast from a database column that produces `42`, a `switch` that
throws at run time, a flag test that is always true. This concept covers the
underlying type and its size, the zero value, `[Flags]` and the bit operations
that go with it, `HasFlag` and its traps, validation, generic code over enums,
and when a plain enum is the wrong tool.

## Use Cases

- A closed set of states or kinds: `OrderStatus`, `LogLevel`, `HttpMethod`.
- Combinable options passed as one value: file access, permissions, feature
  switches (`[Flags]`).
- Compact storage of a small choice in large arrays or structs, with a `byte`
  underlying type.
- Mapping integer codes from a database or a wire protocol to readable names.

## Deep Dive

### An integer with names

```csharp
enum Status { Pending, Paid, Shipped }          // int, values 0, 1, 2
enum SmallStatus : byte { Pending, Paid, Shipped }

Enum.GetUnderlyingType(typeof(Status));          // System.Int32
Unsafe.SizeOf<Status>();                          // 4
Unsafe.SizeOf<SmallStatus>();                     // 1
(int)Status.Shipped;                              // 2
(Status)42;                                       // 42, no exception
```

The underlying type defaults to `int` and can be any integral type. Members
start at zero and count up unless you assign values. Conversions between the
enum and its underlying type are explicit, and a cast never checks anything:
`(Status)42` is a valid `Status` whose `ToString()` is `"42"`.

Changing the underlying type is a storage decision. A struct with a `long` and
four `int`-based enum fields measured 24 bytes; with `byte`-based enums, 16.
That matters in arrays of millions of structs and almost nowhere else, and it
changes the binary contract, so pick it when the enum is created.

### The zero value

The default value of any enum is `(E)0`, whether or not a member has that value.
The literal `0` (and any constant equal to zero) also converts implicitly to
every enum type:

```csharp
enum Port { A = 1, B, C }

Port p = default;   // 0, Enum.IsDefined(p) is False
Port q = 0;         // compiles: implicit conversion from literal zero
int zero = 0;
Port r = zero;      // CS0266: a variable needs an explicit cast
```

An uninitialized field, a `new T[n]` array, and `default(T)` all produce zero.
The official guidance is to almost always declare a member with value `0`: a
real default (`Unknown`, `None`, `Pending`) or an explicit "not set" marker.
Then a forgotten assignment shows up as a named, testable state instead of a
number nobody declared.

### Flags: combining values

When values combine, give each member its own bit, mark the type `[Flags]`, and
combine with `|`:

```csharp
[Flags]
enum Perm { None = 0, Read = 1, Write = 2, Execute = 4 }

var rw = Perm.Read | Perm.Write;
rw;                                 // Read, Write
(Perm)7;                            // Read, Write, Execute
(Perm)9;                            // 9   (bit 8 has no name, so no names at all)
(Perm)16;                           // 16

rw &= ~Perm.Write;                  // clear a bit:  Read
rw ^= Perm.Execute;                 // toggle a bit: Read, Execute
```

`[Flags]` changes no arithmetic; the operators work on any enum. It changes
formatting and parsing: without it, `(NoFlags)3` prints `3`; with it, the value
is decomposed into `Read, Write`. If any set bit has no member, the whole value
prints as a number. Binary literals (`0b_0000_0100`) or shifts (`1 << 2`) make
the powers of two easy to review, and named combinations (`ReadWrite = Read |
Write`) are fine for common sets.

### Testing flags, and the HasFlag traps

```csharp
(rw & Perm.Read) == Perm.Read;                  // True: all bits of Read are set
rw.HasFlag(Perm.Read);                          // True: same test
rw.HasFlag(Perm.Read | Perm.Execute);           // False: needs ALL the bits
(rw & (Perm.Read | Perm.Execute)) != 0;         // True: ANY of the bits
Perm.Read.HasFlag(Perm.None);                   // True, for every value
rw.HasFlag(Status.Paid);                        // ArgumentException at run time
```

Three traps live in those lines. `HasFlag` with a combined argument means "all
of these", not "any of these". `HasFlag(None)` is always true, because
`(x & 0) == 0`: the documentation says to test for `None` with `==`, never
with a bitwise AND. And the parameter type is `Enum`, so passing a value
of another enum compiles and throws `ArgumentException`.

Cost: with an `Enum` parameter the argument is boxed in principle. The
measurement in Value Types, Reference Types and Boxing shows 48 bytes per call
while the code is cold and 0 once it is optimized. On a hot path the bitwise form is never worse.

### Validating values from outside

Casts, `Enum.Parse` with a number, deserializers, and database columns all
accept undefined values. Validate at the boundary:

```csharp
Enum.IsDefined(Perm.Read | Perm.Write);         // False: no member is exactly 3
Enum.IsDefined(Perm2.Read | Perm2.Write);       // True: ReadWrite = 3 exists

var all = Perm.Read | Perm.Write | Perm.Execute;
((Perm)9 & ~all) == 0;                          // False: has an unknown bit
((Perm)5 & ~all) == 0;                          // True
```

`Enum.IsDefined` checks for a member with exactly that value, so it rejects
valid flag combinations. For flags, mask against the union of known bits. The
parsing side (`Enum.TryParse` accepting `"99"` and `"Red, Blue"`) is covered in
Parsing, TryParse and the Try Pattern.

### Switching over an enum

```csharp
static string Describe(Status s) => s switch
{
    Status.Pending => "waiting",
    Status.Paid    => "paid",
    Status.Shipped => "on the way",
};
// warning CS8524: ... not exhaustive) involving an unnamed enum value.
//                 For example, the pattern '(Status)3' is not covered.
Describe((Status)42);   // SwitchExpressionException: Unmatched value was 42.
```

The compiler knows that the three names do not cover the type and warns. The
right fix is an explicit discard arm that handles the unknown case on purpose
(`_ => $"unknown ({(int)s})"`), or throws a domain exception, rather than a
suppression. When a member is added later, the discard hides it, so tests over
`Enum.GetValues<Status>()` are a cheap guard.

### Generic code and the Enum constraint

A type parameter can be constrained to enums with `System.Enum`, and the generic
helpers (`Enum.GetValues<T>()`, `Enum.GetNames<T>()`, `Enum.IsDefined<T>(T)`)
avoid `typeof` and casts:

```csharp
static string Name<T>(T v) where T : struct, Enum => $"{typeof(T).Name}.{v}";
Name(Perm.Write);                               // Perm.Write
string.Join(",", Enum.GetValues<Perm>());       // None,Read,Write,Execute
```

### Enums in JSON

System.Text.Json writes enums as numbers by default (`{"Status":2,"Perm":3}`).
With `JsonStringEnumConverter` it writes names, flags included (`"Read,
Write"`), and since .NET 9 `[JsonStringEnumMemberName("dark-red")]` renames a
single member. Two run-time facts to know: the converter still reads and writes
the number for an undefined value (`(Status)42` became `42`), and an unknown
name such as `"Lost"` throws `JsonException`. Options and source generation are
in System.Text.Json Serialization and Options.

### When an enum is the wrong tool

An enum cannot carry behavior or data per member, and C# does not allow methods
inside it. Extension members can add helpers, but a `switch` over the enum in
many places is the smell that the members want to be types. Two alternatives:

- **A class with static instances** (`sealed record OrderStatus(string Code,
  bool IsFinal)` with `public static readonly OrderStatus Paid = ...`) when each
  value carries data or rules. You lose `switch` on constants and `[Flags]`, and
  gain a closed, validated set.
- **A closed hierarchy** of records when each case has different data.

## Trade-offs

- **Cheap and fast, but not closed.** An enum is an integer: any value of the
  underlying type is legal, so every value from outside needs validation.
  ```csharp
  var s = (Status)int.Parse("42");   // accepted silently: s prints as 42
  ```
- **Zero is always a value.** Without a zero member, `default` produces a state
  nobody declared. Declare `None` or `Unknown` as 0.
- **Numbers are the contract.** Reordering members or inserting one in the
  middle changes stored and serialized values. Assign explicit values to enums
  that are persisted or sent over the wire.
- **`[Flags]` is compact but easy to misread.** `HasFlag(a | b)` means "all",
  `HasFlag(None)` is always true, and `IsDefined` rejects valid combinations.
  Prefer explicit bitwise tests and a mask of known bits.
- **No behavior per member.** A growing number of `switch` statements over the
  same enum is the signal to move to a class with static instances or a small
  hierarchy.
- **Smaller underlying types save memory only at scale** and are a binary
  breaking change later. Use `int` unless you measured a reason.

## Documentation Links

- [Enumeration types, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/enum) (doc)
- [FlagsAttribute class (guidelines for flags enums), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.flagsattribute) (doc)
- [Enum.HasFlag method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.enum.hasflag) (doc)
- [Enum.IsDefined method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.enum.isdefined) (doc)
- [JsonStringEnumMemberNameAttribute class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.text.json.serialization.jsonstringenummembernameattribute) (doc)
