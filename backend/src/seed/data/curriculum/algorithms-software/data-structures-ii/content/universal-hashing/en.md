---
version: 1.0
updatedAt: 2026-09-13
---
## Learning Objectives

- Explain the adversarial argument against any single, fixed hash function: an adversary who knows the function can always construct n keys that all collide.
- State the definition of a universal family of hash functions precisely: for any two distinct keys, the probability of a collision, over a random choice of function from the family, is at most 1/m.
- Describe, at a conceptual level, how a concrete universal family (multiply-mod-prime) is constructed and why choosing a fresh random function per hash table instance is the actual defense.
- Distinguish what universal hashing protects against (an adversary choosing keys before the function is chosen) from what it does not (an adversary who somehow learns the function after it is fixed).
- Explain why universal hashing lowers the expected cost per operation back to O(1) even under adversarial key choice, connecting back to the birthday paradox's collision-probability argument.

## Context & Motivation

The previous concept showed that collisions are not a rare edge case, they become likely astonishingly early, at roughly `n ≈ √m` keys, purely from the birthday paradox, with no adversary required at all. That argument assumed keys were hashed uniformly at random, which is exactly true for the birthday problem itself but is an assumption worth questioning for a hash table: what if the keys are not random, because whoever is choosing them knows exactly which hash function the table uses?

