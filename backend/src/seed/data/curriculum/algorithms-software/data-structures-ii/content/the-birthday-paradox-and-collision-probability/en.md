---
version: 1.0
updatedAt: 2026-09-13
---
## Learning Objectives

- State the birthday paradox precisely: with just 23 people, there is better than even odds that two share a birthday, despite there being 365 possible birthdays.
- Derive the general formula for the probability of at least one collision among `n` items hashed into `m` slots, and explain why it grows so much faster than intuition suggests.
- Connect the birthday paradox directly to hash table collisions: a hash table starts accumulating collisions long before it is anywhere near full.
- Explain why this matters specifically for a *fixed* hash function under adversarial or merely unlucky input, motivating the next two concepts.
- Compute, for a concrete table size, the number of entries at which collisions become likely, not just possible.

## Context & Motivation

Data Structures I established what a collision is and how to resolve one, through chaining or open addressing, and the previous concept in this discipline's topic sequence on load factor showed how performance degrades as a table fills. What none of that material addressed directly is a genuinely counterintuitive question: at what point should a collision actually be *expected*? A natural but wrong intuition says "not until the table is close to full", reasoning by analogy to a nearly full parking lot where most spaces are already taken. Hash table collisions do not behave that way, and the reason is a famous piece of probability, usually introduced through birthdays rather than hash tables, that generalizes directly to explain why: with surprisingly few items and a surprisingly empty table, a collision is already more likely than not. This concept works out that surprising math itself; the next two concepts use it to explain two very different responses hash table design has taken to it.

## Core Theory

### The birthday paradox, stated and solved

The classic form of the question: how many people need to be in a room before there is a better than 50% chance that two of them share a birthday (ignoring leap years, so 365 equally likely birthdays)? Intuition, anchored on "365 is a big number," typically guesses somewhere in the hundreds. The actual answer is 23.

The calculation is easiest done by computing the probability of *no* shared birthday and subtracting from 1. With `k` people, the first person's birthday can be anything (probability 1); the second person's birthday must avoid the first's (probability 364/365); the third must avoid both previous ones (probability 363/365); and so on, down to the k-th person avoiding all `k-1` previous birthdays (probability (365-k+1)/365). Multiplying these together gives the probability of *no* collision among all `k` people:

```
P(no shared birthday) = (365/365) · (364/365) · (363/365) · ... · ((365-k+1)/365)
```

For `k = 23`, this product works out to approximately 0.493, meaning `P(at least one shared birthday) = 1 - 0.493 ≈ 0.507`, just over 50%. The reason this defies intuition is that the relevant quantity is not "how many people compared to 365 possible birthdays" (23 out of 365 does look small), but "how many *pairs* of people," since any pair could collide: with 23 people there are `C(23, 2) = 253` distinct pairs, and 253 independent-ish chances for a match, out of 365 possible birthdays, is a much more plausible source of a collision than 23 people alone suggests.

### Generalizing to n items and m slots

The exact same calculation, with 365 replaced by `m` (the number of hash table slots, playing the role of "possible birthdays") and 23 replaced by `n` (the number of keys hashed in, playing the role of "people"), gives the probability of at least one collision when `n` keys are hashed uniformly at random into `m` slots:

```
P(no collision) = (m/m) · ((m-1)/m) · ((m-2)/m) · ... · ((m-n+1)/m)
P(at least one collision) = 1 - P(no collision)
```

A commonly used approximation (valid when `n` is small relative to `m`, using `1 - x ≈ e^(-x)` for small `x`) simplifies this to:

```
P(no collision) ≈ e^(-n²/2m)
```

This approximation makes the key relationship explicit: the probability of a collision depends on `n²` relative to `m`, not on `n` relative to `m` the way load factor does. This `n²`-versus-`m` relationship is exactly why collisions become likely at roughly `n ≈ √m`, far earlier than `n` approaching `m` (which is what a "how full is the parking lot" intuition, or even load factor alone, would suggest).

### Why this matters for hash tables specifically

The direct consequence for a hash table with `m` slots is that collisions are not a rare edge case reserved for when the table is nearly full: with as few as roughly `√m` keys inserted (a load factor of only about `1/√m`, which can be a very small number for a large table), the probability of having encountered at least one collision already exceeds 50%. This is precisely why every practical hash table implementation must have a collision-resolution strategy from the very first insertions, not as a rare fallback: chaining and open addressing, covered in Data Structures I, are not defenses against an unlikely event, they are handling something the birthday paradox shows will happen early and often, even under a "fair," uniformly random hash function with no adversary involved at all.

