---
version: 1.0
updatedAt: 2026-05-28
---
# Runtime and Performance Changes (21 to 25)

> **Not on the OCP 1Z0-831 exam.** None of the JEPs below add language constructs or testable API behaviour. They are here because any real-world Java 21 to Java 25 upgrade hits these flags, defaults, and footguns in production. Read once, recognise the names, do not memorise.

---

## Why a Non-Exam Lesson

The 22 to 25 release cycle landed a heavy bench of HotSpot and GC work. Some of it changes defaults silently, which means an upgraded application can behave differently on day one even if not a single line of code changed. A senior developer is expected to know what those changes are and which flags reverse them.

The OCP exam will not ask you to compare ZGC and G1. It will not ask you to choose a flag. But your team lead might, on the day you ship Java 25.

---

## JEP 474 — ZGC Generational Mode by Default (Java 23)

Up to Java 21, the Z Garbage Collector was **single-generation** (no young/old split). In Java 23 generational ZGC became the default mode whenever ZGC is selected with `-XX:+UseZGC`.

| Aspect | Java 21 ZGC | Java 23+ ZGC |
|--------|-------------|--------------|
| Generations | One (whole heap) | Two (young + old) |
| Typical throughput | Lower than G1 | Closer to G1 |
| Pause time | Sub-millisecond | Sub-millisecond |
| Allocation rate handling | Mediocre | Much better |

Selecting ZGC:

```sh
java -XX:+UseZGC -Xmx16g -jar app.jar
```

Opting back into the old non-generational mode (deprecated, will be removed):

```sh
java -XX:+UseZGC -XX:-ZGenerational -Xmx16g -jar app.jar
```

- JEP: <https://openjdk.org/jeps/474>

---

## JEP 519 — Compact Object Headers (Java 25, final)

Shrinks the per-object header on 64-bit HotSpot from **12 bytes (compressed oops on) or 16 bytes (compressed oops off)** down to **8 bytes**. For allocation-heavy workloads — wide rows in OLAP, JSON document parsing, large `HashMap` populations — this shows up as a 10 to 20 percent reduction in live heap.

| Heap object population | Approx. saving with 4 fewer bytes per header |
|------------------------|-----------------------------------------------|
| 10 million instances | ~40 MB |
| 100 million instances | ~400 MB |
| 1 billion instances | ~4 GB |

Enable with:

```sh
java -XX:+UnlockExperimentalVMOptions -XX:+UseCompactObjectHeaders -jar app.jar
```

Final in Java 25, still gated behind the experimental flag in 25 GA (the JEP expects the default to flip in a later release).

- JEP: <https://openjdk.org/jeps/519>

---

## JEP 423 — Region Pinning for G1 (Java 22)

Before Java 22, calling a JNI critical region (`GetPrimitiveArrayCritical`) on G1 could **disable garbage collection entirely** until every critical region was released. That occasionally caused allocation stalls and even `OutOfMemoryError` on applications that did a lot of JNI work (TLS libraries, native image codecs).

Java 22 changes G1 to **pin individual regions** instead of disabling GC across the whole heap. Other regions can still be collected.

| Before 22 | From 22 onward |
|-----------|----------------|
| Critical region disables all GC | Critical region pins only its region |
| OOMs under JNI load | Continues collecting elsewhere |

No flag to set. The new behaviour is on by default for G1, which is the default collector.

- JEP: <https://openjdk.org/jeps/423>

---

## JEP 491 — Synchronize Virtual Threads without Pinning (Java 24)

The single most important runtime fix between 21 and 25 for code that uses virtual threads.

In Java 21, when a virtual thread entered a `synchronized` block or method, it was **pinned** to its carrier platform thread. No other virtual thread could be scheduled on that carrier until the synchronized region exited. This produced surprising thread starvation in libraries that took locks (JDBC drivers, logging frameworks, JSON parsers) — exactly the libraries virtual threads were supposed to scale.

The workaround in 21 was "replace `synchronized` with `ReentrantLock` everywhere". From Java 24 this workaround is no longer needed. `synchronized` now yields the carrier just like `ReentrantLock.lockInterruptibly()` does.

```java
synchronized (lock) {
    // In Java 21: VT pinned to carrier until block exits.
    // In Java 24+: VT may unmount and remount on another carrier.
    Thread.sleep(Duration.ofSeconds(1));
}
```

Pinning still happens in two cases:

| Cause | Status in 25 |
|-------|--------------|
| `synchronized` | **Fixed** (no longer pins) |
| JNI critical region | Still pins |
| `Object.wait` inside native frame | Rare, still pins |

To inspect remaining pin events, run with `-Djdk.tracePinnedThreads=full`.

- JEP: <https://openjdk.org/jeps/491>

---

## JEP 483 — Ahead-of-Time Class Loading and Linking (Java 24)

Cuts cold-start latency by pre-recording which classes the application loads, then prebuilding a binary AOT cache that the JVM mmaps at startup. Two-step workflow:

