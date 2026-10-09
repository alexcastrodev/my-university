---
version: 1.0
updatedAt: 2026-10-09
---
## Objective

Project Leyden attacks the two reasons a Java program is slow in its first seconds without giving up the dynamic JVM: **startup** (reading, parsing, loading, linking and initializing thousands of classes) and **warm-up** (running in the interpreter while the JIT collects profiles, before optimized code exists). Its mechanism is the **AOT cache**, a file produced by a *training run* of your application and consumed by every later *production run*. The work that used to be repeated on each launch is done once and stored. It is not a different runtime: reflection, dynamic class loading, agents and the JIT all keep working, and the JIT still takes over when the workload differs from the training run. The project is delivered as a sequence of JEPs, each adding one more kind of data to the same cache, so knowing *what is cached today* and *what is still only proposed* is the core of the topic.

## Use Cases

- Cutting time-to-first-request of a service that has to scale out quickly, where every new instance pays the full class-loading and warm-up cost.
- Making short-lived JVMs cheaper: CLI tools, build tooling, test workers and serverless functions that never live long enough to warm up.
- Getting a large part of the startup benefit of a native executable while keeping a normal JVM, so reflection-heavy frameworks need no build-time metadata.
- Reasoning about startup regressions: knowing which of "classes", "profiles", "objects" or "code" a given cache contains tells you what is still being paid at run time.

## Deep Dive

### Startup and warm-up are different costs

A cold JVM pays twice. First it loads and links every class the program touches, which for a framework application means thousands of classes. Then it runs that code in the interpreter while HotSpot counts invocations and records *profiles* (which branch is taken, which receiver types appear at a call site) so that C1 and C2 know what to optimize. Peak speed only arrives after both. A runtime that wants to optimize aggressively *because* it observes the real program is structurally slow at the start, which is the price of the design described in [JIT Tiered Compilation](/jvm-concepts/jit-tiered-compilation). Leyden moves observation from the production run to a training run.

### What the AOT cache holds, one JEP at a time

```
JEP 483  JDK 24  classes, already read, parsed, loaded and linked        (delivered)
JEP 514  JDK 25  one-step commands to create the cache                   (delivered)
JEP 515  JDK 25  method profiles from the training run                   (delivered)
JEP 516  JDK 26  cached Java objects usable with any GC, including ZGC   (delivered)
JEP 544  JDK 28  compiled native code for hot methods                    (targeted, not yet shipped)
```

Each JEP extends the *same* cache and the same commands, so nothing in your launch script changes when a later JEP lands. JEP 515's own example shows what profiles buy: a short Stream program went from 90 ms to 73 ms, for about 250 KB of extra cache. JEP 544 is the step that removes most of the remaining warm-up, because compiled code, not just the information needed to compile it, comes from the cache.

### Creating and using a cache

```java
public class Main {
    public static void main(String[] args) {
        long total = java.util.stream.IntStream.range(0, 1_000).boxed()
            .map(i -> i * 2).filter(i -> i % 3 == 0)
            .mapToLong(i -> i).sum();
        System.out.println(total);
    }
}
```

```
# JDK 25+, one step (JEP 514): runs the app, then writes app.aot when it exits
$ java -XX:AOTCacheOutput=app.aot -cp app.jar Main

# every later run
$ java -XX:AOTCache=app.aot -cp app.jar Main
```

The JDK 24 form splits the same thing in two, which is useful when the machine that trains and the machine that builds the cache differ, or when memory is tight (the one-step form needs roughly twice the training heap while it builds):

```
$ java -XX:AOTMode=record -XX:AOTConfiguration=app.aotconf -cp app.jar Main
$ java -XX:AOTMode=create -XX:AOTConfiguration=app.aotconf -XX:AOTCache=app.aot -cp app.jar Main
```

### When a cache is valid

The cache is only used if the production JVM matches the one that trained it: same JDK release, architecture and operating system, a matching class path (extra JARs may be appended, directories are not supported), and matching module options. Agents that rewrite class files break it. If any rule is violated, HotSpot prints a warning and runs normally without the cache, so a stale cache silently costs you startup time rather than failing. To turn that silence into a failure, use `-XX:AOTMode=required` (spelled `-XX:AOTMode=on` before JDK 27).

```
$ java -XX:AOTCache=app.aot -XX:AOTMode=required -cp other.jar Main
# exits with an error instead of falling back to a cold start
```

### Objects and garbage collectors

The first caches stored heap objects in a layout tied to specific collectors, so ZGC could not use them. JEP 516 added a GC-agnostic format that is *streamed* into the heap by a background thread instead of memory-mapped. It is chosen automatically (for instance when training ran with ZGC or a heap above 32 GB) and `-XX:+AOTStreamableObjects` forces it. Streaming wants a spare CPU core, which matters on small container limits.

### Where Leyden stops

Leyden keeps the JVM, so the gain is a fraction of what a native executable gives and the memory footprint does not shrink. JEP 483 reports about 42% faster startup for a small Stream demo and for Spring PetClinic, with a cache of 11 MB and 130 MB respectively. When the requirement is a process that is live in milliseconds with a small footprint, compare with [GraalVM Native Image Compilation](/java-concepts/graalvm-native-image-compilation). When the requirement is "the same application, noticeably quicker to start", the AOT cache is the cheaper first step. Shrinking what you ship is a separate lever: see [jlink and jdeps: Custom Runtime Images](/java-concepts/jlink-custom-runtime-images).

## Trade-offs

- **The cache is only as good as the training run**: classes the training run never touched are not cached, and classes it touched needlessly bloat the cache. Mocking the network or the database during training loads classes production never uses.

```
# training against a stubbed database: the stub's classes enter the cache, the real driver's do not
$ java -XX:AOTCacheOutput=app.aot -Dspring.profiles.active=test -jar app.jar
```

- **A cache is tied to an exact JDK and class path**: upgrade the JDK or change a dependency and the cache is ignored with a warning, so the cache must be rebuilt as part of every build, not committed.

```
$ java -XX:AOTCache=app.aot -cp app-v2.jar Main
# HotSpot warns that the cache cannot be used and starts without it (message text varies by JDK)
```

- **`AOTMode=required` trades silent slowness for hard failures**: good in a pipeline that must notice a stale cache, risky in production, where adding a monitoring agent that hooks class loading would stop the application from starting.

- **It does not raise peak throughput**: the JIT still produces the steady-state code, so a long-running service is as fast as before after warm-up; only the road to it is shorter.

- **The feature set is still moving**: compiled-code caching (JEP 544) is targeted, not shipped, and flags have been renamed between releases (`AOTMode=on` became `required` in JDK 27). Pin a JDK version in the build and treat the launch flags as part of that version's contract.

## Documentation Links

- [JEP 483: Ahead-of-Time Class Loading & Linking](https://openjdk.org/jeps/483) - doc
- [JEP 514: Ahead-of-Time Command-Line Ergonomics](https://openjdk.org/jeps/514) - doc
- [JEP 515: Ahead-of-Time Method Profiling](https://openjdk.org/jeps/515) - doc
- [JEP 516: Ahead-of-Time Object Caching with Any GC](https://openjdk.org/jeps/516) - doc
- [JEP 544: Ahead-of-Time Code Compilation](https://openjdk.org/jeps/544) - doc
- [Project Leyden - OpenJDK](https://openjdk.org/projects/leyden/) - doc
