# Declaring Module Dependencies

---

## Overview

All module directives live inside the `module` declaration in `module-info.java`. Each directive controls what the module depends on and what it exposes.

```java
module <module-name> {
    // zero or more directives
}
```

---

## `requires` — Declaring a Dependency

```java
module com.example.client {
    requires java.sql;          // compile-time and runtime dependency
    requires java.logging;
}
```

The compiler and runtime both enforce that `java.sql` and `java.logging` are present on the module path. If a required module is absent, the JVM fails at startup, not at the point of first use.

---

## `requires transitive` — Implied Readability

```java
module com.example.persistence {
    requires transitive java.sql;  // consumers automatically read java.sql too
}
```

Any module that `requires com.example.persistence` automatically gains read access to `java.sql` without declaring it explicitly. Use this when your API types come from another module.

```java
module com.example.app {
    requires com.example.persistence;
    // No need to also write: requires java.sql;
    // because persistence re-exports it transitively
}
```

> **Exam tip:** Forgetting `requires transitive` when your public API returns types from a dependency causes a compile error in the consuming module. Add `transitive` so consumers do not need to redeclare the dependency.

---

## `requires static` — Optional / Compile-Time-Only Dependency

```java
module com.example.plugin {
    requires static com.example.annotations;  // needed at compile time, optional at runtime
}
```

`requires static` compiles against the module but does not mandate its presence at runtime. Useful for annotation processors and optional integrations.

---

## `exports` — Exposing a Package

```java
module com.example.lib {
    exports com.example.lib.api;          // accessible to all modules
    exports com.example.lib.util;
    // com.example.lib.internal is NOT exported — strongly encapsulated
}
```

Only `public` and `protected` types in an exported package are accessible to other modules. Non-exported packages are invisible even if their types are `public`.

---

## `exports … to` — Qualified Export

```java
module com.example.framework {
    exports com.example.framework.spi to com.example.plugin.a,
                                         com.example.plugin.b;
}
```

Only the listed modules may access the package. All other modules see it as non-existent.

---

## `opens` — Deep Reflection Access

```java
module com.example.domain {
    opens com.example.domain.entity;  // opens to all — reflection allowed
}
```

`opens` allows reflective access (including private members) to the package at runtime. Required by frameworks such as Hibernate, Jackson, and Spring when they need to access private fields.

---

## `opens … to` — Qualified Opens

```java
module com.example.domain {
    opens com.example.domain.entity to hibernate.core, jackson.databind;
}
```

Limits deep reflection to the listed modules only.

---

## `exports` vs `opens` — Comparison

| Directive | Compile-time access | Runtime (normal) | Runtime (reflection) |
|-----------|-------------------|-----------------|---------------------|
| `exports pkg` | Yes | Yes | Public only |
| `exports pkg to m` | Yes (m only) | Yes (m only) | Public only (m only) |
| `opens pkg` | No | No | Yes (all, including private) |
| `opens pkg to m` | No | No | Yes, m only |

> **Exam tip:** `opens` does **not** grant compile-time visibility. A module can `opens` without `exports`, which allows reflection but not normal compilation against those types.

---

## `uses` — Declaring Service Consumption

```java
module com.example.app {
    uses com.example.api.Formatter;  // this module will look up Formatter implementations
}
```

---

## `provides … with` — Declaring Service Implementation

```java
module com.example.formats {
    provides com.example.api.Formatter
        with com.example.formats.JsonFormatter,
             com.example.formats.XmlFormatter;
}
```

---

## Complete `module-info.java` Example

```java
module com.example.shop {
    requires java.base;                          // implicit, shown for clarity
    requires java.sql;
    requires transitive java.logging;
    requires static com.example.codegen;

    exports com.example.shop.api;
    exports com.example.shop.model;
    exports com.example.shop.spi to com.example.shop.plugins;

    opens com.example.shop.entity to hibernate.core;

    uses com.example.shop.spi.TaxCalculator;
    provides com.example.shop.spi.TaxCalculator
        with com.example.shop.internal.DefaultTaxCalculator;
}
```

---

## Key Points for the Exam

- `requires transitive` propagates readability to downstream modules.
- `requires static` is compile-time only; the module may be absent at runtime.
- `exports` grants compile-time and normal runtime access; `opens` grants reflective access only.
- An `exports … to` or `opens … to` is called a **qualified** directive.
- `java.base` is always required implicitly; listing it is redundant but not an error.
- You can `exports` and `opens` the same package independently.

## References

- [JEP 261: Module System](https://openjdk.org/jeps/261)
- [Oracle Docs — module-info (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/module-summary.html)
