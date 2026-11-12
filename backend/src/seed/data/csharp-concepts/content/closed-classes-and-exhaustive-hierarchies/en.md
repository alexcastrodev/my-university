---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

A `closed` class, new in C# 15, is a base class whose complete list of direct
subclasses is known to the compiler, because only code in the same assembly can
derive from it. The payoff is in `switch`: a switch over a closed base that
handles each direct subclass is exhaustive, with no discard arm, even when the
base is a plain hierarchy and not an enum. Until C# 15 the compiler could not
promise that, so `abstract` base plus `sealed` children still produced CS8509
with the pattern `'_'`, and teams wrote a `_ => throw` arm that hid every
subclass added later. This concept covers the modifier and its rules, how
exhaustiveness is computed (and where it has holes), the diagnostics, the
metadata, the System.Text.Json gotcha, and how `closed` compares with
`sealed` plus a private constructor, `enum` and `union`. Everything was compiled
and run on the 11.0.100 SDK.

## Use Cases

- A domain hierarchy you own, such as shapes, payment events or gate states,
  that other code consumes with `switch`.
- A contracts assembly that publishes a base type and subclasses, and consumer
  assemblies that must handle all of them without a `_` arm.
- Replacing the `abstract record` plus `_ => throw new UnreachableException()`
  pattern with a compiler-checked version.
- Choosing between a closed hierarchy and a `union` for a closed set of cases.

## Deep Dive

### The modifier and its rules

```csharp
closed record class GateState;
record class Closed : GateState;
record class Open(float Percent) : GateState;

GateState g = new Open(40f);
string text = g switch { Closed => "closed", Open(var pct) => $"open {pct}%" };
// "open 40%", compiled without a warning
```

The same hierarchy declared `abstract` on the base and `sealed` on the children
compiles with `warning CS8509: ... the pattern '_' is not covered`. The compiler
cannot rule out a subclass in another assembly. With `closed` it can, and the
warning disappears. Remove a case from the closed version and the warning comes
back naming the real gap: `the pattern 'Rect' is not covered`.

The rules, each one checked with a one-line program:

| Code | Result |
|---|---|
| `new Shape()` on a closed class | `CS0144`: it is abstract. `closed` implies `abstract` |
| `closed abstract class A;` | `CS9384`: always implicitly abstract |
| `closed sealed class A;` or `closed static class A;` | `CS9381`: cannot be sealed or static |
| `closed struct A;`, `closed interface A;` | `CS0106`: only classes (records included) |
| `class X : ClosedBase` in another assembly | `CS9382`: cannot use a closed type from another assembly as a base type |
| `class closed { }` | `CS9380`: types and aliases cannot be named `closed` |

The `CS9382` case needs two projects, and the lab has them: a contracts assembly
with `closed record class Shape`, and an app assembly that cannot derive from it
but can switch over it. A `closed` class can also be a `record class`, which is
what you usually want for data.

### How exhaustiveness is computed

The compiler checks the **direct** subclasses. Three consequences, each from a
compiled example:

1. A direct subclass that is not closed is covered by a pattern for itself. With
   `closed class Animal` and children `Dog` and `Cat`, a switch with `Dog` and
   `Cat` is exhaustive, and a `Leaf : Dog` is covered by the `Dog` arm.
2. A direct subclass that is itself `closed` extends the check to its own
   children. With `closed class Mid : Animal` and `class Leaf : Mid`, a switch
   with only `Dog` and `Cat` warns `the pattern 'Leaf' is not covered`; adding
   `Leaf l => 3` silences it.
3. A direct subclass that is neither closed nor abstract can be instantiated
   itself, so the switch needs an arm for it. With `closed class Shape`, a plain
   `class Animal : Shape`, and `Dog` and `Cat` below `Animal`, a switch over
   `Shape` with arms for `Dog` and `Cat` only warns `the pattern 'Animal' is not
   covered`.

So the discipline is: make every level that you want checked `closed`, or keep
the direct subclasses as the only concrete types.

Subsumption works as it does for any switch. If the base case comes first, the
later arms are unreachable and the compiler says so as an error:

```csharp
Shape s = new Circle(1);
s switch { Shape x => 0, Circle c => 1, Rect r => 2 };
// error CS8510: The pattern is unreachable.
```

### What the compiler writes

The compiler marks the closed class with `IsClosedTypeAttribute` and puts
`CompilerFeatureRequired("ClosedClasses")` on its constructors. The second one
stops a compiler that does not know the feature, and other languages, from
deriving from the class without the protection. The lab reads both from the
metadata with reflection and asserts them. Both are types from the .NET 11
runtime, which is the same lesson as for unions: with `net10.0` as the target,
`closed` fails with `CS0656: Missing compiler required member
'System.Runtime.CompilerServices.IsClosedTypeAttribute..ctor'`. On C# 14 the
modifier is `CS9327: Feature 'closed classes' is not available in C# 14.0`.

### System.Text.Json does not guess

