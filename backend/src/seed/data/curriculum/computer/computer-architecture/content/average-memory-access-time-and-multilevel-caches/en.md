---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- State the AMAT formula and explain what hit time, miss rate, and miss penalty each represent.
- Compute AMAT for a single-level cache given realistic hit time, miss rate, and miss penalty numbers.
- Extend the AMAT formula recursively across a real L1/L2/L3/DRAM hierarchy, where one level's miss penalty is itself another level's AMAT.
- Explain why local miss rate and global miss rate are different quantities, and why multilevel AMAT calculations must be careful about which one they use.
- Explain why real systems use multiple cache levels rather than one large, fast cache, referencing the associativity/size cost tradeoffs from earlier in this cluster.

## Context & Motivation

Every concept in this cluster so far — locality, mapping, associativity, replacement, write policy — has been building toward a single question: on average, how long does a memory access actually take, once all of this machinery is accounted for? Average Memory Access Time (AMAT) is the formula that answers this precisely, and ACM/IEEE CS2013's Architecture and Organization Knowledge Area names computing it, "under a variety of cache and memory configurations," directly as a required learning outcome — a curriculum-level confirmation that this formula, not just a qualitative understanding of caching, is core content.

This concept is also where the discipline's real memory hierarchy — not just one cache, but the full L1/L2/L3/DRAM pyramid from `the-memory-hierarchy-and-locality` — gets its precise, quantitative treatment for the first time: AMAT applies recursively, with each level's "miss penalty" simply being the AMAT of the level below it, letting the exact same formula describe one cache or an entire multilevel hierarchy.

## Core Theory

### The AMAT formula

```text
AMAT = Hit Time + Miss Rate × Miss Penalty
```

- **Hit Time**: how long it takes to determine a hit and return the requested data, when the access does hit — this includes the tag comparison and, for a higher-associativity cache, the extra time to check multiple ways (from `set-associative-and-fully-associative-caches`).
- **Miss Rate**: the fraction of accesses that miss this level.
- **Miss Penalty**: the *additional* time required, beyond the hit time already paid, to service a miss — typically dominated by the time to fetch the block from the next level down.

The formula's intuition: every access pays the hit time regardless of outcome (the cache always has to be checked first); on top of that baseline, a fraction of accesses (the miss rate) pay an *additional* penalty for having to go further down the hierarchy.

### Extending AMAT recursively across levels

The genuinely powerful move is recognizing that a cache level's miss penalty is not some independently given constant — it is, itself, the average time to access the *next* level of the hierarchy, which itself has its own hit time, miss rate, and miss penalty relative to the level below *it*:

```text
AMAT(L1) = HitTime(L1) + MissRate(L1) × MissPenalty(L1)
where MissPenalty(L1) = AMAT(L2)
so:   AMAT(L1) = HitTime(L1) + MissRate(L1) × AMAT(L2)

AMAT(L2) = HitTime(L2) + MissRate(L2) × AMAT(L3)
AMAT(L3) = HitTime(L3) + MissRate(L3) × (DRAM access time)
```

This recursive structure is exactly why the same simple formula, introduced for a single cache, scales cleanly to describe an entire multilevel hierarchy — each level is analyzed with the exact same equation, just with "miss penalty" understood as "however long the next level down actually takes on average."

### Local miss rate vs. global miss rate

