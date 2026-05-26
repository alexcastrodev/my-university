# Java 21 vs Java 25: Exam Differences Overview

> The Oracle Certified Professional Java Developer certification comes in two exam versions: 1Z0-830 (Java 21) and 1Z0-831 (Java 25). This lesson compares the two, highlights what topics are new in the Java 25 exam, and provides a study strategy for candidates who already hold or are studying for the Java 21 certification.

---

## Exam Comparison Table

| Feature | 1Z0-830 (Java 21) | 1Z0-831 (Java 25) |
|---|---|---|
| Java version | 21 (LTS) | 25 (LTS) |
| Exam name | OCP Java SE 21 Developer | OCP Java SE 25 Developer |
| Number of questions | ~50 | ~50 |
| Duration | 90 minutes | 90 minutes |
| Pass score | ~68% | ~68% |
| Core topics | Identical — same chapters 1–15 | Identical + new Java 25 topics |
| New topic: Flexible Constructor Bodies | Not tested | Tested (JEP 492) |
| New topic: Module Import Declarations | Not tested | Tested (JEP 511) |
| New topic: Compact Source Files | Not tested | Tested (JEP 512) |
| New topic: Instance main Methods (final) | Not tested | Tested (JEP 495) |
| New topic: Scoped Values (final) | Preview only (JEP 446) | Finalized, tested (JEP 487) |
| New topic: Stream Gatherers | Not tested | Tested (JEP 485) |

---

## Topics Added in Java 25 (1Z0-831)

The Java 25 exam retains all topics from the Java 21 exam and adds a dedicated module on new language and API features. The six additions are:

### 1. Flexible Constructor Bodies (JEP 492)
Previously, a constructor was required to call `super()` or `this()` as its very first statement. Java 25 lifts this restriction: code is now allowed *before* the explicit constructor invocation, as long as it does not access the uninitialized instance (`this`). This enables argument validation and computation before delegation.

### 2. Module Import Declarations (JEP 511)
A new `import module java.base;` syntax imports all public types from all packages exported by a named module in a single declaration. This is coarser than a wildcard import (`import java.util.*`) — it covers an entire module at once.

### 3. Compact Source Files and Multi-File Programs (JEP 512)
Java programs can now be run directly with `java Hello.java` without a separate `javac` step. Top-level methods (outside any explicit class) are allowed in these "implicit class" files, making Java suitable for scripting and introductory learning.

### 4. Instance main Methods — Final (JEP 495)
The `public static void main(String[] args)` entry point is no longer the only valid program launch signature. Java 25 finalizes a selection protocol: simpler forms (instance `void main()`, static `void main()` without `String[]`) are valid entry points, selected in a defined priority order.

### 5. Scoped Values — Final (JEP 487)
`ScopedValue<T>` is an immutable, thread-safe alternative to `ThreadLocal` for sharing data within and across structured-concurrency scopes. It incubated in Java 20, previewed in Java 21, and became final in Java 25.

### 6. Stream Gatherers (JEP 485)
A new `Stream.gather(Gatherer)` intermediate operation allows user-defined stream transformations with internal state. Built-in gatherers include `windowFixed`, `windowSliding`, `scan`, `fold`, and `mapConcurrent`.

---

## Study Strategy

### If you are starting fresh
Study the full 1Z0-831 curriculum from chapter 1 through the new Java 25 module. The core content (chapters 1–15) is identical between the two exams.

### If you already hold the Java 21 (1Z0-830) certification
Oracle provides an **upgrade path**. Focus exclusively on the six new topics in module 16. All core Java knowledge carries over — you only need to fill in the gaps introduced by the new JEPs.

### If you are currently studying for 1Z0-830
Consider whether to switch to 1Z0-831. The additional six topics are well-scoped, and Java 25 is an LTS release with long-term relevance. The extra study investment is modest compared to the certification's longevity.

---

## What Has NOT Changed

Everything in chapters 1 through 15 of this course is equally applicable to both exams:

- Language fundamentals (variables, operators, flow control, OOP)
- Generics and Collections
- Lambdas, functional interfaces, and streams (through Java 21 stream API)
- Exception handling and localization
- Modules
- Concurrency basics
- I/O and NIO.2
- JDBC

---

## Key Rules Summary

- 1Z0-830 covers Java 21; 1Z0-831 covers Java 25 (both are LTS releases).
- The Java 25 exam adds six new topics: Flexible Constructor Bodies, Module Import Declarations, Compact Source Files, Instance main Methods, Scoped Values, and Stream Gatherers.
- Chapters 1–15 are shared between both exams.
- Existing 1Z0-830 holders can pursue an upgrade path focusing only on the new Java 25 topics.

---

## References

- [Oracle Certification — 1Z0-831](https://education.oracle.com/java-se-25-developer/pexam_1Z0-831)
- [JEP 492 — Flexible Constructor Bodies](https://openjdk.org/jeps/492)
- [JEP 511 — Module Import Declarations](https://openjdk.org/jeps/511)
- [JEP 512 — Compact Source Files](https://openjdk.org/jeps/512)
- [JEP 495 — Instance main Methods](https://openjdk.org/jeps/495)
- [JEP 487 — Scoped Values](https://openjdk.org/jeps/487)
- [JEP 485 — Stream Gatherers](https://openjdk.org/jeps/485)
