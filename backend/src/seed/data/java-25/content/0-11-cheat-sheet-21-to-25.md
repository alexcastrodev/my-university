---
version: 1.0
updatedAt: 2026-05-28
---
# Quick Reference: Java 21 to 25 Cheat Sheet

> One-page reference for the OCP 1Z0-831 upgrade. Tables, snippets, links. Minimal prose. Use after working through lessons [[0-1-overview-21-to-25-roadmap]] through [[0-10-runtime-performance-changes]].

---

## 1. Finalized JEPs, Java 22 to 25

| JEP | Title | Final in | One-line description | Link |
|-----|-------|----------|----------------------|------|
| 423 | Region Pinning for G1 | 22 | G1 pins individual regions instead of disabling GC during JNI critical sections | <https://openjdk.org/jeps/423> |
| 454 | Foreign Function & Memory API | 22 | Final pure-Java replacement for JNI and `sun.misc.Unsafe` | <https://openjdk.org/jeps/454> |
| 456 | Unnamed Variables and Patterns | 22 | `_` placeholder for unused locals, parameters, and pattern components | <https://openjdk.org/jeps/456> |
| 458 | Launch Multi-File Source-Code Programs | 22 | `java Foo.java` can resolve other `.java` files in the same directory | <https://openjdk.org/jeps/458> |
| 467 | Markdown Documentation Comments | 23 | `///` markdown javadoc alongside the classic `/** */` form | <https://openjdk.org/jeps/467> |
| 471 | Deprecate `sun.misc.Unsafe` memory-access | 23 | Memory-access methods on `Unsafe` deprecated for removal | <https://openjdk.org/jeps/471> |
| 474 | ZGC Generational Mode by Default | 23 | `-XX:+UseZGC` is now generational by default | <https://openjdk.org/jeps/474> |
| 483 | Ahead-of-Time Class Loading and Linking | 24 | AOT cache for faster startup | <https://openjdk.org/jeps/483> |
| 486 | `SecurityManager` permanent disablement | 24 | `setSecurityManager` throws unless `-Djava.security.manager=allow` | <https://openjdk.org/jeps/486> |
| 491 | Synchronize Virtual Threads without Pinning | 24 | `synchronized` no longer pins virtual threads to their carriers | <https://openjdk.org/jeps/491> |
| 485 | Stream Gatherers | 25 | `Stream.gather(Gatherer)` plus the `Gatherers` API | <https://openjdk.org/jeps/485> |
| 506 | Scoped Values | 25 | Immutable, dynamic-scoped alternative to `ThreadLocal` | <https://openjdk.org/jeps/506> |
| 511 | Module Import Declarations | 25 | `import module M;` brings every exported package of module `M` into scope | <https://openjdk.org/jeps/511> |
| 512 | Compact Source Files and Instance Main Methods | 25 | Top-level `void main()` in a class-less source file, with `java.lang.IO` | <https://openjdk.org/jeps/512> |
| 513 | Flexible Constructor Bodies | 25 | Statements allowed before `super(...)` / `this(...)` (the prologue) | <https://openjdk.org/jeps/513> |
| 514 | Ahead-of-Time Command-Line Ergonomics | 25 | One-step `-XX:AOTCacheOutput=...` flag | <https://openjdk.org/jeps/514> |
| 519 | Compact Object Headers | 25 | 8-byte object headers on 64-bit (experimental, opt-in) | <https://openjdk.org/jeps/519> |

---

## 2. Syntax Delta — Java 21 vs Java 25

### Ignoring an unused variable

| Java 21 | Java 25 |
|---------|---------|
| `try { ... } catch (IOException e) { log(); }` (compiler warns "unused `e`") | `try { ... } catch (IOException _) { log(); }` |
| `for (var entry : map.entrySet()) { count++; }` | `for (var _ : map.entrySet()) { count++; }` |
| `case Point p -> draw();` (warning) | `case Point _ -> draw();` |

### Entry point

```java
// Java 21
public class Hello {
    public static void main(String[] args) {
        System.out.println("Hi");
    }
}
```

```java
// Java 25 — compact source file (Hello.java)
void main() {
    IO.println("Hi");
}
```

### Constructor prologue

```java
// Java 21 — must call super first, no statements before it
class Rect extends Shape {
    Rect(int w, int h) {
        super(w * h);                   // first statement, no choice
    }
}
```

```java
// Java 25 — validation before super is allowed
class Rect extends Shape {
    Rect(int w, int h) {
        if (w <= 0 || h <= 0)
            throw new IllegalArgumentException();
        super(w * h);                   // still no `this` access before super
    }
}
```

### Imports

```java
// Java 21
import java.util.List;
import java.util.Map;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.stream.Stream;
import java.util.stream.Collectors;
```

```java
// Java 25
import module java.base;               // every exported package of java.base
```

### Stream windowing

```java
// Java 21 — manual batching with a Collector
List<List<Integer>> batches = Stream.of(1, 2, 3, 4, 5, 6, 7)
    .collect(Collectors.collectingAndThen(
        Collectors.toList(),
        list -> IntStream.range(0, (list.size() + 2) / 3)
                         .mapToObj(i -> list.subList(i * 3, Math.min((i + 1) * 3, list.size())))
                         .toList()));
```