## Worked Examples

### Example 1: verifying the 23-people, 365-day calculation

**Problem:** Confirm that with 23 people, the probability of a shared birthday exceeds 50%.

**Calculation:** Multiplying `(365/365) · (364/365) · (363/365) · ... · (343/365)` (23 terms, down to `365 - 23 + 1 = 343`) gives approximately 0.4927. So `P(at least one match) = 1 - 0.4927 ≈ 0.5073`, confirming the classic result: just over 50%, with only 23 people out of 365 possible birthdays.

### Example 2: finding the "50% collision" point for a hash table with m = 1,000,000 slots

**Problem:** Using the approximation `P(no collision) ≈ e^(-n²/2m)`, estimate how many keys `n` need to be hashed into a table of `m = 1,000,000` slots before the probability of at least one collision exceeds 50%.

**Setup:** Solve `e^(-n²/2m) = 0.5` for `n`. Taking the natural log of both sides: `-n²/2m = ln(0.5) ≈ -0.693`, so `n² = 2m · 0.693 = 1.386m`.

**Calculation:** With `m = 1,000,000`: `n² ≈ 1,386,000`, so `n ≈ 1177`.

**Interpretation:** With a table of one million slots, only about 1,177 keys (a load factor of roughly 0.00118, barely above one-tenth of one percent full) are enough to make a collision more likely than not. This is the concrete, numerical version of "far earlier than the table being nearly full" that Core Theory describes, and it is exactly the `n ≈ √m` relationship predicted there (√1,000,000 = 1,000, close to the 1,177 computed precisely).

## Common Misconceptions & Pitfalls

- **"A collision only becomes likely once the table is nearly full."** Example 2 shows the opposite for a large table: a collision becomes more likely than not with a load factor of about 0.1%, not anywhere close to the table filling up, because the relevant comparison is `n²` against `m`, not `n` against `m`.
- **"The birthday paradox is a cute trivia fact with no real computing application."** It is the exact same calculation, with different labels on the same two quantities (23 people, 365 birthdays becomes n keys, m slots), and it is the reason every hash table needs a real collision-resolution strategy starting from its very first insertions, not as a rare contingency.
- **"If collisions are this likely, hash tables must not actually be a good idea."** A hash table's O(1) average-case performance already accounts for collisions happening regularly, that is exactly what chaining's O(1 + alpha) and open addressing's probe-count formulas from Data Structures I are built to handle; the birthday paradox explains *why* those mechanisms are load-bearing from early on, it does not undermine the structure's practical value.
- **"This calculation assumes something special about hash tables that doesn't apply to a 'real' random process like birthdays."** The calculation is identical in both cases; the only assumption needed is that the mapping (birthday, or hash value) is close to uniformly random over its range, which is exactly the assumption a "good" hash function is designed to approximate, and exactly the assumption the next concept, universal hashing, formalizes and strengthens.

## Summary

The classic birthday paradox (23 people suffice for a better-than-even chance of a shared birthday among 365 possibilities) is not really about birthdays, it is about the number of *pairs* among `n` items growing much faster than `n` itself, and the same calculation, with `m` slots replacing 365 birthdays, applies directly to hash tables: the probability of at least one collision among `n` keys hashed into `m` slots is approximately `1 - e^(-n²/2m)`, becoming more likely than not once `n` reaches roughly `√m`, a load factor that can be a tiny fraction of 1 for a large table. This is precisely why collision resolution is a first-class, always-needed part of any hash table design, not a rare-case fallback, and it sets up a genuine question this discipline's next two concepts answer in two very different ways: universal hashing addresses collisions caused by an adversary who can predict a fixed hash function, and perfect hashing eliminates collisions entirely for a known, static set of keys.

## Documentation Links

- [MIT 6.042 - Mathematics for Computer Science (OCW)](https://ocw.mit.edu/courses/6-042j-mathematics-for-computer-science-fall-2010/): doc
- [Sedgewick & Wayne - Algorithms Lectures (Princeton)](https://algs4.cs.princeton.edu/lectures/): doc
