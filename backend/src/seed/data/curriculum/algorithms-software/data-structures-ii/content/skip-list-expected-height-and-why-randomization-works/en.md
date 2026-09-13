---
version: 1.0
updatedAt: 2026-09-13
---
## Learning Objectives

- Derive the probability that a given element reaches level `k`: exactly (1/2)^k, directly from the independent coin-flip process.
- Derive the expected number of elements at level `k`, and use it to argue the skip list's expected height is O(log n).
- State, and give the intuition for, the expected search cost of O(log n), by relating the number of levels to the number of "drop down" moves a search performs.
- Explain precisely what is being averaged over when a skip list's performance is called "expected": repeated runs with independent coin flips, not repeated runs over different input distributions.
- Compare the constants involved (in expectation) to AVL and red-black trees' worst-case bounds, and state honestly what randomization buys and what it costs.

## Context & Motivation

The previous two concepts built the skip list structure and worked out its search, insertion, and deletion mechanics in full detail, but every claim about performance so far ("expected O(log n)") has been asserted rather than derived. This concept closes that gap with two short, genuinely illuminating calculations: first, exactly how many elements are expected to reach any given level, which explains why the number of levels itself is expected to be O(log n); and second, why a search's cost is tied directly to the number of levels, giving expected O(log n) search (and, since insertion and deletion reuse the same downward pass, the same expected bound for them too). This is the same style of probabilistic reasoning already used elsewhere in this curriculum for randomized quicksort's expected O(n log n) running time, applied here to a data structure's shape instead of a sorting algorithm's comparison count.

## Core Theory

### The probability an element reaches level k

Recall the level-assignment process: an element is always at level 0, and for each level above that, an independent fair coin flip decides whether it is promoted one further level (continuing on heads, stopping on tails). Reaching level `k` (for `k ≥ 1`) requires the coin to come up "promote" `k` times in a row, an event whose probability, since each flip is independent, is simply the product of `k` individual probabilities of one-half each:

```
P(element reaches level k) = (1/2)^k
```

This is a direct consequence of the coin-flip process defined in the first concept of this topic, not an additional assumption: it is exactly the same reasoning as asking "what is the probability of flipping heads four times in a row," applied to "how many times in a row does this element get promoted."

### Expected number of elements at level k

With `n` total elements in the skip list, and each one independently reaching level `k` with probability `(1/2)^k`, linearity of expectation (summing each element's individual, possibly-fractional "contribution" to the count, without needing the elements' outcomes to be otherwise related) gives the expected number of elements present at level `k`:

```
E[elements at level k] = n · (1/2)^k
```

This immediately shows why the levels shrink geometrically going up: level 0 has (in expectation) all `n` elements, level 1 has `n/2`, level 2 has `n/4`, and so on, exactly matching the "express lane" picture from the first concept, now backed by an actual formula rather than just a diagram.

### Why the expected height is O(log n)

The skip list's height is the highest level that has at least one element on it. Setting the expected count `n · (1/2)^k` equal to a small constant (say, 1) and solving for `k` gives the level at which the expected count drops to about one element:

```
n · (1/2)^k = 1
2^k = n
k = log₂ n
```

This is a heuristic, not a rigorous proof of the bound (a fully rigorous derivation uses a proper tail bound on the maximum of `n` geometric random variables, which is standard but more involved than this discipline needs to reproduce in full), but it correctly identifies the key quantity and its order: the expected height of a skip list built from `n` elements is Θ(log n), the same order as an AVL or red-black tree's *worst-case* height, achieved here purely through the coin-flip process with no bookkeeping, no rotations, and no invariant to check.

### Why expected search cost is also O(log n)

A search, as the previous concept detailed, does exactly one of two things at each step: move right on the current level, or drop down one level. The number of "drop down" moves across an entire search is bounded by the skip list's height itself, at most one drop per level, so that count is O(log n) by the height argument just given. The number of "move right" moves is bounded, in expectation, by a small constant per level: intuitively, once a search has dropped to a given level, it can only have arrived just after the last "checkpoint" element that level promoted from the level below, so on average it takes only a small constant number of rightward moves before either finding the target or needing to drop down again (this is the same geometric-distribution reasoning used to derive the expected number of elements at each level, applied here to "how far right before the next promoted element appears"). Combining an O(log n) bound on drops with an O(1)-per-level expected bound on rightward moves gives an overall expected search cost of O(log n), and since insertion and deletion reuse that same downward pass (as the previous concept showed), they inherit the identical expected O(log n) bound.

### What "expected" actually averages over

