---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand how to find out what's actually consuming heap memory in a running JVM — via histograms and heap dumps — and how to read the different flavors of `OutOfMemoryError` correctly instead of reflexively bumping `-Xmx` and hoping.

## Use Cases

- Diagnosing a service that slowly leaks memory over days before it crashes, without guessing.
- Reading an `OutOfMemoryError`'s exact message text to know whether more heap will genuinely fix it or just delay an inevitable crash.
- Pulling a heap histogram in a few seconds during an incident, instead of jumping straight to a full heap dump that takes minutes to analyze.

## Deep Dive

### Heap histograms: a cheap first look

A histogram counts live objects by class, without the cost of a full heap dump:

```
% jcmd 8998 GC.class_histogram

 num     #instances         #bytes  class name
----------------------------------------------
   1:        789087       31563480  java.math.BigDecimal
   2:        172361       14548968  [C
   3:         13224       13857704  [B
   4:        184570        5906240  java.util.HashMap$Node
```

Character arrays (`[C`) and `String` are almost always near the top — that's normal. What's worth investigating is a class showing up in numbers that don't match what the code should be doing, like the `BigDecimal` count above if the application only expects transient `BigDecimal`s that shouldn't accumulate. `GC.class_histogram` forces a full GC by default, so it only counts live objects; add `-all` to skip the GC and see garbage too. `jmap -histo:live process_id` does the same thing via the older tool.

### Heap dumps: shallow, deep, and retained size

When a histogram isn't enough, a full heap dump (`jcmd process_id GC.heap_dump /path/to/dump.hprof`) captures every object and reference for offline analysis in a tool like Eclipse Memory Analyzer (MAT) or VisualVM. Three sizes matter when reading one:

```
shallow size    — the object itself only (references count as 4-8 bytes each, not what they point to)
deep size       — shallow size + everything it references, including objects other things also reference
retained size   — shallow size + only what would actually be freed if this object became garbage
```

The gap between deep and retained size is exactly the objects your target *shares* with something else — freeing the target wouldn't free those, so they don't count toward what you'd actually reclaim. Objects with the largest retained size are the heap's **dominators** — free (or shrink, or shorten the lifetime of) those first, since they account for the most reclaimable memory.

### Reading OutOfMemoryError messages correctly

The exact text after `OutOfMemoryError:` tells you which of four different problems actually occurred — conflating them wastes an incident:

```
"Java heap space"              — the heap itself is full; either undersized or genuinely leaking.
"Metaspace"                    — class metadata won't fit; classic symptom of a classloader leak
                                   (e.g. redeploying an app server repeatedly without old
                                   classloaders ever going out of scope).
"GC overhead limit exceeded"   — the JVM decided GC is thrashing: >98% of time in GC, reclaiming
                                   <2% of the heap each time, for 5 consecutive full GCs — a strong
                                   signal of a real leak, not just an undersized heap.
[native OOM, no Java text]     — not the Java heap at all; the OS refused a native memory request
                                   (JVM's own overhead, direct ByteBuffers, JNI, thread stacks).
```

Only "Java heap space" and "Metaspace" are reliably fixed by giving the JVM more memory *if* the application is simply undersized for its workload — for a real leak, more memory only postpones the same error.

## Trade-offs

- **A histogram is seconds and cheap; a heap dump is minutes and expensive** — reach for the histogram first (it also triggers a full GC, so don't run it during a latency-sensitive steady-state measurement), and only pull a full dump once the histogram tells you which class to investigate.
- **More heap doesn't fix a leak, it postpones the crash** — the tell is in the message: `GC overhead limit exceeded` specifically exists to fail fast instead of let an application grind at 98% GC time indefinitely, precisely so a leak surfaces as a crash instead of as silently-degraded latency.
- **Book vs today**: the specific `jcmd`/`jmap` commands and the shallow/deep/retained vocabulary here are unchanged and still exactly how MAT and modern IDE heap-dump viewers (e.g. IntelliJ Ultimate's built-in analyzer) describe things. One dated detail: `jvisualvm` was bundled with the JDK through JDK 8 but **has not shipped with the JDK since JDK 9** — it's now a separate download from the standalone VisualVM project, not a command that's just there.

## Documentation Links

- Scott Oaks, *Java Performance: The Definitive Guide*, 2nd Edition (O'Reilly, 2020) — Chapter 7 "Heap Memory Best Practices", "Heap Analysis" section, pp. 203-215 — book
- [jcmd — Java SE 25 Tool Specifications](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jcmd.html) — doc
- [OutOfMemoryError — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/OutOfMemoryError.html) — doc
- [Eclipse Memory Analyzer (MAT)](https://eclipse.dev/mat/) — doc
