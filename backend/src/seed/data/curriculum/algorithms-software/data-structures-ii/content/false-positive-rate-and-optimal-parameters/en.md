---
version: 1.0
updatedAt: 2026-09-13
---
## Learning Objectives

- Derive the approximate false positive rate formula for a Bloom filter: `(1 - e^(-kn/m))^k`, starting from the probability a single bit remains 0.
- Derive the number of hash functions `k` that minimizes the false positive rate for fixed `m` and `n`, and state the clean result: `k = (m/n) · ln(2)`.
- Compute the required bit array size `m` to hit a target false positive rate for a known number of elements `n`.
- Explain the practical trade-off this formula makes explicit: false positive rate decreases exponentially in `m/n` (bits per element), a genuinely favorable exchange rate.
- Size a Bloom filter for a concrete real-world scenario, choosing both `m` and `k`.

## Context & Motivation

The previous concept established that a Bloom filter trades certainty for space by allowing false positives, but left the size of that trade entirely unquantified: how often, exactly, does a false positive happen, and what actually controls that frequency? This concept answers both questions with a single, remarkably clean derivation, arriving at a formula that turns filter design from guesswork into arithmetic: given how many elements will be inserted and how low a false positive rate is acceptable, the formula says precisely how large to make the bit array and how many hash functions to use.

## Core Theory

### Step 1: the probability a specific bit is still 0 after n insertions

Consider one specific bit position in the array, and assume (as an idealizing but standard assumption) that each of the `k` hash functions, for each of the `n` inserted keys, sets a uniformly random bit position, independent of every other hash computation. Each individual "set a bit" operation misses this specific position with probability `(1 - 1/m)`. There are `k · n` such independent bit-setting operations total (`k` per key, across `n` keys), so the probability this one specific bit is still 0 after all of them is:

```
P(bit is still 0) = (1 - 1/m)^(kn)
```

Using the standard approximation `(1 - 1/m)^m ≈ e^(-1)` for large `m` (the same limit that defines Euler's number), this simplifies to:

```
P(bit is still 0) ≈ e^(-kn/m)
```

### Step 2: the false positive rate

A false positive occurs on a query for some never-inserted key `y` precisely when all `k` of `y`'s hash positions happen to already be 1 (as the previous concept's Example 1 illustrated concretely). Treating each of those `k` positions as independently being 1 with probability `(1 - e^(-kn/m))` (one minus the "still 0" probability from Step 1, an approximation that is standard in this derivation even though the k positions are not perfectly independent in a real filter), the probability all `k` of them are 1 simultaneously is that probability raised to the `k`-th power:

```
P(false positive) ≈ (1 - e^(-kn/m))^k
```

This is the central formula of this concept: the false positive rate depends on exactly three quantities, the bit array size `m`, the number of hash functions `k`, and the number of inserted elements `n`, specifically through the ratio `m/n` (bits allocated per element) and the choice of `k`.

### Step 3: the optimal number of hash functions

For a *fixed* ratio `m/n`, the false positive rate formula from Step 2 can be minimized over choices of `k` using ordinary calculus (differentiating with respect to `k` and setting the result to zero). The result is a clean, memorable formula:

```
k_optimal = (m/n) · ln(2) ≈ 0.693 · (m/n)
```

This says the best number of hash functions is directly proportional to how many bits are allocated per element: more bits per element justifies using more hash functions, and at this optimal `k`, the false positive rate formula from Step 2 simplifies to:

```
P(false positive at k_optimal) ≈ (1/2)^k_optimal ≈ 0.6185^(m/n)
```

This final form is the one worth internalizing: the false positive rate shrinks *exponentially* as more bits per element are allocated, a genuinely favorable exchange rate that is exactly why Bloom filters are practical in the first place. Doubling the bits-per-element roughly squares how small the false positive rate becomes (since it is an exponential in `m/n`), a dramatically better return than, say, a linear improvement would offer.

### Sizing a filter for a target false positive rate

Design in practice runs this chain of formulas in reverse: given a target false positive rate `p` and a known (or well-estimated) number of elements `n`, solve `p ≈ 0.6185^(m/n)` for `m/n`, then choose `k = (m/n) · ln(2)` rounded to the nearest integer. Concretely, taking the natural log of both sides of `p ≈ 0.6185^(m/n)` gives:

```
m/n ≈ ln(p) / ln(0.6185) ≈ -1.44 · ln(p)
m ≈ -1.44 · n · ln(p)
```

## Worked Examples

### Example 1: computing the false positive rate for a concrete filter

