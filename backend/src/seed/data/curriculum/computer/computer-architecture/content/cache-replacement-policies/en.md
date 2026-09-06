---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Explain why a replacement policy is only a meaningful question once a cache has more than one way per set.
- Describe the Least Recently Used (LRU) policy and the locality-based reasoning behind it.
- Explain why exact LRU is expensive to implement for higher associativity, and describe a real, cheaper approximation.
- Compare LRU against FIFO and random replacement, and give a concrete access pattern where LRU outperforms FIFO.
- Trace which block gets evicted under LRU for a given sequence of accesses within one set.

## Context & Motivation

The previous concept gave a set-associative cache more than one place a block *could* go within a set — but it deliberately left open exactly which of the N ways gets chosen when a new block needs to be brought in and every way in the target set is already occupied. That choice matters: pick well, and the block evicted is one unlikely to be needed again soon; pick poorly, and the cache evicts a block right before it would have been reused, turning what could have been a hit into an avoidable miss.

This concept is naturally connected to the very first idea of this cluster's memory hierarchy discussion: temporal locality, the empirical observation that a recently used location is likely to be used again soon. Every serious replacement policy is, at its core, an attempt to operationalize that same principle into a concrete, implementable eviction rule.

## Core Theory

### Why replacement is trivial under direct mapping

Direct mapping (one way per set) never actually needs a replacement policy: when a set (of one) already holds a block and a new block maps to it, there is exactly one occupant to evict — no choice exists. The question this concept develops only becomes meaningful, and interesting, once a set has two or more ways to choose among, which is exactly why it comes after set associativity in this cluster's sequence.

### Least Recently Used (LRU): operationalizing temporal locality directly

The **LRU** policy evicts whichever way in the target set was accessed longest ago, among the ways in that set. The reasoning is a direct, literal application of temporal locality: if a block hasn't been touched in a while, relative to its set-mates, it's a reasonable bet that it's less likely to be touched again soon than the blocks that *have* been accessed more recently. Exact LRU requires tracking a full, valid recency ordering across every way in a set, updated on every single access to that set — for a 2-way set, this is cheap (one bit suffices, flipped to indicate which way was accessed most recently); for higher associativity (say, 8-way or 16-way), tracking an exact ordering of 8 or 16 items requires meaningfully more state and more complex update logic on every access.

### Why real hardware often approximates LRU instead

Because exact LRU's hardware cost grows faster than linearly with associativity, many real cache designs use a cheaper approximation instead of the exact policy — for example, a "pseudo-LRU" scheme using a small binary tree of single bits to approximately track recency with far less state than an exact ordering would require, or a "clock" / "not-recently-used" style scheme (familiar from the operating-system page-replacement literature this discipline's `operating-systems-i` will develop further) that periodically clears "used" bits and evicts among the ones not recently marked. These approximations sacrifice some precision for meaningfully cheaper hardware, and in practice perform close enough to exact LRU that the difference rarely matters for overall system performance.

### FIFO and random: simpler alternatives, with real tradeoffs

**FIFO** (first-in, first-out) evicts whichever way's block was brought into the cache longest ago, regardless of how recently it was actually *used* — cheap to implement (a single counter per set, cycled among ways), but it can evict a block that was just accessed a moment ago simply because it happened to arrive early, ignoring the actual access pattern LRU is designed to track. **Random** replacement picks a way to evict uniformly at random — trivially cheap in hardware (no state to maintain across accesses at all) and, surprisingly, performs reasonably well in practice for higher associativities, because with enough ways, the odds of randomly evicting the one block about to be reused are simply low.

## Worked Examples

### Example 1: LRU correctly avoiding a bad eviction that FIFO makes

Consider a 2-way set, initially holding blocks A (brought in first) and B (brought in second, and also the most recently *accessed*, since it was just fetched). A subsequent access sequence for this set: access A (making A the most recently used), then a new block C needs to be brought in.

```text
Access order so far: A brought in, B brought in, A accessed again.
Recency (LRU):  B is now least recently used (A was just re-accessed; B hasn't
                 been touched since it was originally brought in).
FIFO order:      A was brought in first, so FIFO would evict A regardless of
                 the fact that A was JUST accessed.

LRU evicts:  B   (correct — B is genuinely the least recently touched)
FIFO evicts: A   (poor choice — A was just accessed, and is now gone)
```

