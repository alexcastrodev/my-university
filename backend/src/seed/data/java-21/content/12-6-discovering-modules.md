# Discovering Modules

> **OCP Exam Topic** — Use command-line tools to inspect, analyze, and package modules: `java --list-modules`, `java --describe-module`, `jdeps`, `jlink`, and understand the distinction between unnamed modules and automatic modules. Covered in Chapter 12 of *OCP Java SE 21 Developer Study Guide* (Selikoff & Boyarsky).

---

## `java --list-modules`

Lists all observable modules — both the platform modules that ship with the JDK and any modules on the module path.

```bash
# List all platform (JDK) modules
java --list-modules
```

Sample output (abbreviated):

```
java.base@21
java.compiler@21
java.desktop@21
java.logging@21
java.net.http@21
java.sql@21
java.xml@21
...
```

To include your own modules, add them to the module path:

```bash
java --module-path out --list-modules
```

---

## `java --describe-module`

Prints the full declaration of a single module: its `requires`, `exports`, `opens`, `uses`, and `provides` directives.

```bash
# Describe a platform module
java --describe-module java.sql
```

Sample output:

```
java.sql@21
requires java.logging transitive
requires java.transaction.xa transitive
requires java.xml transitive
exports java.sql
exports javax.sql
uses java.sql.Driver
```

Describe one of your own compiled modules:

```bash
java --module-path out --describe-module com.example.app
```

---

## `jdeps` — Dependency Analysis Tool

`jdeps` analyses class files and JARs to report their dependencies. It is invaluable for understanding what modules a legacy JAR needs before migrating it to the module system.

### Basic usage

```bash
# Analyse a JAR's dependencies
jdeps myapp.jar
```

### Module-summary mode

```bash
jdeps --module-path mods --module com.example.app
```

### Listing internal JDK API usages

```bash
jdeps --jdk-internals myapp.jar
```

Output highlights any use of `sun.*` or `com.sun.*` internal APIs that are now strongly encapsulated. This is critical for migrating pre-Java 9 code.

### Generating module-info suggestions

```bash
jdeps --generate-module-info ./generated-module-info myapp.jar
```

`jdeps` writes a candidate `module-info.java` for each JAR analysed, which you can use as a starting point when modularising a library.

---

## `jlink` — Custom Runtime Images

`jlink` assembles a minimal, self-contained Java runtime that includes only the modules your application actually needs.

```bash
jlink --module-path $JAVA_HOME/jmods:out \
      --add-modules com.example.app \
      --output myapp-runtime
```

The resulting `myapp-runtime/` directory contains:

```
myapp-runtime/
├── bin/
│   └── java          <- trimmed JVM executable
├── lib/
│   └── modules       <- only the required platform modules
└── ...
```

Run the application with the bundled runtime:

```bash
myapp-runtime/bin/java -m com.example.app/com.example.app.Main
```

Benefits:
- Smaller deployment footprint — no need to install a full JDK on the target machine.
- Faster startup — fewer modules to load.
- Improved security — unused JDK modules are not present to exploit.

---

## Unnamed Module

Code compiled or run from the **classpath** (not the module path) belongs to the **unnamed module**. The unnamed module:

- can read all named modules (it reads everything).
- is accessible to no named module (named modules cannot `requires` the unnamed module).
- exports all its packages to all other modules in the unnamed module.
- is a compatibility mechanism to keep legacy classpath code working alongside the module system.

```bash
# This code runs in the unnamed module
java -cp mylegacy.jar com.example.Main
```

The unnamed module allows existing applications to run on Java 9+ without modification, even if they use split packages or internal JDK APIs that are still accessible from the unnamed module via command-line flags.

---

## Automatic Modules

An **automatic module** is a plain JAR file — one without `module-info.class` — placed on the **module path** instead of the classpath.

```bash
java --module-path lib/guava-32.jar:out -m com.example.app/com.example.app.Main
```

The JVM derives the module name using this algorithm:

1. If the JAR's `MANIFEST.MF` contains `Automatic-Module-Name`, that value is used.
2. Otherwise, the module name is derived from the JAR filename by stripping the version suffix and replacing non-alphanumeric characters with dots.

Properties of automatic modules:

| Property | Behaviour |
|---|---|
| Module name | Derived from filename or `Automatic-Module-Name` manifest entry |
| `exports` | All packages are exported to all modules |
| `requires` | Reads all named modules and the unnamed module |
| `module-info.java` | None — it does not exist |

Automatic modules bridge the gap when you want to use a library that has not yet been modularised. Named modules can declare `requires` against automatic modules by name.

```java
module com.example.app {
    requires com.google.guava; // automatic module derived from guava-32.jar
}
```

---

## Unnamed vs Automatic Module Comparison

| Feature | Unnamed Module | Automatic Module |
|---|---|---|
| Location | Classpath (`-cp`) | Module path (`-p`) |
| Has a name | No | Yes (derived) |
| Named modules can `requires` it | No | Yes |
| Exports all packages | Yes (to unnamed module) | Yes (to all modules) |
| Reads all modules | Yes | Yes |
| Has `module-info` | No | No |

---

## Key Points to Remember

- `java --list-modules` lists observable modules; `java --describe-module <name>` prints a module's full declaration.
- `jdeps` analyses class-level dependencies, identifies internal JDK API usage, and can generate candidate `module-info.java` files.
- `jlink` builds a trimmed runtime image containing only the modules required by your application.
- The **unnamed module** represents all code on the classpath; it cannot be named as a dependency by any named module.
- An **automatic module** is a plain JAR on the module path; it exports all packages and reads all modules. Named modules can declare `requires` against it.

---

## References

- [jdeps Reference](https://docs.oracle.com/en/java/javase/21/docs/specs/man/jdeps.html)
- [jlink Reference](https://docs.oracle.com/en/java/javase/21/docs/specs/man/jlink.html)
- [JEP 261 — Module System](https://openjdk.org/jeps/261)
- OCP Study Guide, Chapter 12 — Modules
