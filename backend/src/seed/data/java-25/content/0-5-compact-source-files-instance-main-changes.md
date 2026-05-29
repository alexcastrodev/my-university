---
version: 1.0
updatedAt: 2026-05-28
---
# Compact Source Files & Instance Main — Delta from Java 21 to Java 25 (JEP 512)

> **JEP 512** — finalized in Java 25. See [openjdk.org/jeps/512](https://openjdk.org/jeps/512).

---

## What changed since Java 21

In Java 21 every runnable program required:

```java
public class Hello {
    public static void main(String[] args) {
        System.out.println("hi");
    }
}
```

In Java 25 the minimum runnable program is:

```java
void main() {
    IO.println("hi");
}
```

No `class`, no `public`, no `static`, no `String[] args`, no `System.out`. The feature went through four previews under three different names before finalization:

| Release | JEP | Name at the time | Status |
|---------|-----|------------------|--------|
| Java 21 | [445](https://openjdk.org/jeps/445) | Unnamed Classes & Instance Main Methods | First preview |
| Java 22 | [463](https://openjdk.org/jeps/463) | Implicitly Declared Classes & Instance Main Methods | Second preview |
| Java 23 | [477](https://openjdk.org/jeps/477) | Implicitly Declared Classes & Instance Main + auto `java.base` import | Third preview |
| Java 24 | [495](https://openjdk.org/jeps/495) | Simple Source Files & Instance Main Methods | Fourth preview |
| Java 25 | [512](https://openjdk.org/jeps/512) | **Compact Source Files** & Instance Main Methods + `IO` class | Final |

Notable deltas across iterations:

- **JEP 445 → 463**: the construct was renamed from "unnamed class" to "implicitly declared class". The implicit class is no longer anonymous from the runtime's perspective — it has a synthetic name derived from the file.
- **JEP 477**: the implicit class automatically imports `java.base`, removing the need to write `import java.util.List;` etc.
- **JEP 495**: renamed to "simple source file".
- **JEP 512**: final name "compact source file"; adds the `java.lang.IO` class with `println`, `print`, `readln`; specifies the auto-import in terms of `import module java.base;` (JEP 511).

The exam vocabulary for Java 25 is **compact source file** and **instance main method**.

---

## Compact source file rules

A compact source file is a `.java` file whose top level contains members but no `class`, `interface`, `record`, or `enum` declaration. The compiler synthesizes a `final` class with package-private access containing those members.

```java
// File: Greet.java
String name = "world";

void main() {
    IO.println("Hello, " + name);
}

String shout(String s) { return s.toUpperCase(); }
```

Constraints:

- No `package` declaration. The implicit class is in the unnamed package.
- A `main` method is required (instance or static).
- No subclasses can extend the implicit class; it is not nameable from other source files.
- `import` declarations are allowed and appear before the first top-level member.

---

## Instance main resolution order

When the JVM launches `Foo`, it looks for `main` in this order. The **first** match wins:

| Priority | Signature |
|----------|-----------|
| 1 | `static void main(String[] args)` |
| 2 | `static void main()` |
| 3 | `void main(String[] args)` (instance, requires a no-arg constructor) |
| 4 | `void main()` (instance, requires a no-arg constructor) |

The `public` modifier is **not required** at any priority. For instance `main`, the launcher constructs the enclosing class with its no-arg constructor and then invokes `main` on that instance. If the class has no accessible no-arg constructor, launch fails.

```java
// Mixed: a static and an instance main in the same compact source file
static void main(String[] args) { new Demo().run(args); }   // priority 1 — wins
void main()                     { run(new String[0]); }     // priority 4 — ignored
```

---

## Automatic import of java.base

A compact source file behaves as if `import module java.base;` (JEP 511) were the first import:

```java
// no imports written
void main() {
    var nums = List.of(1, 2, 3);           // java.util.List
    var sum  = nums.stream().mapToInt(Integer::intValue).sum();
    IO.println(sum);
}
```

The implicit import is added to compact source files only. Conventional source files (those with an explicit `class` declaration) still need explicit imports.

---

## The IO class

`java.lang.IO`, new in JEP 512, exposes three static methods:

```java
public final class IO {
    public static void println(Object obj);
    public static void print(Object obj);
    public static String readln(String prompt);
}
```

- `println(obj)` and `print(obj)` write `String.valueOf(obj)` to `System.out`.
- `readln(prompt)` writes the prompt to `System.out`, reads a line from `System.in`, and returns it (without the trailing newline). Returns `null` on EOF.
- `IO` is in `java.lang`, so no import is needed in any source file — not just compact ones.

```java
void main() {
    String n = IO.readln("Name? ");
    IO.println("Hello, " + n);
}
```

---

## Running source files directly

`java Foo.java` (JEP 330, Java 11) compiles in memory and runs. Compact source files build on this:

```bash
java Hello.java
```

Multi-file source-code programs (JEP 458, **finalized in Java 22**, not new in 25) allow one file to reference types declared in sibling files, which are compiled on demand:

```bash
java Main.java          # Main.java may reference helpers in Util.java in the same dir
```

The `--source` flag is still accepted for selecting a language level, but is no longer required for current-version source files:

```bash
java --source 25 Main.java
```

Compact source files and instance main methods are available without `--enable-preview` in Java 25.

---

## Exam-relevant rules

| Rule | Detail |
|------|--------|
| Terminology | "Compact source file" + "instance main method" (Java 25 final names) |
| Class declaration | Omitted; compiler synthesizes a package-private `final` class in the unnamed package |
| `main` resolution | static-with-args → static-no-args → instance-with-args → instance-no-args |
| `public` required? | No — any access modifier (including default) is allowed |
| Instance `main` requirement | An accessible no-arg constructor on the enclosing class |
| Auto-import | `java.base` is imported implicitly in compact source files only |
| `IO` location | `java.lang.IO` — no import needed, available everywhere |
| `IO` methods | `println(Object)`, `print(Object)`, `readln(String) → String` (null on EOF) |
| Preview flag | None required in Java 25 |
| Multi-file launch | Provided by JEP 458 (Java 22), not by JEP 512 |
| Allowed top-level forms | Fields, methods, nested types, imports; no `package`, no top-level `class` |

---

## See also

- [[7-5-compact-source-files-and-multi-file-programs]] — base course lesson on compact source files and multi-file launching.
- [[7-6-instance-main-methods]] — base course lesson on instance main resolution.
- JEP cross-reference: [JEP 458 — Launch Multi-File Source-Code Programs](https://openjdk.org/jeps/458).
