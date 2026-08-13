---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand how the JVM turns bytecode into native machine code while the program is already running — why it deliberately waits before compiling, what makes a piece of code "hot," and how the JVM combines a fast-starting compiler with a slower, smarter one instead of picking just one.

## Use Cases

- Explaining a "slow first request" or a benchmark's warm-up period as expected JIT behavior, not a bug.
- Reading `-XX:+PrintCompilation` output or JIT-related JFR events to see what got compiled, when, and at which tier.
- Deciding whether a short-lived CLI tool or a long-running service benefits more from startup speed or peak throughput — and picking the right compilation strategy for each.

## Deep Dive

### Bytecode: compiled enough to be portable, interpreted enough to be fast

`javac` doesn't compile Java straight to a CPU's native instructions the way a C++ compiler does — it compiles to bytecode, a portable intermediate format the JVM then runs. That's what makes "just-in-time" possible: because the `java` binary is executing an idealized instruction set rather than source line-by-line, it can compile that bytecode into real machine code *while the program runs*, mixing an interpreted language's portability with a compiled language's speed.

### Why the JVM waits: hot spots and profile-guided optimization

The JVM doesn't compile a method the first time it runs — it interprets it first, for two reasons. First, compiling code that only executes once is wasted work; interpreting it once is cheaper than compiling and then running it once. Second, and more interestingly, running code first lets the JVM *observe* it before deciding how to optimize it.

The classic example is `equals()`. Every object inherits it, and it's usually overridden, so a naive call requires a dynamic lookup of which `equals()` implementation actually applies. If the JVM notices that, every time this call site executes, the argument is always a `String`, it can compile a version that calls `String.equals()` directly — skipping the lookup entirely. That optimization is only possible *after* watching the code run for a while; an ahead-of-time compiler with no runtime profile can't make it. (If a later call passes something other than a `String`, the JVM deoptimizes that compiled code and recompiles to handle the new case.)

### C1 and C2, unified by tiered compilation

The JVM actually ships two JIT compilers, historically called the client compiler (C1) and server compiler (C2):

```
C1 — compiles sooner, less aggressively. Faster to produce code, so it wins during startup/warm-up.
C2 — waits longer, gathers more runtime profile data, produces more heavily optimized code.
     Wins once a method is hot enough that the extra optimization pays for itself.
```

Older JVMs made you choose one compiler for the whole run via `-client`/`-server` flags (both are no-ops today). Modern JVMs use **tiered compilation** instead: every method starts interpreted, gets promoted to C1-compiled once it's warm, and gets promoted again to C2-compiled once it's hot enough to justify the extra optimization time — the JVM gets C1's fast startup *and* C2's peak throughput from the same run, without you having to choose. It's on by default; `-XX:-TieredCompilation` turns it off.

## Trade-offs

- **Every JVM process pays a warm-up cost** — the first requests hit interpreted (or C1) code before C2 has had a chance to compile the hot paths, which is exactly why a benchmark that only runs a loop once measures interpreter speed, not steady-state throughput:

  ```java
  // Running this once tells you almost nothing about production performance —
  // the JIT hasn't had a chance to compile the hot inner loop yet.
  long start = System.nanoTime();
  doExpensiveWork();
  System.out.println(System.nanoTime() - start);
  ```
- **The code cache has a fixed size, and a full cache silently stops compilation** — once `-XX:ReservedCodeCacheSize` is exhausted, the JVM logs a warning and falls back to running everything interpreted, which reads like a mysterious slowdown if you don't know to look for that specific message.
- **Book vs today**: the book (2nd ed., 2020) covers `jaotc`-based ahead-of-time compilation as an "experimental JDK 11 feature" for avoiding warm-up in long-startup REST servers — **`jaotc` and AOT compilation were removed entirely in JDK 17** (JEP 410), so that specific tool no longer exists on any current JDK. What actually solved this problem in production since then is **GraalVM Native Image**, which the book describes as an "Early Adopter" feature producing genuinely fast-starting native binaries at the cost of some peak-throughput optimization and a list of reflection/dynamic-class-loading limitations — that part is still accurate, but native image has since gone fully mainstream via first-class support in Spring Boot 3 (`spring-boot:build-image`, Spring AOT processing) and frameworks built around it from the start (Quarkus, Micronaut), specifically because serverless and fast-autoscaling deployments make JIT warm-up cost a bigger deal today than it was in 2020, not a smaller one.

## Documentation Links

- Scott Oaks, *Java Performance: The Definitive Guide*, 2nd Edition (O'Reilly, 2020) — Chapter 4 "Working with the JIT Compiler", pp. 89-120 — book
- [JEP 410: Remove the Experimental AOT and JIT Compiler](https://openjdk.org/jeps/410) — doc
- [GraalVM Native Image Reference](https://www.graalvm.org/latest/reference-manual/native-image/) — doc
- [Spring Boot: Ahead-of-Time Processing](https://docs.spring.io/spring-boot/reference/packaging/native-image/introducing-graalvm-native-images.html) — doc
