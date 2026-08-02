# Practice: Java 25 New Features

> Five exercises covering the six topics that 1Z0-831 (Java 25) adds on top
> of 1Z0-830 (Java 21) — module import declarations and their ambiguity
> rules, how they interact with `requires`, automatic imports in implicit
> classes, the `main` method priority order, and why Scoped Values moved
> from preview to final between the two exams. Try to answer before opening
> each explanation.

---

## Exercise 1 — Module Import Declarations and Ambiguous Simple Names

```java
import module java.base;
import module java.sql;

public class ReportGenerator {
    public static void main(String[] args) {
        Date generated = new Date();
        System.out.println("Report generated: " + generated);
    }
}
```

Does this compile? If not, how would you fix it while keeping both module
imports?

<details>
<summary>Answer</summary>

**It does not compile** — `Date` is an ambiguous reference.

`import module java.base;` brings in every public type exported by
`java.base`, which includes `java.util.Date`. `import module java.sql;`
brings in every public type exported by `java.sql`, which includes
`java.sql.Date`. Both modules export a type whose simple name is `Date`,
and per JEP 511 this is resolved the **same way as wildcard-import
ambiguity**: the compiler does not guess or pick one arbitrarily — a
simple name that resolves to more than one type from module/wildcard
imports is a compile-time error.

The fix is to add a **specific single-type import**, which always wins
over any module import:

```java
import java.util.Date;   // now Date unambiguously means java.util.Date
```

or to fully qualify the type at the point of use:

```java
java.sql.Date generated = new java.sql.Date(System.currentTimeMillis());
```

</details>

---

## Exercise 2 — Module Import Declarations Are Not a Substitute for `requires`

```java
// module-info.java
module com.example.reports {
    requires java.base;   // written explicitly for clarity; implicit anyway
}
```

```java
// ReportGenerator.java — inside the module com.example.reports
import module java.sql;

public class ReportGenerator {
    Connection conn;   // intended to be java.sql.Connection
}
```

Given only the `module-info.java` shown above, does `ReportGenerator.java`
compile?

<details>
<summary>Answer</summary>

**No.** `import module java.sql;` textually brings the simple name
`Connection` into scope, but a module import is **only sugar for
imports** — it does not grant the module any readability to `java.sql`.
That readability comes exclusively from a `requires` clause in
`module-info.java`, and this module only requires `java.base`.

The compiler therefore reports that the `java.sql` package is not
visible/readable to `com.example.reports`, and the field declaration
fails to compile — despite the `import module java.sql;` line compiling
fine on its own.

The fix is to add the missing dependency:

```java
module com.example.reports {
    requires java.base;
    requires java.sql;   // now java.sql types are actually accessible
}
```

This is explicitly called out as an exam trap: **`import module` never
replaces `requires`** in modular code. In non-modular (classpath) code
there's no `module-info.java` at all, so this restriction doesn't apply —
but the moment you're inside a named module, both the `requires` and the
import are needed.

</details>

---

## Exercise 3 — Automatic Imports Apply Only to Implicit Classes

```java
// A: Quick.java — no explicit class declaration
void main() {
    var items = List.of("bread", "milk");
    var log = Path.of("shopping.log");
    items.forEach(System.out::println);
}
```

```java
// B: Quick2.java — explicit class declaration
public class Quick2 {
    public static void main(String[] args) {
        var items = List.of("bread", "milk");
        items.forEach(System.out::println);
    }
}
```

Running `java Quick.java` works. Running `java Quick2.java` fails to
compile, even though neither file has an `import` statement and both
reference `List` the same way. Why the difference?

<details>
<summary>Answer</summary>

`Quick.java` is an **implicit class** (JEP 512) — a source file with
top-level methods and no explicit `class { }` wrapper. Implicit class
files get a fixed set of **automatic imports** the compiler adds for
you, including `java.util.*` (covers `List`) and `java.nio.file.*`
(covers `Path`), along with packages like `java.io.*`,
`java.util.stream.*`, `java.util.function.*`, and others. That's why
`List.of(...)` and `Path.of(...)` resolve without a single `import`
line.