This is precisely the scenario where LRU's extra bookkeeping pays for itself: FIFO, ignoring actual usage, evicts the block that was just proven to still be relevant, while LRU correctly protects it.

### Example 2: Tracing exact LRU across a longer access sequence in a 4-way set

Starting with an empty 4-way set, and the access sequence P, Q, R, S, P, T (accessing block T requires an eviction, since the set is now full with P, Q, R, S):

```text
After P: [P]                    (P most recent)
After Q: [P, Q]                 (Q most recent)
After R: [P, Q, R]              (R most recent)
After S: [P, Q, R, S]            (S most recent; set now full)
After P (again): recency order becomes Q, R, S, P
                 (Q is now LEAST recently used, having not been touched
                  since it was originally brought in)
Bring in T: evict Q (least recently used) → set becomes [R, S, P, T]
```

Q is evicted specifically because every other block in the set (R, S, and the just-re-accessed P) has been touched more recently than Q — exactly the bookkeeping exact LRU requires to make this determination correctly.

### Example 3: A pathological access pattern where even LRU performs poorly

Consider a loop that cycles through exactly 5 distinct blocks, repeatedly, inside a 4-way set (one too many blocks for the available ways): access order A, B, C, D, E, A, B, C, D, E, ... repeating.

```text
By the time A is accessed again (the 6th access in the cycle), it was
evicted long ago (LRU evicted it after the 4th subsequent access, since
it became the least recently used the moment B, C, D, E were each
touched after it) — every single access in this pattern is a MISS,
under LRU, FIFO, or random alike, because the working set (5 blocks)
simply exceeds the associativity (4 ways) available in this one set.
```

This is a genuine limitation shared by *every* replacement policy, not a flaw specific to LRU — no eviction rule can prevent a miss when the set of blocks genuinely in active use exceeds the number of ways available to hold them; that is a capacity limitation, not a replacement-policy failure, and is the exact motivation for choosing associativity and total cache size large enough for a program's real working set in the first place.

## Common Misconceptions & Pitfalls

- **"LRU is always the best possible policy."** LRU is a good heuristic based on temporal locality, but Example 3 shows it offers no protection at all once the number of actively cycled blocks exceeds the available ways — no replacement policy can fix a genuine capacity shortfall, only a bigger cache or higher associativity can.
- **"Real hardware always implements exact LRU."** Exact LRU's hardware cost grows quickly with associativity; many real designs use cheaper approximations (pseudo-LRU, clock-style schemes) that perform close enough to exact LRU in practice to justify the simpler, cheaper hardware.
- **"Random replacement is a naive, poor choice compared to LRU."** For higher associativities specifically, random replacement performs surprisingly competitively with LRU in practice, and its trivial hardware cost (no per-access state update needed at all) is a real, legitimate engineering advantage in some designs.
- **"FIFO and LRU always produce the same eviction decision."** Example 1 shows a concrete case where they diverge — FIFO tracks only arrival order, ignoring whether a block was subsequently re-accessed, while LRU explicitly re-orders on every access to reflect actual recent usage.

## Summary

A replacement policy only matters once a set has more than one way, and its job is to pick, among a full set's occupants, which one to evict for an incoming block — Least Recently Used (LRU) operationalizes temporal locality directly by evicting whichever way was touched longest ago, though exact LRU's hardware cost grows with associativity, motivating cheaper real-world approximations; FIFO (arrival order, ignoring reuse) and random replacement are simpler alternatives with their own real tradeoffs, and no policy at all can prevent a miss once a working set genuinely exceeds the ways available, a capacity limitation no eviction rule can paper over. Having now covered how blocks are found (mapping and associativity) and which one gets evicted (replacement), the next concept turns to the other side of the cache's job — what happens on a *write*, rather than a read.

## Documentation Links

- [Bryant & O'Hallaron — Computer Systems: A Programmer's Perspective (CS:APP)](https://csapp.cs.cmu.edu/) — Chapter 6 discusses cache replacement policies alongside associativity and locality.
- [CMU 15-213 — Cache Memories Lecture](http://www.cs.cmu.edu/afs/cs/academic/class/15213-s14/www/lectures/11-cache-memories.pdf) — covers LRU and its role in set-associative cache design.
