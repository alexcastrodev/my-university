---
version: 1.0
updatedAt: 2026-10-14
---
## Objective

Inheritance in C# is opt-in at every level. A method is not overridable unless
the base class marks it `virtual` or `abstract`, a derived class must say
`override` to replace it, and `new` exists to say "I am hiding this on purpose".
Which implementation runs depends on that choice: an override is picked by the
runtime type of the object, a hidden member by the static type of the variable.
This concept covers the four keywords (`virtual`, `override`, `new`, `sealed`),
abstract classes, covariant return types, how a virtual call is actually
dispatched and what `sealed` lets the JIT do, casting with `is`, `as` and
patterns, the fragile base class problem, and when to pick an interface, an
abstract class or plain composition.

## Use Cases

- A framework base class with one hook you override, such as `DbContext.OnModelCreating`
  or `BackgroundService.ExecuteAsync`.
- An abstract `Shape` or `PaymentMethod` with a few concrete subtypes handled by
  a `switch` on type.
- Sealing the concrete classes of an application so the JIT can call them
  directly and nobody inherits from them by accident.
- Reading a hierarchy you did not write and predicting which method a call
  will run.
- Deciding whether a new abstraction should be an interface, an abstract class
  or a wrapped object.

## Deep Dive

### `virtual` and `override` versus `new`

```csharp
Animal a = new Dog();
Dog d = (Dog)a;
a.Speak();    // Dog.Speak, then Animal.Speak
d.Speak();    // Dog.Speak, then Animal.Speak
a.Describe(); // Animal.Describe   (static type decides)
d.Describe(); // Dog.Describe

class Animal
{
    public virtual void Speak() => Console.WriteLine("Animal.Speak");
    public void Describe() => Console.WriteLine("Animal.Describe");
}
class Dog : Animal
{
    public override void Speak() { Console.WriteLine("Dog.Speak"); base.Speak(); }
    public new void Describe() => Console.WriteLine("Dog.Describe");
}
```

`override` replaces the slot the base declared, so every caller, whatever the
variable type, reaches `Dog.Speak`. `new` declares a second, unrelated method
that happens to share the name; a caller holding an `Animal` never sees it.
`base.Speak()` calls the base implementation non-virtually, which is how an
override extends instead of replacing.

If you write the same signature without either keyword, the compiler hides the
member and warns:

```text
warning CS0108: 'Child.Show()' hides inherited member 'Parent.Show()'.
Use the new keyword if hiding was intended.
```

Treat that warning as a question: almost always the base method should have been
`virtual` and you wanted `override`. `new` is a tool for versioning (a base
class you do not own added a member with your name), not for design.

An override cannot change accessibility, and it can only override a member that
is `virtual`, `abstract` or itself an `override`.

### Abstract classes

An `abstract` class cannot be instantiated and may declare `abstract` members
without a body, which every concrete subclass must implement. Unlike an
interface it can hold fields, constructors and non-public members, so it is the
natural home for the template method pattern: the public algorithm is fixed and
one protected step varies.

```csharp
abstract class Report
{
    private readonly DateTime _created = new(2026, 10, 14);
    protected Report() { }
    public string Render() => $"{Title()} @ {_created:yyyy-MM-dd}";
    protected abstract string Title();
}
sealed class SalesReport : Report { protected override string Title() => "Sales"; }

// new SalesReport().Render() -> "Sales @ 2026-10-14"
```

The Framework Design Guidelines recommend a `protected` (or `internal`)
constructor on abstract types, never a public one, because nobody can call it
from outside anyway.

### Covariant return types (C# 9)

Since C# 9 an override may return a type more derived than the base method's,
which removes the cast callers used to write:

```csharp
class Animal { public virtual Animal Clone() => new Animal(); }
class Dog : Animal { public override Dog Clone() => new Dog(); }

Dog copy = new Dog().Clone(); // no (Dog) cast needed
```

The same applies to read-only overriding properties. Records rely on it: the
hidden clone method of a derived record returns the derived type, which is why
`with` on a derived record held in a base-typed variable still produces a
derived copy.

### How a virtual call is dispatched

Every object starts with a pointer to its type's method table, and each virtual
method has a slot in it. A call through a base-typed reference has to load that
pointer, find the slot and jump to whatever address is there. You can see it by
asking the JIT for its output (`DOTNET_JitDisasm`). The experiment used an
abstract `Shape`, an unsealed `OpenCircle` and a `sealed SealedCircle`, both
overriding `Area()` with the same body. With tiered compilation off,
on .NET 10.0.0 and Apple M4 (arm64), a method that calls `Area()` on a `Shape`
compiled to:

```text
ldr  x1, [x0]         ; method table of the object
ldr  x1, [x1, #0x40]  ; chunk of virtual slots
ldr  x1, [x1, #0x20]  ; the Area slot
blr  x1               ; indirect call
```

The same call on a parameter typed as a `sealed class SealedCircle` had no call
at all: the JIT knew the exact target, inlined `Area()` and emitted the two
multiplications directly. That is devirtualization, and `sealed` is what made
it provable.

With the default settings the picture changes again. Dynamic PGO, on by default
since .NET 8, instruments the first tier and records which types actually
arrive. In the same experiment, the Tier1 version of the base-typed method
compared the object's method table with `OpenCircle`'s, ran the inlined body
when it matched and fell back to the indirect call otherwise (guarded
devirtualization). So a virtual call that always sees one type is often cheap
in practice, but only after warm-up and only behind a type check. Code analysis
rule CA1852 suggests sealing internal types that have no subclasses, and the
Framework Design Guidelines note that virtual calls are slower mostly because
they are not inlined.

