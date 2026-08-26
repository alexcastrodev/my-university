---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand why two knapsack problems that look almost identical — same items, same capacity, same optimal-substructure property — need entirely different algorithmic techniques: the fractional knapsack problem has the greedy-choice property and is solved by a single O(n log n) greedy pass, while the 0-1 knapsack problem does not, requires dynamic programming instead, and only runs in O(nW) time, which is pseudo-polynomial rather than truly polynomial in the input size.

## Use Cases

- Recognizing, given a resource-allocation problem, whether items can be split (fractional — greedy applies) or must be taken whole (0-1 — greedy can silently give a wrong answer, and DP is needed).
- Interview and design-review red flag: a candidate proposes "sort by value-per-weight and take greedily" for a knapsack-shaped problem — the first question is whether the items are actually divisible, because the same-sounding rule is provably correct for one variant and provably wrong for the other.
- Budget/capacity allocation where items are indivisible units (ad slots, shipping containers, discrete investments up to a budget) — the 0-1 DP table (or its space-optimized rolling-array form) is the standard tool once greedy is ruled out.

## Deep Dive

### Two problems, one shared optimal-substructure property

Both problems share the same setup, per CLRS: a thief robbing a store can carry at most `W` pounds, and faces `n` items, where item `i` is worth `v_i` dollars and weighs `w_i` pounds (integers). In the **0-1 knapsack problem**, the thief must take each item whole or not at all — "0-1" because that's the only choice per item, no fractions, no duplicates. In the **fractional knapsack problem**, the setup is identical except the thief can take any fraction of an item — CLRS's own analogy is a 0-1 item is like a gold ingot (all or nothing) while a fractional item is like gold dust (take exactly the amount you want).

CLRS states optimal substructure precisely for each, and the two statements differ in exactly the place you'd expect — what's left over after removing item `j`:

