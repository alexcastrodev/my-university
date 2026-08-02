# Practice: Methods

> Five exercises covering what the slides in this module introduced —
> varargs vs. fixed-arity overload resolution, `protected` access across
> packages, static-context rules and static method "hiding", the full
> overload-resolution order (widening, boxing, varargs), and why a getter
> that hands out a mutable reference breaks encapsulation. Try to answer
> before opening each explanation.

---

## Exercise 1 — Varargs vs. fixed-arity overload resolution

```java
public class Calc {
    static void print(int a, int b) { System.out.println("fixed"); }
    static void print(int... nums)  { System.out.println("varargs"); }

    public static void main(String[] args) {
        print(1, 2);
        print(1, 2, 3);
        print();
    }
}
```

What does each call print?

<details>
<summary>Answer</summary>

```
fixed
varargs
varargs
```

`print(1, 2)` has exactly two `int` arguments, which is an **exact match**
for `print(int a, int b)`. When a fixed-arity overload matches exactly,
the compiler always prefers it over the varargs version — varargs is
only invoked as a fallback when no fixed-arity overload applies.

`print(1, 2, 3)` has three arguments — no fixed-arity overload accepts
three `int`s, so `print(int... nums)` is the only applicable method, and
it runs with `nums = {1, 2, 3}`.

`print()` has zero arguments. `print(int a, int b)` requires exactly two,
so it doesn't apply; varargs accepts zero-or-more, so `print(int...
nums)` runs again, this time with `nums.length == 0`.

This is the rule from the varargs slide: "when an overloaded exact match
exists, the compiler prefers it over the varargs variant" — varargs is
always the last resort, never the first choice.

</details>

---

## Exercise 2 — `protected` access: subclass reference vs. supertype reference

```java
// file: zoo/Animal.java
package zoo;

public class Animal {
    protected int age = 1;
    protected void grow() { age++; }
}
```

```java
// file: park/Elephant.java
package park;

import zoo.Animal;

public class Elephant extends Animal {
    void live() {
        grow();                 // (1)
        this.age = 10;          // (2)
    }

    void compare(Animal other) {
        other.grow();           // (3)
    }
}
```

`Elephant` is in a different package than `Animal`. Which line(s), if
any, fail to compile?

<details>
<summary>Answer</summary>

**Line (3) fails to compile.** Lines (1) and (2) are fine.

`protected` grants access to same-package classes *and* to subclasses in
other packages — but for a subclass in a different package, that access
only works **through the subclass's own type** (or a reference to it),
not through an arbitrary reference typed as the parent class.

Lines (1) and (2) access `grow()` and `age` implicitly through `this`,
which has compile-time type `Elephant` — that's the subclass's own
reference, so it's allowed.

Line (3) receives `other` as a plain `Animal` parameter. Even though the
object passed in might actually be another `Elephant` at runtime, the
compiler only looks at the **declared type** of `other`, which is
`Animal` — a type outside `park`, with no special relationship granting
`Elephant` access to it. `Elephant` can reach into its *own* inherited
`protected` members, but not into some other `Animal` reference's
protected members from outside the package. This matches the exam note
on the slide: "a subclass in another package can access protected
members through its own type, but not through a plain parent-type
reference."

</details>

---

## Exercise 3 — Static context rules and static method "hiding"

```java
public class Vehicle {
    int wheels = 4;
    static String category() { return "Vehicle"; }

    static void describe() {
        System.out.println(wheels);   // (1)
    }
}

public class Car extends Vehicle {
    static String category() { return "Car"; }
}

