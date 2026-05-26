# Module Import Declarations (JEP 511)

---

## Overview

**JEP 511**, finalised in Java 25, introduces **module import declarations**: a single `import` statement that imports all `public` top-level types from every package exported by a named module.

```java
import module java.base;
```

This one line replaces dozens of individual `import` statements for types such as `java.util.List`, `java.io.IOException`, `java.util.stream.Stream`, and so on.

---

## Syntax

```java
import module <module-name>;
```

The keyword pair `import module` is the new syntax. `module` acts as a contextual keyword here — it is only special inside an `import` statement.

```java
import module java.base;          // imports all exported packages of java.base
import module java.sql;           // imports javax.sql.*, java.sql.*
import module java.desktop;       // imports java.awt.*, javax.swing.*, …
```

Multiple module imports can appear together, alongside traditional imports:

```java
import module java.base;
import module java.sql;
import java.util.logging.Logger;  // traditional single-type import still works
```

---

## Comparison with Traditional Imports

| Form | Syntax | Imports |
|------|--------|---------|
| Single-type import | `import java.util.List;` | One type |
| On-demand import | `import java.util.*;` | All types in one package |
| Module import | `import module java.base;` | All exported types of the whole module |

Module imports have lower precedence than explicit single-type imports. An ambiguity between two module imports is resolved by adding an explicit single-type import.

---

## Resolving Ambiguity

If two imported modules export the same simple name, the compiler reports an ambiguity error only when that name is actually used without qualification:

```java
import module java.base;   // exports java.util.Date (via java.util)
import module java.sql;    // also exports java.sql.Date

Date d = new Date();       // compile error: ambiguous
```

Fix with a single-type import that takes precedence:

```java
import module java.base;
import module java.sql;
import java.sql.Date;      // resolves ambiguity — java.sql.Date wins

Date d = new Date();       // OK: java.sql.Date
```

---

## Practical Examples

### Before JEP 511

```java
import java.util.List;
import java.util.ArrayList;
import java.util.Map;
import java.util.HashMap;
import java.util.stream.Stream;
import java.util.stream.Collectors;
import java.util.function.Function;
import java.io.IOException;
import java.nio.file.Path;
import java.nio.file.Files;

public class DataPipeline {
    public static void main(String[] args) throws IOException {
        List<String> lines = Files.readAllLines(Path.of("data.txt"));
        Map<Integer, List<String>> grouped = lines.stream()
            .collect(Collectors.groupingBy(String::length));
    }
}
```

### After JEP 511

```java
import module java.base;

public class DataPipeline {
    public static void main(String[] args) throws IOException {
        List<String> lines = Files.readAllLines(Path.of("data.txt"));
        Map<Integer, List<String>> grouped = lines.stream()
            .collect(Collectors.groupingBy(String::length));
    }
}
```

---

## Module Imports in Unnamed / Implicit Classes

Module imports are especially useful in the context of unnamed classes (JEP 512) and simple programs:

```java
import module java.base;
import module java.desktop;

void main() {
    var frame = new JFrame("Hello");
    frame.setSize(400, 300);
    frame.setVisible(true);
}
```

---

## Scope and Resolution Rules

1. Module imports are resolved at compile time against the module graph.
2. A module import only imports **exported** packages of the named module — non-exported packages remain inaccessible.
3. Single-type imports (`import java.util.Date;`) always win over module imports when both provide the same simple name.
4. On-demand imports (`import java.util.*;`) also take precedence over module imports.
5. `import module java.base;` is implicitly added by the compiler when processing unnamed classes (implicit main programs).

> **Exam tip:** Module imports do **not** allow access to non-exported packages. They only bring exported public types into scope — the module system's encapsulation is fully respected.

---

## Key Points for the Exam

- Syntax: `import module <module-name>;`
- Imports all public types from all packages exported by the module.
- Does not bypass module system encapsulation — non-exported packages remain hidden.
- Ambiguities are resolved with an explicit single-type import.
- Single-type and on-demand package imports take precedence over module imports.
- `java.base` is implicitly module-imported for implicit classes (JEP 512).
- Finalised in Java 25 (previously a preview feature).

## References

- [JEP 511: Module Import Declarations](https://openjdk.org/jeps/511)
