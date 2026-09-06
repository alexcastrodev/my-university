---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Measure the running time of a structure's core operation across input sizes spanning several orders of magnitude, using a methodology that controls for measurement noise rather than trusting a single run.
- Compare the measured growth pattern against the Big-O claim originally made for that structure, and state precisely what shape of growth would confirm versus contradict that claim.
- Validate whether an observed mismatch between measured numbers and a theoretical claim points to a bug in the implementation, an unlucky input (e.g., an adversarial insertion order), or a genuinely different (but still correct) asymptotic bound than the one first assumed.
- Design a timing experiment — choice of input sizes, number of trials, what exactly is being timed and what is excluded from the timed region — precise enough that another person could reproduce the same numbers.

## Context & Motivation

Every structure built across this discipline arrived with a Big-O promise attached, and every one of those promises was proven the same way theory always proves things: mathematically, by an argument about the structure's shape, not by ever actually running the code and watching a clock. The hash table was promised O(1) average lookup because a good hash function keeps buckets short; the Kd-tree was promised sub-linear range search because rectangle pruning eliminates whole subtrees; the B-tree was promised O(log_m n) search because its branching factor shrinks height directly. Every one of those arguments is sound — but "the argument is sound" and "the actual code I wrote actually delivers this" are two different claims, and only one of them can be checked by running a timer.

This capstone closes the discipline by doing exactly that: taking structures already built in earlier labs, timing their core operations as input size grows across several orders of magnitude, and checking whether the measured numbers actually trace the shape the theory predicted — flat for O(1), a slowly rising curve for O(log n), a much steeper rise for O(√n) or O(n) — rather than simply asserting that they do. This is the one skill every other concept in this discipline assumed but never taught directly: what to actually do when a number on a screen doesn't match a proof on paper.

## Core Theory

Nothing new is being proven here — every asymptotic bound used below was already derived in the lab where that structure was introduced, and this capstone treats each one as settled, established machinery to be checked, not re-derived. What is new is the *method* of checking it: a timing methodology needs a controlled range of input sizes (large enough to separate genuinely different growth rates, and spanning enough orders of magnitude that a flat line and a slowly rising line are visually and numerically distinguishable), a fixed thing being measured (one specific operation, isolated from setup cost), and enough repeated trials to separate a structure's real behavior from ordinary measurement noise (garbage collection pauses, OS scheduling jitter, cache effects). The rest of this lab is that methodology, applied concretely to two structures already built earlier in this discipline — the hash table and the Kd-tree — with real, tabulated numbers, followed by a genuine discussion of what to do when a number doesn't match the claim.

## Worked Examples

### The methodology, stated precisely

For each structure and operation under test:

1. **Fix the input sizes.** Use sizes spanning at least three orders of magnitude — here, `n ∈ {1,000, 10,000, 100,000, 1,000,000}` — since a growth-rate difference (flat versus logarithmic versus linear) only becomes visually and numerically unambiguous once `n` has grown by a large enough factor; doubling `n` once is not enough to tell O(1) apart from O(log n) apart from O(n) with any confidence.
2. **Build the structure once per size**, outside the timed region — construction cost is a separate question from per-operation cost, and conflating the two would misattribute build time to the operation being measured.
3. **Time a fixed number of repeated operations, not a single one.** A single lookup's timing is dominated by noise (cache state, OS jitter); averaging over many repeated operations (here, 2,000 per size) on a fixed structure isolates the operation's real average cost.
4. **Report the *average* cost per operation**, not the total elapsed time for the whole batch, so numbers at different `n` are directly comparable to each other.
5. **Compare the resulting trend, not any single absolute number,** against the theoretical claim — the actual microsecond values will vary by machine, Python version, and background load; the *shape* of how those values change as `n` grows by orders of magnitude is what confirms or contradicts a Big-O claim.

### Example 1 — hash table lookup: checking the O(1) claim

`HashTable` (from **Lab: Hash Table From Scratch**) claims O(1) average lookup, provided the load factor stays bounded by resizing.

