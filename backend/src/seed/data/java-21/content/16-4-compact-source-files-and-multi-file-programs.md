# Compact Source Files and Multi-File Programs (JEP 512)

> Java 25 finalizes the ability to launch Java programs directly from source files without an explicit compilation step. It also introduces "implicit class" files that allow top-level methods and fields outside any named class. This lesson covers the mechanics, the automatic imports, and multi-file execution.

---

## The Java 21 Baseline

In Java 21, running a Java program always required:
1. Writing a class with a `public static void main(String[] args)` method
2. Compiling with `javac`
3. Running with `java`

```java
// Java 21 — HelloWorld.java
public class HelloWorld {
    public static void main(String[] args) {
        System.out.println("Hello, World!");
    }
}
```

```sh
javac HelloWorld.java
java HelloWorld
```

This ceremony made Java unapproachable for quick scripts and introductory learning.

---

## Compact Source Files — Running Without `javac` (JEP 512)

Java 25 allows running a single `.java` file directly. The compiler is invoked implicitly:

```sh
java HelloWorld.java
```

The file can contain a traditional class with `main`, or an **implicit class** — a file with top-level methods and fields that does not declare a named class:

```java
// Hello.java — implicit class (no class declaration needed)
void main() {
    System.out.println("Hello from an implicit class!");
}
```

```sh
java Hello.java   // works directly in Java 25
```

---

## Implicit Classes

An **implicit class** is a `.java` source file where the top-level code is not wrapped in an explicit `class { }` declaration. The compiler synthesizes an unnamed class around the file's contents:

```java
// Greeting.java — implicit class with multiple methods
import java.util.List;

List<String> names = List.of("Alice", "Bob", "Carol");

void main() {
    names.forEach(this::greet);
}

void greet(String name) {
    System.out.println("Hello, " + name + "!");
}
```

Rules for implicit classes:
- The file must contain at least one method named `main` (the entry point).
- Top-level fields and methods are allowed — they become members of the synthesized class.
- The implicit class cannot be referenced by other classes (it has no accessible name).
- No `package` declaration is allowed in an implicit class file.

---

## Automatic Imports in Compact Programs

Implicit classes receive a set of **automatic imports** without any explicit `import` declarations:

```java
// These are automatically available in implicit class files:
// java.io.*
// java.math.*
// java.net.*
// java.net.http.*
// java.nio.file.*
// java.util.*
// java.util.concurrent.*
// java.util.function.*
// java.util.regex.*
// java.util.stream.*
```

This means common classes like `List`, `Map`, `Path`, `Files`, `Stream`, `Optional`, and `HttpClient` are available without explicit imports:

```java
// Implicit class — no imports needed for common types
void main() {
    var names = List.of("Alice", "Bob");           // java.util.List
    var path  = Path.of("/tmp/data.txt");           // java.nio.file.Path
    var lines = Files.readAllLines(path);           // java.nio.file.Files
    names.stream()
         .filter(n -> n.startsWith("A"))
         .forEach(System.out::println);
}
```

> **Exam tip:** Automatic imports apply only to implicit class files. Regular classes with explicit `class` declarations do not get them.

---

## Multi-File Programs

Java 25 also supports launching a **multi-file program** from a single command. The main source file is specified first; the compiler finds additional source files automatically:

```sh
# Compile and run starting from Main.java, which uses Helper.java
java --source 25 Main.java
```

Or with the `sources` launcher feature:

```sh
java sources Main.java
```

Dependencies within the source tree are resolved by the launcher. This is aimed at scripts and learning environments, not large production applications.

---

## Traditional Class in a Single-File Launch

The single-file launch also works with traditional classes — the class name does not have to match the file name when running directly (it must for `javac`):

```java
// Greet.java
class Greet {
    public static void main(String[] args) {
        System.out.println("Hello, " + (args.length > 0 ? args[0] : "World"));
    }
}
```

```sh
java Greet.java Alice    # passes "Alice" as args[0]
```

---

## Use Cases

| Scenario | Approach |
|---|---|
| Quick script or one-off task | Implicit class, run with `java Script.java` |
| Educational / introductory code | Implicit class — minimal ceremony |
| Command-line tool | Compact source file with `main()` |
| Production application | Traditional class + `javac` (unchanged) |
| Build pipelines | Traditional toolchain (Maven, Gradle) — unchanged |

---

## Comparison: Java 21 vs Java 25

```java
// Java 21 — required full class
public class PrintArgs {
    public static void main(String[] args) {
        for (String arg : args) {
            System.out.println(arg);
        }
    }
}
// Command: javac PrintArgs.java && java PrintArgs a b c

// Java 25 — implicit class
void main() {
    for (String arg : args) {     // 'args' available via instance main (JEP 495)
        System.out.println(arg);
    }
}
// Command: java PrintArgs.java a b c
```

---

## Key Rules Summary

- Java 25 (JEP 512) allows running `.java` files directly with `java FileName.java` — no `javac` step needed.
- **Implicit class**: a `.java` file with top-level methods/fields and no explicit class declaration.
- Implicit classes have a synthesized unnamed class — they cannot be referenced by name from other classes.
- Automatic imports (common `java.*` packages) are active in implicit class files.
- Multi-file programs: the launcher can resolve dependencies across source files.
- Production applications still use the traditional `javac` + `java` workflow.

---

## References

- [JEP 512 — Compact Source Files and Multi-File Programs](https://openjdk.org/jeps/512)
- OCP Study Guide (Java 25 edition), Chapter 16 — What's New in Java 25