This is not a hypothetical concern. Any specific, fixed hash function, no matter how carefully designed, has some fixed set of keys that all map to the same slot (this is unavoidable: a hash function maps a much larger key space down to `m` slots, so by pigeonhole, some `m+1` keys must collide somewhere, and in practice, entire buckets' worth of keys collide together). An adversary who knows the exact hash function a system uses, which is a realistic threat in any system accepting untrusted input (a web server hashing request headers into a table, for instance), can precompute a large set of keys that all collide, submit them, and degrade every operation from O(1) to O(n), a genuine denial-of-service vector documented in real systems. Universal hashing is the answer: instead of committing to one fixed function an adversary could study in advance, commit to a randomly chosen function from a well-designed family, chosen fresh, at runtime, in a way the adversary cannot predict before choosing their keys.

## Core Theory

### The adversarial argument, made precise

For any fixed hash function `h` mapping keys to `m` slots, and for any set of `m + 1` or more keys, pigeonhole guarantees at least two of them collide under `h`. In practice, far worse is achievable: because `h` is a deterministic, publicly knowable function (its source code, or at least its general design, is usually not a secret), an adversary can simply compute `h(k)` for many candidate keys `k` offline, and select an arbitrarily large collection that all hash to the very same slot. Submitting that collection turns every one of that hash table's operations into an O(n) linked-list (or probe-sequence) walk, for as long as the same fixed `h` is used. No single fixed hash function can defend against this, because the adversary's only requirement is knowing `h` in advance, something that holds for every fixed function, however cleverly constructed.

### The definition of a universal family

The fix does not try to build one hash function immune to this attack (no such function exists), it instead builds a **family** of hash functions, `H`, with a specific statistical property, and picks one member of that family at random, at runtime, after the adversary has already had to commit to (or at least, before the adversary can observe) which member was chosen. Formally, `H` is a **universal family** if, for any two *distinct* keys `x` and `y`, when `h` is drawn uniformly at random from `H`:

```
P(h(x) = h(y)) ≤ 1/m
```

The key word is *any*: this bound must hold for every possible pair of distinct keys, including ones an adversary picked specifically hoping they would collide. What defeats the adversary is that the *function* is now the random variable, not the keys: the adversary can fix their keys in advance all they like, but they cannot know, at the time they choose those keys, which member of `H` will be drawn, so they cannot engineer a pair guaranteed to collide the way they could against one fixed, known `h`.

### A concrete construction: the multiply-mod-prime family

One well-known, practical universal family (due to Carter and Wegman, 1979) works over integer keys as follows: fix a prime `p` larger than the largest possible key value, and define, for any choice of integers `a` in `{1, ..., p-1}` and `b` in `{0, ..., p-1}`:

```
h_{a,b}(k) = ((a·k + b) mod p) mod m
```

The family `H` is the set of all such functions, one for each valid choice of `(a, b)`. Choosing a hash function for a new hash table instance means picking `a` and `b` uniformly at random (once, when the table is created) and using that one `h_{a,b}` for every key inserted afterward. It can be shown, through a counting argument on how many `(a, b)` pairs make two given distinct keys collide, that this family satisfies the `P(h(x)=h(y)) ≤ 1/m` bound exactly. The details of that counting proof are a standard exercise in a course with more room for it than this concept has; the important takeaway is that such families are known to exist, are cheap to compute (one multiplication, one addition, two mod operations), and are used in real hash table implementations specifically to defend against the adversarial scenario just described.

### Why this restores O(1) expected performance

With a fresh, randomly chosen `h_{a,b}` for every table instance, the adversary is back to facing what is, from their perspective, an unpredictable function, exactly the situation the previous concept's birthday-paradox analysis assumed in the first place (uniformly random hashing). The universal property directly bounds the *expected* number of other keys any given key collides with: summing the `≤ 1/m` collision probability over all `n-1` other keys gives an expected number of collisions per key of at most `(n-1)/m = alpha` (the load factor from Data Structures I), which is exactly the same `O(1 + alpha)` expected chain length that ordinary chaining analysis assumed under a "nice" hash function, now proven to actually hold, even against an adversary, as long as the adversary commits to their keys without knowing which `(a, b)` will be drawn.

## Worked Examples

### Example 1: why one specific fixed hash function is always breakable

**Problem:** Suppose a hash table always uses `h(k) = k mod 8` (m = 8 slots), and an adversary knows this. Construct 5 keys that all collide.

**Construction:** Any keys congruent to each other mod 8 collide: `k = 0, 8, 16, 24, 32` all satisfy `k mod 8 = 0`. An adversary who knows the formula can generate as many such keys as desired, offline, with no guessing involved, and submitting them all forces every one of them into the same bucket or probe sequence, degrading every subsequent operation touching them to O(n).

### Example 2: computing a universal hash and verifying the guarantee is per-family, not per-instance

**Problem:** Using `h_{a,b}(k) = ((a·k + b) mod p) mod m` with `p = 17`, `m = 8`, `a = 3`, `b = 5`, compute `h_{a,b}(4)` and `h_{a,b}(12)`, and explain what the universal property does and does not guarantee about this specific pair.

**Calculation:** `h(4) = ((3·4 + 5) mod 17) mod 8 = (17 mod 17) mod 8 = 0 mod 8 = 0`. `h(12) = ((3·12 + 5) mod 17) mod 8 = (41 mod 17) mod 8 = 7 mod 8 = 7`. These two keys do not collide under this particular `(a, b)` choice.

**What the guarantee does and does not say:** The universal property guarantees that, *averaged over all possible choices of `(a, b)`*, the probability that keys 4 and 12 collide is at most 1/8. It says nothing about this one specific `(a, b) = (3, 5)` in isolation, some choices of `(a, b)` will make 4 and 12 collide, others (like this one) will not; the guarantee is about the family as a whole, which is exactly why the defense requires actually choosing `(a, b)` randomly and keeping it unknown to an adversary in advance, rather than publishing one fixed, "good" pair once.

## Common Misconceptions & Pitfalls

- **"A universal hash function guarantees no two specific keys will ever collide."** It guarantees the opposite framing: for any two distinct keys, the collision probability *over the random choice of function* is bounded, but for one specific, already-chosen function, some pairs of keys absolutely will collide (Example 2 shows this can go either way depending on which `(a, b)` happens to be drawn).
- **"Universal hashing means using a 'more random-looking' hash formula, like adding more multiplications."** The property being engineered is a formal probabilistic guarantee over an entire family of functions, provable by a counting argument, not a vague sense that the output "looks" scrambled; a formula can look complicated and still fail to be universal, and a simple one like the multiply-mod-prime family can be proven universal exactly.
- **"Once a universal hash function is chosen for a table, it protects against future adversarial keys just as well as it did against past ones."** The defense relies on the adversary not knowing which `(a, b)` was drawn *before* choosing their keys; if the specific chosen function later becomes known (leaked, or inferred from observed behavior), an adversary can then construct a colliding set against that specific function, exactly as in Example 1. Universal hashing defends against a worst-case *input*, not a scenario where the function itself is also compromised.
- **"This is only a theoretical concern; no real system is actually attacked this way."** Algorithmic-complexity denial-of-service attacks exploiting predictable hash functions in real web frameworks and language runtimes (several affecting production systems handling untrusted form or JSON keys) are well documented, which is exactly why many mainstream language runtimes seed their default string hash function randomly at process startup, a direct, practical application of this concept's idea.

## Summary

No single, fixed hash function can resist an adversary who knows it: pigeonhole guarantees colliding keys exist, and knowing the formula lets an adversary find them offline and submit them, degrading every operation to O(n). Universal hashing defends against this not by building an unbreakable function (none exists) but by drawing a fresh function, uniformly at random, from a family `H` satisfying `P(h(x) = h(y)) ≤ 1/m` for every pair of distinct keys, so that an adversary who must commit to their keys before the function is drawn cannot engineer a guaranteed collision. A concrete, practical family (multiply-mod-prime, due to Carter and Wegman) achieves this bound with a cheap arithmetic formula, and choosing its parameters randomly at table-creation time restores the O(1 + alpha) expected performance the birthday paradox showed cannot be taken for granted under a fixed, known function. The next concept addresses a related but different problem: when the full set of keys is known in advance (a static dictionary), collisions can be eliminated entirely, not just bounded in expectation.

## Documentation Links

- [Carter, J. L., & Wegman, M. N. (1979). "Universal Classes of Hash Functions." Journal of Computer and System Sciences.](https://www.sciencedirect.com/science/article/pii/0022000079900448): paper
- [MIT 6.006 - Lecture Notes (OCW)](https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/pages/lecture-notes/): doc
