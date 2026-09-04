---
version: 1.0
updatedAt: 2026-09-04
---
## Objective

Understand why the JVM's moving, generational collectors never actually "free" an object the way `malloc`/`free` or a reference-counting GC does — they compact the still-reachable ones and let everything else be — and why that design deliberately trades RAM for CPU. The JVM needs a memory manager at all because the OS's own abstraction, virtual memory, is leaky: it doesn't know where your references live, so it can't reclaim memory on your behalf.

## Use Cases

- Diagnosing why a service's GC CPU cost went up — and telling apart "allocation rate rose" from "heap headroom shrank," which call for different fixes.
- Justifying generous heap headroom for an in-memory cache using the generational cost formula instead of a hunch about what "feels" wasteful.
- Explaining precisely why a moving collector "has no `free()`" in a performance/system-design interview instead of a vague "GC is slow."
- Recognizing when a claim about GC behavior belongs to a *specific* collector (Parallel, G1, ZGC) versus the shared moving/generational design all of them build on.

## Deep Dive

### Four ways to manage heap memory, four different cost shapes

Every non-trivial program has to recycle heap memory, and the strategy for doing that determines what you pay for it:

```
manual (malloc/free — C, Zig)
  footprint == live set (the minimum possible)
  CPU cost  ∝ allocation rate      (every allocation is eventually matched by a free)

reference counting (Swift, CPython, C++ shared_ptr, Rust Rc)
  footprint == live set (also the minimum — objects die the instant they're unreachable)
  CPU cost  ∝ allocation rate      (same shape as manual: a "malloc and free" per object,
                                     plus counter-update overhead, worse across threads)

arena / bump allocation, no collector (ergonomic in Zig; awkward in C, Rust, C++)
  footprint == arena capacity, freed all at once when the arena/scope ends
  CPU cost  ≈ near zero per allocation, but nothing individual is reclaimed early

moving / generational GC (every collector in the JDK)
  footprint == live set + heap headroom H
  CPU cost  ∝ (live set × allocation rate) / H     where H = heap capacity − live set
```

The first two strategies optimize for the smallest possible footprint and pay for it in CPU: double the allocation rate and you double the CPU spent managing memory, full stop — there's no knob to turn that back down except allocating less. (Rust's `Box` and C++'s `unique_ptr` sidestep the reference counter entirely for values with exactly one owner, and some compilers can prove a counter is unnecessary and drop it — but the shape of the cost doesn't change for anything that *is* shared.) An arena sidesteps per-object bookkeeping altogether by reclaiming everything at once, at the cost of never reclaiming one long-lived object early. A moving collector accepts a bigger footprint than any of these on purpose, because that extra headroom `H` sits in the denominator of its cost — and headroom is a knob you control directly with `-Xmx`.

### What a moving collector actually does during a collection cycle

A moving collector never inspects a dead object at all — it never sees it. A collection cycle has two phases: **mark** (trace from roots — locals, static fields — to find every still-reachable object) and **compact** (copy those live objects to the bottom of the heap, then keep bump-allocating from there). Anything not reached by the mark phase is simply left behind when the live objects are copied away; there is no "identify garbage and reclaim it" step the way `free()` or a refcount hitting zero implies:

```
before GC:  [ live ][ dead ][ live ][ dead ][ dead ][ live ][ ... free space ... ]
after GC:   [ live ][ live ][ live ][ ......... free space, bump-allocate here ......... ]
```

This is why doubling the allocation rate and doubling `-Xmx`'s headroom cancel out: the cost formula's numerator (live set × allocation rate) doubled, but so did the denominator (`H`), so the CPU spent per collection cycle is unchanged — you just bought back the throughput with RAM instead of with less garbage.

### Generational collection: turning multiplication into addition

The formula above still has an uncomfortable property: cost grows with live-set size too, which is bad news for anything that wants to cache a lot of data in RAM. Generational collection fixes this by splitting the heap in two and exploiting the **weak generational hypothesis** — most objects die young:

```
young generation (small)     old generation (large)
  live set ≈ small (ε_y)       allocation rate ≈ low (ε_o)
  collected often               collected rarely
       │  survives a few cycles →  promoted
       └──────────────────────────────►
```

A **write barrier** records whenever a mutation stores a young reference into an old object, so a young collection can treat the (small) recorded set plus the usual roots as its starting points instead of re-scanning the entire old generation on every minor GC. With that split, the cost formula becomes additive instead of multiplicative:

```
cost ≈ (liveSet_young × allocRate_young) / H_young    +    (liveSet_old × allocRate_old) / H_old
         └── liveSet_young is tiny (ε) ──┘                  └── allocRate_old is tiny (ε) ──┘
```

