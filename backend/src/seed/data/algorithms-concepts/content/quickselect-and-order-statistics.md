---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand the selection problem — finding the k-th smallest element of an unordered array (the median being the special case k = N/2) — and how to solve it faster than sorting first. Quickselect reuses the sibling quicksort concept's own partition routine, but recurses into only the one side known to contain the k-th element, giving expected O(N) time. Cormen's median-of-medians algorithm goes further, guaranteeing O(N) even in the worst case.

## Use Cases

- Finding a median, percentile, or top-k cutoff without paying for a full O(N log N) sort — e.g. computing the median of a batch of latency samples, or picking a score cutoff for the top 10% of results.
- A natural interview follow-up to quicksort: "you just implemented quicksort — now find the k-th smallest element without sorting the whole array."
- A baseline to compare against `PriorityQueue`-based top-k (the TopM pattern from the sibling quicksort concept's Use Cases) — quickselect is the in-place, single-pass alternative when the whole collection already fits in an array in memory.

## Deep Dive

### The selection problem: why sorting first is wasteful

Given an unordered array and an integer `k`, the selection problem asks for the k-th smallest element — not the fully sorted array, just one entry of it. The obvious solution is to sort and index:

```java
Quick.sort(a);
return a[k];   // correct, but pays for a full sort you don't need
```

This works because after a full sort, `a[k]` is trivially the k-th smallest — but it costs O(N log N), the same as sorting the *entire* array, even though the problem only asked for one order statistic out of N. When k is a constant fraction of N (the median, k = N/2, is the canonical hard case — it's easy when k is very small or very large, e.g. the minimum or maximum), it's possible to do asymptotically better: find just the k-th smallest in expected linear time, without fully ordering anything else in the array.

### Quickselect: partition once, recurse into only one side

The key move both books share: reuse the sibling quicksort concept's partition routine unchanged, but instead of recursing into *both* halves like quicksort does, recurse into only the *one* half known to contain the k-th element — the other half's work is discarded entirely, never even visited.

Recall what the sibling concept's `partition(a, lo, hi)` guarantees: it returns an index `j` such that `a[lo..j-1]` are all ≤ `a[j]` and `a[j+1..hi]` are all ≥ `a[j]`. That's exactly the information needed to decide which side holds the k-th smallest element, without looking at either side's contents:

```java
int quickselect(int[] a, int lo, int hi, int k) {
    if (hi <= lo) return a[lo];
    int j = partition(a, lo, hi);      // sibling quicksort concept's partition, unchanged
    if (j == k)      return a[j];      // pivot landed exactly on the target rank — done
    else if (j > k)  return quickselect(a, lo, j - 1, k);   // k is in the left part
    else              return quickselect(a, j + 1, hi, k);  // k is in the right part
}
```

Sedgewick & Wayne's own `select()` (their Applications section, following priority queues) expresses the identical logic as an iterative loop instead of a recursion, shuffling the array first to guard against adversarial input:

```java
public static Comparable select(Comparable[] a, int k) {
    StdRandom.shuffle(a);
    int lo = 0, hi = a.length - 1;
    while (hi > lo) {
        int j = partition(a, lo, hi);
        if      (j == k) return a[k];
        else if (j > k)  hi = j - 1;
        else             lo = j + 1;
    }
    return a[k];
}
```

**Why this is expected O(N):** if each partition call happens to split its subarray roughly in half, the total work across all the (single-branch) recursive calls is proportional to N + N/2 + N/4 + N/8 + ... — a geometric series that sums to less than 2N. Sedgewick & Wayne state this as Proposition U: *"Partitioning-based selection is a linear-time algorithm, on average."* This is a strictly better bound than quicksort's own O(N log N) average case, precisely because quickselect throws away one side's work at every level instead of recursing into both.

The "on average" qualifier carries the exact same caveat as quicksort itself: the analysis assumes partitioning on a random (or randomly shuffled) element, so the guarantee is probabilistic. A consistently bad pivot choice — the same adversarial or already-sorted inputs that degrade quicksort — degrades quickselect to O(N²) in the worst case; see the sibling quicksort concept's own worst-case discussion rather than re-deriving it here. Cormen's `RANDOMIZED-SELECT` is the same algorithm under a different name, with the same `T(n) = T(n-1) + Θ(n)` worst-case recurrence quicksort has when a partition only ever peels off one element at a time.

### Watch it happen: a 9-element worked trace

Take `a = [7, 2, 9, 4, 1, 8, 3, 6, 5]` (indices 0-8) and search for `k = 4` — the median, i.e. the 5th-smallest of these 9 distinct values (which is 5, easy to confirm against the fully sorted array `[1,2,3,4,5,6,7,8,9]`). This runs the real Sedgewick-style partition from the sibling quicksort concept, hand-traced call by call — notice how each step after a partition call permanently discards one whole side instead of recursing into it:

```viz
type: moves
mark 0 | Pivot for a[0..8] is "7" — target: find k=4, the median (5th smallest of 9).
swap 2 8 | Left scan finds "9" (pos 2, ≥ pivot); right scan finds "5" (pos 8, ≤ pivot) — trade them.
swap 5 7 | Left scan finds "8" (pos 5, ≥ pivot); right scan finds "6" (pos 7, ≤ pivot) — trade them.
swap 0 6 | Scans meet at position 6: swap pivot "7" into place — its final position is j=6.
remove 9 | j=6 > k=4, so recurse LEFT into a[0..5] only — "9" sits right of the pivot, discarded for good.
remove 8 | Also discarded: "8" is right of the pivot too, never visited again.
remove 7 | The pivot itself (j=6 ≠ k=4) is discarded as well — it's in its final sorted spot, but it isn't a[k].
mark 0 | Recurse into a[0..5]. New pivot is a[0] = "3".
swap 2 4 | Left scan finds "5" (pos 2, ≥ pivot); right scan finds "1" (pos 4, ≤ pivot) — trade them.
swap 0 2 | Scans meet at position 2: swap pivot "3" into place — j=2.
remove 1 | j=2 < k=4, so recurse RIGHT into a[3..5] only — "1" (now at position 0) is discarded.
remove 2 | Also discarded: "2" never moved and is excluded too.
remove 3 | The pivot itself (j=2 ≠ k=4) is discarded — k=4 lives to its right, not its left.
mark 3 | Recurse into a[3..5]. New pivot is a[3] = "4".
remove 4 | No exchanges needed — the pivot lands right back at j=3. j=3 < k=4, so it's discarded too.
mark 4 | Recurse into a[4..5]. New pivot is a[4] = "5" — only "5" and "6" remain in play.
remove 6 | No exchanges needed: "5" ≤ "6" already, so j=4 = k=4 immediately — done. "6" is discarded unvisited; quicksort would still have had to sort it.
mark 4 | Answer: a[4] = "5", the 5th smallest (median) of the original 9 elements — found after 3 partition calls, never sorting the rest.
---
7
2
9
4
1
8
3
6
5
```

Three partition calls, each one discarding a whole side of the array, land directly on the answer — no comparison was ever wasted ordering elements that were on the "wrong" side from the start.

### Median of medians: guaranteeing O(N) in the worst case (Cormen only)

Randomized quickselect above is *expected* linear time but still O(N²) in the worst case, for the same reason quicksort is: an unlucky run of bad pivots. Cormen's `SELECT` (Chapter 9, Section 9.3) is a genuinely different algorithm — not covered by Sedgewick & Wayne — that guarantees O(N) even in the worst case, by replacing the random pivot with a *provably good* one, found recursively:

1. Divide the n elements into ⌈n/5⌉ groups of 5 elements each (the last group may be short).
2. Sort each group of 5 in place — cheap, since sorting a fixed-size group of 5 is O(1) regardless of n.
3. Take the median of each group (the 3rd element of each sorted group of 5).
4. Recursively call `SELECT` on just those ⌈n/5⌉ group medians to find their median — call it `x`. This is the pivot.
5. Partition the full array around `x` (a generalization of the sibling concept's partition that takes the pivot value as a parameter, rather than always picking `a[lo]`).
6. Recurse into whichever side contains the k-th element — exactly like quickselect above.

```java
int select(int[] a, int lo, int hi, int k) {
    if (hi <= lo) return a[lo];
    int pivot = medianOfMedians(a, lo, hi);
    int j = partitionAround(a, lo, hi, pivot);  // sibling's partition, generalized to a given pivot value
    if (j == k)      return a[j];
    else if (j > k)  return select(a, lo, j - 1, k);
    else              return select(a, j + 1, hi, k);
}

int medianOfMedians(int[] a, int lo, int hi) {
    int n = hi - lo + 1;
    int numGroups = (n + 4) / 5;
    int[] medians = new int[numGroups];
    for (int g = 0; g < numGroups; g++) {
        int groupLo = lo + g * 5;
        int groupHi = Math.min(groupLo + 4, hi);
        Arrays.sort(a, groupLo, groupHi + 1);   // a group of ≤5 elements: O(1) to sort
        medians[g] = a[(groupLo + groupHi) / 2];
    }
    return select(medians, 0, numGroups - 1, numGroups / 2);  // median OF the medians, found recursively
}
```

The one substantive proof idea is this: because each group of 5 is sorted, the groups whose median is ≤ `x` contribute not just their median but the two elements below it as also ≤ `x` — and symmetrically for groups whose median is ≥ `x`. Counting this up across roughly half the groups on each side gives the key guarantee: **the median-of-medians pivot `x` is guaranteed to be greater than at least 3/10 of the elements, and less than at least 3/10 of the elements.** That bounds how lopsided the partition split can possibly be — the side excluded from recursion always has at least 3n/10 elements removed from consideration, so the side that's recursed into has at most 7n/10 elements, in the *worst* case, not just on average.

That gives the recurrence `T(n) ≤ T(n/5) + T(7n/10) + O(n)` — the `T(n/5)` term is the cost of finding the median of medians itself, the `T(7n/10)` term is the cost of the one recursive call into the larger possible side, and `O(n)` covers the grouping, sorting each group of 5, and partitioning. Since `n/5 + 7n/10 = 9n/10 < n`, this recurrence solves to **O(n)** by substitution (assume `T(n) ≤ cn`, substitute, and the `-cn/10` slack absorbs the `O(n)` term for large enough `c`) — worst-case linear time, guaranteed, regardless of input.

This is a genuinely clever, non-obvious result — but Cormen is explicit that it's "mostly of theoretical interest": the constant factors from grouping into 5s, sorting every group, and recursing twice per level (once for the pivot, once for the actual selection) make it slower in practice than randomized quickselect, despite quickselect's weaker worst-case guarantee. Median-of-medians earns its place as a proof technique and a fallback for adversarial-input safety, not as the algorithm you'd reach for by default.

## Trade-offs

- **Expected O(N), not guaranteed** — same probabilistic caveat as quicksort: a consistently bad pivot degrades randomized quickselect to O(N²). The standard mitigation is identical too — shuffle the array (or pick a random pivot) so the worst case isn't triggered by common inputs like sorted data. See the sibling quicksort concept's Trade-offs for the full discussion.
- **Median-of-medians trades a hard guarantee for large constants** — Cormen's O(N) worst-case `SELECT` is a real result, not just a curiosity, but its overhead (grouping into 5s, sorting every group, two recursive calls per level) makes randomized quickselect faster in practice almost always. Reach for it only when a worst-case guarantee genuinely matters more than typical-case speed.
- **Mutates the array in place** — like the sibling quicksort concept's partition, both `quickselect` and `SELECT` reorder the input array as a side effect (partially: only around the target rank, not fully sorted). If the original order needs to survive, work on a copy.
- **The JDK doesn't ship a selection algorithm** — there's no `Arrays.select(a, k)`. Reaching for `Arrays.sort(a)` then `a[k]` is the pragmatic default (fine for a one-off call on a small-to-medium array); implementing quickselect by hand only pays off when selection happens often enough, or on arrays large enough, for the O(N) vs O(N log N) gap to matter. `PriorityQueue`-based top-k (see the sibling quicksort concept's TopM use case) is the usual alternative when the data arrives as an unbounded stream rather than sitting in an array already.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4th Edition (Addison-Wesley, 2011) — Section 2.5 "Applications" (following priority queues), `select()`, pp. 346-347 — book
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4th Edition (MIT Press, 2022) — Chapter 9 "Medians and Order Statistics", Sections 9.1-9.3, pp. 229-241 — book
- [Princeton Algorithms, 4th Ed. — Quicksort (companion site, partitioning reference)](https://algs4.cs.princeton.edu/23quicksort/) — doc
- [PriorityQueue — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/PriorityQueue.html) — doc