**Problem:** A Bloom filter has `m = 10,000,000` bits, `k = 7` hash functions, and `n = 1,000,000` elements inserted. Estimate the false positive rate.

**Calculation:** `kn/m = 7 · 1,000,000 / 10,000,000 = 0.7`. So `P(bit still 0) ≈ e^(-0.7) ≈ 0.4966`, meaning `P(bit is 1) ≈ 0.5034`. The false positive rate is then `(0.5034)^7 ≈ 0.0082`, roughly 0.82%, meaning about 1 in every 122 queries for a genuinely absent key would incorrectly report "possibly in the set."

### Example 2: sizing a filter for a target 1% false positive rate with 10 million elements

**Problem:** A system expects to insert `n = 10,000,000` elements and wants a false positive rate of at most `p = 0.01` (1%). Determine `m` and `k`.

**Solving for m:** `m ≈ -1.44 · n · ln(p) = -1.44 · 10,000,000 · ln(0.01) = -1.44 · 10,000,000 · (-4.605) ≈ 66,312,000` bits, about 8.3 MB (66,312,000 / 8 bits per byte).

**Solving for k:** `k_optimal = (m/n) · ln(2) ≈ (66,312,000 / 10,000,000) · 0.693 ≈ 6.63 · 0.693 ≈ 4.6`, rounded to `k = 5` (or the nearest practical integer, commonly rounded down or checked at both 4 and 5 to see which gives a rate closer to the target).

**Interpretation:** Roughly 8.3 MB of memory and 5 hash functions gives about a 1% false positive rate for 10 million elements, versus the far larger memory an actual set of 10 million keys (each potentially many bytes long) would require to store directly, illustrating exactly the space-for-certainty trade this discipline's Bloom filter concepts have been building toward.

## Common Misconceptions & Pitfalls

- **"Using more hash functions always makes a Bloom filter more accurate."** Example 1 and the k_optimal formula show this is false past a certain point: too many hash functions set too many bits per insertion, filling the array faster and *raising* the false positive rate; there is a genuine optimum, `k = (m/n) · ln(2)`, not a "more is always better" relationship.
- **"The false positive rate depends mainly on m and k, with n playing a secondary role."** The formula's structure (`kn/m` inside the exponent) shows `n` is just as central as `m` and `k`; specifically, it is the *ratio* `m/n` (bits budgeted per element) that determines the achievable false positive rate, which is exactly why Example 2's sizing calculation starts from an expected `n` before choosing `m`.
- **"A 1% false positive rate means exactly 1 in 100 real-world queries will be wrong."** The formula gives the probability for a query on a key that was genuinely never inserted; if most queries in practice are for keys that *were* inserted (which never produce false positives, per the previous concept), the real-world observed error rate across all queries can be considerably lower than the formula's headline percentage suggests.
- **"Since this derivation uses approximations, the formula is not reliable for real system design."** The approximations (treating hash outputs as independent, using `e^(-1)` in place of `(1-1/m)^m`) are standard and well-validated against exact calculations and empirical measurement for realistic `m` and `n`; production systems (databases, network routers, browsers) size real Bloom filters using exactly this formula.

## Summary

A single bit remains 0 after `n` insertions with `k` hash functions each with probability approximately `e^(-kn/m)`, and a false positive requires all `k` of a queried key's bit positions to be 1 simultaneously, giving a false positive rate of approximately `(1 - e^(-kn/m))^k`. Minimizing this over `k` for a fixed bits-per-element ratio `m/n` gives the clean optimum `k = (m/n) · ln(2)`, at which the false positive rate simplifies to roughly `0.6185^(m/n)`, shrinking exponentially as more bits per element are allocated. This turns Bloom filter design into simple arithmetic: choose a target false positive rate and an expected element count, solve for the required `m`, and derive `k` from the optimal-k formula, exactly as Example 2 works through for a concrete 10-million-element, 1%-target scenario. This closes out this discipline's arc through hashing-based structures: from ordinary hash tables (certain answers, collision-bound performance) through universal hashing (certain answers, adversary-resistant performance) and perfect hashing (certain answers, zero collisions for static sets) to Bloom filters (uncertain "maybe" answers, but at a small, precisely quantifiable and controllable cost, in exchange for space no exact structure can match).

## Documentation Links

- [Bloom, B. H. (1970). "Space/Time Trade-offs in Hash Coding with Allowable Errors." Communications of the ACM.](https://dl.acm.org/doi/10.1145/362686.362692): paper
- [MIT 6.006 - Lecture Notes (OCW)](https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/pages/lecture-notes/): doc