A subtlety the recursive formula above depends on getting right: **local miss rate** is the fraction of accesses *that reach a given level* that miss it (for example, L2's local miss rate is computed only over the accesses that already missed L1 and were forwarded to L2). **Global miss rate** is the fraction of *all* original accesses (starting from L1) that end up missing a given level. L2's global miss rate is always lower than its local miss rate, precisely because L1 has already filtered out most of the easy hits before anything even reaches L2. The recursive AMAT formula above uses **local** miss rates at each level — each level's own miss rate, relative to the accesses it actually receives — which is exactly what makes the recursive structure correct.

## Worked Examples

### Example 1: Single-level AMAT with realistic numbers

An L1 cache has a hit time of 1 cycle, a miss rate of 5%, and a miss penalty of 20 cycles (the time to fetch from main memory, in a system with no L2):

```text
AMAT = 1 + 0.05 × 20 = 1 + 1.0 = 2.0 cycles
```

Even with a fairly good 95% hit rate, the *average* access still costs twice the pure hit time, purely because the 5% of misses are so much more expensive than a hit — a direct illustration of why even a "good" hit rate leaves real room for further optimization via a second cache level.

### Example 2: A full three-level hierarchy, computed recursively

```text
L1: Hit Time = 1 cycle,  Local Miss Rate = 5%
L2: Hit Time = 10 cycles, Local Miss Rate = 20% (of accesses that reach L2)
L3: Hit Time = 30 cycles, Local Miss Rate = 40% (of accesses that reach L3)
DRAM access time = 200 cycles
```

Working from the bottom up:

```text
AMAT(L3)  = 30 + 0.40 × 200        = 30 + 80   = 110 cycles
AMAT(L2)  = 10 + 0.20 × AMAT(L3)   = 10 + 0.20 × 110 = 10 + 22 = 32 cycles
AMAT(L1)  = 1  + 0.05 × AMAT(L2)   = 1  + 0.05 × 32  = 1 + 1.6 = 2.6 cycles
```

The overall AMAT experienced by the processor — 2.6 cycles — is dominated by the L1 hit time (1 cycle) plus a relatively small contribution from the rare, deeper misses, precisely because each successive level catches most of what the level above it missed, and only a shrinking fraction of accesses ever reach the slow, 200-cycle DRAM.

### Example 3: Converting a global miss rate into the recursive local form

Suppose a report gives L2's **global** miss rate (relative to all original accesses) as 1%, and L1's miss rate as 5%. Compute L2's **local** miss rate (needed for the recursive formula):

```text
Global miss rate of L2 = (fraction reaching L2) × (L2's local miss rate)
Fraction reaching L2   = L1's miss rate = 0.05
0.01 = 0.05 × (L2's local miss rate)
L2's local miss rate   = 0.01 / 0.05 = 0.20 (20%)
```

This confirms the relationship used implicitly in Example 2: L2's local miss rate (20%) is meaningfully higher than its global miss rate (1%) would suggest in isolation, because the global figure is diluted by the 95% of accesses that never even reach L2 in the first place — exactly the distinction this concept's Core Theory section warns must be tracked carefully.

## Common Misconceptions & Pitfalls

- **"A lower global miss rate for L2 than L1's own miss rate means L2 is a worse cache."** Example 3 shows the opposite conclusion is likely — L2's low global miss rate mostly reflects how few accesses even reach it (L1 already filtered most out), not necessarily that L2 itself is ineffective at catching what it does receive; its local miss rate is the fair measure of L2's own effectiveness.
- **"Miss penalty is a fixed hardware constant, unrelated to the rest of the hierarchy."** Example 2 shows the opposite: a level's miss penalty is precisely the AMAT of the level below it, which itself depends on that level's own hit time, miss rate, and its own miss penalty, recursively — nothing about it is an independent, freestanding number in a multilevel design.
- **"Since L1 already achieves a low miss rate, further cache levels add little value."** Example 1 shows even a good single-level hit rate (95%) leaves a meaningful average penalty (AMAT of 2.0, double the pure hit time); Example 2 shows adding L2 and L3 levels substantially reduces that overall AMAT (down to 2.6 cycles, despite DRAM itself costing 200 cycles) by catching most of what L1 misses before it ever reaches the truly slow level.
- **"AMAT is the same thing as CPU time."** AMAT measures memory access cost specifically; it feeds into the Iron Law's CPI factor (memory stalls raise the effective CPI, as this discipline's pipelining cluster already established for load-use hazards) but is not itself CPU time — it is one specific, quantifiable contributor to it.

## Summary

AMAT = Hit Time + Miss Rate × Miss Penalty is the formula this entire cluster has been building toward, and it extends recursively across a full multilevel hierarchy by treating each level's miss penalty as simply the AMAT of the level below it, using each level's *local* miss rate (relative to the accesses that actually reach it, not the global fraction of all original accesses) at every step. A realistic three-level hierarchy (Example 2) shows how each successive cache level catches most of what the level above it missed, keeping the overall AMAT close to the fastest level's hit time even though the slowest level (DRAM) remains orders of magnitude slower on its own. The next concept, Cache-Friendly Code and Locality in Practice, takes this formula out of the abstract and shows it acting on real, measurable code — the same algorithm, same complexity, running at genuinely different speeds purely based on memory access order.

## Documentation Links

- [ACM/IEEE CS2013 — Architecture and Organization Knowledge Area](https://csed.acm.org/knowledge-areas-architecture-and-organization-ar-cs2013-version/) — names computing Average Memory Access Time under varying cache configurations as a required learning outcome.
- [Bryant & O'Hallaron — Computer Systems: A Programmer's Perspective (CS:APP)](https://csapp.cs.cmu.edu/) — Chapter 6 develops AMAT and multilevel cache analysis with the same recursive structure.