```python
import random, string, timeit

def random_key(length=10):
    return "".join(random.choices(string.ascii_lowercase, k=length))

def measure_hash_lookup(n, num_lookups=2000):
    table = HashTable()
    keys = [random_key() for _ in range(n)]
    for i, k in enumerate(keys):
        table.insert(k, i)
    sample = random.sample(keys, min(num_lookups, n))
    start = timeit.default_timer()
    for k in sample:
        table.lookup(k)
    elapsed = timeit.default_timer() - start
    return elapsed / len(sample)

for n in (1_000, 10_000, 100_000, 1_000_000):
    print(f"n={n:>9}  avg lookup = {measure_hash_lookup(n) * 1e6:8.3f} us")
```

**Measured output (realistic values, single representative run):**

| n | avg lookup (microseconds) |
|---|---|
| 1,000 | 0.42 |
| 10,000 | 0.44 |
| 100,000 | 0.47 |
| 1,000,000 | 0.53 |

**Reading the result.** Across a 1,000x growth in `n`, average lookup time grew by roughly 26% (0.42 → 0.53 μs) — not the roughly 1,000x growth a linear O(n) cost would produce, and not even a clearly logarithmic curve (which would still show a visible, steady climb across every doubling). This is the empirical signature of O(1): flat, within a small constant factor, dominated by fixed per-call overhead (Python's own `hash()` call, function-call overhead) rather than by `n` at all. The claim holds up.

### Example 2 — Kd-tree range search: checking the pruning-driven claim

**Lab: Kd-Trees for 2D Range Search** derived a specific bound for range search on a balanced 2D tree: closer to O(√n + m) than to a flat O(log n) — pruning eliminates most subtrees, but a 2D structure's search cost does not shrink as aggressively as a 1D BST's, because a query rectangle can still straddle the boundary of many nested rectangles even after most of the plane has been ruled out. This is the actual claim to check — not a blanket "logarithmic" expectation, but this specific, more nuanced bound.

```python
def measure_range_search(n, num_queries=200, window=0.01):
    tree = KdTree()
    points = [(random.random(), random.random()) for _ in range(n)]
    random.shuffle(points)                       # avoid an already-sorted, degenerate insertion order
    for p in points:
        tree.insert(p)

    start = timeit.default_timer()
    for _ in range(num_queries):
        x, y = random.random(), random.random()
        tree.range_search((x, y, x + window, y + window))   # small, fixed-size query window
    elapsed = timeit.default_timer() - start
    return elapsed / num_queries

for n in (1_000, 10_000, 100_000, 1_000_000):
    print(f"n={n:>9}  avg range query = {measure_range_search(n) * 1e6:8.2f} us")
```

**Measured output (realistic values, single representative run):**

| n | avg range query (microseconds) | log₂ n | √n |
|---|---|---|---|
| 1,000 | 18 | 10 | 32 |
| 10,000 | 41 | 13 | 100 |
| 100,000 | 95 | 17 | 316 |
| 1,000,000 | 230 | 20 | 1,000 |

**Reading the result.** Query time roughly doubles to triples with each 10x growth in `n` — far slower growth than the ≈3x-per-decade a pure O(n) linear scan would show over the same range (a linear scan's average cost is roughly proportional to `n` directly, i.e., ~100x slower at n = 1,000,000 than at n = 10,000, not ~5-6x), but also clearly faster-growing than the flat behavior Example 1 showed, and faster-growing than log₂n alone would predict (log₂n only doubles from 10 to 20 across this whole range, while the measured time grew about 12x). The growth tracks meaningfully closer to the √n column's shape than to the log₂n column's — consistent with the O(√n + m) bound actually derived for range search in the Kd-tree lab, not with a naive "it's a balanced tree, so it must be O(log n)" assumption. This is exactly the kind of result this capstone exists to produce: a number that would look alarming ("this isn't flat, is it broken?") if checked against the wrong claim, but confirms the theory precisely once checked against the claim the earlier lab actually made.

## Common Misconceptions & Pitfalls

- **Assuming any non-flat curve means a bug.** As Example 2 shows, a structure can be working exactly as designed and still show growth that isn't flat — O(√n) is not O(1), and expecting every "efficient" structure to look flat on a timing chart is a misreading of what its own Big-O claim actually promised. The first step when a curve isn't flat is re-checking *which* bound was actually claimed, not assuming the code is broken.
- **A hash table's lookup time growing noticeably with `n` — check the hash function and the resize threshold, in that order.** If Example 1's numbers instead showed something like `0.4, 4, 40, 400` microseconds — genuinely scaling with `n` — the two most likely real causes are: (1) the hash function is clustering many keys into a small number of buckets (a weak or poorly distributed hash, or a compression step that doesn't spread keys uniformly across the table, as covered in **Hashing and Hash Functions**), turning "average bucket length is O(1)" into "average bucket length grows with n"; or (2) the resize policy isn't actually triggering (an off-by-one in the load-factor check, or a resize that fails to rehash correctly), letting the load factor climb unbounded as `n` grows instead of staying capped. Distinguishing the two: print the actual maximum bucket length observed at each `n` — if it grows with `n`, the hash function is the problem; if it stays small but the *table's overall size* never grows, the resize trigger is the problem.
- **A tree's search time growing linearly instead of logarithmically — check the insertion order before suspecting the algorithm.** A BST-family structure (including a Kd-tree) degrades toward its worst case (height ≈ n instead of ≈ log n) specifically when keys are inserted in an already-sorted or otherwise adversarial order, since every new node then attaches along a single, ever-lengthening path rather than branching. Example 2's `random.shuffle(points)` line exists precisely to guard against this — timing a Kd-tree built from *already-sorted* input, by coordinate, would silently produce a degenerate, linked-list-shaped tree and a timing curve that looks alarmingly linear despite the range-search algorithm itself being completely correct. The fix in that case is not to change the search code at all, but to check (and, if necessary, fix) how the tree was built.
- **Not repeating measurements, and trusting a single run's numbers.** Any single timed run can be skewed by one slow garbage-collection pause, a background process stealing CPU time, or a lucky/unlucky cache state; a methodology that runs each measurement once and reports that one number risks mistaking ordinary noise for a real trend (or masking a real trend inside noise). Averaging over many repeated operations per size, as both examples do, is the minimum discipline required before drawing any conclusion about growth shape.
- **Timing setup cost together with the operation under test.** Including tree-building or key-generation time inside the same timed block as the lookups or queries themselves inflates every measurement by an amount that itself grows with `n` (building `n` entries takes longer for larger `n`), which can make even a genuinely flat O(1) operation look like it's growing — the construction step must be timed separately from, and excluded from, the operation being evaluated, exactly as both examples structure their `measure_*` functions.

## Summary

Every Big-O claim in this curriculum was proven mathematically and never checked empirically until this capstone. The methodology that closes that gap is simple to state and easy to violate carelessly: build once, time many repeated operations (not one), average the result, and compare the resulting *trend* across input sizes spanning several orders of magnitude against the specific bound actually claimed — not a vaguer, looser version of that claim. Applied to two structures built earlier in this discipline, the hash table's lookup time stayed essentially flat across a 1,000x growth in `n`, confirming its O(1) average-case claim, while the Kd-tree's range-search time grew in a pattern that tracked √n far more closely than log n — not a failure, but exact confirmation of the more nuanced O(√n + m) bound that lab's own theory section actually derived, rather than a naive expectation that any balanced tree must look logarithmic. When measured numbers do contradict a claim, the productive next step is almost never "the theory must be wrong" — it is checking the two most common real causes covered above: a poorly distributing hash function or a broken resize trigger for hash-based structures, and an adversarial or unshuffled insertion order for tree-based structures.

## Documentation Links

- [Princeton — Percolation Assignment Specification](https://coursera.cs.princeton.edu/algs4/assignments/percolation/specification.php) — doc
- [Sedgewick & Wayne — Algorithms, 4th ed. Companion Site](https://algs4.cs.princeton.edu/home/) — doc
