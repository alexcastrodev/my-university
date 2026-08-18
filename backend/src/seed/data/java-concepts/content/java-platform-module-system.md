---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

Understand the Java Platform Module System (JPMS, JDK 9+): a **module** is a unit of packaging that sits above the package and below the classpath, declaring in a `module-info.java` file exactly which of its packages are exposed (`exports`) and which other modules it depends on (`requires`). Unlike the flat classpath — where `public` meant public to everyone, everywhere, and "this package is internal" was documentation plus hope — the compiler and the runtime actually **enforce** these boundaries: illegal access is a compile error, and illegal reflective access is a runtime exception.

## Use Cases

- Publishing a library whose public API package is reachable while its implementation packages are genuinely inaccessible to consumers, rather than merely discouraged by a `.internal.` naming convention.
- Declaring a machine-checked dependency graph between an application's own modules, so a missing dependency fails at compile time or at launch instead of surfacing as a `NoClassDefFoundError` in production.
- Running `jlink` to assemble a custom runtime image containing only the JDK modules an application actually uses — a real lever on container image size and startup time.
- Reading an `IllegalAccessError` or `InaccessibleObjectException` whose message mentions modules, and knowing it is an encapsulation decision talking, not a generic classpath mystery.

## Deep Dive

### module-info.java: the module declaration

A module is declared by a single `module-info.java` at the root of its source tree. It names the module and lists its directives:

```java
module com.example.orders {
    requires com.example.catalog;
    requires transitive java.sql;

    exports com.example.orders.api;

    opens com.example.orders.model to com.fasterxml.jackson.databind;

    uses com.example.orders.spi.PricingStrategy;
    provides com.example.orders.spi.PricingStrategy
        with com.example.orders.internal.DefaultPricingStrategy;
}
```

Nothing here is optional metadata: each directive changes what compiles and what runs.

### requires: a checked dependency

`requires` declares a dependency that holds at compile time *and* at run time. Without it, code in this module cannot reference a type from the other module at all — there is no lenient fallback:

```java
// in module com.example.orders, whose module-info.java omits `requires com.example.catalog;`
import com.example.catalog.Product;   // error: package com.example.catalog is not visible
                                      //   (package com.example.catalog is declared in module
                                      //    com.example.catalog, but module com.example.orders
                                      //    does not read it)
```

Every module implicitly requires `java.base`; everything else — including `java.sql`, `java.xml`, `java.desktop` — must be requested by name.

### requires transitive: passing a dependency along

`requires transitive M` says "anyone who requires *me* also reads M." This matters whenever a type from `M` appears in this module's own exported API:

```java
module com.example.orders {
    requires transitive java.sql;      // Connection leaks into the exported signature below
    exports com.example.orders.api;
}
```

```java
package com.example.orders.api;

import java.sql.Connection;

public interface OrderStore {
    void writeTo(Connection connection);   // consumers must be able to name Connection
}
```

With `transitive`, a consumer needs only `requires com.example.orders;`. Without it, every consumer would have to add a redundant `requires java.sql;` of their own just to call a method this module already handed them.

There is also `requires static M`, a dependency that is mandatory at compile time but optional at run time — the usual choice for annotation processors and optional integrations.

### exports: the actual enforcement

`exports` makes a package's `public` types readable by other modules. A package that is *not* exported is invisible outside the module even if every type and method in it is `public`:

```java
module com.example.orders {
    exports com.example.orders.api;
    // com.example.orders.internal is deliberately NOT exported
}
```

```java
// in another module
import com.example.orders.internal.DefaultPricingStrategy;
// error: package com.example.orders.internal is not visible
//   (package com.example.orders.internal is declared in module com.example.orders,
//    which does not export it)
```

This is the whole point of the system: `public` now means "public to the modules I chose", not "public to the world". A qualified form, `exports com.example.orders.internal to com.example.reporting;`, narrows the audience to specific named modules — useful for splitting one logical component across several modules without opening its internals to everyone.

### opens: reflective access, granted explicitly

`exports` grants compile-time access to public members. It does **not** grant deep reflection into private members. Frameworks that set private fields directly — Jackson, Hibernate, Spring — need `opens`:

```java
module com.example.orders {
    opens com.example.orders.model;                              // to every module
    opens com.example.orders.model to com.fasterxml.jackson.databind;  // or just to one
}
```

Without it, reflection that would have quietly worked on the classpath now fails at run time:

```java
Field f = Order.class.getDeclaredField("total");
f.setAccessible(true);
// java.lang.reflect.InaccessibleObjectException: Unable to make field
//   private java.math.BigDecimal com.example.orders.model.Order.total accessible:
//   module com.example.orders does not "opens com.example.orders.model" to unnamed module @1b6d3586
```

An `open module com.example.orders { ... }` opens every package at once — the blunt migration escape hatch. Note that `opens` and `exports` are independent: a package can be opened for reflection without being exported for `import`, which is exactly the right shape for a JPA entity or DTO package that a framework must introspect but callers should not compile against.

### uses / provides: ServiceLoader, compiler-checked

The module system absorbs the `ServiceLoader` pattern. `uses` declares that this module consumes a service interface; `provides X with Y` declares a concrete implementation:

```java
module com.example.orders {
    uses com.example.orders.spi.PricingStrategy;
    provides com.example.orders.spi.PricingStrategy
        with com.example.orders.internal.DefaultPricingStrategy;
}
```

```java
ServiceLoader<PricingStrategy> loader = ServiceLoader.load(PricingStrategy.class);
PricingStrategy strategy = loader.findFirst()
    .orElseThrow(() -> new IllegalStateException("No PricingStrategy on the module path"));
```