Doubling the *allocation rate* still doubles the cost (as it must, for any strategy) — but doubling the *live set* (e.g. growing an in-memory cache) barely moves the needle, because that growth lands almost entirely in the old generation, where the allocation rate — not the live set — is what's small. That's the mechanism that makes a bigger cache cheap to keep resident, unlike in `malloc`/`free` or reference counting, where cost tracks allocation rate regardless of what you're caching.

This is also why an in-memory cache is the exception to a pattern that otherwise holds: for ordinary program data, a lower-CPU workload usually means both a lower allocation rate *and* a smaller live set, because reading more data requires more processing. A cache breaks that link — it's computationally inert, just sitting there waiting to be read — so its live set doesn't shrink along with CPU usage the way everything else does. Generational GC's old-generation headroom is exactly what makes carrying that inert live set affordable.

One honest caveat about the formula itself: it appears to predict infinite CPU cost as headroom `H` approaches zero, which looks alarming but is really just an artifact of assuming a constant allocation rate. In reality, as GC consumes more and more CPU, the application gets fewer cycles left to allocate with, so the allocation rate itself falls before the formula's singularity is ever actually reached. Treat it as a useful first-order model of the trade-off, not a physical law.

### Scaling cores without scaling heap

One concrete pattern makes the formula tangible: add threads or cores to a workload, and the allocation rate rises accordingly — if `-Xmx` stays fixed, GC activity rises sharply right along with it, since the denominator `H` didn't move while the numerator did. Add roughly 100 MB of extra heap per added core, though — well under the 1+ GB per core the underlying hardware already bundles — and GC overhead plateaus back down to match a manual or reference-counting baseline. More cores add allocation-rate-independent-of-live-set (exactly the old generation's ε term from above), so headroom scaling with core count is what keeps the formula's ratio, and therefore GC's CPU share, roughly constant.

## Trade-offs

- **Moving/generational GC deliberately trades RAM for CPU — that's the whole design.** More heap headroom is a direct, mechanical lever on the cost formula above, not a vague "throw hardware at it" hack:
  ```
  same 200 MB live set, same allocation rate:
    malloc/free or refcounting     footprint ≈ 200 MB      CPU: pays malloc+free per object, fixed
    generational moving GC         footprint ≈ 200 MB + H  CPU: falls as H grows — a knob, not a fact
  ```
  Whether that trade is usually the economically correct one to make given real hardware pricing is a separate question — see [Sizing the JVM Heap: RAM/CPU Economics in Practice](/jvm-concepts/heap-sizing-economics).
- **Passing a raw object pointer across the FFI boundary is harder with a moving collector**, since a GC cycle can relocate the object mid-call — one real reason low-level and embedded languages have historically leaned on manual memory management even though it costs more CPU. It's also why the [Foreign Function and Memory API](/java-concepts/foreign-function-and-memory-api) has to pin or copy memory it hands to native code instead of passing a bare Java reference across.
- **A production-grade moving/generational collector is a decade-scale engineering investment**, which is why only the best-resourced runtimes ship one (the JDK, .NET's CLR, V8). A smaller-team language without one has a real but smaller lever available instead: allocate more aggressively on the stack to lower the allocation rate in the first place — which is what Go does. That only shrinks the formula's numerator, though; it doesn't change the underlying cost shape the way a moving collector's headroom denominator does.
- **Java's upcoming value classes (Project Valhalla) are commonly assumed to be a stack-allocation optimization for reducing GC pressure — they're not.** Their primary motivation is heap *layout*: flattening an object's fields into its container instead of storing a pointer to a separately-allocated instance, which removes a pointer indirection and a per-object header regardless of where the object ends up living.
- **This whole calculus assumes the stack stays a small slice of memory next to the heap** — true for a normal thread count, but virtual threads can exist by the hundreds of thousands, each with its own stack. Whether that shifts the RAM/CPU trade-off meaningfully is outside this concept's scope, but it's worth not assuming stack memory is always negligible.
- **Production-grade, fully concurrent collectors with no stop-the-world pauses are very new technology.** The first to run on commodity hardware was Zing's, released in 2010 but proprietary; the first open-source one, Generational ZGC, shipped only in JDK 21 (2023, [JEP 439](https://openjdk.org/jeps/439)). A pause-time complaint about Java based on experience from much earlier likely predates the collector that fixed exactly that complaint.

## Documentation Links

- [HotSpot Virtual Machine Garbage Collection Tuning Guide — Java SE 25](https://docs.oracle.com/en/java/javase/25/gctuning/introduction-garbage-collection-tuning.html) — doc
- [JEP 439: Generational ZGC](https://openjdk.org/jeps/439) — doc
- [Andrew W. Appel, "Garbage Collection Can Be Faster Than Stack Allocation", Information Processing Letters 25(4), 1987](https://www.cs.princeton.edu/~appel/papers/45.pdf) — doc