### `sealed` on classes and on overrides

`sealed class` forbids subclasses; `sealed override` lets a class override a
member and stop any further override below it. `string` is sealed. You cannot
seal a member that is not an override, since a non-virtual member is already
closed.

### Casting: implicit, explicit, `is`, `as` and patterns

Upcasting is implicit. Downcasting needs a cast, which throws when wrong:

```csharp
Shape up = new Square(3);
var c = (Circle)up; // InvalidCastException: Unable to cast object of type 'Square' to type 'Circle'.

Circle? maybe = up as Circle;              // null instead of an exception
if (up is Circle { Radius: > 1 } big) { }  // test, deconstruct and bind in one step

string text = up switch
{
    Circle k => $"circle {k.Radius}",
    Square q => $"square {q.Side}",
    _ => "unknown",
};
```

Two details trip people up. `is` and `as` only consider reference, boxing,
unboxing and nullable conversions, never user-defined conversion operators, so
`o is Feet` is `false` even when an `explicit operator Feet(Meters)` exists and
`(Feet)meters` would work. And `x is Shape` is true for any subclass, while
`x.GetType() == typeof(Shape)` checks the exact type. `null` never matches a
type pattern.

### The fragile base class problem

A subclass that overrides methods depends on how the base class calls its own
virtual members, which is an implementation detail:

```csharp
class Bag
{
    private readonly List<string> _items = [];
    public virtual void Add(string item) => _items.Add(item);
    public virtual void AddRange(IEnumerable<string> items)
    {
        foreach (var i in items) Add(i); // self-call through a virtual method
    }
}
class CountingBag : Bag
{
    public int Added { get; private set; }
    public override void Add(string item) { Added++; base.Add(item); }
    public override void AddRange(IEnumerable<string> items)
    {
        Added += items.Count();
        base.AddRange(items);
    }
}
// AddRange(["a", "b", "c"]) -> Added: 6
```

Each item was counted twice, once in `AddRange` and once in the `Add` it calls.
If a later version of `Bag` stopped calling `Add`, the count would silently
become correct, then wrong in another way. Wrapping a `List<string>` in a sealed
class that exposes only `Add` and `AddRange` removes the coupling: the same
calls give `Added: 4, Count: 4` after one more `Add`, and nothing outside can
change that.

### Interface, abstract class or composition

- **Interface** when unrelated types, including structs, must share a contract,
  or a class already has a base class. A class can implement many interfaces
  but inherit only one class.
- **Abstract class** when the subtypes share state, a constructor or a fixed
  algorithm with protected steps, and you own the whole hierarchy.
- **Composition** when you want to reuse behavior, not to be substitutable.
  Inheriting from `List<T>` to add a method exposes every `List<T>` member forever.

Since C# 8 interfaces can carry default bodies and even private members, so
"interfaces have no code" is no longer the deciding factor. What still separates
them is instance state, constructors and single inheritance.

## Trade-offs

- **`virtual` is a public promise.** Every virtual member is an extension point
  you must document and keep stable, including when the base class calls it.
  Make members virtual only where you designed a hook, and prefer a protected
  virtual called by a public non-virtual method.
  ```csharp
  public void Save() { Validate(); OnSaving(); Write(); } // public, fixed order
  protected virtual void OnSaving() { }                    // the only hook
  ```
- **Sealing helps the JIT and blocks users.** Sealing internal or application
  types is cheap and lets calls be inlined; sealing a public library type removes
  a way your users extend it, and unsealing later is safe while sealing later is
  a breaking change. The Framework Design Guidelines advise against sealing
  public classes without a reason.
- **`new` hides bugs.** Behavior depends on the variable's declared type, so the
  same object answers differently in two places. Reserve it for version
  conflicts with a base class you do not control.
- **Deep hierarchies resist change.** Each level couples to the one above; two or
  three levels with an abstract root is usually the useful limit before
  composition reads better.
- **Type switches replace virtual calls only in closed sets.** A `switch` over
  sealed subtypes keeps logic in one place but must be edited for every new
  subtype; a virtual method spreads logic across classes but adding a subtype
  touches nothing else.
- **`as` with a null check versus a pattern.** `as` silently gives `null`, which
  can travel far before failing. Prefer `is T x` or a cast that throws where the
  wrong type is a bug.

## Documentation Links

- [Inheritance, C# fundamentals, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/object-oriented/inheritance) (doc)
- [Polymorphism, C# fundamentals, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/object-oriented/polymorphism) (doc)
- [Knowing when to use override and new keywords, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/knowing-when-to-use-override-and-new-keywords) (doc)
- [override modifier, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/override) (doc)
- [sealed modifier, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/sealed) (doc)
- [Type-testing operators and cast expressions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/type-testing-and-cast) (doc)
- [What's new in C# 9, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-9) (doc)
- [Virtual members, Framework Design Guidelines, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/virtual-members) (doc)
- [Sealing, Framework Design Guidelines, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/sealing) (doc)
- [CA1852: Seal internal types, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca1852) (doc)
- [Runtime configuration options for compilation (tiered compilation and PGO), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/runtime-config/compilation) (doc)
