# Diving into the module-info File

> **OCP Exam Topic** — Understand and write every directive available in `module-info.java`: `requires`, `requires transitive`, `exports`, `exports to`, `opens`, `opens to`, `uses`, and `provides...with`. Covered in Chapter 12 of *OCP Java SE 21 Developer Study Guide* (Selikoff & Boyarsky).

---

## Overview

`module-info.java` is the declaration file for a Java module. It uses special keywords that do not appear anywhere else in the language. The file must:

- be named exactly `module-info.java`
- sit at the root of the module's source tree (not inside any package directory)
- contain exactly one `module` declaration

A fully annotated module declaration can include all directives shown below.

---

## `requires`

Declares that this module depends on another module at both compile time and runtime.

```java
module com.example.app {
    requires java.sql;         // depends on java.sql module
    requires com.example.util; // depends on another named module
}
```

- `java.base` is always implicitly required — never write `requires java.base;`.
- If the required module is absent from the module path, the JVM fails at startup.

---

## `requires transitive`

Declares a dependency and **re-exports** it to any module that reads this module. This is called **implied readability**.

```java
module com.example.service {
    requires transitive com.example.api; // consumers of service also read api
}
```

If module `A` requires `com.example.service`, it automatically reads `com.example.api` without needing its own `requires` directive. Use `requires transitive` when your exported types reference types from another module — callers would otherwise receive compile errors.

```java
// Consumer module — no need to separately require com.example.api
module com.example.client {
    requires com.example.service; // transitively reads com.example.api
}
```

---

## `exports`

Makes a package accessible to all other modules. Without `exports`, a package is strongly encapsulated — even `public` types are invisible to outside code.

```java
module com.example.library {
    exports com.example.library.api;    // public API package
    // com.example.library.internal is NOT exported — hidden from all
}
```

Rules:
- Only packages may be exported, not individual classes.
- A package must belong to the declaring module; you cannot export packages from other modules.

---

## `exports to` (Qualified Export)

Restricts a package export to a specific set of named modules. Useful for frameworks or test modules that should access implementation details not meant for general use.

```java
module com.example.library {
    exports com.example.library.api;            // open to everyone
    exports com.example.library.internal
        to com.example.test, com.example.tools; // restricted export
}
```

Code in any module other than `com.example.test` and `com.example.tools` cannot access `com.example.library.internal`, even via reflection.

---

## `opens`

Allows reflective access to a package at runtime, while keeping compile-time access restricted. Frameworks like Spring, Hibernate, and JUnit use reflection to inspect and manipulate objects.

```java
module com.example.app {
    opens com.example.app.model; // reflection allowed at runtime
}
```

- `opens` permits `getDeclaredFields()`, `setAccessible(true)`, and similar reflective operations.
- Unlike `exports`, `opens` does not grant compile-time access — the package is not visible to `import` statements in other modules.

---

## `opens to` (Qualified Opens)

Restricts reflective access to a specific list of modules.

```java
module com.example.app {
    opens com.example.app.model to com.fasterxml.jackson.databind;
}
```

Only the Jackson databind module can reflect into `com.example.app.model`. All other modules are denied reflective access.

---

## `open module`

Declaring the entire module as `open` grants reflective access to all packages without listing them individually. Convenient for application modules that are heavily framework-driven.

```java
open module com.example.app {
    requires spring.core;
    exports com.example.app.api;
}
```

An `open module` may still have `exports` directives for compile-time visibility. It may NOT contain individual `opens` directives — that would conflict.

---

## `uses`

Declares that this module consumes a service via `java.util.ServiceLoader`. The named type is the service interface or abstract class.

```java
module com.example.app {
    requires java.logging;
    uses com.example.spi.LogProvider; // this module will look up LogProvider implementations
}
```

`uses` does not require a direct dependency on any implementation — it only declares intent to call `ServiceLoader.load(LogProvider.class)`.

---

## `provides...with`

Declares that this module provides an implementation of a service interface.

```java
module com.example.logging {
    provides com.example.spi.LogProvider
        with com.example.logging.ConsoleLogProvider;
}
```

- The type after `provides` is the service interface (must be on the module path).
- The type after `with` is the concrete implementation class inside this module.
- The implementation is discovered by `ServiceLoader` at runtime without any hard import dependency from the consumer.

---

## Complete Example

```java
module com.example.platform {
    // Dependencies
    requires java.sql;
    requires transitive com.example.api;

    // Compile-time exports
    exports com.example.platform.api;
    exports com.example.platform.spi to com.example.plugins;

    // Reflective access for frameworks
    opens com.example.platform.model;
    opens com.example.platform.config to com.fasterxml.jackson.databind;

    // Service consumer and provider
    uses com.example.spi.StorageProvider;
    provides com.example.spi.StorageProvider
        with com.example.platform.storage.DefaultStorageProvider;
}
```

---

## Directive Summary Table

| Directive | Compile-time access | Runtime reflective access | Scope |
|---|---|---|---|
| `requires` | Yes (dependency) | n/a | all modules |
| `requires transitive` | Yes + implied readability | n/a | all modules |
| `exports` | Yes | No | all modules |
| `exports to` | Yes | No | named modules only |
| `opens` | No | Yes | all modules |
| `opens to` | No | Yes | named modules only |
| `open module` | No (for reflection) | Yes (all packages) | all modules |
| `uses` | n/a | ServiceLoader discovery | service type |
| `provides...with` | n/a | ServiceLoader registration | service type |

---

## Key Points to Remember

- `module-info.java` must be at the source root, not inside a package directory.
- `requires transitive` grants implied readability to downstream consumers.
- `exports` controls compile-time visibility; `opens` controls runtime reflective access.
- Qualified variants (`exports to`, `opens to`) restrict access to named modules.
- `uses` and `provides...with` implement the `ServiceLoader` service-provider pattern.
- An `open module` opens all packages for reflection; it cannot contain explicit `opens` directives.

---

## References

- [JEP 261 — Module System](https://openjdk.org/jeps/261)
- [Java SE 21 — module-info syntax](https://docs.oracle.com/en/java/javase/21/docs/specs/java-se-21-jls.html)
- OCP Study Guide, Chapter 12 — Modules
