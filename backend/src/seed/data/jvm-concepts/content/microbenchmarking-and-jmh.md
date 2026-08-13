---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand why a hand-rolled "time a loop" microbenchmark routinely lies about Java performance, and how JMH (Java Microbenchmark Harness) exists specifically to avoid those traps.

## Use Cases

- Deciding whether implementation A or B of a hot method is actually faster, instead of guessing from a stopwatch-style test that the JIT compiler quietly invalidates.
- Writing a benchmark that gets reviewed by teammates who need to trust the number, not just see one.
- Recognizing "that benchmark result looks suspiciously too good" as a sign of dead-code elimination rather than a real win.

## Deep Dive

### The trap: measuring nothing at all

A naive microbenchmark warms up a loop, times a second loop, and prints the elapsed time:

```java
public void doTest() {
    double l;
    for (int i = 0; i < nWarmups; i++) l = fibImpl1(50);   // warm-up
    long then = System.currentTimeMillis();
    for (int i = 0; i < nLoops; i++) l = fibImpl1(50);      // "measurement"
    long now = System.currentTimeMillis();
    System.out.println("Elapsed time: " + (now - then));
}
```

This will very likely print something close to zero. `l` is a local variable that's written but never read, so the JIT compiler is free to conclude the entire loop body has no observable effect and delete it — the "benchmark" ends up timing an empty loop, not `fibImpl1()`. A hand-fix (making `l` a `volatile` field so the write is observable) closes this particular hole, but a JIT compiler has other tricks: given a constant input like `fibImpl1(50)` every time, it can also constant-fold the whole computation to a single value computed once, so even a technically-"used" result can still measure nothing real.

### What JMH does about it

JMH is the JDK-ecosystem-standard benchmarking harness (not bundled with the JDK itself, but compatible with JDK 8 and later) built specifically to close these holes. The core trick is the `Blackhole` — a JMH-provided object whose whole job is to force the JIT to treat a value as genuinely used, so it can't be optimized away:

```java
import org.openjdk.jmh.annotations.Benchmark;
import org.openjdk.jmh.infra.Blackhole;

public class MyBenchmark {
    @Benchmark
    public void testIntern(Blackhole bh) {
        for (int i = 0; i < 10000; i++) {
            String s = new String("String to intern " + i);
            String t = s.intern();
            bh.consume(t);   // forces the JIT to treat t as observably used
        }
    }
}
```

Running it produces a warm-up phase, a measurement phase, and a real throughput number — JMH handles the warm-up/measurement split, iteration counts, and forking a fresh JVM per benchmark automatically, instead of leaving each of those as a place to get it wrong by hand.

## Trade-offs

- **A microbenchmark that doesn't consume its result measures nothing** — this isn't a JMH-specific gotcha, it's true of any hand-rolled timing loop; `Blackhole.consume()` (or, without JMH, a `volatile` field read back and printed) is the fix either way.
- **Threaded microbenchmarks routinely measure JVM lock contention, not the code under test** — a tiny, tight benchmark loop makes synchronized sections a disproportionate fraction of total work, so adding threads to a microbenchmark tends to reveal contention that will basically never happen at the same intensity in real application code — treat multi-threaded microbenchmark results with real skepticism.
- **JMH isn't a silver bullet** — it removes the classic footguns (dead-code elimination, missing warm-up, constant folding on a fixed input), but you still have to design a benchmark that actually represents the workload you care about — testing `fibImpl1(50)` forever, with the same input every time, tells you almost nothing about performance across a realistic range of inputs.

## Documentation Links

- Scott Oaks, *Java Performance: The Definitive Guide*, 2nd Edition (O'Reilly, 2020) — Chapter 2 "An Approach to Performance Testing", pp. 15-48 — book
- [JMH — OpenJDK Code Tools](https://github.com/openjdk/jmh) — doc
- [JMH Samples](https://github.com/openjdk/jmh/tree/master/jmh-samples/src/main/java/org/openjdk/jmh/samples) — doc
