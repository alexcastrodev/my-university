---
version: 1.0
updatedAt: 2026-09-13
---
## Learning Objectives

- Describe a Bloom filter's structure: a bit array of size m, plus k independent hash functions, with no keys ever actually stored.
- Implement the insert operation (set k bits to 1) and the membership test (check if all k bits are 1) precisely.
- Explain why a Bloom filter can produce false positives but can never produce a false negative, and derive that guarantee directly from the insert and query mechanics.
- Explain why standard Bloom filters cannot support deletion, and identify the trade-off (bit array size versus false positive rate) this structure makes explicit.
- Identify realistic use cases where an occasional false positive is an acceptable cost for large memory savings.

## Context & Motivation

Every hash-based structure covered so far in this discipline, ordinary hashing, universal hashing, and perfect hashing, shares one commitment: they all actually store the keys (or at least enough information to recover them), so that a lookup can answer "is this key present" with total certainty. That certainty has a cost, storing n keys takes space proportional to n (and, for a hash table, typically noticeably more than n once slack space for load factor is accounted for). For some real workloads, an enormous set membership check happens far more often than an actual retrieval, and a small, well-understood chance of error would be an entirely acceptable price for a dramatic reduction in memory: a web crawler checking "have I already visited this URL" against billions of URLs, a database checking "might this key exist on disk before paying for an expensive disk read," or a spell-checker checking "is this a real word" against a large dictionary. Burton Bloom introduced exactly this trade-off in 1970: a structure that answers membership queries using a small, fixed amount of memory, independent of how large or complex the keys themselves are, by giving up perfect certainty in one specific, carefully bounded direction.

## Core Theory

### The structure: a bit array and k hash functions, nothing else

A **Bloom filter** consists of a bit array of `m` bits, initialized entirely to 0, and `k` independent hash functions `h_1, h_2, ..., h_k`, each mapping any possible key to an index in `{0, 1, ..., m-1}`. That is the entire structure. Crucially, no key is ever stored anywhere, only bits are ever set, which is exactly what makes the memory footprint independent of the keys' own size or complexity: a Bloom filter for a set of long URLs takes exactly as much space as one for a set of single characters, given the same `m` and `k`.

### Insertion: set k bits

To insert a key `x`, compute all `k` hash values `h_1(x), h_2(x), ..., h_k(x)`, and set the bit at each of those `k` positions in the array to 1 (if a bit is already 1, from this or a previous insertion, it simply stays 1, nothing is undone or overwritten).

### Membership query: check k bits

To test whether a key `x` might be in the set, compute the same `k` hash values, and check whether *every one* of those `k` positions currently holds a 1. If even a single one of them is 0, the answer is a certain **"definitely not in the set"** (explained below). If all `k` are 1, the answer is **"possibly in the set"**, not a certainty.

### Why false negatives are impossible

This asymmetry (a confident "no," an uncertain "yes") follows directly from how insertion works. If `x` was genuinely inserted at some point, every one of its `k` bits was set to 1 at that time, and bits, once set, are never cleared by any later insertion of a *different* key, only ever set (an insertion can only turn a 0 into a 1, never a 1 back into a 0). So if `x` was ever inserted, all `k` of its bits are guaranteed still 1 at query time, no matter what else has been inserted since, and the query is guaranteed to answer "possibly in the set." A **false negative**, the filter claiming a key is absent when it was in fact inserted, is therefore structurally impossible: it would require some bit that was set to 1 at insertion time to have flipped back to 0, an operation the structure never performs.

### Why false positives are possible

The reverse direction has no such guarantee. It is entirely possible for a key `y` that was *never* inserted to have all `k` of its hash positions already set to 1, purely because *other*, genuinely inserted keys happened to set those same bit positions along the way. When this happens, querying `y` incorrectly reports "possibly in the set," a **false positive**: the bit array cannot distinguish "these bits are 1 because y itself was inserted" from "these bits are 1 purely because of coincidental overlap with other keys' bit positions," since no key identity is ever recorded, only bits. This possibility is not a bug to be fixed, it is the specific, quantifiable price a Bloom filter charges for its extreme space efficiency, and the next concept derives exactly how large that price is and how to control it.

### Why deletion is not supported (in the standard version)

Removing a key naively would mean clearing its `k` bits back to 0, but that is unsafe in general: any of those `k` bit positions might also have been set by some other, still-present key's insertion (since many keys can share a hash position, that is exactly the mechanism behind false positives), so clearing a bit could silently turn a currently-present key into a false negative for a totally unrelated key, violating the one guarantee (no false negatives) the structure is specifically built never to violate. The standard Bloom filter therefore supports only insertion and query, not deletion; a variant called a **counting Bloom filter** (using small counters instead of single bits, decrementing rather than clearing on removal) exists specifically to add deletion support back in, at the cost of additional memory per slot, but that is beyond what this concept needs to establish.

