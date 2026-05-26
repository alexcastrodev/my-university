---
version: 1.0
updatedAt: 2026-05-26
---
# Creating Modular and Non-modular JARs and Runtime Images

---

## Overview

Java provides two command-line tools for packaging and distribution:

| Tool | Purpose |
|------|---------|
| `jar` | Creates JAR archives (standard, executable, or modular) |
| `jlink` | Creates a minimal, self-contained runtime image |

---

## The `jar` Tool — Key Flags

| Flag | Short | Description |
|------|-------|-------------|
| `--create` | `-c` | Create a new JAR |
| `--extract` | `-x` | Extract files from a JAR |
| `--list` | `-t` | List contents of a JAR |
| `--update` | `-u` | Update an existing JAR |
| `--file=<file>` | `-f <file>` | Specifies the JAR filename |
| `--main-class=<class>` | `-e <class>` | Sets the entry-point class (executable JAR) |
| `--verbose` | `-v` | Verbose output |
| `--module-version=<ver>` | | Sets the module version |
| `--describe-module` | `-d` | Prints the module descriptor of a modular JAR |

---

## Creating a Standard (Non-modular) JAR

```bash
# Compile
javac -d out/classes src/com/example/app/*.java

# Package
jar --create --file=app.jar --verbose -C out/classes .
```

The `-C out/classes .` changes into `out/classes` and adds all files from there.

---

## Creating an Executable JAR

An executable JAR specifies the main class in its `MANIFEST.MF` via `--main-class`:

```bash
jar --create \
    --file=app.jar \
    --main-class=com.example.app.Main \
    -C out/classes .

# Run
java -jar app.jar
```

> **Exam tip:** `--main-class` sets the `Main-Class:` attribute in `META-INF/MANIFEST.MF`. Without it, `java -jar app.jar` throws a `no main manifest attribute` error.

---

## Creating a Modular JAR

A **modular JAR** is a JAR that contains `module-info.class` at its root. It can be placed on the module path.

```bash
# Compile (includes module-info.java)
javac -d out/com.example.app \
      --module-source-path src \
      $(find src -name "*.java")

# Package — module-info.class is included automatically
jar --create \
    --file=mods/com.example.app.jar \
    --main-class=com.example.app.Main \
    --module-version=1.0 \
    -C out/com.example.app .

# Describe the module
jar --describe-module --file=mods/com.example.app.jar
```

---

## Running with Module Path

```bash
# Run a modular JAR
java --module-path mods \
     --module com.example.app/com.example.app.Main

# Shorthand
java -p mods -m com.example.app/com.example.app.Main

# If the JAR has Main-Class set, the main class can be omitted
java -p mods -m com.example.app
```

| Flag | Description |
|------|-------------|
| `--module-path` / `-p` | Directory or JAR list for named modules |
| `--module` / `-m` | Module to launch, optionally with main class |
| `--add-modules` | Add extra root modules (e.g., `--add-modules ALL-MODULE-PATH`) |

---

## The `jlink` Tool

`jlink` assembles a minimal JRE that contains only the modules your application needs. The resulting image includes the JVM, selected platform modules, and your application modules.

```bash
jlink \
  --module-path $JAVA_HOME/jmods:mods \
  --add-modules com.example.app \
  --output dist/my-app-runtime \
  --launcher run=com.example.app/com.example.app.Main \
  --compress=2 \
  --no-header-files \
  --no-man-pages
```

### Key `jlink` Flags

| Flag | Description |
|------|-------------|
| `--module-path` | Path to platform `.jmod` files and application modules |
| `--add-modules` | Root modules to include (transitive dependencies resolved automatically) |
| `--output` | Output directory for the runtime image |
| `--launcher <name>=<module>/<main>` | Creates a launch script in `<output>/bin/` |
| `--compress=<0|1|2>` | Compression: 0=none, 1=strings, 2=ZIP |
| `--no-header-files` | Exclude C header files (reduces size) |
| `--no-man-pages` | Exclude man pages (reduces size) |
| `--strip-debug` | Remove debug information from classes and native libs |

---

## Running the Custom Runtime Image

```bash
# The launcher script is placed in dist/my-app-runtime/bin/
./dist/my-app-runtime/bin/run

# Or use the java binary directly
./dist/my-app-runtime/bin/java \
    -m com.example.app/com.example.app.Main
```

The generated image has no dependency on any installed JDK or JRE.

---

## `jmod` Files

The JDK ships with `.jmod` files (in `$JAVA_HOME/jmods/`). These are not regular JARs; they are used exclusively at link time by `jlink`.

```bash
# List contents of a jmod file
jmod list $JAVA_HOME/jmods/java.base.jmod
```

---

## Typical Workflow Summary

```
src/                     javac                 out/
  module-info.java  ─────────────────────>  module-info.class
  com/example/...                           com/example/...
                                                 │
                           jar                   │
  out/  ────────────────────────────────>  mods/app.jar
                                                 │
                          jlink                  │
  mods/ + $JAVA_HOME/jmods ──────────────>  dist/my-app-runtime/
```

---

## Key Points for the Exam

- A modular JAR contains `module-info.class` at the root and is placed on the `--module-path`.
- `--main-class` / `-e` sets `Main-Class` in `MANIFEST.MF`; needed for `java -jar`.
- `jlink` produces a self-contained runtime image; requires all modules to be named (no classpath JARs in the image).
- `--add-modules` includes root modules; `jlink` resolves all transitive dependencies automatically.
- `.jmod` files are only for `jlink`; applications do not use them at runtime.
- `-p` is short for `--module-path`; `-m` is short for `--module`.

## References

- [Oracle Docs — jar Tool (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jar.html)
- [Oracle Docs — jlink Tool (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jlink.html)
