---
version: 1.0
updatedAt: 2026-05-26
---
# Instance main Methods — Now Final (JEP 495)

---

## Overview

**JEP 495**, finalised in Java 25, relaxes the rules for the program entry-point method. A `main` method no longer needs to be `public`, `static`, or accept a `String[]` parameter. This removes boilerplate that confused beginners and cluttered simple programs.

---

## Traditional Entry Point (Pre-Java 25)

```java
public class App {
    public static void main(String[] args) {
        System.out.println("Hello");
    }
}
```

All four elements — `public`, `static`, `void`, `String[] args` — were mandatory for the JVM to recognise the entry point.

---

## Relaxed `main` in Java 25

Any of the following are now valid entry points:

```java
// 1. Instance main, no args (simplest form)
class App {
    void main() {
        System.out.println("Hello");
    }
}

// 2. Instance main with args
class App {
    void main(String[] args) {
        System.out.println("Args: " + args.length);
    }
}

// 3. Static main, no args
class App {
    static void main() {
        System.out.println("Static, no args");
    }
}

// 4. Traditional form still works
class App {
    public static void main(String[] args) {
        System.out.println("Classic");
    }
}
```

---

## Resolution Order

When the JVM looks for an entry point in a class, it evaluates candidates in this priority order:

| Priority | Signature |
|----------|-----------|
| 1 (highest) | `static void main(String[])` — any access modifier |
| 2 | `static void main()` — any access modifier |
| 3 | `instance void main(String[])` — any access modifier |
| 4 (lowest) | `instance void main()` — any access modifier |

The JVM picks the **first** matching method. If the selected `main` is an instance method, the JVM instantiates the class using its no-argument constructor before invoking `main`.

> **Exam tip:** If a class has both `static void main(String[])` and `void main()`, the static form is always chosen. Know the priority table — the exam tests it.

---

## Requirements for Instance `main`

- The class must have a **no-argument constructor** (the default constructor qualifies if no constructors are declared).
- The `main` method must be non-`abstract` and non-`native`.
- The class must not be abstract.
- Access modifiers (`public`, `protected`, package-private, `private`) are accepted for `main` but `public` is conventional.

```java
class Greeter {
    private String greeting;

    Greeter() {
        this.greeting = "Hello";
    }

    void main() {
        System.out.println(greeting + ", World!");
    }
}
```

---

## Instance `main` in an Unnamed Class (JEP 512)

The most minimal valid Java 25 program:

```java
void main() {
    System.out.println("Hello, Java 25!");
}
```

The compiler wraps this in a synthesised unnamed class. `main()` is an instance method on that class.

---

## Interaction with Inheritance

If `main` is inherited from a superclass, the JVM can use it as the entry point, following the same resolution rules.

```java
class Base {
    void main() {
        System.out.println("Base main");
    }
}

class Child extends Base {
    // No main declared — inherits Base.main()
}
```

Running `Child` uses `Base.main()` after instantiating `Child`.

---

## Deprecation of Old Signature?

The traditional `public static void main(String[] args)` is **not deprecated** and remains fully supported. JEP 495 extends the set of valid signatures; it does not remove any existing ones.

---

## Key Points for the Exam

- `main` can now be an instance method — the JVM instantiates the class before calling it.
- `String[] args` is optional — `void main()` with no parameters is valid.
- Access modifiers are optional — `main` does not need to be `public`.
- Priority order: static with args > static no args > instance with args > instance no args.
- Class must have a no-arg constructor when `main` is an instance method.
- The traditional signature still works and is still highest priority when `String[]` is present.
- Finalised in Java 25 (previewed as JEP 445, 463, 477).

## References

- [JEP 495: Simple Source Files and Instance Main Methods (Fifth Preview)](https://openjdk.org/jeps/495)
- [JEP 512: Compact Source Files and Instance Main Methods (Final)](https://openjdk.org/jeps/512)
