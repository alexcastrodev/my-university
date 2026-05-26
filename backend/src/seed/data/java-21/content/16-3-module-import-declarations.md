# Module Import Declarations (JEP 511)

> Java 25 introduces a new `import module` syntax that imports all public types from every exported package of a named module in a single declaration. This lesson covers the syntax, semantics, how it differs from wildcard imports, and how it interacts with the module system.

---

## The Problem It Solves

In Java 21, importing types from a well-known module like `java.base` required either individual type imports or multiple wildcard imports:

```java
// Java 21 — many imports needed for common types
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.ArrayList;
import java.util.HashMap;
import java.io.IOException;
import java.io.BufferedReader;
// ... and more
```

Even with wildcard imports, you had to know which package each type lives in:

```java
import java.util.*;
import java.io.*;
import java.nio.file.*;
// ... still multiple lines
```

---

## The New Syntax (Java 25 / JEP 511)

A single **module import declaration** imports all public types from all exported packages of the named module:

```java
import module java.base;       // imports ALL public types from all java.base exports

import module java.sql;        // imports Connection, PreparedStatement, ResultSet, etc.
import module java.desktop;    // imports AWT/Swing types
```

After `import module java.base;`, the following types are available without further imports:

```java
// All of these are accessible with just: import module java.base;
List<String> list = new ArrayList<>();
Map<String, Integer> map = new HashMap<>();
Path p = Path.of("/tmp/data.txt");
Files.readAllLines(p);
Optional<String> opt = Optional.of("hello");
Instant now = Instant.now();
```

---

## Module Import vs Wildcard Import

| Feature | `import java.util.*` | `import module java.base` |
|---|---|---|
| Granularity | One package | Entire module (all exported packages) |
| Types covered | Only `java.util.*` | All packages exported by `java.base` |
| Ambiguity handling | Same as single-type | Same as single-type — specific import wins |
| Applies to unnamed module | Yes | Yes |

A module import is effectively shorthand for all the wildcard imports of every package the module exports:

```java
// import module java.base; is approximately equivalent to:
import java.lang.*;
import java.util.*;
import java.io.*;
import java.nio.*;
import java.nio.file.*;
import java.nio.charset.*;
import java.time.*;
// ... and dozens more packages
```

---

## Ambiguity Resolution

When a type name exists in multiple imported modules or packages, the same resolution rules as wildcard imports apply: a **specific single-type import wins**, and ambiguous simple names require disambiguation:

```java
import module java.base;
import module java.sql;

// java.util.Date vs java.sql.Date — AMBIGUOUS without specific import
Date d = new Date();  // compile error — which Date?

// Fix with a specific import (takes priority over module imports)
import java.util.Date;
Date d2 = new Date();  // OK — java.util.Date

// Or use the fully qualified name
java.sql.Date sqlDate = new java.sql.Date(System.currentTimeMillis());
```

---

## Module Imports and `module-info.java`

Module import declarations work in **both modular and non-modular** code:

### In non-modular code (classpath)
A `import module java.base;` in a regular `.java` file simply makes all `java.base` exported types available. No `module-info.java` is required.

```java
// Regular class on the classpath — no module-info.java needed
import module java.base;
import module java.sql;

public class DatabaseApp {
    public static void main(String[] args) throws Exception {
        Connection conn = DriverManager.getConnection("jdbc:h2:mem:test", "sa", "");
        // ...
    }
}
```

### In modular code (module-info.java)
The importing module must still **declare a `requires` dependency** on the module it imports. The `import module` declaration is syntactic sugar for imports — it does not replace `requires`:

```java
// module-info.java
module com.example.myapp {
    requires java.sql;    // still required — grants access
}
```

```java
// MyApp.java — inside the module
import module java.sql;  // import all exported types from java.sql

public class MyApp {
    Connection conn;     // java.sql.Connection — accessible because module requires java.sql
}
```

> **Exam tip:** `import module java.base;` alone does NOT establish a `requires` relationship. In modular programs, you still need `requires` in `module-info.java`.

---

## Common Modules and Their Key Exports

| Module | Key packages exported |
|---|---|
| `java.base` | `java.lang`, `java.util`, `java.io`, `java.nio.file`, `java.time`, `java.math` |
| `java.sql` | `java.sql`, `javax.sql` |
| `java.desktop` | `java.awt`, `javax.swing` |
| `java.net.http` | `java.net.http` |
| `java.logging` | `java.util.logging` |

---

## Key Rules Summary

- `import module ModuleName;` imports all public types from all packages exported by that module.
- It is coarser than a wildcard import (`import pkg.*`) — covers the entire module.
- Ambiguous simple names are resolved the same way as with wildcard imports: specific single-type imports take priority.
- In modular programs, `import module` is syntactic sugar for imports only — `requires` in `module-info.java` is still needed to grant access.
- In non-modular (classpath) programs, no `module-info.java` is required.
- `java.lang` is implicitly imported in every class; `import module java.base;` additionally covers all other `java.base` exports.

---

## References

- [JEP 511 — Module Import Declarations](https://openjdk.org/jeps/511)
- OCP Study Guide (Java 25 edition), Chapter 16 — What's New in Java 25
