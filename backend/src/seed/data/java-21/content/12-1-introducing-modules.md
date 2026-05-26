# Introducing Modules

> **OCP Exam Topic** — Understand the Java Platform Module System (JPMS): motivation, core concepts, and the relationship between modules, packages, and the classpath. Covered in Chapter 12 of *OCP Java SE 21 Developer Study Guide* (Selikoff & Boyarsky).

---

## Why Modules Exist

Before Java 9, all compiled code lived on the **classpath** — a flat list of directories and JAR files. Two chronic problems plagued large applications.

**Classpath Hell** — When multiple JARs define the same package or class, the JVM silently picks whichever one appears first on the classpath. The result is unpredictable behaviour that is hard to reproduce and debug.

**Weak Encapsulation** — The `public` modifier was the only barrier between a library's API and its internals. Any `public` class in any JAR was accessible to any other JAR on the classpath. Library authors could not enforce which packages were part of their public contract.

The **Java Platform Module System (JPMS)**, introduced in Java 9 and finalized in Java 11, addresses both problems by introducing a higher-level unit of deployment: the **module**.

---

## What a Module Is

A module is a named, self-describing group of packages with explicit dependencies and an explicit API surface. Every module declares:

- **What it contains** — the packages it owns.
- **What it requires** — the other modules it depends on.
- **What it exports** — the packages other modules may use.

This declaration lives in a special source file called `module-info.java` at the root of the module's source tree.

```java
// A minimal module declaration
module com.example.app {
    requires java.sql;
    exports com.example.app.api;
}
```

Packages not listed in an `exports` directive are **strongly encapsulated** — no code outside the module can access them, even if the types within are `public`.

---

## Module Path vs Classpath

JPMS introduces a new search path alongside the traditional classpath.

| Concept | Classpath | Module Path |
|---|---|---|
| Flag | `-cp` / `-classpath` | `--module-path` / `-p` |
| Unit of resolution | Individual `.class` files | Whole modules |
| Access control | `public` is globally visible | Controlled by `exports` |
| Circular dependencies | Allowed | Not allowed |
| Unnamed packages | Allowed | Not allowed in named modules |

The two paths can coexist. Code on the classpath continues to work as before, while modularised code benefits from the stronger guarantees of the module path.

---

## The JDK Is Modular

Starting with Java 9 the JDK itself was split into modules. You no longer get a monolithic `rt.jar`; instead the runtime is composed of discrete modules.

Key JDK modules to recognise for the exam:

| Module | Purpose |
|---|---|
| `java.base` | Core types: `java.lang`, `java.util`, `java.io`. Always available. |
| `java.sql` | JDBC API |
| `java.desktop` | AWT and Swing |
| `java.logging` | `java.util.logging` |
| `java.xml` | XML processing (JAXP) |
| `java.net.http` | `java.net.http.HttpClient` (Java 11+) |

`java.base` is implicitly required by every module — you never have to write `requires java.base;`.

---

## Named Modules, Unnamed Modules, and Automatic Modules

Not all code is immediately modular. JPMS defines three module types to support gradual migration.

**Named module** — has a `module-info.java` and is placed on the module path. Full JPMS rules apply.

**Unnamed module** — code on the classpath that has no `module-info.java`. It can read all other modules and is accessible to no named module. This preserves backward compatibility.

**Automatic module** — a plain JAR (no `module-info.java`) placed on the *module path*. The JVM derives the module name from the JAR filename and the module exports all its packages. Automatic modules bridge the gap while library authors add proper module declarations.

---

## Key Points to Remember

- JPMS solves classpath hell and weak encapsulation.
- A module declares its dependencies (`requires`) and its public API (`exports`).
- Packages not exported are strongly encapsulated regardless of access modifiers.
- `java.base` is always implicitly required; it contains `java.lang`, `java.util`, and `java.io`.
- Three module types exist: named, unnamed (classpath), and automatic (plain JAR on module path).
- The module path (`--module-path` / `-p`) is separate from the classpath (`-cp`).

---

## References

- [JEP 261 — Module System](https://openjdk.org/jeps/261)
- [Java SE 21 Module API](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Module.html)
- [JDK Module Summary](https://docs.oracle.com/en/java/javase/21/docs/api/index.html)
