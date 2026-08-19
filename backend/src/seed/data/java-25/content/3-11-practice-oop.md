# Practice: OOP

> Five exercises covering what the slides in this module introduced —
> overload resolution order with widening/boxing/varargs, flexible
> constructor bodies (JEP 513), static/field hiding vs. instance method
> overriding, exhaustive `switch` over sealed hierarchies, and the
> write-only nature of unnamed variables (`_`). Try to answer before
> opening each explanation.

---

## Exercise 1 — Overload resolution: widening beats boxing beats varargs

```java
public class Resolver {
    static void test(long x)    { System.out.println("long"); }
    static void test(Integer x) { System.out.println("Integer"); }
    static void test(int... x)  { System.out.println("varargs"); }

    public static void main(String[] args) {
        test(5);
    }
}
```

What's printed?

<details>
<summary>Answer</summary>

`long`

The compiler resolves overloads in strict phases, and it stops at the
first phase where exactly one applicable method exists:

1. **Phase 1 — exact match or widening only** (no boxing, no varargs).
   `5` is an `int` literal. `int` widens to `long` via a widening
   primitive conversion, so `test(long)` **is** applicable in this
   phase. `test(Integer)` is not applicable here — going from `int` to
   `Integer` requires autoboxing, which phase 1 disallows. `test(int...)`
   is not applicable here either — varargs is excluded from phase 1.

Since phase 1 already finds exactly one applicable method
(`test(long)`), the compiler picks it and never even considers phase 2
(boxing) or phase 3 (varargs). This is exactly the ordering the slide
lays out: exact match → widening → autoboxing → varargs, each phase
tried only if the previous one found nothing applicable.

</details>

---

## Exercise 2 — Flexible Constructor Bodies (JEP 513): what can precede `super()`?

```java
public class Sensor {
    private final int id;

    public Sensor(int id) {
        if (id < 0) {
            throw new IllegalArgumentException("id must be >= 0");
        }
        super();
        this.id = id;
    }
}

public class TypedSensor extends Sensor {
    private final String type;

    public TypedSensor(int id, String type) {
        if (type == null) {
            throw new IllegalArgumentException("type is required");
        }
        this.type = type;   // line A
        super(id);          // line B
    }
}
```

Does this compile? If not, which line is the problem?

<details>
<summary>Answer</summary>

It does **not** compile — **line A**, `this.type = type;`, is the
problem, because it executes before `super(id)` on line B.

**JEP 513 (Flexible Constructor Bodies, finalized in Java 25)** relaxed
the old rule that `super()`/`this()` must be the textually first
statement in a constructor. Statements now *can* precede the explicit
constructor invocation — but only if they don't touch the instance
being constructed. `Sensor`'s constructor is a correct example: the
`if (id < 0) throw ...` check only reads the parameter `id`, never
`this`, so it's allowed to sit before `super()`.

`TypedSensor`'s constructor breaks that rule. `this.type = type;`
assigns to an instance field — it reads/writes state that belongs to
`this` — and it does so *before* `super(id)` has run, i.e. before the
`Sensor` portion of the object even exists yet. Flexible constructor
bodies loosen *where* you can put validation/pre-computation logic,
but the core safety invariant is unchanged: nothing that touches `this`
(field reads, field writes, instance method calls) may run until after
the superclass is fully initialized. Swapping the two lines — calling
`super(id)` first, then `this.type = type;` — fixes the error.

</details>

---

## Exercise 3 — Static hiding, field hiding, and instance overriding, side by side

```java
class Vehicle {
    String category = "generic";
    static String kind() { return "Vehicle"; }
    String describe() { return "a " + category; }
}

class Car extends Vehicle {
    String category = "car";
    static String kind() { return "Car"; }
    @Override
    String describe() { return "a " + category; }
}

Vehicle v = new Car();
System.out.println(v.kind());
System.out.println(v.category);
System.out.println(v.describe());
```

What's printed on each of the three lines?

<details>
<summary>Answer</summary>

```
Vehicle
generic
a car
```

All three lines involve a variable `v` whose **reference type is
`Vehicle`** but whose **runtime type is `Car`**, and each line resolves
differently depending on what kind of member is being accessed:

- `v.kind()` — `kind()` is `static`. Static methods are never
  overridden, only **hidden**, and a call through an instance reference
  is resolved entirely at **compile time** using the reference's
  declared type (`Vehicle`), not the object's actual type. So it prints
  `"Vehicle"`, even though `v` actually points to a `Car` at runtime.

