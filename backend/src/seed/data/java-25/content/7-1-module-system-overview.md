# Module System Overview

---

## Overview

The **Java Platform Module System (JPMS)**, introduced in Java 9 (Project Jigsaw), adds a higher-level unit of encapsulation on top of packages. A module is a named, self-describing collection of packages with explicit dependencies.

**Problems JPMS solves:**

| Problem | Description |
|---------|-------------|
| Classpath Hell | Duplicate or missing JARs discovered only at runtime |
| Unreliable encapsulation | Any `public` class was accessible from anywhere on the classpath |
| Monolithic JDK | No way to ship a subset of the JDK with an application |

---

## Module Structure

A module is a directory (or JAR) whose root contains a `module-info.java` file:

```
my.app/
├── module-info.java
└── com/example/app/
    ├── Main.java
    └── service/
        └── OrderService.java
```

```java
// module-info.java
module my.app {
    requires java.logging;
    exports com.example.app;
}
```

The `module-info.java` file is compiled into `module-info.class` and placed at the root of the module directory or JAR.

---

## Module Naming

Module names follow the same reverse-domain convention as package names. A module name must be unique within a module path.

```java
module com.acme.billing { }
module org.springframework.core { }
module java.base { }
```

> **Exam tip:** Module names use dots as separators but are **not** hierarchically related — `com.acme` and `com.acme.billing` are independent modules with no parent-child relationship.

---

## Named vs Unnamed Modules

| Type | How it is loaded | Has a name? | Reads |
|------|-----------------|-------------|-------|
| Named module | Module path (`--module-path`) | Yes — declared in `module-info.java` | Only what it explicitly `requires` |
| Unnamed module | Classpath | No — referred to as the unnamed module | Reads all named modules and itself |
| Automatic module | Module path, no `module-info` | Yes — derived from JAR filename | Reads all other modules |

The unnamed module exists for backward compatibility: all code loaded from the classpath belongs to it.

---

## The `module-info.java` File

```java
module com.example.shop {

    // Dependencies
    requires java.base;          // always implicit
    requires java.sql;
    requires transitive java.logging;

    // What this module exposes
    exports com.example.shop.api;
    exports com.example.shop.model;

    // Internal package opened only to a specific module
    opens com.example.shop.internal to framework.module;

    // Service declarations
    uses com.example.shop.api.PaymentService;
    provides com.example.shop.api.PaymentService
        with com.example.shop.internal.StripePaymentService;
}
```

`java.base` is required implicitly by every module; you do not need to declare it.

---

## The JDK Module Graph (Excerpt)

The JDK itself is modularised. Key platform modules:

| Module | Contents |
|--------|----------|
| `java.base` | `java.lang`, `java.util`, `java.io`, `java.nio`, … |
| `java.sql` | JDBC, `javax.sql` |
| `java.logging` | `java.util.logging` |
| `java.xml` | JAXP, DOM, SAX |
| `java.desktop` | AWT, Swing |
| `jdk.compiler` | `javac` |

---

## Compiling and Running Modules

```bash
# Compile a single named module
javac -d out/my.app --module-source-path src \
      $(find src/my.app -name "*.java")

# Run
java --module-path out -m my.app/com.example.app.Main

# Compile all modules under src/ at once
javac -d out --module-source-path src \
      $(find src -name "*.java")
```

---

## Key Points for the Exam

- `module-info.java` lives at the **root** of the module source tree.
- `java.base` is implicitly required — never needs to appear in `requires`.
- Named modules have strong encapsulation: non-exported packages cannot be accessed at all, even with reflection (unless `opens` or `--add-opens` is used).
- The unnamed module can access all exported packages of named modules, but named modules cannot `require` the unnamed module.
- JPMS is distinct from OSGi; it is built into the JDK.

## References

- [JEP 261: Module System](https://openjdk.org/jeps/261)
- [Oracle Docs — The Module System (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/module-summary.html)