A closed class is abstract, and System.Text.Json treats an abstract base as a
type with no discriminator unless told otherwise. With default options,
`JsonSerializer.Serialize<Shape>(new Circle(2))` writes `{}` and
`Deserialize<Shape>` throws `NotSupportedException`. The option
`InferClosedTypePolymorphism = true` tells the serializer that the closed
class's direct subclasses are the polymorphic set:

```csharp
var options = new JsonSerializerOptions { InferClosedTypePolymorphism = true };
JsonSerializer.Serialize<Shape>(new Circle(2), options);
// {"$type":"Circle","R":2}
JsonSerializer.Deserialize<Shape>("""{"$type":"Rectangle","W":3,"H":4}""", options);
// Rectangle { W = 3, H = 4 }
```

The `$type` property appears in the payload, which is a contract with clients.
Treat the property name and the type names as public API, or write the
discriminators yourself with `[JsonPolymorphic]` and `[JsonDerivedType]`.

### Closed versus the alternatives

- **`abstract` plus a private constructor and nested sealed classes.** This made
  the hierarchy closed by convention, but the compiler still wanted a `_` arm and
  gave CS8509 (see `result-types-versus-exceptions`). `closed` is that pattern,
  checked.
- **`sealed` classes behind an interface.** Another assembly can implement the
  interface, so no exhaustiveness. Same limit.
- **`enum`.** Exhaustive in intent, but any integer is a legal enum value and the
  warning is `CS8524`. `closed enum` is only a proposal: `closed enum Color` is
  `CS0106` on the GA compiler, even with `LangVersion` `preview`. See
  `enums-and-flags-enums`.
- **`union`.** Chooses from types that need no shared base, including ones you do
  not own. A closed hierarchy needs a base you own and gives you inheritance and
  shared members. See `union-types-in-csharp-15`.

## Trade-offs

- **Same assembly only.** Consumers cannot add subclasses, which is the point, but
  it means plugin-style extension is out. If extensions must exist, do not use
  `closed`.
- **Adding or closing is a breaking change.** Adding a subclass to a published
  closed class makes every consumer's switch non-exhaustive, and adding `closed`
  to an existing public class stops all external subclasses from compiling. Plan
  the contracts assembly's versioning for that.
- **Holes at non-closed middle levels.** A middle class that is neither closed
  nor sealed can be instantiated if it is not abstract, so the compiler asks for
  an arm for it. Make intermediate classes `closed` when you want the check to go
  deeper.
- **Runtime requirement.** The attribute types ship with .NET 11. A library that
  must target `net10.0` cannot use `closed` without a polyfill, and other
  languages cannot subclass it.
- **Serialization needs a decision.** Turn on `InferClosedTypePolymorphism` or
  write the discriminators yourself; the default output is `{}`.
- **Keep the discard arm out.** Adding `_` brings back the old problem: the new
  subclass compiles and silently takes the default branch.

## Lab

In this lab a contracts assembly publishes `closed record class Shape` with `Circle` and `Rectangle`, and an app assembly computes areas and serializes shapes. The starter declares `Shape` as `abstract`, so you see the problem first and then fix it. `Shapes.App` turns CS8509 into an error.

**The scenario**

Two source projects, `Shapes.Contracts` (`Shape.cs`) and `Shapes.App` (`ShapeService.cs` with `Area`, `ToJson` and `FromJson`), plus the test project. The tests read the compiler's metadata with reflection and check the JSON text.

**What you will do, step by step**

1. **Close the hierarchy (TODO-00).** In `Shape.cs`, replace `abstract` with `closed`.
2. **Exhaustive switch across assemblies (TODO-01).** In `Area`, one arm per subclass and no `_`. Notice that this compiles only because of TODO-00.
3. **JSON discriminator (TODO-02).** Implement `ToJson` and `FromJson` with `InferClosedTypePolymorphism = true` to get `{"$type":"Circle","R":2}`.

**How you know you are done**

`dotnet test` is green with 10 tests. You should be able to explain why `Area` needs no `_` arm even though `Shapes.Contracts` is a different assembly, and why the same code with `abstract` does not compile.

**Optional challenges**

- Add `public record class Triangle(double B, double H) : Shape;` to `Shapes.Contracts` and rebuild: `Area` fails with CS8509 naming `Triangle`.
- Create a third project that derives from `Shape` and read `CS9382`.

**Prerequisites:** records, `switch` expressions and the .NET 11 SDK (the projects target `net11.0`).

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. Every stubbed method throws `NotImplementedException`, so red tests are your checklist.

## Documentation Links

- [closed modifier, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/closed) (doc)
- [Closed hierarchies, C# 15 feature specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-15.0/closed-hierarchies) (doc)
- [What's new in C# 15, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-15) (doc)
- [Unions and closed hierarchies in ASP.NET Core, .NET Blog](https://devblogs.microsoft.com/dotnet/unions-and-closed-hierarchies-in-aspnetcore/) (doc)
- [Closed enums proposal, dotnet/csharplang](https://github.com/dotnet/csharplang/blob/main/proposals/closed-enums.md) (doc)