- `v.category` — fields are **not polymorphic** at all. Field access is
  always resolved by the **compile-time type of the reference**, so
  `v.category` reads `Vehicle`'s field, `"generic"` — `Car`'s
  `category` field merely *hides* `Vehicle`'s, it doesn't replace it.

- `v.describe()` — `describe()` is a genuinely **overridden** instance
  method (no `static`, not `private`, not `final`), so it uses
  **dynamic dispatch**: the JVM looks at `v`'s actual runtime type
  (`Car`) and invokes `Car.describe()`. Inside that method body, the
  unqualified reference `category` is resolved at compile time *within
  `Car`'s own source*, so it means `Car`'s `category` field
  (`"car"`) — giving `"a car"`.

The takeaway matches the slide's hiding-vs-overriding table exactly:
only instance methods get true runtime polymorphism; static methods and
fields are always resolved by the reference type.

</details>

---

## Exercise 4 — Exhaustive `switch` over a sealed hierarchy

```java
public sealed interface Notification permits Email, Sms, PushNotification { }

public record Email(String address) implements Notification { }
public record Sms(String number) implements Notification { }
public non-sealed class PushNotification implements Notification { }

class SilentPush extends PushNotification { }

class Router {
    String describe(Notification n) {
        return switch (n) {
            case Email e -> "email to " + e.address();
            case Sms s   -> "sms to " + s.number();
        };
    }
}
```

Does `Router` compile?

<details>
<summary>Answer</summary>

**No — compile error.** The `switch` expression is not exhaustive.

`Notification` is `sealed` with exactly three **permitted direct
subtypes**: `Email`, `Sms`, and `PushNotification`. For a pattern-matching
`switch` over a sealed type to be exhaustive without a `default` branch,
it must cover **every permitted direct subtype** — here, only `Email`
and `Sms` are covered; `PushNotification` has no `case` at all, so the
compiler cannot prove the switch handles every possible `Notification`.

Note that `PushNotification` being declared `non-sealed` (which legally
reopens it — any class, like `SilentPush`, may extend it freely) is a
bit of a red herring: it doesn't change what the switch needs. A single
`case PushNotification p -> ...` would cover `PushNotification` *and*
every future subclass of it (like `SilentPush`) through ordinary type-pattern
matching — you don't need to enumerate `SilentPush` separately. The fix
is either adding `case PushNotification p -> "push to device"` or a
`default ->` branch; either one restores exhaustiveness and the code
compiles.

</details>

---

## Exercise 5 — Unnamed variables (`_`): write-only by design

```java
record Point(int x, int y) { }

Object obj = new Point(3, 4);

if (obj instanceof Point(int x, int _)) {
    System.out.println(x + ", " + _);   // line A
}

List<String> items = List.of("a", "b", "c");
int count = 0;
for (var _ : items) {
    count++;                             // line B
}

try {
    int[] data = {1, 0, 2};
    int result = 10 / data[1];
} catch (ArithmeticException _) {
    System.out.println("division failed");   // line C
}

System.out.println(count);
```

Which line fails to compile, and why do the other uses of `_` work fine?

<details>
<summary>Answer</summary>

**Line A fails to compile** — `System.out.println(x + ", " + _)` tries
to *read* `_`. Per **JEP 456**, an unnamed variable declared with `_` is
strictly **write-only**: it exists to satisfy a syntax position that
requires a variable (a record-pattern component, a loop variable, a
`catch` parameter) when the value itself is never needed. The compiler
deliberately gives `_` no readable binding, so any expression that tries
to reference it — as `+ _` does here — is a compile error, not merely a
warning.

Lines B and C compile without issue, and so would the record pattern on
line A's `if` if the `println` didn't try to read `_`:

- `int _` inside `Point(int x, int _)` discards the `y` component — you
  only care about `x`.
- `for (var _ : items)` discards the loop element — only the fact that
  an iteration happened (`count++`) matters.
- `catch (ArithmeticException _)` discards the exception object — only
  the fact that a division by zero occurred matters.

All three are separate, unrelated unnamed variables in the same method,
and that's fine: `_` is specifically exempted from Java's normal rule
that forbids redeclaring a local variable name already in scope, so any
number of `_`s can coexist. Fixing line A to simply
`System.out.println(x)` would make the whole snippet compile; running it
would print `3`, then `division failed` (since `data[1]` is `0`), then
`3` for `count` (three elements iterated).

</details>
