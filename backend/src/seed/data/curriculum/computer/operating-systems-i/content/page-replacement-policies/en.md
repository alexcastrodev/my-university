---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Explain why physical memory filling up forces the OS to choose a page to evict when a new page must be brought in.
- Trace FIFO, optimal, and LRU page replacement on the same reference string, and count the page faults each produces.
- Explain why optimal (evict the page used furthest in the future) is a theoretical best case, not implementable in practice.
- Explain the intuition behind LRU as a practical approximation of optimal, and why it usually — but not always — outperforms FIFO.

## Context & Motivation

Paging, as covered so far, has implicitly assumed physical memory always has room for whatever pages a process currently needs. Real systems run many processes at once, competing for a finite, usually much smaller amount of physical memory than the sum of everyone's virtual address spaces — so at some point, bringing in a new page requires evicting an existing one to make room. **Which** page to evict is a genuine policy question, and different reasonable-sounding answers produce measurably different numbers of subsequent page faults on the identical sequence of memory references — precisely analogous to the cache-replacement-policy question already covered for data caches in this platform's `computer-architecture` discipline, now applied one level further down the memory hierarchy, to physical page frames instead of cache lines.

## Core Theory

### The problem, precisely

Given a fixed number of physical frames and a sequence of page references (a **reference string**) that exceeds what fits simultaneously, an eviction decision must be made every time a referenced page isn't currently resident and no free frame is available. Each such event where the needed page isn't already in memory is a **page fault** — the metric every replacement policy in this concept is judged by: fewer page faults for the same reference string and frame count means a better policy for that workload.

### FIFO: evict whichever page has been resident longest

**First-in-first-out (FIFO)** replacement evicts whichever currently-resident page was brought into memory earliest, regardless of how recently or how often it has actually been used since. It is simple to implement (just a queue of resident pages, in load order) but can perform surprisingly poorly, since a page's mere age in memory says nothing about whether it's still actively being used.

### Optimal: the unimplementable best case

**Optimal replacement (Bélády's algorithm)** evicts whichever currently-resident page will be referenced furthest in the future (or never again at all). This provably minimizes the total number of page faults for a given reference string and frame count — but it requires knowing the *future* sequence of references in advance, which a real running system generally cannot know. Optimal is used exclusively as a theoretical yardstick: real policies are compared against how close they come to optimal's page-fault count on the same workload, not implemented directly, in the same spirit that SJF's scheduling optimality (covered earlier in this discipline) required knowing job lengths in advance and was likewise unimplementable directly in general.

### LRU: approximate optimal using the past instead of the future

**Least-recently-used (LRU)** evicts whichever currently-resident page has gone the longest *without* being referenced. The intuition: a page used recently is likely (by the same locality principle already covered for the TLB and for caching in general) to be used again soon, so the page that has sat unused the longest is the best available guess for "won't be needed again soon" — a practical, implementable proxy for optimal's unavailable knowledge of the actual future. LRU is not always as good as optimal (it can be fooled by access patterns that violate typical locality), but it is generally the strongest practical policy among the ones covered here, and real systems approximate it (exact LRU tracking has its own overhead, addressed by various practical approximations beyond this discipline's depth).

## Worked Examples

### Example 1: FIFO on a concrete reference string

Reference string: `1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5` with 3 physical frames available.

```text
Ref:  1    2    3    4    1    2    5    1    2    3    4    5
      -----------------------------------------------------------
F1:   1    1    1    4    4    4    5    5    5    5    4    4
F2:        2    2    2    1    1    1    1    1    1    1    5
F3:             3    3    3    2    2    2    2    3    3    3
Fault: F    F    F    F    F    F    F    F    -    F    F    F

FIFO total faults: 10 (out of 12 references)
```

(FIFO evicts the oldest-loaded frame each time a fault occurs and no free frame remains — for instance, at reference 4, frame 1 holding page 1 is evicted since it was loaded first among 1,2,3.)

### Example 2: Optimal on the identical reference string

Same reference string, same 3 frames, using Bélády's rule — evict whichever resident page is used furthest in the future:

```text
Ref:  1    2    3    4    1    2    5    1    2    3    4    5
      -----------------------------------------------------------
F1:   1    1    1    1    1    1    1    1    1    1    4    4
F2:        2    2    2    2    2    2    2    2    2    2    5
F3:             3    4    4    4    5    5    5    3    3    3
Fault: F    F    F    F    -    -    F    -    -    F    F    F

Optimal total faults: 8 (out of 12 references)
```

