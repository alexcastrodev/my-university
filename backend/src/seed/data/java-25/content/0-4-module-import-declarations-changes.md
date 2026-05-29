---
version: 1.0
updatedAt: 2026-05-28
---
# Module Import Declarations — Delta from Java 21 to Java 25 (JEP 511)

> **JEP 511** — finalized in Java 25. See [openjdk.org/jeps/511](https://openjdk.org/jeps/511).

---

## What changed since Java 21

Java 21 had no `import module` form. An import declaration could name a single type, a package (`pkg.*`), a static member, or a static member set; nothing more. Java 25 adds a fourth shape:

```java
import module <module-name>;
```

Preview history:

| Release | JEP | Status |
|---------|-----|--------|
| Java 23 | [476](https://openjdk.org/jeps/476) | First preview |
| Java 24 | [494](https://openjdk.org/jeps/494) | Second preview |
| Java 25 | [511](https://openjdk.org/jeps/511) | Final |

Between previews:

- JEP 476 required the compilation unit to be **in a named module** to use `import module`. JEP 494 lifted that restriction so unnamed-module / classpath code can also use it, and JEP 511 keeps that relaxation. The exam answer in 25 is: **`import module` works everywhere, including classpath code and compact source files.**
- The grammar uses the contextual keyword `module` inside `import`; `module` is still a valid identifier elsewhere. This was true in every preview and remains true in 25.

---

## What it does

`import module M;` is shorthand for *on-demand imports of every package exported unqualifiedly by `M`, and recursively by every module `M` reads via `requires transitive`*.

```java
// One line; no java.util, java.io, java.nio etc.
import module java.base;

void main() {
    var list = List.of(1, 2, 3);                  // java.util.List
    var path = Path.of("README.md");              // java.nio.file.Path
    var stream = Stream.of("a","b").toList();     // java.util.stream.Stream
}
```

Transitive re-export is the key delta from a wildcard package import. Consider:

```text
module M { requires transitive N; exports p; }
module N { exports q; }
```

`import module M;` imports both `p.*` (from M) **and** `q.*` (from N, because M requires it transitively). A regular `import M.p.*;` would import only `p`.

Qualified exports (`exports p to X;`) are imported only if the importing module is `X`.

---

## Interaction with other import forms

Module imports coexist with single-type and on-demand imports:

```java
import module java.base;          // bulk
import java.util.logging.Logger;  // single-type
import static java.lang.Math.PI;  // static member
import java.sql.*;                // on-demand
```

Resolution precedence for an unqualified type name `T` follows the JLS ordering:

1. Single-type imports of `T`.
2. Types declared in the current compilation unit.
3. Type-import-on-demand declarations **and** module imports (treated together).
4. Types in `java.lang`.

So a `import module java.base;` does **not** shadow an explicit `import com.example.List;`. Step 3 lumps wildcard package imports and module imports together for ambiguity purposes.

---

## Ambiguity rules

If two on-demand or module imports both bring in a type with the same simple name, the reference is ambiguous and the compiler issues an error.

```java
import module java.desktop;     // brings java.awt.List
import module java.base;        // brings java.util.List

List l = null;                  // ERROR: reference to List is ambiguous
```

Resolve with a single-type import (which takes precedence):

```java
import module java.desktop;
import module java.base;
import java.util.List;          // wins
```

Or fully qualify the offender at the use site.

---

## Use in non-modular code

Compilation units in the unnamed module (classpath code) can use `import module M;` provided the module `M` is observable on the module path or in the upgrade/system modules. The set of imported types is computed from `M`'s declared `exports` and its transitive reads, exactly as in modular code.

---

## Composition with compact source files (JEP 512)

A compact source file (no `class`, no package) automatically imports `java.base` as if `import module java.base;` were written. JEP 512 specifies this implicit module import in terms of JEP 511.

```java
// File: Hello.java — runs with `java Hello.java`
void main() {
    var names = List.of("Ada", "Linus");   // java.util.List, no explicit import
    IO.println(names);                      // java.lang.IO (JEP 512)
}
```

Adding an explicit `import module java.sql;` at the top still works; the implicit `import module java.base;` is not weakened.

---

## Exam-relevant rules

| Rule | Detail |
|------|--------|
| Syntax | `import module <module-name>;` — no wildcards, no static form |
| Imports brought in | Every package `M` exports unqualifiedly, plus recursively those of every `requires transitive` module |
| Qualified exports | `exports p to X` is imported only when the importer is `X` |
| Allowed locations | Any compilation unit, in a named module or on the classpath |
| Coexistence | Mixes freely with single-type, on-demand, and static imports |
| Ambiguity | Two module/on-demand imports of the same simple name ⇒ compile error unless a single-type import disambiguates |
| Precedence vs `import pkg.*` | Same precedence tier (JLS §7.5.3 / §7.5.4) |
| Implicit in compact source files | `import module java.base;` is automatic (JEP 512) |
| `module` keyword | Contextual — usable as an identifier outside `import` |

---

## See also

- [[7-3-module-import-declarations]] — base course lesson on module imports.
- JLS: [§7.5 Import Declarations, Java SE 25](https://docs.oracle.com/javase/specs/jls/se25/html/jls-7.html).
