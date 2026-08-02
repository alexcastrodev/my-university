# Practice: Building Blocks

> Five exercises covering what the slides in this module introduced —
> one-public-class-per-file rules, local variable scope and shadowing,
> default values for fields vs. locals, the order of field initializers,
> instance initializer blocks and constructors, and garbage collection
> eligibility. Try to answer before opening each explanation.

---

## Exercise 1 — How many public classes can one file have?

```java
// File: Zoo.java
public class Zoo {
    public static void main(String[] args) {
        System.out.println("Zoo opens");
    }
}

public class Animal {
    String name;
}
```

Does `Zoo.java` compile?

<details>
<summary>Answer</summary>

**No — this fails to compile.**

A single `.java` source file may declare at most **one top-level `public`
class**, and that class's name must match the filename exactly. Here both
`Zoo` and `Animal` are declared `public` in the same file (`Zoo.java`).
The compiler rejects the second one with something like `class Animal is
public, should be declared in a file named Animal.java`.

Note that the rule is specifically about `public` — the file could legally
contain any number of *non*-public top-level classes alongside `Zoo`:

```java
public class Zoo { }
class Animal { }     // fine — package-private, no filename requirement
class Habitat { }    // also fine
```

Each top-level class still compiles to its own `.class` file, but only one
per source file is allowed to be `public`.

</details>

---

## Exercise 2 — Can a nested block redeclare a variable that shadows a field?

```java
public class Counter {
    int value = 100;

    void update(int value) {
        value = value + 1;
        {
            int value = 5;
            System.out.println(value);
        }
        System.out.println(value);
    }
}
```

Does `update` compile? If not, which line is the problem?

<details>
<summary>Answer</summary>

**No — it fails to compile**, at `int value = 5;` inside the nested
block, with a "variable value is already defined in method
update(int)" error.

Two different rules are in play here, and it's important to separate them:

1. The parameter `value` **legally shadows** the instance field `value`
   for the entire body of `update`. That part alone is fine — inside the
   method, plain `value` refers to the parameter, and `this.value` would
   be required to reach the field. Shadowing a field with a local
   variable or parameter is explicitly permitted.
2. A local variable (and a parameter counts as one) **cannot be shadowed
   by another local variable** declared in a nested block within the same
   method. The parameter `value` is in scope for the *entire* method
   body, including the nested `{ }` block — so trying to declare a second
   `value` there isn't shadowing, it's a duplicate declaration inside a
   scope where the name is already active, which the compiler rejects.

This is the asymmetry the exam likes to test: a local/parameter can hide
a *field* of the same name, but it can never be hidden by another local
declared anywhere inside its own scope, including deeper nested blocks.

</details>

---

## Exercise 3 — Field defaults vs. local variable defaults

```java
public class Inventory {
    static int itemCount;
    boolean discontinued;
    String sku;
    double[] weights;

    void describe() {
        int pendingOrders;
        System.out.println(itemCount + " " + discontinued + " " + sku + " " + weights);
        System.out.println(pendingOrders);
    }
}
```

Does `describe()` compile? Whether it does or not, what are the default
values of `itemCount`, `discontinued`, `sku`, and `weights` immediately
after an `Inventory` object is constructed?

<details>
<summary>Answer</summary>

**It does not compile** — but not because of the `System.out.println`
line that reads the four fields; that line is completely fine. The
failure is the *next* line: `pendingOrders` is a **local** variable, and
local variables receive **no default value** in Java. Reading a local
variable before it's definitely assigned is a compile-time error
("variable pendingOrders might not have been initialized"), regardless of
whether the method ever actually gets called.

If that last `println` were deleted, the method would compile and print
the fields' defaults, because static and instance fields *do* get
type-based defaults the moment the object (and, for `static`, the class)
is initialized:

- `itemCount` (`static int`) → `0`
- `discontinued` (`boolean`) → `false`
- `sku` (`String`, a reference type) → `null`
- `weights` (`double[]`, also a reference type — an array is an object)
  → `null`, **not** an empty array and **not** an array of `0.0`s. The
  array *reference itself* defaults to `null` until something explicitly
  assigns it a `new double[...]`.

The general rule: every field (instance or static) gets a type-appropriate
default (`0`/`0L`/`0.0`/`false`/`null`); every local variable gets nothing
and must be definitely assigned before it's read, or the compiler stops
you.