At reference 4 (a fault, since frames hold 1,2,3), optimal evicts page 3 rather than page 1 — because looking ahead, page 3 isn't referenced again until position 10, while page 1 is needed again almost immediately at position 5. Optimal achieves 8 faults versus FIFO's 10 on the identical reference string and frame count — a direct, measured demonstration that eviction choice matters, using nothing but a different rule for which page to evict.

### Example 3: LRU on the identical reference string, and the comparison

Same reference string, same 3 frames, evicting whichever resident page was least recently referenced:

```text
Ref:  1    2    3    4    1    2    5    1    2    3    4    5
      -----------------------------------------------------------
F1:   1    1    1    4    4    4    5    5    5    5    4    4
F2:        2    2    2    1    1    1    1    1    1    1    5
F3:             3    3    3    2    2    2    2    3    3    3
Fault: F    F    F    F    F    F    F    -    -    F    F    F

LRU total faults: 9 (out of 12 references)
```

```text
Summary on this reference string, 3 frames:
  FIFO:    10 faults
  Optimal:  8 faults  (theoretical best, requires future knowledge)
  LRU:      9 faults  (practical, uses only past references)
```

LRU lands between FIFO and optimal here — worse than the unimplementable ideal, but better than the naive age-based FIFO rule, by using actual reference history (which page went longest without being touched) rather than merely how long ago a page was first loaded.

## Common Misconceptions & Pitfalls

- **"FIFO evicts the least recently used page, just tracked by load order."** FIFO tracks only *when a page was loaded*, not when it was last *referenced* — a page loaded long ago but referenced constantly since (and thus clearly still needed) can still be evicted under FIFO purely because of its old load time, a real weakness LRU is specifically designed to avoid.
- **"Optimal replacement is a real, implementable policy that should just be used."** Optimal requires knowing the future reference sequence in advance — information a running system does not have — which is precisely why it exists only as a theoretical yardstick for judging how close practical policies (like LRU) come to the best possible result.
- **"LRU always performs at least as well as FIFO on every reference string."** LRU is generally stronger in practice because most real workloads exhibit the locality it exploits, but it is not mathematically guaranteed to beat FIFO on every conceivable reference string — some adversarial or unusual access patterns can favor one or the other differently; the general superiority is empirical and locality-dependent, not an absolute guarantee.
- **"A page fault always means something is broken or the program has a bug."** A page fault, in this context, is simply the event of a referenced page not currently being resident in memory — an entirely ordinary, expected part of normal paging operation whenever physical memory is smaller than the sum of everything being used, not necessarily a sign of an error (a genuinely invalid/unmapped access is a different condition).

## Summary

When physical memory fills up, bringing in a new page requires evicting a resident one, and different eviction policies produce measurably different page-fault counts on the identical reference string. **FIFO** evicts by load order alone, ignoring actual usage since loading, and can perform poorly as a result. **Optimal** (Bélády's algorithm) evicts whichever page is needed furthest in the future, provably minimizing faults — but requires future knowledge no real system has, making it a theoretical yardstick rather than an implementable policy. **LRU** evicts whichever resident page has gone longest without being referenced, using only past behavior as a practical, locality-based proxy for optimal's unavailable foresight — generally outperforming FIFO in practice, as the worked example's concrete fault counts (FIFO 10, LRU 9, optimal 8) demonstrate on one specific reference string. The next concept turns to what happens around these page faults at a system level: how demand paging decides when to bring pages in at all, and what happens when the demand for physical memory across all running processes exceeds what's actually available.

## Documentation Links

- [Arpaci-Dusseau — Operating Systems: Three Easy Pieces, "Beyond Physical Memory: Policies"](https://pages.cs.wisc.edu/~remzi/OSTEP/vm-beyondphys-policy.pdf) — the canonical treatment of FIFO, optimal, and LRU page replacement this concept is built from.
- [ACM/IEEE CS2013 — Operating Systems Knowledge Area](https://csed.acm.org/knowledge-areas-operating-systems-os-cs2013-version/) — curriculum guidelines establishing page-replacement policy comparison as core virtual memory content.
