# Flexible Constructor Bodies (JEP 492)

> Java 21 required that `super()` or `this()` be the very first statement in any constructor. JEP 492, finalized in Java 25, lifts this restriction: code is now allowed *before* the explicit constructor invocation, as long as it does not reference the uninitialized instance. This lesson covers the rule change, its use cases, and how it looks on the exam.

---

## The Java 21 Restriction

In Java 21 and earlier, an **explicit constructor invocation** (`super()` or `this()`) had to be the first statement in the constructor body. Any code placed before it was a compile-time error:

```java
// Java 21 — COMPILE ERROR
class Animal {
    String name;
    Animal(String name) {
        System.out.println("Creating: " + name);  // ERROR — must call super() first
        super();
        this.name = name;
    }
}
```

```java
// Java 21 — COMPILE ERROR (argument computation before super())
class PositiveNumber {
    int value;
    PositiveNumber(int v) {
        if (v <= 0) throw new IllegalArgumentException("Must be positive");  // ERROR
        super();
        this.value = v;
    }
}
```

This made validation and pre-computation awkward — developers had to resort to static helper methods or factory methods to work around the restriction.

---

## The Java 25 Rule (JEP 492)

Java 25 allows **prologue code** — statements before the explicit constructor invocation — with one critical constraint:

> **Code before `super()` or `this()` must NOT access the uninitialized instance.** Specifically, it cannot read or write instance fields (`this.x`), call instance methods (`this.foo()`), or pass `this` as an argument.

```java
// Java 25 — VALID: validation before super()
class PositiveNumber {
    int value;
    PositiveNumber(int v) {
        if (v <= 0) throw new IllegalArgumentException("Must be positive");  // OK
        super();
        this.value = v;
    }
}

// Java 25 — VALID: computation before super()
class Circle {
    double area;
    Circle(double radius) {
        double computed = Math.PI * radius * radius;  // OK — local variable, not this
        super();
        this.area = computed;
    }
}
```

---

## What Is Still Forbidden

The restriction on accessing `this` before `super()`/`this()` remains:

```java
// Java 25 — COMPILE ERROR: accessing instance field before super()
class Animal {
    String name;
    Animal(String n) {
        System.out.println(this.name);  // ERROR — 'this' not yet initialized
        super();
        this.name = n;
    }
}

// Java 25 — COMPILE ERROR: calling instance method before super()
class Animal {
    void validate() { }
    Animal(String n) {
        this.validate();  // ERROR — instance not yet initialized
        super();
    }
}
```

---

## Computing Super-Constructor Arguments

A major use case is computing arguments to pass to `super()` when that computation involves conditionals or multiple steps:

```java
// Java 21 — workaround required a static helper
class Rectangle extends Shape {
    Rectangle(double width, double height) {
        super(computeArea(width, height));  // forced to extract to static method
    }
    private static double computeArea(double w, double h) { return w * h; }
}

// Java 25 — prologue code makes it cleaner
class Rectangle extends Shape {
    Rectangle(double width, double height) {
        double area = width * height;  // compute before super()
        super(area);                   // pass computed value
    }
}
```

---

## Delegating with `this()` and Pre-Validation

The same rule applies to `this()` calls (constructor chaining):

```java
// Java 25 — validation before this()
class Connection {
    String url;
    int timeout;

    Connection(String url) {
        this(url, 30);  // delegate — no prologue needed here
    }

    Connection(String url, int timeout) {
        if (url == null || url.isBlank())
            throw new IllegalArgumentException("URL required");  // OK before this()
        if (timeout <= 0)
            throw new IllegalArgumentException("Timeout must be positive");
        this("default", 30);  // ERROR if this were here — can't chain again
        // Note: this() delegates to Connection(String,int) above
    }
}
```

> **Exam tip:** The restriction is specifically about `this` (the object reference). Local variables, static fields, and static method calls are all allowed before `super()`/`this()`.

---

## Before vs After: Summary

```java
// BEFORE (Java 21) — validation forced after super(), or into static method
class Sensor extends Device {
    String id;
    Sensor(String id) {
        super();                              // must be first
        Objects.requireNonNull(id, "id");    // validation happens after super
        this.id = id;
    }
}

// AFTER (Java 25) — validation before super()
class Sensor extends Device {
    String id;
    Sensor(String id) {
        Objects.requireNonNull(id, "id");    // validate BEFORE super()
        super();
        this.id = id;
    }
}
```

---

## Key Rules Summary

- In Java 21, `super()` or `this()` must be the first statement — no code before it.
- In Java 25 (JEP 492), code is allowed before `super()`/`this()` (prologue code).
- Prologue code **cannot** access the instance: no `this.field`, no `this.method()`, no passing `this`.
- Local variables, static fields, and static method calls in the prologue are permitted.
- Primary use cases: argument validation before delegation, computing arguments to pass to `super()`.

---

## References

- [JEP 492 — Flexible Constructor Bodies](https://openjdk.org/jeps/492)
- OCP Study Guide (Java 25 edition), Chapter 16 — What's New in Java 25