The provider class need not be exported — the module system wires it up itself. This replaces the old `META-INF/services/com.example.orders.spi.PricingStrategy` text file, whose contents no compiler ever validated, with a declaration the compiler checks (the provider must exist, be public, implement the service, and have a no-arg constructor or a static `provider()` method).

### Strong encapsulation and the singleton attack

This is the enforcement the [Singletons and Noninstantiable Utility Classes](/java-concepts/singleton-and-noninstantiable-classes) concept mentions in passing. The reflective "clone the singleton" attack —

```java
Constructor<Elvis> ctor = Elvis.class.getDeclaredConstructor();
ctor.setAccessible(true);
Elvis clone = ctor.newInstance();
```

— throws `InaccessibleObjectException` **only** when `Elvis` lives in a named module whose package has not been `opens`ed to the caller's module. That is a narrow condition, and it is not a security feature you can lean on: it is a side effect of a packaging decision the class's author made. The point worth carrying away is that encapsulation here is *opt-in via module boundaries*, which is precisely why the singleton concept concludes that the enum form (or an explicit constructor guard) is the real defense.

### The unnamed module

Code loaded from the classpath, with no `module-info.java`, lands in the **unnamed module**. Its rules are deliberately permissive so that pre-9 code keeps running:

- it reads every other module, and can use every package those modules export;
- no module can `requires` it, because it has no name to write;
- and the reflective protections above largely do not bite it the way they bite named modules.

That last point is the gap `singleton-and-noninstantiable-classes` calls out. It is also the reason the enforcement story feels theoretical to most Java developers: the overwhelming majority of application code — including most Spring Boot services in 2026 — still ships as plain JARs on the classpath, in the unnamed module, with no `module-info.java` anywhere in the build. JPMS adoption *inside the JDK* is total; adoption for application code has been slow and remains opt-in.

### Automatic modules: the migration bridge

A plain JAR with no `module-info.java` that is placed on the **module path** (rather than the classpath) becomes an **automatic module**. The runtime gives it a name and broad implicit permissions — it reads every other module, and it exports and opens all of its packages — so that real modules and un-modularized JARs can interoperate during migration:

```bash
java --module-path libs:mods --add-modules com.example.orders -m com.example.orders/com.example.orders.Main
```

The name comes from one of two places. If the JAR's manifest declares one, that wins:

```
Automatic-Module-Name: com.fasterxml.jackson.databind
```

This is the intentional, stable option, and the one a library maintainer should ship long before writing a real `module-info.java`. Otherwise the name is derived from the filename: drop the `.jar` extension, strip a trailing version suffix, and turn the remaining non-alphanumeric runs into dots — so `jackson-databind-2.17.0.jar` yields the module name `jackson.databind`. A derived name is a hazard, because it changes if the file is ever renamed and it can collide or be rejected outright (a filename that reduces to an invalid Java identifier simply fails to load as a module).

### jlink: a runtime with only what you need

Because the JDK itself is modularized, `jlink` can resolve an application's module graph and emit a runtime image holding only those modules:

```bash
jlink --module-path $JAVA_HOME/jmods:mods \
      --add-modules com.example.orders \
      --launcher orders=com.example.orders/com.example.orders.Main \
      --compress=zip-6 --no-header-files --no-man-pages \
      --output custom-runtime

./custom-runtime/bin/orders
```

The result runs without a separately installed JDK, and it is typically a fraction of the size of a full one. This is not a curiosity: it is a routine step in container builds where image size and cold-start time matter, and it is arguably the module system's most widely realized payoff.

## Trade-offs

- **Split packages are forbidden, and this genuinely breaks real dependency trees** — no two modules on the module path may contain the same package. When two libraries both ship classes under one package name (a common outcome of "extras" or "compat" JARs), the module graph refuses to resolve, and there is no clean workaround short of the offending libraries repackaging:

```
java.lang.module.ResolutionException: Modules lib.core and lib.extras export package com.example.util to module app
```

- **`opens` and strong encapsulation are in unresolved tension** — an ORM that sets private fields, or a serializer that walks every declared field, needs `opens` on exactly the packages you most wanted to encapsulate, and an `open module` declaration surrenders the guarantee wholesale:

```java
open module com.example.orders { }   // every package reflectively open to everyone
```

- **Adoption for application code has been slow, and pretending otherwise misleads** — the JDK is fully modularized, but most applications still run on the classpath in the unnamed module, where none of the enforcement applies. Treat JPMS as valuable for libraries and for `jlink`-based deployment first; a `module-info.java` in a typical Spring Boot service buys friction before it buys guarantees.
- **`requires transitive` is easy to get wrong in both directions** — omitting it forces every consumer to redundantly re-declare a dependency your own exported signatures already oblige them to have, while marking everything transitive leaks your internal dependency choices into their compile-time graph — the exact implementation leakage the module system exists to prevent. The rule that actually holds: make it transitive when, and only when, the dependency's types appear in your exported API.
- **Reflective failures move from compile time to run time** — a missing `requires` is caught by the compiler, but a missing `opens` is not; it surfaces the first time a framework touches the class, which may be well into startup or deep inside a request:

```java
f.setAccessible(true);   // InaccessibleObjectException — nothing flagged this at compile time
```

- **The command-line escape hatches make it easy to never actually modularize** — `--add-exports`, `--add-opens`, and `--add-modules` exist to unblock migration, but a build that accumulates a dozen of them has taken on permanent configuration in exchange for the encapsulation it was meant to gain:

```bash
java --add-opens java.base/java.lang=ALL-UNNAMED -jar app.jar
```

## Documentation Links

- [Understanding the Module System — Java SE developer guide](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/module-summary.html) — doc
- [JEP 261: Module System](https://openjdk.org/jeps/261) — doc
- [jlink — Java SE Tools Reference](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jlink.html) — doc
