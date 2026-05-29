---
version: 1.0
updatedAt: 2026-05-28
---
# Preview & Incubator Features in Java 25 (Context, Not on Exam)

> **Not on the exam.** OCP Java SE 25 (1Z0-831) tests only **finalized** language and API features. Everything in this lesson is in `--enable-preview` or `jdk.incubator.*` territory in Java 25. Read this so that when you skim release notes, JEP indexes, or modern Java articles you can place each feature on the maturity ladder without confusing it with what the exam actually covers.

---

## The Maturity Ladder

| Stage | Flag / module | Stability |
|-------|---------------|-----------|
| Experimental | `-XX:+UnlockExperimentalVMOptions` | May vanish |
| Incubator (API) | `jdk.incubator.*` module | API may change between releases |
| Preview (language/API) | `--enable-preview` + `--release N` | Round-tripping required each release |
| Final | none | Stable, backwards-compatible |

Preview features must be re-enabled and **recompiled** for each new JDK; their class files are stamped with a preview bit and refuse to load on a different release.

---

## JEP 488 — Primitive Types in Patterns, `instanceof`, and `switch` (Second Preview in 25)

Extends pattern matching beyond reference types so that `int`, `long`, `double`, etc. participate.

```java
// preview
Object o = 42;

if (o instanceof int i) {            // unboxes + range-checks
    System.out.println(i + 1);
}

String describe(Object o) {
    return switch (o) {
        case int i when i < 0   -> "negative int";
        case int i              -> "non-negative int";
        case long l             -> "long " + l;
        case double d           -> "double " + d;
        case null               -> "null";
        default                 -> "other";
    };
}
```

It also tightens conversions in `instanceof`: `int i = 1000; if (i instanceof byte b)` is **false** because 1000 does not fit a `byte` — a long-requested fix to the "lossy cast" footgun.

Status in 25: second preview. https://openjdk.org/jeps/488

---

## JEP 505 — Structured Concurrency (Fifth Preview in 25)

A high-level API for treating a group of related virtual-thread tasks as a single unit of work. Lives in `java.util.concurrent`.

```java
// preview
try (var scope = StructuredTaskScope.open()) {
    Subtask<String> user   = scope.fork(() -> fetchUser(id));
    Subtask<List<Order>> os = scope.fork(() -> fetchOrders(id));

    scope.join();                       // wait for all
    return new Profile(user.get(), os.get());
}                                       // scope closes -> cancels stragglers
```

Variants control completion policy:

| Factory | Policy |
|---------|--------|
| `StructuredTaskScope.open()` | Wait for all, cancel on failure |
| `StructuredTaskScope.open(Joiner.anySuccessfulResultOrThrow())` | First success wins |
| `StructuredTaskScope.open(Joiner.allSuccessfulOrThrow())` | All must succeed |

Goals: tree-shaped task hierarchies, automatic cancellation, observable thread dumps. Status in 25: fifth preview — the API has changed shape across iterations, which is why it is still not final. https://openjdk.org/jeps/505

---

## JEP 401 — Value Classes and Objects (Preview, Project Valhalla)

The flagship Valhalla feature. A `value class` has **no object identity**: no `==`-by-reference, no synchronization, no `System.identityHashCode`. The JVM is free to flatten them into containing objects and arrays.

```java
// preview
value class Point {
    int x;
    int y;
    Point(int x, int y) { this.x = x; this.y = y; }
}

Point p = new Point(1, 2);
// p == new Point(1, 2)  -> would be a compile error: identity comparison forbidden
// p.equals(new Point(1, 2)) -> true (component-wise)
```

Restrictions:

- All instance fields are implicitly `final`.
- No `Object.wait/notify` on a value object.
- Cannot be used as a monitor in `synchronized`.

Final classes that opt-in unlock dramatic memory and cache-locality wins for small immutable types. Status: preview, evolving. https://openjdk.org/jeps/401

---

## JEP 502 — Stable Values (Preview in 24/25)