## Worked Examples

### Example 1: tracing insertion and query on a small filter

**Problem:** A Bloom filter has `m = 10` bits (all initially 0) and `k = 2` hash functions. Insert `"cat"` (with `h_1("cat") = 1`, `h_2("cat") = 4`) and `"dog"` (with `h_1("dog") = 4`, `h_2("dog") = 7`). Then query `"cat"`, `"dog"`, and `"bird"` (with `h_1("bird") = 1`, `h_2("bird") = 7`).

**After both insertions:** Bits 1, 4 (from "cat"), and 4, 7 (from "dog") are set to 1. The array, indices 0 through 9, reads: `0 1 0 0 1 0 0 1 0 0`.

**Query "cat":** Check bits 1 and 4: both are 1, so the answer is "possibly in the set," correctly (it was in fact inserted).

**Query "dog":** Check bits 4 and 7: both are 1, so the answer is "possibly in the set," correctly.

**Query "bird":** Check bits 1 and 7: both happen to be 1 (bit 1 was set by "cat," bit 7 was set by "dog"), so the answer is "possibly in the set," even though "bird" was never inserted: a **false positive**, arising purely from the coincidental overlap of "bird"'s hash positions with bits that two entirely different keys happened to set.

### Example 2: confirming no false negative is possible, even after many insertions

**Problem:** After inserting 1,000 more unrelated keys into the filter from Example 1 (none of them "cat"), query "cat" again. Argue why the answer must still correctly report "possibly in the set."

**Argument:** Every one of those 1,000 insertions can only ever set bits to 1 (never clear a bit back to 0), so bits 1 and 4 (set when "cat" was originally inserted) remain 1 regardless of what else has happened to the array since. Querying "cat" again checks the same two positions, finds them still both 1, and correctly reports "possibly in the set." No amount of subsequent activity on a Bloom filter can ever turn a true positive into a false negative, exactly the guarantee Core Theory derives structurally from the fact that insertion never clears a bit.

## Common Misconceptions & Pitfalls

- **"A Bloom filter can tell you a key is definitely present."** It can never do that: even a query that returns "possibly in the set" carries some chance of being a false positive (Example 1's "bird" query shows this concretely); the only certain answer a Bloom filter ever gives is "definitely not in the set."
- **"Bloom filters store the keys in a compressed form."** No key is ever stored, in compressed form or otherwise, only bit positions computed from hash functions are ever set; this is exactly why the space cost is independent of key size or complexity, and exactly why individual keys cannot be recovered or enumerated from the filter afterward.
- **"You can delete a key from a Bloom filter by clearing its k bits."** Example 1 shows bit positions are routinely shared between different keys ("cat" and "dog" both touch bit 4); clearing a shared bit to remove one key would incorrectly turn a different, still-present key into a false negative, violating the filter's one absolute guarantee. Deletion requires a different variant (a counting Bloom filter) built specifically to support it safely.
- **"A false positive rate means the structure is unreliable and shouldn't be used for anything important."** The false positive rate is a known, precisely computable quantity (the next concept derives the exact formula), not an unpredictable defect, and it is tunable by choosing `m` and `k` appropriately; systems like web browsers' malicious-URL checks and database storage engines' "does this key possibly exist on disk" checks use Bloom filters specifically because that known, tunable rate is acceptable in exchange for the space saved.

## Summary

A Bloom filter answers set-membership queries using only a bit array of size `m` and `k` independent hash functions, never storing any key directly. Insertion sets `k` bits per key; a query checks whether all `k` of a key's bit positions are currently 1, answering "possibly in the set" if so and "definitely not in the set" otherwise. Because insertion only ever sets bits (never clears them), a key that was truly inserted always has all its bits still set at query time, making false negatives structurally impossible, but keys that were never inserted can still have all their bit positions coincidentally set by other keys, making false positives possible and, unlike a hash table's collisions, an accepted, quantifiable cost rather than something to eliminate. This asymmetry, plus the resulting inability to safely support deletion, is exactly the trade a Bloom filter makes for space usage that is independent of key size and dramatically smaller than actually storing the keys. The next concept derives exactly how large that false positive rate is, as a function of `m`, `k`, and `n`, and how to choose `m` and `k` to hit a target rate.

## Documentation Links

- [Bloom, B. H. (1970). "Space/Time Trade-offs in Hash Coding with Allowable Errors." Communications of the ACM.](https://dl.acm.org/doi/10.1145/362686.362692): paper
- [Sedgewick & Wayne - Algorithms Lectures (Princeton)](https://algs4.cs.princeton.edu/lectures/): doc
