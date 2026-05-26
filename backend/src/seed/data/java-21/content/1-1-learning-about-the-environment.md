# Learning About the Environment

> **OCP Exam Topic** — Understand the Java development and execution environment: JDK components, compilation, and execution flow. Covered in Chapter 1 of *OCP Java SE 21 Developer Study Guide* (Selikoff & Boyarsky).

---

## The Java Platform

Java code does not run directly on an operating system. Instead, it runs on the **Java Virtual Machine (JVM)**, a software layer that translates compiled bytecode into native machine instructions. This design is what makes Java portable: *write once, run anywhere*.

The two main distributions you need to know for the exam are:

| Distribution | Contains | Used For |
|---|---|---|
| **JDK** (Java Development Kit) | JVM + compiler (`javac`) + tools | Writing and compiling source code |
| **JRE** (Java Runtime Environment) | JVM only (no compiler) | Running pre-compiled programs |

> As of Java 11, Oracle no longer ships a standalone JRE. The JDK itself is used for both development and deployment.

---

## Compiling with javac

The `javac` command compiles `.java` source files into `.class` bytecode files.

```bash
# Compile a single file
javac HelloWorld.java

# Compile multiple files at once
javac HelloWorld.java Greeter.java

# Specify an output directory for .class files
javac -d out HelloWorld.java
```

The output `.class` file contains platform-independent **bytecode**, not native machine code.

### What javac Produces

```
HelloWorld.java  →  javac  →  HelloWorld.class
```

If the source file defines a `public class`, the filename must exactly match the class name (including capitalisation). A file named `HelloWorld.java` must declare `public class HelloWorld`.

---

## Running with java

The `java` command launches the JVM and executes a compiled class:

```bash
# Run a compiled class (no .class extension!)
java HelloWorld

# Pass arguments to the program
java HelloWorld Alice 42

# Run with a classpath
java -cp out HelloWorld
```

> The argument to `java` is the **class name**, not the filename. Do not include `.class`.

---

## The Classpath

The **classpath** tells the JVM where to look for `.class` files. It can be a directory, a JAR file, or a list of both.

```bash
# Single directory
java -cp out HelloWorld

# Multiple entries (colon on Unix/macOS, semicolon on Windows)
java -cp out:lib/utils.jar HelloWorld

# Using the CLASSPATH environment variable (not recommended for production)
export CLASSPATH=out:lib/utils.jar
java HelloWorld
```

### Common classpath flags

| Flag | Meaning |
|---|---|
| `-cp` | Short form of `-classpath` |
| `-classpath` | Full form |
| `--class-path` | Long GNU-style form (Java 9+) |

---

## Source Launcher (Java 11+)

Since Java 11, you can run a single-file program directly without an explicit compilation step:

```bash
# No prior javac needed
java HelloWorld.java
```

The JVM compiles the file in memory and executes it immediately. This mode is useful for scripts and learning but is **not** used in multi-file projects. The exam expects you to know both workflows.

---

## Java Versions and LTS

Java follows a **six-month release cadence**. Every three years a **Long-Term Support (LTS)** release is designated; Java 21 is an LTS release. The OCP exam tracks LTS versions, which is why this course targets Java 21.

```
Java 17 (LTS)  →  18  →  19  →  20  →  Java 21 (LTS)  →  22  →  ...
```

---

## Key Points to Remember

- The **JDK** contains both the compiler (`javac`) and the runtime (`java`); the JRE contains only the runtime.
- Source files end in `.java`; compiled bytecode files end in `.class`.
- The `java` command takes a **class name**, not a file path.
- The **classpath** (`-cp`) controls where the JVM looks for compiled classes.
- Java 11+ supports running a single `.java` file directly with `java FileName.java`.
- `null` is not a keyword you need here, but understanding that classes live on the heap matters from the very first lesson.