It is worth being precise about the randomness being averaged over here, since it is a common point of confusion. A skip list's expected O(log n) bound is an average over the coin flips the skip list's own implementation makes internally, at insertion time, not an average over different possible inputs or insertion orders. This means the bound holds *regardless of what values are inserted or in what order*, in sharp contrast to a plain, unbalanced BST, whose O(n) worst case is specifically triggered by an unlucky *input* (sorted-order insertion), something a hostile or unlucky caller can actually cause. No caller, however adversarial, can force a skip list into its (theoretically possible but vanishingly unlikely) O(n) worst case, because that worst case would require the skip list's own internal coin flips to conspire against it, something entirely outside any caller's control. This is exactly the same style of guarantee randomized quicksort's expected O(n log n) bound provides against adversarial input orderings, applied here to a data structure's shape rather than a sorting algorithm's pivot choices.

## Worked Examples

### Example 1: computing expected level populations for n = 1,000,000

**Problem:** For a skip list holding n = 1,000,000 elements, compute the expected number of elements at levels 0, 10, and 20, and the expected height.

**Level 0:** E = 1,000,000 · (1/2)^0 = 1,000,000 (every element, as expected).

**Level 10:** E = 1,000,000 · (1/2)^10 = 1,000,000 / 1024 ≈ 976.6 elements.

**Level 20:** E = 1,000,000 · (1/2)^20 = 1,000,000 / 1,048,576 ≈ 0.95 elements, already close to the "about one element" threshold used to estimate height.

**Expected height:** k = log₂(1,000,000) ≈ 19.9, consistent with the level-20 calculation showing the expected count has just dropped below one element there, matching the O(log n) claim precisely for this n.

### Example 2: comparing to the red-black bound for the same n

**Problem:** Compare this skip list's expected height (≈20, from Example 1) to the red-black tree worst-case height bound for the same n = 1,000,000 (computed in an earlier concept as ≈40).

**Comparison:** The skip list's *expected* height (≈20) is noticeably smaller than the red-black tree's *worst-case* height bound (≈40) for the same n, though this is not quite an apples-to-apples comparison: one is an average-case figure and the other a guaranteed upper bound. What is directly comparable is the order of growth: both are Θ(log n), and both, in practice, deliver fast, predictable performance for real workloads of this size, arrived at through entirely different mechanisms (coin flips versus enforced invariants).

## Common Misconceptions & Pitfalls

- **"Expected O(log n) means the skip list is usually faster than a red-black tree."** The two bounds measure different things (expected height with unbounded but improbable worst case, versus guaranteed worst-case height) and are not directly comparable as stated; Example 2's numerical comparison is illustrative for one specific n, not a general claim that one structure is "faster" than the other in all cases.
- **"The O(log n) height bound is derived the same rigorous way as AVL's Fibonacci-based bound."** The derivation in this concept is a heuristic (setting the expected count to a constant and solving), correctly capturing the order of growth but not a fully rigorous high-probability bound; a complete derivation exists in the literature (via Chernoff-style tail bounds) but is beyond what this concept needs to establish the key intuition.
- **"Expected performance means the skip list behaves inconsistently from run to run in a way that matters in practice."** The expectation is over internal coin flips with a probability distribution so concentrated around log n (for any reasonably large n) that observed heights vary very little run to run in practice; it is not the same kind of unpredictability as, say, cache misses or garbage collection pauses.
- **"Since search is expected O(log n), so is every individual search, always."** Any single search could, in a vanishingly unlikely worst case, take O(n) time (if the coin flips happened to produce an almost entirely flat structure with no meaningful higher levels); "expected" describes the average over the random construction process, not a per-call guarantee.

## Summary

Each element reaches level k with probability (1/2)^k, a direct consequence of needing k consecutive "promote" coin flips, and linearity of expectation turns this into an expected count of n·(1/2)^k elements at level k. Setting that count to a small constant and solving shows the skip list's expected height is Θ(log n), and since a search's cost is bounded by that height (drops) plus a small constant per level (rightward moves), search, insertion, and deletion all inherit an expected O(log n) cost. Crucially, this expectation is taken over the skip list's own internal coin flips, not over the input or insertion order, so no caller, adversarial or otherwise, can force the (theoretically possible but exponentially unlikely) O(n) worst case, the same style of guarantee randomized quicksort provides for sorting. This closes out the case for skip lists as a genuine, principled alternative to AVL and red-black trees: same expected order of growth, radically simpler mechanics, at the cost of a worst-case guarantee traded for an overwhelmingly favorable probabilistic one.

## Documentation Links

- [Pugh, W. (1990). "Skip Lists: A Probabilistic Alternative to Balanced Trees." Communications of the ACM.](https://epaperpress.com/sortsearch/download/skiplist.pdf): paper
- [Stanford CS166 - Data Structures](https://web.stanford.edu/class/cs166): doc
