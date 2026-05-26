---
version: 1.0
updatedAt: 2026-05-26
---
# Migration to Modules: Unnamed and Automatic Modules

---

## Overview

Migrating a large legacy codebase to the Java Module System all at once is impractical. JPMS provides two compatibility mechanisms — the **unnamed module** and **automatic modules** — that allow gradual, incremental migration.

---

## The Unnamed Module

All code loaded from the **classpath** belongs to a single virtual module called the **unnamed module**. It has no name and no `module-info.java`.

| Property | Value |
|----------|-------|
| Name | None (referred to as "unnamed module") |
| How loaded | Via the classpath (`-classpath` / `-cp`) |
| Reads | All named modules (automatic and explicit) |
| Exports | All packages to all other modules |
| Can be `requires`-ed? | No — named modules cannot depend on the unnamed module |

```bash
# All JARs on the classpath belong to the unnamed module
java -cp app.jar:lib.jar com.example.Main
```

The unnamed module is a catch-all for legacy code. It reads every named module, so existing code continues to compile and run against the JDK modules.

> **Exam tip:** Named modules **cannot** `requires` the unnamed module. The dependency is one-way: the unnamed module reads named modules, but named modules cannot see the unnamed module.

---

## Automatic Modules

An **automatic module** is a regular JAR (without `module-info.class`) that is placed on the **module path** instead of the classpath. The JVM treats it as a named module with automatically derived properties.

| Property | How it is derived |
|----------|-----------------|
| Module name | From `Automatic-Module-Name` in `MANIFEST.MF`, or from the JAR filename |
| Exports | All packages (everything is exported) |
| Reads | All other modules on the module path + the unnamed module |
| Requires | Nothing explicitly — reads all via implied readability |

```bash
# guava-32.0.jar placed on module path becomes automatic module "guava"
java --module-path lib/guava-32.0.jar:out \
     -m com.example.app/com.example.app.Main
```

---

## Deriving the Module Name from the JAR Filename

When no `Automatic-Module-Name` manifest entry is present, the module name is derived from the JAR filename:

1. Strip the version suffix (e.g., `-32.0.1-jre`).
2. Replace any non-alphanumeric characters (except `.`) with `.`.
3. Collapse consecutive dots; strip leading and trailing dots.

| JAR Filename | Derived Module Name |
|-------------|-------------------|
| `guava-32.0.jar` | `guava` |
| `jackson-databind-2.15.2.jar` | `jackson.databind` |
| `commons-lang3-3.13.0.jar` | `commons.lang3` |
| `my_lib-1.0.jar` | `my.lib` |

> **Exam tip:** Set `Automatic-Module-Name` in the JAR manifest for a stable, predictable module name. Relying on filename-derived names is fragile when the version suffix changes.

---

## Classpath vs Module Path — Quick Comparison

| Aspect | Classpath | Module Path |
|--------|-----------|-------------|
| Module type | Unnamed module | Named or automatic modules |
| `module-info.java` required | No | No (automatic) or Yes (named) |
| Strong encapsulation | No | Yes (named modules) |
| Reads other modules | All named modules | Declared via `requires` |
| Exported packages | All | Declared via `exports` |

---

## Incremental Migration Strategy

A typical migration moves JARs one at a time from the classpath to the module path:

```
Step 1: Everything on classpath (unnamed module)
  java -cp a.jar:b.jar:c.jar com.Main

Step 2: Move one JAR to module path as automatic module
  java --module-path a.jar -cp b.jar:c.jar \
       --add-modules my.module.a com.Main

Step 3: Add module-info.java to a.jar (named module)
  java --module-path a.jar --module-path . \
       -m com.example.app/com.Main

Step 4: Repeat for b.jar and c.jar
```

---

## Escape Hatches: `--add-reads` and `--add-exports`

When a named module needs to access a package from the unnamed module, or from a non-exporting module, the JVM provides command-line overrides.

### `--add-reads`

Grants a module the ability to read another module (or the unnamed module) without a `requires` declaration:

```bash
# Allow com.example.app to read the unnamed module
java --add-reads com.example.app=ALL-UNNAMED \
     --module-path mods -m com.example.app/com.Main
```

### `--add-exports`

Opens a non-exported package to a specific module (or all unnamed code):

```bash
# Export an internal JDK package to com.example.app
java --add-exports java.base/sun.misc=com.example.app \
     --module-path mods -m com.example.app/com.Main

# Export to ALL-UNNAMED (any classpath code)
java --add-exports java.base/sun.misc=ALL-UNNAMED \
     -cp app.jar com.example.Main
```

### `--add-opens`

Like `--add-exports` but also allows deep reflection (same as `opens` in `module-info.java`):

```bash
java --add-opens java.base/java.lang=ALL-UNNAMED \
     -jar legacy-app.jar
```

| Flag | Purpose |
|------|---------|
| `--add-reads M=N` | Module M can read module N |
| `--add-exports M/pkg=N` | Module M exports `pkg` to N (compile-time + runtime) |
| `--add-opens M/pkg=N` | Module M opens `pkg` to N (reflection only) |
| Use `ALL-UNNAMED` | Targets all code on the classpath |

> **Exam tip:** These flags are **escape hatches** for migration, not a permanent solution. Production code should eventually encode dependencies in `module-info.java`.

---

## `jdeps` — Analysing Dependencies

`jdeps` helps identify which modules a JAR depends on, a useful first step before adding `module-info.java`:

```bash
# Show module dependencies of a JAR
jdeps --module-path mods myapp.jar

# Generate a module-info.java candidate
jdeps --generate-module-info out myapp.jar

# Check if a JAR uses internal JDK APIs
jdeps --jdk-internals myapp.jar
```

---

## Key Points for the Exam

- The unnamed module contains all classpath code; it reads all named modules but cannot be named in a `requires`.
- Automatic modules are classpath JARs placed on the module path; they export all packages and read everything.
- Automatic module name comes from `Automatic-Module-Name` manifest entry or is derived from the JAR filename.
- `--add-reads`, `--add-exports`, `--add-opens` are command-line overrides for incremental migration.
- `ALL-UNNAMED` is a special target meaning "all classpath code."
- `jdeps` helps analyse dependencies and generate `module-info.java` candidates.

## References

- [JEP 261: Module System — Compatibility](https://openjdk.org/jeps/261)
- [Oracle Docs — jdeps Tool (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jdeps.html)
