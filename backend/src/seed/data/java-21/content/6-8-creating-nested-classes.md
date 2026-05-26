# Creating Nested Classes

> **OCP Exam Topic** — Understand and use the four kinds of nested classes: static nested class, inner class, local class, and anonymous class. Covered in Chapter 6 of *OCP Java SE 21 Developer Study Guide* (Selikoff & Boyarsky).

---

## Overview

Java allows you to define a class inside another class or method. There are four varieties, each with different scoping and access rules:

| Kind | Declared In | Has `static` Modifier | Requires Outer Instance |
|---|---|---|---|
| Static nested class | Class body | Yes | No |
| Inner class | Class body | No | Yes |
| Local class | Method body | No | No (has enclosing method scope) |
| Anonymous class | Expression | No | Depends on context |

---

## Static Nested Class

A static nested class is declared inside an outer class with the `static` modifier. It behaves like a regular top-level class, but its name is scoped inside the outer class.

```java
public class Outer {
    private static int outerStatic = 42;
    private int outerInstance = 10;

    public static class Nested {
        public void display() {
            System.out.println(outerStatic);   // OK — static member of outer
            // System.out.println(outerInstance); // compile error — not static
        }
    }
}

// Instantiation — no outer instance needed
Outer.Nested n = new Outer.Nested();
n.display(); // 42
```

Static nested classes are commonly used to group helper types closely with their owner without needing access to instance state (e.g., `Map.Entry`).

---

## Inner Class (Non-Static Nested Class)

An inner class is declared inside an outer class **without** the `static` modifier. Every inner class instance is associated with a specific outer class instance and can access all of the outer class's members, including `private` ones.

```java
public class Engine {
    private int horsepower = 300;

    public class Cylinder {
        public void fire() {
            System.out.println("Firing with " + horsepower + " hp engine");
        }
    }
}

// Instantiation — requires an outer instance first
Engine engine = new Engine();
Engine.Cylinder cylinder = engine.new Cylinder();
cylinder.fire(); // Firing with 300 hp engine
```

Key rules for inner classes:

- Cannot declare `static` fields or `static` methods (except `static final` constants).
- The outer instance is accessible via `OuterClass.this`.

```java
public class Outer {
    private String name = "Outer";

    public class Inner {
        private String name = "Inner";

        public void printNames() {
            System.out.println(name);         // Inner
            System.out.println(Outer.this.name); // Outer
        }
    }
}
```

---

## Local Class

A local class is defined inside a method body. It can access local variables of the enclosing method only if those variables are **effectively final** (their value does not change after initialization).

```java
public class Formatter {
    public String format(String prefix) {
        String separator = " - "; // effectively final

        class PrefixFormatter {
            public String apply(String value) {
                return prefix + separator + value; // captures local vars
            }
        }

        PrefixFormatter pf = new PrefixFormatter();
        return pf.apply("Hello");
    }
}

Formatter f = new Formatter();
System.out.println(f.format("INFO")); // INFO - Hello
```

Local classes:

- Are never accessible outside their enclosing method.
- Cannot have access modifiers (`public`, `private`, etc.).
- Can implement interfaces and extend classes.

---

## Anonymous Class

An anonymous class is a local class with no name. It is declared and instantiated in a single expression, typically to implement an interface or extend a class inline.

```java
// Implementing an interface anonymously
Runnable r = new Runnable() {
    @Override
    public void run() {
        System.out.println("Running anonymously");
    }
};
r.run(); // Running anonymously
```

Anonymous class extending an abstract class:

```java
abstract class Greeting {
    abstract void greet(String name);
}

Greeting g = new Greeting() {
    @Override
    void greet(String name) {
        System.out.println("Hello, " + name + "!");
    }
};
g.greet("Alice"); // Hello, Alice!
```

Rules for anonymous classes:

- Can implement **one** interface or extend **one** class — not both at the same time.
- Cannot have explicit constructors (constructor arguments go in the `new` expression).
- Like local classes, they can only access effectively final local variables.
- Cannot declare `static` members (except `static final` constants).

**Note:** For simple single-method interfaces, lambdas are usually preferred over anonymous classes. Anonymous classes remain useful when you need to override multiple methods or extend a concrete class.

---

## Access Summary

| | Static Outer Members | Instance Outer Members | Effectively Final Locals |
|---|:---:|:---:|:---:|
| Static nested class | Yes | No | No |
| Inner class | Yes | Yes | No |
| Local class | Yes | Yes (if in instance method) | Yes |
| Anonymous class | Yes | Yes (if in instance method) | Yes |

---

## Key Points to Remember

- **Static nested class**: declared with `static`; instantiated as `new Outer.Nested()`; can access outer static members only.
- **Inner class**: no `static` modifier; requires an outer instance (`outer.new Inner()`); accesses all outer members including private.
- **Local class**: defined inside a method; can capture effectively final local variables; no access modifiers allowed.
- **Anonymous class**: nameless, single-expression declaration and instantiation; implements one interface or extends one class; commonly replaced by lambdas for functional interfaces.
- Inner and anonymous classes cannot declare `static` members (except `static final` constants).
- Effectively final means the variable is never reassigned after initial assignment — the `final` keyword is optional.
