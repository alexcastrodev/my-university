---
version: 1.0
updatedAt: 2026-05-26
---
# Compact Source Files and Multi-File Programs (JEP 512)

---

## Overview

**JEP 512**, finalised in Java 25, introduces two related capabilities:

1. **Unnamed classes** — A source file can contain methods and fields directly, without an enclosing class declaration.
2. **Multi-file source-code programs** — `java Prog.java` can now span multiple source files loaded from the same directory, without an explicit compile step.

The goal is to reduce ceremony for small programs, scripts, and learning exercises while keeping the full Java language available.

---

## Unnamed Classes (Implicit Classes)

A source file without a `class` declaration is called an **unnamed class** (or implicit class). The compiler synthesises an enclosing class automatically.

### Traditional "Hello, World"

```java
public class Hello {
    public static void main(String[] args) {
        System.out.println("Hello, World!");
    }
}
```

### With JEP 512

```java
void main() {
    System.out.println("Hello, World!");
}
```

No class declaration, no `public`, no `static`, no `String[] args`. This is valid Java 25.

---

## Rules for Unnamed Classes

| Rule | Detail |
|------|--------|
| Must have a `main` method | The entry point is `void main()` (instance or static) |
| No package declaration allowed | Unnamed classes belong to the unnamed package |
| Can contain fields and methods | Top-level field/method declarations are synthesised into the class |
| Can `import` | Both traditional and module imports work |
| `java.base` implicitly imported | `import module java.base;` is added automatically |
| Cannot be referenced by name | No other class can instantiate or extend it |
| Cannot have constructors | No explicit constructor — uses default |

---

## Fields and Methods in an Unnamed Class

```java
import module java.base;

String greeting = "Hello";   // instance field

String buildMessage(String name) {
    return greeting + ", " + name + "!";
}

void main() {
    System.out.println(buildMessage("World"));
    System.out.println(buildMessage("Java 25"));
}
```

---

## Launching Source-Code Programs

```bash
# Run a single source file directly (no javac needed)
java Hello.java

# Pass arguments
java Hello.java Alice Bob
```

The `java` launcher compiles the file in memory and executes it. This is different from `javac` + `java` — no `.class` file is written to disk.

---

## Multi-File Source-Code Programs

In Java 25, `java Prog.java` can reference types defined in other `.java` files **in the same directory**. The launcher compiles them all together automatically.

```
project/
├── Main.java
├── Greeter.java
└── Formatter.java
```

```java
// Greeter.java
class Greeter {
    String greet(String name) {
        return "Hello, " + name;
    }
}
```

```java
// Formatter.java
class Formatter {
    String format(String msg) {
        return "[" + msg.toUpperCase() + "]";
    }
}
```

```java
// Main.java — the entry-point file passed to java
void main() {
    var g = new Greeter();
    var f = new Formatter();
    System.out.println(f.format(g.greet("World")));
}
```

```bash
java Main.java
# Output: [HELLO, WORLD]
```

> **Exam tip:** Only the file named on the command line needs to be a valid entry point. The other files in the directory are compiled as supporting classes and do not need a `main` method.

---

## Comparison: Traditional vs JEP 512

| Aspect | Traditional | JEP 512 |
|--------|------------|---------|
| Requires `class` declaration | Yes | No (for unnamed classes) |
| Explicit `javac` step | Yes | No — `java Prog.java` compiles and runs |
| `main` must be `public static` | Yes (pre-JEP 463/495) | No — instance `main()` suffices |
| Multi-file support | Yes (with `javac`) | Yes — same directory, auto-discovered |
| Output `.class` files | Yes | No — in-memory compilation only |
| Suitable for production | Yes | Not recommended — use `javac` for production |

---

## Restrictions

- Unnamed classes cannot have a package statement.
- The unnamed class cannot be referenced from other classes.
- The launcher's multi-file support only scans the **same directory** as the entry-point file.
- Standard module-path and classpath flags still apply when running with `java`.

---

## Key Points for the Exam

- An unnamed class is a source file with top-level method/field declarations but no `class` statement.
- `import module java.base;` is automatically applied to unnamed classes.
- `java Prog.java` compiles and runs without a separate `javac` step; no `.class` files are written.
- Multi-file programs: additional `.java` files in the same directory are compiled automatically.
- Unnamed classes have no package, cannot be named, and cannot be subclassed.
- Finalised in Java 25 (previewed in earlier releases as JEP 445, 463, 477, 495).

## References

- [JEP 512: Compact Source Files and Instance Main Methods](https://openjdk.org/jeps/512)
