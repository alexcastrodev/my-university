---
version: 1.0
updatedAt: 2026-05-28
---
# Flexible Constructor Bodies — Delta from Java 21 to Java 25 (JEP 513)

> **JEP 513** — finalized in Java 25. See [openjdk.org/jeps/513](https://openjdk.org/jeps/513).

---

## What changed since Java 21

In Java 21, the JLS rule was strict: if a constructor contains an explicit `this(...)` or `super(...)` invocation, it must be the **first statement** of the constructor body. Any computation that needed the result of that call had to be done in the call's argument list or after it.

Java 25 splits the body into two parts:

- **Prologue** — statements before the explicit constructor invocation.
- **Epilogue** — the explicit invocation and everything after it.

Statements are now allowed in the prologue, subject to restrictions designed to keep the half-initialized object inaccessible.

Preview history:

| Release | JEP | Name at the time | Status |
|---------|-----|------------------|--------|
| Java 22 | [447](https://openjdk.org/jeps/447) | Statements before super(...) | First preview |
| Java 23 | [482](https://openjdk.org/jeps/482) | Flexible Constructor Bodies | Second preview (renamed) |
| Java 24 | [492](https://openjdk.org/jeps/492) | Flexible Constructor Bodies | Third preview |
| Java 25 | [513](https://openjdk.org/jeps/513) | Flexible Constructor Bodies | Final |

Notable drift:

- JEP 447 forbade **any** assignment to instance fields in the prologue. JEP 482 relaxed this: the prologue may assign to fields **declared in the same class** (not inherited). JEP 513 keeps that rule.
- JEP 447 forbade `try`/`catch` around the `super(...)` call. JEP 513 still forbids putting the explicit invocation inside a `try` block, but the prologue itself may contain `try`/`catch` over its own statements.
- Final form clarifies that an explicit invocation must appear at the **top level** of the constructor body — never inside a lambda, switch expression, local class, or nested block.

---

## The two-part constructor body

```java
class Sub extends Super {
    final int x;

    Sub(int raw) {
        // ---------- prologue ----------
        if (raw < 0) throw new IllegalArgumentException();
        int normalized = Math.abs(raw);
        this.x = normalized;          // assigning *own* field is OK
        // ---------- epilogue ----------
        super(normalized * 2);        // explicit invocation
        // post-super work
        log("built with " + normalized);
    }
}
```

In Java 21, every line above `super(...)` would have been a compile error.

---

## Prologue restrictions

In the prologue, the current instance exists in an unconstructed state. The compiler enforces:

| Restriction | Allowed? |
|-------------|----------|
| Read or write `this.f` for `f` declared in **this** class | Write yes, read no |
| Read or write `this.f` for `f` declared in a **super** class | No |
| Call an instance method on `this` (explicitly or implicitly) | No |
| Use `this` or `super` as a value (e.g. `return this`, pass to a method) | No |
| Call a `static` method or access a `static` field of any class | Yes |
| Reference parameters and locals | Yes |
| Throw exceptions, `if`, `for`, `try`/`catch`, etc. | Yes |
| Construct other objects (`new Foo(...)`) | Yes |
| Put the `super(...)` / `this(...)` call inside `try` / `if` / lambda | No |

The "write but not read" asymmetry for the current class's own fields is the key surprise. The compiler treats prologue field assignments as **definite-assignment** evidence for the field; you cannot read what you have just written until the epilogue.

```java
class C {
    final int a;
    C(int n) {
        this.a = n;          // OK
        // System.out.println(this.a);  // compile error: cannot read in prologue
        super();
        System.out.println(this.a);    // OK in epilogue
    }
}
```

---

## Pattern 1 — Validate arguments before calling super

```java
class PositiveInt extends Number {
    PositiveInt(int v) {
        if (v <= 0) throw new IllegalArgumentException("v must be > 0");
        super();
        // ...
    }
}
```

In Java 21 this had to be a `static` helper called from the `super(...)` argument list.

---

## Pattern 2 — Compute super-call arguments

```java
class Cents extends Money {
    Cents(BigDecimal dollars) {
        var c = dollars.movePointRight(2).longValueExact();
        super(c);
    }
}
```

The local `c` is reused inside `super(...)` and (potentially) in the epilogue — no `static` helper, no recomputation.

---

## Pattern 3 — Conditional super invocation

```java
class Lazy extends Eager {
    Lazy(Config cfg) {
        if (cfg.fast()) {
            super(cfg.fastSeed());
        } else {
            super(cfg.slowSeed());     // two paths, same shape
        }
        // common epilogue
    }
}
```

Every execution path through the prologue must reach **exactly one** explicit constructor invocation. The compiler enforces this with the same definite-assignment machinery used for `final` fields.

---

## Pattern 4 — Field-before-super fixes the overridable-method footgun

A classic Java bug:

```java
class Base {
    Base() { describe(); }
    void describe() { System.out.println("base"); }
}
class Derived extends Base {
    final String label;
    Derived(String label) {
        super();            // Base() runs first; Derived.describe() reads label
        this.label = label; // ...but label is still null at that point!
    }
    @Override void describe() { System.out.println(label); }
}
// Output: null
```

In Java 25 the subclass can initialize `label` **before** delegating up:

```java
class Derived extends Base {
    final String label;
    Derived(String label) {
        this.label = label;   // assigned in prologue
        super();              // Base() calls describe(), which now reads "label"
    }
    @Override void describe() { System.out.println(label); }
}
// Output: <the actual label>
```

This is the canonical exam example for the new feature.

---

## What is still forbidden

- Calling **any** instance method of the current class in the prologue, including inherited ones — even via an explicit `this.m()`.
- Reading **any** instance field in the prologue, whether declared here or inherited.
- Assigning to inherited fields in the prologue (you have no superclass instance yet).
- Putting the explicit constructor invocation inside a `try`, `if`, lambda, switch expression, or nested block other than the constructor body itself.
- Throwing a checked exception that the constructor does not declare — normal rules still apply.

---

## Exam-relevant rules

| Rule | Detail |
|------|--------|
| Allowed location of `super(...)` / `this(...)` | Top level of the constructor body; no longer the first statement |
| Prologue field writes | Allowed for fields declared in the current class only |
| Prologue field reads | Forbidden for all instance fields |
| Prologue instance method calls | Forbidden — including inherited methods |
| Prologue `this` / `super` as value | Forbidden |
| Prologue static access | Permitted |
| `try`/`catch` wrapping the explicit invocation | Forbidden |
| `try`/`catch` inside the prologue | Permitted |
| Conditional invocation | Permitted if every path reaches exactly one explicit invocation |
| Records and enums | Same rules apply; canonical record constructors still cannot have an explicit invocation |
| Preview flag in Java 25 | None — feature is final |

---

## See also

- [[3-3-constructors-flexible-bodies-initializers]] — base course lesson on constructors and flexible bodies.
- JLS: [§8.8.7 Constructor Body, Java SE 25](https://docs.oracle.com/javase/specs/jls/se25/html/jls-8.html#jls-8.8.7).