- **0-1:** if the most valuable load weighing at most `W` pounds includes item `j`, then the remaining load must be the most valuable load weighing at most `W - w_j` pounds that the thief can take from the other `n - 1` items (excluding item `j` entirely — it's already fully spoken for).
- **Fractional:** if the most valuable load weighing at most `W` pounds includes weight `w` of item `j`, then the remaining load must be the most valuable load weighing at most `W - w` pounds that the thief can take from the other `n - 1` items *plus* the leftover `w_j - w` pounds of item `j` itself — item `j` can still contribute more, because it isn't necessarily used up.

Both are legitimate optimal-substructure arguments — a solution to the whole problem is built from a solution to a strictly smaller instance of the same problem. That's the property both dynamic programming and greedy algorithms depend on, which is exactly why it's tempting to assume both problems admit the same kind of algorithm. They don't.

### The fractional knapsack greedy algorithm — and why it's provably optimal

To solve the fractional problem, first compute each item's value per pound, `v_i / w_i`. The greedy rule: sort items by that ratio descending, then take as much as possible of the best-ratio item, then the next-best, and so on until the capacity is exhausted.

```java
record Item(String name, int weight, int value) {
    double ratio() {
        return (double) value / weight;
    }
}

static double fractionalKnapsack(List<Item> items, int capacity) {
    List<Item> sorted = new ArrayList<>(items);
    sorted.sort(Comparator.comparingDouble(Item::ratio).reversed()); // best ratio first — the one sort that makes greedy work

    double totalValue = 0;
    int remaining = capacity;
    for (Item item : sorted) {
        if (remaining <= 0) break;
        if (item.weight() <= remaining) {
            totalValue += item.value();          // take the whole item
            remaining -= item.weight();
        } else {
            totalValue += item.ratio() * remaining; // take only the fraction that still fits
            remaining = 0;
        }
    }
    return totalValue;
}
```

Because the whole algorithm is one sort followed by one linear pass, it runs in O(n log n), dominated entirely by the sort.

CLRS poses proving this rule correct as Exercise 15.2-1 rather than working the proof in the main text — but the proof has the same shape as the exchange argument the sibling activity-selection concept walks through in full for Theorem 15.1: take any optimal solution, and if it doesn't already start by fully exhausting the best-ratio item, show that swapping in as much of that item as the optimal solution's own capacity allows can only match or beat it, because nothing else in the knapsack can turn a pound of capacity into more value than the best available ratio. That's the greedy-choice property — a first choice, provably part of *some* optimal solution, that never needs to be revisited.

### CLRS's own counterexample: greedy fails on 0-1 knapsack

The same greedy rule — sort by ratio, take greedily — looks equally reasonable for the 0-1 problem, and CLRS gives a specific, small counterexample (Figure 15.3) proving it isn't. Three items, knapsack capacity 50:

| Item | Weight | Value | Value/weight |
|---|---|---|---|
| 1 | 10 | $60 | 6 |
| 2 | 20 | $100 | 5 |
| 3 | 30 | $120 | 4 |

Greedy-by-ratio takes item 1 first (ratio 6, the best). With 40 pounds of capacity left, it takes item 2 next (ratio 5, next best) — now 30 of the 50 pounds are used, value $160. Item 3 (weight 30) no longer fits in the remaining 20 pounds, so 0-1 greedy stops there, having used only 30 of the available 50 pounds.

Checking every feasible subset by hand confirms greedy's answer is wrong:

| Subset | Weight | Value |
|---|---|---|
| {1} | 10 | $60 |
| {2} | 20 | $100 |
| {3} | 30 | $120 |
| {1, 2} | 30 | $160 ← greedy's answer |
| {1, 3} | 40 | $180 |
| {2, 3} | 50 | **$220 ← true optimum** |
| {1, 2, 3} | 60 | infeasible (exceeds capacity 50) |

The optimal 0-1 solution is items 2 and 3 for $220, using the knapsack's full 50-pound capacity — and it leaves out item 1, the very item with the best individual ratio. Every solution that includes item 1 is worse than $220 (best such solution is {1, 3} at $180).

CLRS's own explanation for *why* greedy fails here: taking item 1 first "doesn't work in the 0-1 problem, because the thief is unable to fill the knapsack to capacity, and the empty space lowers the effective value per pound of the load." In the fractional case this never happens — any leftover capacity gets topped up with a fraction of the next-best item, so no capacity is ever wasted. In the 0-1 case, once the best-ratio item is locked in, the *remaining* capacity might not divide evenly among what's left, and 10 pounds of unused space (as happens here) is value that greedy can never recover. Deciding whether to include an item now requires comparing the subproblem that includes it against the subproblem that excludes it — and both of those subproblems recur throughout the search, which is exactly the overlapping-subproblems signature that calls for dynamic programming instead.

### The 0-1 knapsack DP solution: recurrence, table, and O(nW) time

CLRS proves the 0-1 problem's optimal substructure and its overlapping subproblems in the main text, then poses the actual dynamic-programming solution as Exercise 15.2-2 rather than deriving the recurrence and table itself. What follows is that DP technique applied to CLRS's exact problem and its exact three-item example, constructed and hand-verified here rather than transcribed from CLRS's main text (which does not carry it).

Define `OPT(i, w)` as the maximum value achievable using only items `1..i` with capacity `w`. Item `i` either doesn't fit at all, or it can be skipped or taken — matching the optimal-substructure statement above:

```
OPT(i, w) = OPT(i-1, w)                                      if w_i > w   (item i can't fit)
OPT(i, w) = max( OPT(i-1, w), OPT(i-1, w - w_i) + v_i )       otherwise    (skip it, or take it)
```

```java
static int knapsack01(int[] weight, int[] value, int capacity) {
    int n = weight.length;
    int[][] opt = new int[n + 1][capacity + 1]; // opt[0][*] stays 0 (base case: no items)

    for (int i = 1; i <= n; i++) {
        for (int w = 0; w <= capacity; w++) {
            opt[i][w] = opt[i - 1][w];                         // always a valid choice: skip item i
            if (weight[i - 1] <= w) {
                opt[i][w] = Math.max(opt[i][w], opt[i - 1][w - weight[i - 1]] + value[i - 1]);
            }
        }
    }
    return opt[n][capacity]; // reconstructing which items were taken needs a traceback over this table
}
```

Filling `OPT(i, w)` for CLRS's own three-item example (item 1: weight 10, value 60; item 2: weight 20, value 100; item 3: weight 30, value 120; capacity 50) — every listed value below is hand-verified against the recurrence. Because all three item weights are multiples of 10, `OPT(i, w)` only changes at multiples of 10, so the table below shows capacity in steps of 10 rather than all 51 columns:

| `OPT(i, w)` | w=0 | w=10 | w=20 | w=30 | w=40 | w=50 |
|---|---|---|---|---|---|---|
| i=0 (no items) | 0 | 0 | 0 | 0 | 0 | 0 |
| i=1 (+ item 1: w10, v60) | 0 | 60 | 60 | 60 | 60 | 60 |
| i=2 (+ item 2: w20, v100) | 0 | 60 | 100 | 160 | 160 | 160 |
| i=3 (+ item 3: w30, v120) | 0 | 60 | 100 | 160 | 180 | **220** |

`OPT(3, 50) = 220` matches the true optimum found by exhaustive enumeration above. Tracing the choice backward from the bottom-right corner confirms *which* items produced it: at `(3, 50)`, `OPT(2, 50) = 160` is beaten by `OPT(2, 20) + 120 = 100 + 120 = 220`, so item 3 is taken and the trace moves to `(2, 20)`; there, `OPT(1, 20) = 60` is beaten by `OPT(1, 0) + 100 = 0 + 100 = 100`, so item 2 is taken and the trace moves to `(1, 0)`; there, `OPT(1, 0) = 0` because item 1 (weight 10) doesn't fit in 0 pounds of remaining capacity, so item 1 is excluded. The recovered set is `{2, 3}` — the same answer the brute-force subset check found.

The table has `(n + 1) * (W + 1)` cells, each doing O(1) work, so filling it costs O(nW) time and space. This looks polynomial, and for fixed, reasonably small `W` it behaves that way in practice — but it is **pseudo-polynomial**, not polynomial in the strict complexity-theory sense: the running time is polynomial in the *numeric value* of `W`, not in the number of bits needed to represent `W`. Doubling `W` doubles the table (and the running time) even though representing the larger `W` costs only one more bit. That's exactly why 0-1 knapsack is still classified as NP-hard in general — an algorithm that's efficient for "capacity up to a few million" can still blow up when capacity is specified as a 64-bit number in the billions, even though `n` stays small.

## Trade-offs

- **Same optimal substructure, different verdict on greedy — that's the entire lesson.** Both problems reduce to a smaller instance of themselves, which is necessary for both DP and greedy but not sufficient for greedy. Only the fractional variant additionally has the greedy-choice property (provable via an exchange argument, per Exercise 15.2-1); the 0-1 variant's Figure 15.3 counterexample is the standard proof that a plausible-looking greedy rule can fail even when the underlying structural property that usually enables it (optimal substructure) is present.
- **O(n log n) greedy vs. O(nW) dynamic programming is a real cost difference, not just a formality.** For fractional knapsack the sort dominates and `W` never enters the running time at all. For 0-1 knapsack, `W` enters directly — a capacity of 10,000 with 20 items means a 20 x 10,001 table, which is fine, but a capacity in the billions (still perfectly reasonable input, e.g. currency in cents) makes the O(nW) table infeasible even though `n` is tiny; this is the pseudo-polynomial subtlety above, not a bug in the algorithm.
- **The value-only table isn't the answer to "which items"** — `knapsack01` above returns `opt[n][capacity]`, a number. Recovering the actual subset (as the worked traceback does) means walking the table backward, comparing `OPT(i, w)` against `OPT(i-1, w)` at each step, the same pattern the sibling `dynamic-programming-fundamentals` and `longest-common-subsequence` concepts use for cut points and reconstructed subsequences — easy to add, easy to forget if the problem statement only seems to ask for a total.
- **Space can be trimmed if only the value is needed.** Since row `i` of the table only ever reads row `i - 1`, `knapsack01` can be rewritten with a single 1D array of length `W + 1`, updated right-to-left within each item's pass (right-to-left specifically to avoid reusing an item already counted earlier in the same row) — dropping space from O(nW) to O(W) at the cost of losing the ability to trace back which items were chosen.

## Documentation Links

- Cormen, Leiserson, Rivest, Stein, "Introduction to Algorithms", 4th Edition (MIT Press, 2022) — Chapter 15 "Greedy Algorithms", Section 15.2 "Elements of the greedy strategy" (knapsack problem setup, optimal-substructure argument for both variants, and Figure 15.3's counterexample), pp. 428-431 — book
- [Comparator — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Comparator.html) — doc
