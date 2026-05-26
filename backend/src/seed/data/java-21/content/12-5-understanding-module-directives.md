# Understanding Module Directives

> **OCP Exam Topic** — Understand the precise semantics of each module directive: implied readability with `requires transitive`, qualified vs unqualified exports, reflective access with `opens`, and the ServiceLoader pattern with `uses`/`provides`. Covered in Chapter 12 of *OCP Java SE 21 Developer Study Guide* (Selikoff & Boyarsky).

---

## `requires` vs `requires transitive`

Both directives declare that the current module depends on another, but they differ in what they expose to downstream consumers.

### `requires` — Direct Dependency

The consuming module reads the required module, but that readability is **not** propagated further.

```java
module com.example.service {
    requires com.example.util; // only service can see util's exports
}
```

```java
module com.example.client {
    requires com.example.service;
    // com.example.client CANNOT see com.example.util
    // even though service depends on util
}
```

If `com.example.service` exposes types from `com.example.util` in its own API (for example, a method that returns a `util` type), then `com.example.client` gets a compile error when trying to use that return value.

### `requires transitive` — Implied Readability

The consuming module automatically reads the transitively required module too.

```java
module com.example.service {
    requires transitive com.example.util; // propagate readability
    exports com.example.service.api;
}
```

```java
module com.example.client {
    requires com.example.service;
    // com.example.client NOW reads com.example.util via implied readability
    // no separate requires com.example.util needed
}
```

**Rule of thumb:** Use `requires transitive` when your exported API exposes types from the dependency — for example, method parameters, return types, or inherited types. The JDK itself uses this heavily: `java.se` transitively requires all platform modules so that code only needs to require `java.se` to access all standard APIs.

---

## `exports` vs `exports to`

Both directives control compile-time access to a package, but differ in scope.

### Unqualified `exports` — Open to All

Any named module can use the exported package.

```java
module com.example.library {
    exports com.example.library.api; // accessible to all modules
}
```

### Qualified `exports to` — Restricted to Named Modules

Only the listed modules can access the package at compile time.

```java
module com.example.library {
    exports com.example.library.internal
        to com.example.testing, com.example.tools;
}
```

This is common for:
- **Test infrastructure** that needs access to internal APIs without making them public.
- **Sister modules** in the same project that share internal contracts.
- **Framework integration** where only a known framework module should touch implementation details.

Modules not in the `to` list see the package as non-existent — they cannot import from it.

---

## `opens` vs `open module`

Both grant runtime reflective access, but at different granularities.

### `opens` — Package-Level Reflective Access

```java
module com.example.app {
    exports com.example.app.api;    // compile-time access
    opens   com.example.app.model;  // reflection-only access at runtime
}
```

- Other modules can call `Class.getDeclaredFields()`, `Method.setAccessible(true)`, etc. on types in `com.example.app.model`.
- Other modules **cannot** `import com.example.app.model.Entity` in source code (unless there is also an `exports` for that package).

### `opens to` — Restricted Reflective Access

```java
module com.example.app {
    opens com.example.app.model to org.hibernate.orm.core;
}
```

Only Hibernate's module can reflect into `com.example.app.model`. All other modules are denied `setAccessible(true)` on those types.

### `open module` — All Packages Open for Reflection

```java
open module com.example.app {
    requires spring.core;
    exports com.example.app.api;
}
```

Every package in the module is open for reflection. This is the migration path for application modules heavily reliant on annotation-driven frameworks. An `open module` cannot have individual `opens` directives — they are redundant.

---

## `uses` and `provides...with` — The ServiceLoader Pattern

Java's `ServiceLoader` is the standard way to discover implementations at runtime without compile-time dependencies on the implementation JAR.

### Consumer Side — `uses`

```java
module com.example.app {
    uses com.example.spi.MessageFormatter; // I will look up implementations
}
```

```java
// Inside the consuming module
ServiceLoader<MessageFormatter> loader =
    ServiceLoader.load(MessageFormatter.class);
for (MessageFormatter formatter : loader) {
    System.out.println(formatter.format("Hello"));
}
```

### Provider Side — `provides...with`

```java
module com.example.json.formatter {
    requires com.example.spi;
    provides com.example.spi.MessageFormatter
        with com.example.json.formatter.JsonMessageFormatter;
}
```

The implementation class `JsonMessageFormatter` must:
- implement or extend `MessageFormatter`
- have a no-argument constructor (or, as of Java 9+, a static `provider()` factory method)

### How They Work Together

```
Consumer module ─uses──> MessageFormatter interface
Provider module ─provides...with──> JsonMessageFormatter (implements MessageFormatter)

At runtime: ServiceLoader.load(MessageFormatter.class)
            discovers JsonMessageFormatter from the provider module
```

The consumer and provider modules never directly depend on each other. They are decoupled through the service interface. This is the foundation of plugin architectures in the JDK (JDBC drivers, cryptography providers, logging implementations).

---

## Summary of Directive Semantics

| Question | Directive |
|---|---|
| "I need to compile against module X" | `requires X` |
| "My API exposes types from X; callers need X too" | `requires transitive X` |
| "Any module may use my package at compile time" | `exports pkg` |
| "Only module A and B may use my package" | `exports pkg to A, B` |
| "Any module may reflect into my package" | `opens pkg` |
| "Only framework F may reflect into my package" | `opens pkg to F` |
| "I call ServiceLoader to find implementations of I" | `uses I` |
| "I provide implementation C of service interface I" | `provides I with C` |

---

## Key Points to Remember

- `requires transitive` grants implied readability — downstream consumers automatically read the transitive dependency without their own `requires` directive.
- `exports` is for compile-time visibility; `opens` is for runtime reflective access. A package can be exported, opened, both, or neither.
- Qualified forms (`exports to`, `opens to`) restrict access to a named list of modules.
- `open module` is a blanket statement: all packages are open for reflection. It cannot contain individual `opens` directives.
- `uses` and `provides...with` implement ServiceLoader-based plugin discovery without compile-time coupling between consumer and provider.

---

## References

- [JEP 261 — Module System](https://openjdk.org/jeps/261)
- [Oracle Docs — ServiceLoader](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/ServiceLoader.html)
- OCP Study Guide, Chapter 12 — Modules