public class Test {
    public static void main(String[] args) {
        Vehicle v = new Car();
        System.out.println(v.category());   // (2)
    }
}
```

Does line (1) compile? What does line (2) print?

<details>
<summary>Answer</summary>

**Line (1) does not compile.** `describe()` is a `static` method, which
means it runs without any object instance — there is no `this`. `wheels`
is an **instance** field, and instance fields only exist once an object
has been created. A static method can access only other static members
directly; reading `wheels` here would need an explicit instance, e.g.
`new Vehicle().wheels`.

**Line (2) prints `"Vehicle"`.** This is the classic static-hiding trap.
`v` is *declared* as type `Vehicle`, even though it references a `Car`
object at runtime. Static methods are **not polymorphic** — they are
never overridden, only *hidden*. A call like `v.category()` is resolved
entirely at **compile time**, based on the reference's declared type, not
the object's actual runtime type. Since `v`'s declared type is `Vehicle`,
the compiler binds the call to `Vehicle.category()` regardless of what
`v` points to at runtime — instance method calls would use the runtime
type via dynamic dispatch, but static method calls never do. (Note this
would compile and behave the same even if `v` were `null`, since no
instance is actually needed to resolve a static call.)

</details>

---

## Exercise 4 — Overload resolution order: widening before boxing before varargs

```java
public class Overload {
    static void call(long n)    { System.out.println("long"); }
    static void call(Integer n) { System.out.println("Integer"); }
    static void call(int... n)  { System.out.println("varargs"); }

    public static void main(String[] args) {
        call(5);
    }
}
```

Which overload runs, and what's printed?

<details>
<summary>Answer</summary>

`call(long n)` runs, printing `"long"`.

The compiler resolves overloads in strict phases, and it fully evaluates
one phase across *all* candidate overloads before ever moving to the
next:

1. **Exact match** — is there a `call(int)`? No such overload exists here.
2. **Widening primitive conversion** — can the argument widen to match
   some overload without boxing? `int` widens to `long` for free
   (`int` → `long` is a widening primitive conversion), so `call(long n)`
   is applicable in this phase.
3. **Autoboxing** — only considered if phase 2 found nothing. `call(Integer
   n)` would require boxing `5` into an `Integer`.
4. **Varargs** — the last resort. `call(int... n)` would require wrapping
   `5` into a one-element array.

Because phase 2 already finds an applicable match (`call(long n)`), the
compiler stops there — it never even considers the boxing or varargs
candidates. This is the same widening-before-boxing-before-varargs order
called out on the "Designing Methods" slide, extended one step further:
varargs is strictly the last phase considered, after both widening and
boxing have failed to find a match.

</details>

---

## Exercise 5 — Encapsulation broken by a leaky getter

```java
import java.util.ArrayList;
import java.util.List;

public class Team {
    private List<String> members;

    public Team(List<String> members) {
        this.members = members;
    }

    public List<String> getMembers() {
        return members;
    }
}

List<String> names = new ArrayList<>(List.of("Ana", "Bruno"));
Team team = new Team(names);

team.getMembers().add("Caio");
names.add("Duda");

System.out.println(team.getMembers());
```

What's printed, and why does this break encapsulation even though
`members` is declared `private`?

<details>
<summary>Answer</summary>

Prints `[Ana, Bruno, Caio, Duda]`.

Declaring `members` `private` only stops outside code from writing
`team.members = someOtherList` directly — it says nothing about what
happens to the *object* that field points to once a reference to it
escapes the class. Here it escapes twice:

- The constructor stores the exact `List` reference the caller passed in
  (`this.members = members;`), instead of copying it. So the caller's own
  `names` variable and `Team`'s internal `members` field are two names for
  the **same** `ArrayList` object — calling `names.add("Duda")` from
  outside mutates `Team`'s internal state directly.
- `getMembers()` returns that same live reference rather than a copy.
  Calling `.add("Caio")` on the returned list mutates the real internal
  list in place — no `Team` method was ever invoked to authorize or
  validate that change; encapsulation is meant to force all state changes
  through the class's own methods, and this getter completely bypasses
  that.

Both mutations land on the one shared list object, so all three prints —
the caller's `names`, the return value of `getMembers()`, and `Team`'s
internal state — reflect the combined changes.

The fix is **defensive copying** on both sides: the constructor should
do `this.members = new ArrayList<>(members);` to decouple from the
caller's list, and the getter should return `new ArrayList<>(members)`
(or an unmodifiable view) instead of the live reference, so external code
can never reach in and mutate `Team`'s internal state directly.

</details>