`Quick2.java` declares an explicit `public class Quick2`, so it's
compiled as an ordinary traditional class. Automatic imports are a
concession specifically for implicit classes — **traditional classes
never receive them**, regardless of whether you launch the file with
`java Quick2.java` (single-file source-launch) or the classic
`javac`+`java` two-step. The compiler reports `List` as an unresolved
symbol, and `Quick2.java` fails to compile until you add:

```java
import java.util.List;
```

The rule to remember: automatic imports key off *implicit vs. explicit
class declaration*, not off *how you invoke the compiler*.

</details>

---

## Exercise 4 — Instance `main` Priority Ordering

```java
public class Launcher {

    void main() {
        System.out.println("A: instance, no args");
    }

    static void main(String[] args) {
        System.out.println("B: static, with args -> " + args.length + " args");
    }
}
```

Run with `java Launcher.java one two`. Which method actually executes,
and why doesn't the JVM simply run whichever `main` appears first in the
source?

<details>
<summary>Answer</summary>

**`"B: static, with args -> 2 args"` prints.**

JEP 495 finalizes a fixed **priority order** among the up to eight legal
`main` forms, ranked by static-vs-instance and presence of the
`String[]` parameter (public/non-public only breaks ties within the same
static/args combination):

1. `public static void main(String[] args)`
2. `static void main(String[] args)`
3. `public static void main()`
4. `static void main()`
5. `public void main(String[] args)`
6. `void main(String[] args)`
7. `public void main()`
8. `void main()`

`static void main(String[] args)` is priority 2. `void main()` is
priority 8, the lowest of all eight forms. The JVM scans the launched
class for whichever of these forms are actually declared and always
runs the **highest-priority one present** — source order is irrelevant.
Here priority 2 beats priority 8, so the static form runs and receives
`args` (`"one"`, `"two"`), printing `2 args`. The instance `main()` is
simply never invoked.

Had `Launcher` declared only `void main()` (no competing static form),
that lowest-priority form would run instead — and the JVM would first
instantiate `Launcher` via its no-arg constructor before calling it.

</details>

---

## Exercise 5 — Preview vs Final: Why Scoped Values Split the Exams

```java
import java.lang.ScopedValue;

public class ContextDemo {
    static final ScopedValue<String> USER = ScopedValue.newInstance();

    public static void main(String[] args) {
        ScopedValue.where(USER, "alice").run(() ->
            System.out.println("User: " + USER.get())
        );
    }
}
```

This exact file is compiled with a plain `javac` (no extra flags), once
using a Java 21 JDK and once using a Java 25 JDK. What happens in each
case, and why does this matter for deciding between the 1Z0-830 and
1Z0-831 exams?

<details>
<summary>Answer</summary>

**Java 21 JDK:** compilation fails. `ScopedValue` was only a **preview**
API in Java 21 (JEP 446) — `java.lang.ScopedValue` is annotated as a
preview feature, and using a preview API without passing
`--enable-preview` (with a matching `--release`) at both compile time and
run time is a compile-time error. Without those flags, `javac` refuses
to compile code that references it.

**Java 25 JDK:** compilation and execution succeed with no special flags,
printing `User: alice`. `ScopedValue` was **finalized** as a standard API
in Java 25 (JEP 487) — it incubated in Java 20, previewed in Java 21
(JEP 446) and again in Java 22 (JEP 464), and only became a permanent,
flag-free part of `java.lang` in Java 25.

This is exactly the reasoning behind the exam-comparison table: **1Z0-830
(Java 21) lists Scoped Values as "Preview only"** and does not test it at
all, because Oracle's certification exams do not examine preview-only
APIs — code depending on them isn't guaranteed to compile with default
settings. **1Z0-831 (Java 25) lists Scoped Values as "Finalized, tested"**
precisely because JEP 487 removed the preview requirement, making it a
stable, examinable part of the language. The same reasoning is why
Flexible Constructor Bodies, Module Import Declarations, Compact Source
Files, and Instance `main` Methods appear only on 1Z0-831: none of them
existed, or were finalized, before Java 25 — while chapters 1–15 stay
identical across both exams because that material was already stable
under Java 21.

</details>