</details>

---

## Exercise 4 — Field initializers, instance initializer blocks, and constructor chaining

```java
public class Ticket {
    private int price = 10;

    {
        price += 5;
        System.out.println("Instance init: " + price);
    }

    public Ticket() {
        System.out.println("No-arg constructor: " + price);
        price = 100;
    }

    public Ticket(int discount) {
        this();
        System.out.println("Overloaded constructor: " + price);
        price -= discount;
    }

    public static void main(String[] args) {
        Ticket t = new Ticket(20);
        System.out.println("Final price: " + t.price);
    }
}
```

What gets printed, in order?

<details>
<summary>Answer</summary>

```
Instance init: 15
No-arg constructor: 15
Overloaded constructor: 100
Final price: 80
```

The subtlety is that field initializers and instance initializer blocks
run **exactly once per object**, tied to the constructor invocation that
actually calls `super()` (implicitly or explicitly) — not once per
constructor in a `this(...)` chain.

Walking through `new Ticket(20)`:

1. `price` is first zeroed to its default (`0`), then the JVM begins
   running `Ticket(int discount)`.
2. Its first statement is `this();`, which delegates to `Ticket()`
   *before* running any of `Ticket(int discount)`'s own field
   initializers — because delegating constructors don't repeat that step.
3. `Ticket()`'s first (implicit) statement is `super()`, calling
   `Object()`. Immediately after that returns, Java runs the field
   initializers and instance initializer blocks **for this object, in
   source order** — this is the one and only time they run: `price = 10`
   (field initializer), then the instance init block executes
   `price += 5` → `15` and prints `Instance init: 15`.
4. Only now does the *body* of `Ticket()` run: prints
   `No-arg constructor: 15`, then sets `price = 100`.
5. Control returns to the point right after `this();` inside
   `Ticket(int discount)`. Its field initializers do **not** run again —
   they already ran in step 3. The rest of its body executes: prints
   `Overloaded constructor: 100`, then `price -= 20` → `80`.
6. Back in `main`, `t.price` is `80`.

The trap: it's tempting to think the field initializer and instance
initializer block run once for *each* constructor that "participates,"
but they run once total, at the point where the `this(...)`/`super(...)`
chain finally reaches the constructor whose first statement is (or
implicitly is) `super(...)`.

</details>

---

## Exercise 5 — Reference reassignment and a false "island of isolation"

```java
class Box {
    Box link;
}

public class Warehouse {
    public static void main(String[] args) {
        Box a = new Box();   // Box #1
        Box b = new Box();   // Box #2
        Box c = new Box();   // Box #3

        a.link = b;           // #1.link -> #2
        b.link = a;           // #2.link -> #1

        c = a;                 // c now points to #1
        a = null;

        // <-- HERE
    }
}
```

At the point marked `HERE`, which `Box` object(s), if any, are eligible
for garbage collection?

<details>
<summary>Answer</summary>

**Only Box #3.** Boxes #1 and #2 are still fully reachable and are *not*
eligible.

Trace the references step by step:

- After the first three lines: `a` → #1, `b` → #2, `c` → #3 (each object
  has exactly one strong reference, from its own local variable).
- `a.link = b;` and `b.link = a;` make #1 and #2 point at each other —
  but both are *also* still directly referenced by the live locals `a`
  and `b`. Mutual references alone don't matter; what matters is whether
  the group is reachable from anything still live.
- `c = a;` repoints `c` from #3 to #1. At this instant, #3 loses its only
  reference (nothing else ever pointed to it) — it becomes eligible for
  GC right here.
- `a = null;` clears the `a` variable. #1 loses *that particular*
  reference, but it is still reachable two other ways: directly through
  `c` (which now points to #1), and indirectly through `b.link` (`b` →
  #2 → `#2.link` → #1). #2 is still reachable directly through `b`.

So at `HERE`: #3 is eligible for GC (zero references, since the line
that stole its last reference already executed). #1 and #2 *look* like a
classic mutually-referencing "island of isolation," but that pattern only
applies when **no live variable reaches any member of the cycle** — here
both `c` and `b` still reach into the pair from outside, so neither is
eligible. This is the pattern the exam exploits: don't assume a cycle of
references is automatically garbage; check whether any still-live
variable can reach a path into it.

</details>