```sh
# 1. Record a training run
java -XX:AOTMode=record \
     -XX:AOTConfiguration=app.aotconf \
     -jar app.jar

# 2. Create the cache from the recording
java -XX:AOTMode=create \
     -XX:AOTConfiguration=app.aotconf \
     -XX:AOTCache=app.aot \
     -jar app.jar

# 3. Run the app using the cache
java -XX:AOTCache=app.aot -jar app.jar
```

Typical startup wins on Spring Boot or Micronaut apps: 30 to 50 percent on the time-to-first-request metric, more on small CLIs.

- JEP: <https://openjdk.org/jeps/483>

---

## JEP 514 — Ahead-of-Time Command-Line Ergonomics (Java 25)

Collapses the two-step training/create flow above into one step. The JVM records on the first run and writes the cache directly.

```sh
# Single-step AOT cache creation
java -XX:AOTCacheOutput=app.aot -jar app.jar

# Subsequent runs use the cache
java -XX:AOTCache=app.aot -jar app.jar
```

- JEP: <https://openjdk.org/jeps/514>

The verbose `AOTMode=record` / `AOTMode=create` flags from JEP 483 still work; `AOTCacheOutput` is sugar.

---

## JEP 470 — PEM Encodings of Cryptographic Objects (Java 25, preview)

A new API in `java.security` for parsing and writing PEM-encoded keys, certificates, and CSRs without dropping down to `KeyFactory`/`CertificateFactory` boilerplate.

```java
// --enable-preview required in 25
String pem = """
    -----BEGIN PUBLIC KEY-----
    MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...
    -----END PUBLIC KEY-----
    """;

PEMDecoder decoder = PEMDecoder.of();
PublicKey key = decoder.decode(pem, PublicKey.class);
```

Still preview in 25 (recognise-and-move-on for exam purposes). See [[0-8-preview-incubator-features]].

- JEP: <https://openjdk.org/jeps/470>

---

## Container Awareness Improvements

Across 22 to 25 the JVM container detection logic has been refined for cgroup v2, including:

- Better honouring of `memory.max` and `memory.high` under cgroup v2
- Accurate CPU quota detection on systemd-managed slices
- `-XX:+UseContainerSupport` is on by default (unchanged since 11) but now reads cgroup v2 correctly out of the box

No flag changes; this is a "it just works on Kubernetes now" delta.

---

## Startup Improvements Summary

Stacked together, the AOT cache (JEP 483/514), compact object headers (JEP 519), and class-loader optimisations bring a typical Spring Boot service down by **30 to 60 percent** at startup compared to Java 21 on the same hardware. Concrete numbers depend on the application; the win is real but variable.

---

## Flag Reference Table

| Flag | Introduced | What it does |
|------|------------|--------------|
| `-XX:+UseZGC` | 11 | Select the Z Garbage Collector |
| `-XX:+ZGenerational` | 21 (opt-in), default in 23 | Generational mode for ZGC |
| `-XX:-ZGenerational` | 23 | Opt back into the old non-generational ZGC |
| `-XX:+UseCompactObjectHeaders` | 25 | Shrink object header to 8 bytes (still experimental in 25 GA) |
| `-XX:+UnlockExperimentalVMOptions` | pre-21 | Required to enable experimental flags |
| `-XX:AOTMode=record` | 24 | Begin AOT training run |
| `-XX:AOTMode=create` | 24 | Build AOT cache from recording |
| `-XX:AOTConfiguration=<file>` | 24 | Path to the AOT configuration file |
| `-XX:AOTCache=<file>` | 24 | Path to the AOT cache to use at runtime |
| `-XX:AOTCacheOutput=<file>` | 25 | Single-step record-and-create |
| `-Djdk.tracePinnedThreads=full` | 21 | Print stack trace when a VT pins |
| `-Djava.security.manager=allow` | 17 | Allow `System.setSecurityManager` to install one (off by default since 24) |
| `--enable-preview` | 12 | Enable preview language features and APIs |
| `-XX:+UseContainerSupport` | 11 | Detect cgroup limits (default on; v2 support modernised in 22 to 24) |
| `-XX:+UseG1GC` | 9 | Select G1 (still default in 25) |
| `-XX:+UseParallelGC` | pre-21 | Throughput collector, unchanged |

---

## Key Takeaway

If you upgrade a production app from 21 to 25 with **zero code changes**, you get four free wins:

1. Virtual threads stop pinning on `synchronized`.
2. ZGC is generational by default (closer to G1 throughput).
3. G1 no longer disables GC during JNI critical regions.
4. Startup is faster even without enabling the AOT cache.

And two things to watch:

1. `System.setSecurityManager` throws unless `-Djava.security.manager=allow`.
2. `sun.misc.Unsafe` memory-access methods print deprecation warnings.

None of this is on the exam. All of it will come up the first time you upgrade a real service.

See also [[0-9-api-changes-21-to-25]] and [[0-11-cheat-sheet-21-to-25]].
