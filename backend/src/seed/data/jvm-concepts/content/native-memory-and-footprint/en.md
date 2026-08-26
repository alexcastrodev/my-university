---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand the JVM's total memory footprint — heap plus native memory — and the reserved-versus-committed distinction that explains why a JVM's "virtual size" can look alarmingly large while its actual memory use is fine.

## Use Cases

- Right-sizing a container's memory limit so the JVM doesn't get OOM-killed by the operating system even though heap usage looks healthy.
- Explaining to a teammate why `ps`/`top` shows a JVM reserving several gigabytes of virtual memory it isn't actually using.
- Breaking down exactly which part of a JVM's memory — heap, metaspace, thread stacks, code cache — is actually driving memory pressure.

## Deep Dive

### Footprint is heap plus everything else

The heap is usually the biggest piece of a JVM's memory use, but it's rarely the *whole* story — thread stacks, the JIT's code cache, metaspace (class metadata), GC bookkeeping structures, and any native allocations from JNI or NIO all live outside the heap, in **native memory**. Total footprint = heap + native memory, and it's the total that the operating system cares about: if the machine doesn't have enough physical memory for the whole footprint, performance suffers, regardless of how comfortable the heap itself looks.

### Reserved vs. committed: why the "virtual size" lies

Start a JVM with `-Xms512m -Xmx2048m` and it doesn't grab 2 GB up front. It tells the OS it *might* need up to 2 GB (**reserved** memory, sometimes called virtual size) but only actually uses 512 MB at first (**committed** memory) — the amount that's genuinely backed by physical pages. Committed memory grows toward the reserved ceiling as the heap actually expands to meet GC goals; reserved memory is a promise, committed memory is real. **Only committed memory matters for performance** — over-reserving by itself never causes a slowdown, though on constrained virtual-memory environments it can still get in the way of other processes trying to reserve their own memory. On Unix systems, a process's resident set size (RSS) is the closest OS-level proxy for committed memory; `top`/`ps` showing a large *virtual* size next to a modest RSS is exactly this reserved/committed gap, not a problem.

### Breaking it down with Native Memory Tracking

`-XX:NativeMemoryTracking=summary` (off by default) turns on visibility into exactly where the JVM's own native memory goes, queryable live via `jcmd`:

```
% jcmd <pid> VM.native_memory summary

Total: reserved=5947420KB, committed=620432KB

-  Java Heap (reserved=4194304KB, committed=268288KB)
-  Class    (reserved=1182305KB, committed=150497KB)  (classes #24316)
-  Thread   (reserved=84455KB,   committed=84455KB)   (thread #77)
-  Code     (reserved=102581KB,  committed=15221KB)
-  GC       (reserved=199509KB,  committed=53817KB)
```

Notice the heap alone reserved 4 GB (matching `-Xmx4g`) but only committed 268 MB — the JVM asked for room to grow, not memory it's actually using. Thread stacks are the one exception to the reserve-then-grow pattern: each of the 77 threads here got its full ~1 MB stack committed immediately at creation, not grown incrementally.

## Trade-offs

- **NMT only sees memory the JVM itself allocates** — it has no visibility into memory a JNI call or a third-party native library (including native libraries bundled with the JDK) allocates directly via `malloc()`, which is a real blind spot when footprint is higher than NMT's own numbers explain.
- **Enabling NMT (`summary` or `detail`) has its own overhead** — it's not something to leave on unconditionally in the tightest-latency production paths; turn it on for the investigation, not by permanent default.
- **Book vs today**: the book frames footprint against "the physical memory of the machine," which undersells how this actually bites people now — the far more common failure mode today is a **container's memory limit** (a Kubernetes pod's cgroup limit, not the underlying node's RAM) killing the process once RSS exceeds it, regardless of how much physical memory the *host* has free. The good news: since JDK 10, the JVM has been container-aware by default (`-XX:+UseContainerSupport`), reading the cgroup's memory limit rather than the host's total physical memory when sizing the default heap — a JVM started inside a 2 GB container today won't try to default-size itself as if it owns the whole machine's RAM the way an unaware older JVM might have.

## Documentation Links

- Scott Oaks, *Java Performance: The Definitive Guide*, 2nd Edition (O'Reilly, 2020) — Chapter 8 "Native Memory Best Practices", "Footprint", pp. 249-260 — book
- [jcmd — Java SE 25 Tool Specifications](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jcmd.html) — doc
- [java (JVM options reference) — Java SE 25 Tool Specifications](https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html) — doc