```java
// Java 25 — gather()
List<List<Integer>> batches = Stream.of(1, 2, 3, 4, 5, 6, 7)
    .gather(Gatherers.windowFixed(3))
    .toList();
```

### Per-request context propagation

```java
// Java 21 — ThreadLocal
static final ThreadLocal<String> USER = new ThreadLocal<>();

USER.set("alice");
try {
    handleRequest();
} finally {
    USER.remove();                      // easy to forget
}
```

```java
// Java 25 — ScopedValue (immutable, auto-cleaned)
static final ScopedValue<String> USER = ScopedValue.newInstance();

ScopedValue.where(USER, "alice")
           .run(() -> handleRequest());
```

---

## 3. Exam Tips for OCP 21 to 25 Candidates

- **`IO.println` is implicit in compact source files.** No `import` line, no `System.out.` prefix. If a class-less source file calls `println("x")` it is `IO.println`.
- **`_` placement is positional.** Legal as a local variable, lambda parameter, pattern binding, catch parameter, formal parameter. **Illegal** as a field name, method name, type name, or as the right-hand side of an assignment.
- **`_` is not a value.** `var x = _;` does not compile. You cannot read from it.
- **Multiple `_` parameters are allowed.** `BiFunction<String,Integer,String> f = (_, _) -> "x";` compiles.
- **Flexible constructor bodies forbid `this`-access before `super`.** You can throw, validate, log, and compute values from the parameters. You cannot read `this.field` or call an instance method on `this`.
- **`super(...)` and `this(...)` are still mutually exclusive** and still must appear exactly once in the prologue.
- **`gather()` is intermediate, not terminal.** It returns a `Stream<R>`. Chain `.toList()` or `.forEach(...)` to consume it.
- **`Gatherers.mapConcurrent(N, fn)` preserves encounter order** even though it runs `fn` on up to N tasks in parallel.
- **Scoped values are immutable inside a scope.** `where(V, x).run(() -> { ... })` binds once; the body cannot mutate `V`. To "rebind" you nest another `where(...).run(...)`.
- **Scoped value inheritance is opt-in.** Child threads see the binding only if they are virtual threads or are spawned via `StructuredTaskScope`, not generic platform threads.
- **`import module M;` brings every package M exports.** Conflicts are resolved like any other multi-import collision; use a fully qualified name or a single-type import to disambiguate.
- **`StringTemplate` and `STR."..."` do not exist in Java 25.** The preview was withdrawn. Text blocks (`"""..."""`) are unrelated and still work.
- **Virtual threads no longer pin on `synchronized`** (since Java 24). If exam code uses `synchronized` with a `Thread.ofVirtual()` thread, no pinning footnote applies in 25.

---

## 4. Where to Study Each Topic

| JEP | Bridge lesson | Full course lesson | Exam tier |
|-----|---------------|--------------------|-----------|
| 456 (unnamed variables) | [[0-7-unnamed-variables-patterns-changes]] | [[3-5-encapsulation-immutability-var-unnamed-variables]] | **yes** |
| 485 (gatherers) | [[0-2-stream-gatherers-changes]] | [[6-5-stream-gatherers]] | **yes** |
| 506 (scoped values) | [[0-3-scoped-values-changes]] | [[8-4-scoped-values]] | **yes** |
| 511 (module imports) | [[0-4-module-import-declarations-changes]] | [[7-3-module-import-declarations]] | **yes** |
| 512 (compact sources + instance `main`) | [[0-5-compact-source-files-instance-main-changes]] | [[7-5-compact-source-files-and-multi-file-programs]], [[7-6-instance-main-methods]] | **yes** |
| 513 (flexible constructor bodies) | [[0-6-flexible-constructor-bodies-changes]] | [[3-3-constructors-flexible-bodies-initializers]] | **yes** |
| 423, 471, 474, 491, 483, 514, 519 | [[0-10-runtime-performance-changes]] | n/a (not on exam) | recognise |
| 454, 467, 486, `StringTemplate` removal | [[0-9-api-changes-21-to-25]] | n/a | recognise |
| 488 (primitive patterns), 505 (structured concurrency), 466 (class-file), 470 (PEM) | [[0-8-preview-incubator-features]] | n/a | recognise |

---

## 5. Official Resources

| Resource | Link |
|----------|------|
| Java SE 25 Documentation hub | <https://docs.oracle.com/en/java/javase/25/> |
| Java Language Changes (25) | <https://docs.oracle.com/en/java/javase/25/language/java-language-changes.html> |
| Java SE 25 API Specification | <https://docs.oracle.com/en/java/javase/25/docs/api/> |
| OpenJDK Project — JDK 25 | <https://openjdk.org/projects/jdk/25/> |
| OpenJDK JEP Index | <https://openjdk.org/jeps/0> |
| Oracle Education — Java certifications | <https://education.oracle.com/> |
| Exam 1Z0-831 (OCP Java SE 25) topic list | <https://education.oracle.com/java-se-25-developer-professional/pexam_1Z0-831> |
| Java SE 25 Release Notes | <https://www.oracle.com/java/technologies/javase/25-relnote-issues.html> |

---

## Key Takeaway

If you remember six things from the 21-to-25 delta, make it: `_`, `IO.println`, `gather()`, `ScopedValue.where(...).run(...)`, `import module M;`, and prologue statements before `super(...)`. Everything else either has not changed or is recognise-and-move-on context.
