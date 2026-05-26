# Updating Our Example for Multiple Modules

> **OCP Exam Topic** — Compile and run a multi-module Java application using `--module-source-path`, inter-module `requires` directives, and the module graph. Covered in Chapter 12 of *OCP Java SE 21 Developer Study Guide* (Selikoff & Boyarsky).

---

## Why Multiple Modules?

A real application rarely lives in a single module. You separate concerns into distinct modules — for example, one module for the API, another for the implementation, and a third for the entry point. Each module declares exactly which other modules it needs via `requires`, making dependencies explicit and verifiable at startup.

---

## Directory Structure for Multiple Modules

With multiple modules, each module gets its own subdirectory under the source root. The layout convention mirrors the single-module case, multiplied:

```
project/
├── src/
│   ├── com.example.api/
│   │   ├── module-info.java
│   │   └── com/example/api/
│   │       └── Greeter.java
│   ├── com.example.impl/
│   │   ├── module-info.java
│   │   └── com/example/impl/
│   │       └── FriendlyGreeter.java
│   └── com.example.app/
│       ├── module-info.java
│       └── com/example/app/
│           └── Main.java
└── out/
```

Each subdirectory under `src/` is a separate module. The directory name conventionally matches the module name declared in `module-info.java`.

---

## Declaring Inter-Module Dependencies

The `requires` directive tells the compiler and the JVM that one module depends on another.

```java
// src/com.example.api/module-info.java
module com.example.api {
    exports com.example.api;
}
```

```java
// src/com.example.impl/module-info.java
module com.example.impl {
    requires com.example.api;
    exports com.example.impl;
}
```

```java
// src/com.example.app/module-info.java
module com.example.app {
    requires com.example.api;
    requires com.example.impl;
}
```

Rules for `requires`:

- The named module must exist on the module path at compile time and at runtime.
- Circular dependencies between modules are not allowed — the module graph must be a directed acyclic graph.
- `java.base` is always implicitly required; you never need to write it explicitly.

---

## Source Files

```java
// src/com.example.api/com/example/api/Greeter.java
package com.example.api;

public interface Greeter {
    String greet(String name);
}
```

```java
// src/com.example.impl/com/example/impl/FriendlyGreeter.java
package com.example.impl;

import com.example.api.Greeter;

public class FriendlyGreeter implements Greeter {
    @Override
    public String greet(String name) {
        return "Hello, " + name + "! Have a great day.";
    }
}
```

```java
// src/com.example.app/com/example/app/Main.java
package com.example.app;

import com.example.api.Greeter;
import com.example.impl.FriendlyGreeter;

public class Main {
    public static void main(String[] args) {
        Greeter g = new FriendlyGreeter();
        System.out.println(g.greet("World"));
    }
}
```

---

## Compiling Multiple Modules Together

The `--module-source-path` flag tells `javac` where to find the source roots for all modules. The compiler resolves inter-module dependencies automatically from that path.

```bash
# Compile all modules in one invocation
javac --module-source-path src \
      -d out \
      $(find src -name "*.java")
```

Or compile specific modules explicitly:

```bash
javac --module-source-path src \
      -d out \
      src/com.example.api/module-info.java \
      src/com.example.api/com/example/api/Greeter.java \
      src/com.example.impl/module-info.java \
      src/com.example.impl/com/example/impl/FriendlyGreeter.java \
      src/com.example.app/module-info.java \
      src/com.example.app/com/example/app/Main.java
```

The output directory mirrors the source structure:

```
out/
├── com.example.api/
│   ├── module-info.class
│   └── com/example/api/Greeter.class
├── com.example.impl/
│   ├── module-info.class
│   └── com/example/impl/FriendlyGreeter.class
└── com.example.app/
    ├── module-info.class
    └── com/example/app/Main.class
```

---

## Running a Multi-Module Program

Point `--module-path` at the output directory containing all compiled modules and name the entry module with `-m`:

```bash
java --module-path out \
     --module com.example.app/com.example.app.Main
```

Short form:

```bash
java -p out -m com.example.app/com.example.app.Main
```

The JVM reads the module graph starting from `com.example.app`, resolves `com.example.api` and `com.example.impl`, and launches `Main`.

---

## The Module Graph

The module graph is the set of modules reachable from the root module(s), connected by `requires` edges. The JVM validates the graph at startup:

```
com.example.app ──requires──> com.example.api
com.example.app ──requires──> com.example.impl
com.example.impl ──requires──> com.example.api
```

If any required module is missing from the module path, the JVM throws an error before `main()` is called.

---

## Key Points to Remember

- Each module lives in its own directory under the shared source root.
- `requires <module-name>` declares a compile-time and runtime dependency on another module.
- `javac --module-source-path <root> -d <out>` compiles all modules in a single command.
- `java -p <out> -m <module>/<MainClass>` launches the application.
- The module graph must be a directed acyclic graph — circular dependencies are a compile-time error.
- Missing modules on the module path are detected at JVM startup, not at class-loading time.

---

## References

- [JEP 261 — Module System](https://openjdk.org/jeps/261)
- [javac — Module-Related Options](https://docs.oracle.com/en/java/javase/21/docs/specs/man/javac.html)
- OCP Study Guide, Chapter 12 — Modules