`StableValue<T>` is a lazy, single-assignment holder — like `final` but initialized on first use, with the JVM treating the value as a constant once set.

```java
// preview
class Config {
    private static final StableValue<DataSource> DS = StableValue.of();

    static DataSource ds() {
        return DS.orElseSet(() -> buildDataSource());
    }
}
```

Differences vs. `final` and double-checked locking:

| | `final` | DCL idiom | `StableValue` |
|---|---------|-----------|---------------|
| Lazy | no | yes | yes |
| Thread-safe single init | n/a | requires `volatile` care | built-in |
| JIT treats as constant | yes | no | yes |
| Boilerplate | low | high | low |

Status: preview. https://openjdk.org/jeps/502

---

## JEP 508 — Vector API (Tenth Incubator in 25)

SIMD-style operations over primitive arrays via `jdk.incubator.vector`. Ten incubators in a row — it has been waiting for Valhalla so that `Vector<E>` can be a value class.

```java
// requires: --add-modules jdk.incubator.vector
import jdk.incubator.vector.*;

static final VectorSpecies<Float> S = FloatVector.SPECIES_PREFERRED;

void scalarAdd(float[] a, float[] b, float[] c) {
    int i = 0;
    int bound = S.loopBound(a.length);
    for (; i < bound; i += S.length()) {
        var va = FloatVector.fromArray(S, a, i);
        var vb = FloatVector.fromArray(S, b, i);
        va.add(vb).intoArray(c, i);
    }
    for (; i < a.length; i++) c[i] = a[i] + b[i];   // scalar tail
}
```

Status: tenth incubator. Still incubator, not preview — the team is explicit that it will not finalize before Valhalla lands. https://openjdk.org/jeps/508

---

## JEP 478 — Key Encapsulation Mechanism API (Preview)

A standardized API for KEMs — primitives used in post-quantum hybrid key exchange. Sits in `javax.crypto.KEM`.

```java
// preview
KEM kem = KEM.getInstance("DHKEM");
KEM.Encapsulator e = kem.newEncapsulator(receiverPublicKey);
KEM.Encapsulated enc = e.encapsulate();
byte[] sharedSecret = enc.key().getEncoded();
byte[] wireBytes    = enc.encapsulation();
```

Niche but important for libraries implementing hybrid TLS, ML-KEM, etc. Status: preview. https://openjdk.org/jeps/478

---

## How to Enable Preview Features

Compile and run must **both** opt in, and `--release` must match the running JDK:

```bash
# compile
javac --release 25 --enable-preview Foo.java

# run
java --enable-preview Foo
```

Incubator modules need `--add-modules` instead:

```bash
javac --add-modules jdk.incubator.vector Foo.java
java  --add-modules jdk.incubator.vector Foo
```

IDE tip: in IntelliJ set *Project Language Level* to "25 (Preview)"; in Maven add `--enable-preview` to both `maven-compiler-plugin` and `maven-surefire-plugin`.

---

## Watch-outs

- Preview class files are tagged with a minor-version bit that **pins them to the exact JDK** they were compiled on. A class built on 25-preview will not run on 26 even with `--enable-preview`. Recompile each release.
- Preview APIs may move packages, rename methods, or change defaults between previews. JEP 505 (structured concurrency) is the canonical example — its `open()` factory replaced earlier subclass-based constructors.
- Incubator modules require an **explicit** `--add-modules`; they are not in the default module graph.

---

## Closing Note

Previews exist so the community can give feedback before features become permanent. Production code in 2026 generally avoids `--enable-preview`. For the OCP Java SE 25 exam: do **not** memorize the syntax of any feature in this lesson. Recognize the names so you can confidently rule them out on multiple-choice questions that mix finalized and preview material.

---

## See also

- [[0-1-overview-21-to-25-roadmap]] — what is final between 21 and 25
- [[2-3-pattern-matching-switch]] — the finalized pattern-matching baseline JEP 488 extends
- JEP index — https://openjdk.org/jeps/0
- Java 25 release notes — https://jdk.java.net/25/release-notes
