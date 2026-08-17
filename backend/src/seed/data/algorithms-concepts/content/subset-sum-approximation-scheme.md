---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

The sibling `approximation-algorithms-vertex-cover` concept (Sections 35.1-35.2) and `set-covering-and-lp-rounding` concept (Sections 35.3-35.4) all deliver approximation algorithms with a *fixed* ratio baked into the algorithm: 2, or `O(lg |X|)`, or 8/7. Section 35.5 closes the chapter with something qualitatively different — an approximation **scheme**, where the accuracy is an input parameter `ε` that the caller dials, and the algorithm's running time is polynomial in both the input size *and* `1/ε`. That is a **fully polynomial-time approximation scheme (FPTAS)**, and Cormen et al. build one for the optimization version of the subset-sum problem: given a set `S` of positive integers and a target `t`, find a subset whose sum is as large as possible without exceeding `t`. The decision version is NP-complete (proved in Section 34.5.5 and covered by the sibling `np-completeness-proofs-and-problem-catalog` concept), so the route is: start from an exact algorithm that incrementally builds the list of all achievable subset sums — an approach in the same incremental-recurrence spirit as the sibling `dynamic-programming-fundamentals` concept, but exponential here because the list itself can double at every step — and then make it polynomial by **trimming** the list, deliberately throwing away any value that another surviving value already approximates closely enough.

## Use Cases

- Solving the practical optimization form of subset sum: the source's framing is a truck that can carry at most `t` pounds and up to `n` boxes with weights `x1, ..., xn`, and the question is how heavy a load it can take without exceeding the limit.
- Reaching for `EXACT-SUBSET-SUM` unchanged when the numbers cooperate — the source notes it is genuinely polynomial-time in the special cases where `t` is polynomial in `|S|` or all the numbers in `S` are bounded by a polynomial in `|S|`. Only when the values are large does the exponential list growth bite.
- Trading accuracy for time on a continuous dial rather than accepting one fixed ratio: `APPROX-SUBSET-SUM` takes `ε` with `0 < ε < 1` and guarantees the returned value is within a factor of `1 + ε` of the optimum, so the same code covers "roughly right and fast" and "nearly exact and slower."
- Recognizing the FPTAS shape when you meet it elsewhere: a family of algorithms indexed by `ε`, with running time polynomial in `1/ε` *as well as* in the input size — as opposed to a scheme that is only polynomial in the input size for each fixed `ε`.
- Learning list trimming as a reusable technique: whenever a state space is a list of numeric values and near-duplicates are harmless, keeping one representative per multiplicative bucket collapses an exponential list into a logarithmic-sized one.

## Deep Dive

### The exact algorithm: maintain the list of all achievable sums, capped at t

Let `Pi` denote the set of values obtainable by summing the members of each (possibly empty) subset of `{x1, x2, ..., xi}`. For `S = {1, 4, 5}` this gives `P1 = {0, 1}`, `P2 = {0, 1, 4, 5}`, and `P3 = {0, 1, 4, 5, 6, 9, 10}`. The whole exact algorithm rests on one identity:

`Pi = P(i-1) ∪ (P(i-1) + xi)`

where `L + x` means the list built by adding `x` to every element of `L` — for example, if `L = ⟨1, 2, 3, 5, 9⟩` then `L + 2 = ⟨3, 4, 5, 7, 11⟩`. The other observation that makes the algorithm practical is that once a subset's sum exceeds `t`, no superset of it can ever be optimal, so it can be discarded immediately.

```java
// Faithful translation of EXACT-SUBSET-SUM(S, n, t) (CLRS, Section 35.5).
// Li is the sorted list of sums of subsets of {x1..xi} that do not exceed t.
long exactSubsetSum(long[] x, int n, long t) {
    List<Long> l = new ArrayList<>(List.of(0L));      // line 1: L0 = <0>

    for (int i = 1; i <= n; i++) {                    // line 2
        l = mergeLists(l, addToEach(l, x[i - 1]));    // line 3: merge, duplicates removed
        removeGreaterThan(l, t);                      // line 4
    }
    return l.get(l.size() - 1);                       // line 5: largest element in Ln
}
```

`MERGE-LISTS(L, L')` is the merge-sort merge with duplicates dropped, running in time proportional to the combined lengths, so it keeps every `Li` sorted. By induction on `i` (Exercise 35.5-1), `Li` is exactly the sorted list of every element of `Pi` that is at most `t`. The catch is the length: `|Li|` can be as large as `2^i`, so `EXACT-SUBSET-SUM` is exponential-time in general.

### TRIM: keep one representative per multiplicative bucket

The key to turning that into an FPTAS is to **trim** each `Li` right after building it. The idea: if two values in a list are close to each other, there is no point keeping both when the goal is only an approximate answer. Given a trimming parameter `δ` with `0 < δ < 1`, trimming a list `L` removes as many elements as possible such that every removed element `y` still has a surviving element `z` **representing** it, meaning `z` is no greater than `y` but within a factor of `1 + δ`:

`y / (1 + δ) ≤ z ≤ y`

Because every surviving value was already a real element of the original list, trimming can only make the answer *smaller*, never illegal — a crucial property for the correctness proof later.

```java
// Faithful translation of TRIM(L, delta) (CLRS, Section 35.5).
// L must be sorted into monotonically increasing order. Runs in Theta(m) time.
List<Long> trim(List<Long> l, double delta) {
    int m = l.size();
    List<Long> out = new ArrayList<>();
    out.add(l.get(0));                                // line 2: L' = <y1>
    long last = l.get(0);                             // line 3

    for (int i = 1; i < m; i++) {                     // line 4: i = 2 to m
        long yi = l.get(i);
        if (yi > last * (1 + delta)) {                // line 5: yi >= last, L is sorted
            out.add(yi);                              // line 6
            last = yi;                                // line 7
        }
    }
    return out;                                       // line 8
}
```

The procedure makes a single increasing pass, appending a value only when it is the first element or when the most recent value placed into the output cannot represent it. The trace below is the source's own trimming example: `L = ⟨10, 11, 12, 15, 20, 21, 22, 23, 24, 29⟩` with `δ = 0.1`. Each token is one element of `L`, and it disappears from the row at the moment `TRIM` declines to append it:

```viz
type: moves
remove 11 | last = 10. Is 11 > 10 x 1.1 = 11? No, so line 5 fails and 11 is dropped -- it is represented by 10.
remove 21 | 12 > 11 so 12 is kept (last = 12); 15 > 13.2 kept (last = 15); 20 > 16.5 kept (last = 20). Now: is 21 > 20 x 1.1 = 22? No -- dropped, represented by 20.
remove 22 | Is 22 > 22? No -- dropped as well, also represented by 20.
remove 24 | 23 > 22, so 23 is kept and last = 23. Is 24 > 23 x 1.1 = 25.3? No -- dropped, represented by 23.
---
10
11
12
15
20
21
22
23
24
29
```

The surviving list is `L' = ⟨10, 12, 15, 20, 23, 29⟩`: 11 is represented by 10, both 21 and 22 by 20, and 24 by 23. Ten elements became six, and every discarded value still has a close, slightly smaller stand-in.

### APPROX-SUBSET-SUM: exact algorithm plus a trim per iteration

```java
// Faithful translation of APPROX-SUBSET-SUM(S, n, t, eps) (CLRS, Section 35.5).
// Requires 0 < eps < 1. Returns a value within a factor of (1 + eps) of optimal.
long approxSubsetSum(long[] x, int n, long t, double eps) {
    List<Long> l = new ArrayList<>(List.of(0L));      // line 1: L0 = <0>

    for (int i = 1; i <= n; i++) {                    // line 2
        l = mergeLists(l, addToEach(l, x[i - 1]));    // line 3
        l = trim(l, eps / (2.0 * n));                 // line 4: note eps/2n, NOT eps
        removeGreaterThan(l, t);                      // line 5
    }
    return l.get(l.size() - 1);                       // lines 6-7: largest value in Ln
}
```

The only structural difference from `EXACT-SUBSET-SUM` is line 4. The trimming parameter is `ε/2n` rather than `ε` precisely because trimming happens `n` times and the inaccuracies **compound**: each pass can shave the surviving values by a factor of `1 + ε/2n`, so after `n` passes the damage is `(1 + ε/2n)^n`, and shrinking the per-pass parameter by `2n` is what keeps that product below `1 + ε`.

Here is the source's own worked instance: `S = ⟨104, 102, 201, 101⟩`, `t = 308`, `ε = 0.40`, so the trimming parameter is `δ = ε/2n = 0.40/8 = 0.05`.

| i | line 3 — merge `L(i-1)` with `L(i-1) + xi` | line 4 — trim by 0.05 | line 5 — drop values > 308 |
|---|---|---|---|
| 1 (`x1 = 104`) | `⟨0, 104⟩` | `⟨0, 104⟩` | `⟨0, 104⟩` |
| 2 (`x2 = 102`) | `⟨0, 102, 104, 206⟩` | `⟨0, 102, 206⟩` | `⟨0, 102, 206⟩` |
| 3 (`x3 = 201`) | `⟨0, 102, 201, 206, 303, 407⟩` | `⟨0, 102, 201, 303, 407⟩` | `⟨0, 102, 201, 303⟩` |
| 4 (`x4 = 101`) | `⟨0, 101, 102, 201, 203, 302, 303, 404⟩` | `⟨0, 101, 201, 302, 404⟩` | `⟨0, 101, 201, 302⟩` |

Reading the trims: at `i = 2`, 104 is dropped because it is within a factor of 1.05 of 102. At `i = 3`, 206 is dropped as within 1.05 of 201, and 407 survives the trim only to be cut by line 5 for exceeding `t = 308`. At `i = 4`, 102 is dropped (within 1.05 of 101), 203 is dropped (within 1.05 of 201), and 303 is dropped (within 1.05 of 302).

The procedure returns `z = 302`. The true optimum is `307 = 104 + 102 + 101`, so the answer is within 2% — comfortably inside the promised `ε = 40%`. That gap between the guarantee and the observed error is typical: the bound is worst-case.

### Why it is fully polynomial: the accuracy bound and the list-length bound

**Theorem 35.7**: `APPROX-SUBSET-SUM` is a fully polynomial-time approximation scheme for the subset-sum problem. Two things need proving.

**The answer is accurate.** Both line 4 and line 5 only ever *delete* elements, never invent them, so every element of `Li` is a genuine member of `Pi` — the returned `z` is truly the sum of some subset of `S`, and line 5 guarantees `z ≤ t`. Let `y*` be the optimal value (the largest element of `Pn` that is at most `t`); then `z ≤ y*`, and what remains is to show `y*/z ≤ 1 + ε`.

- Exercise 35.5-2 establishes by induction on `i` that for every `y ∈ Pi` with `y ≤ t`, some surviving `z ∈ Li` satisfies `y / (1 + ε/2n)^i ≤ z ≤ y` — that is, one trim of `ε/2n` per iteration, compounded `i` times.
- Applying it to `y*` at `i = n` gives an element of `Ln` with `y*/z ≤ (1 + ε/2n)^n`, and since the returned `z` is the *largest* element of `Ln`, the same bound holds for it.
- It remains to show `(1 + ε/2n)^n ≤ 1 + ε`. The function `(1 + ε/2n)^n` is increasing in `n` (Exercise 35.5-3) and approaches its limit `e^(ε/2)`, so it is bounded by `e^(ε/2) ≤ 1 + ε/2 + (ε/2)²`. Because `0 < ε < 1` forces `(ε/2)² ≤ ε/2`, that last expression is at most `1 + ε`.

**The running time is polynomial in the input size and in 1/ε.** After trimming, any two successive elements `z` and `z'` of `Li` must differ by a factor greater than `1 + ε/2n` — that is exactly what surviving the trim means. So each list holds the value 0, possibly the value 1, and at most `log_(1+ε/2n) t` further values, giving a length bound of

`log_(1+ε/2n) t + 2 = ln t / ln(1 + ε/2n) + 2 ≤ 2n(1 + ε/2n)·ln t / ε + 2 < 3n·ln t / ε + 2`

using `0 < ε < 1` for the last step. That bound is polynomial in `1/ε` and in the input size — which is the `lg t` bits needed to write `t` plus the bits needed to write `S`, itself polynomial in `n`. Since the running time is polynomial in the list lengths, the whole scheme is fully polynomial. That is the crux: trimming converts a list that could hold `2^i` values into one holding `O(n·ln t / ε)` values, and the compounded error stays bounded because the per-trim parameter was divided by `2n` up front.

## Trade-offs

- **A scheme, not an algorithm** — unlike the fixed-ratio algorithms in the sibling concepts, the caller chooses the accuracy. That flexibility has a price: `1/ε` sits in the running-time bound (`3n·ln t / ε + 2` elements per list), so halving the allowed error roughly doubles the work. Chasing very small `ε` walks you back toward the exponential exact algorithm.
- **The trimmed answer is always an underestimate, never an overestimate** — trimming keeps a representative `z ≤ y` for every discarded `y`, and line 5 enforces `z ≤ t`. So the returned value is a genuinely achievable subset sum that never exceeds the target, which is exactly what the truck-loading framing needs. Exercise 35.5-4 asks how to modify the scheme to approximate the *smallest* subset sum not less than `t` instead.
- **You get a value, not a subset** — as written, `APPROX-SUBSET-SUM` returns only the number `z`. Recovering *which* elements sum to it takes extra bookkeeping (Exercise 35.5-5), the same way a DP table gives you the optimal cost before it gives you the optimal solution.
- **The exact algorithm is sometimes already good enough** — `EXACT-SUBSET-SUM` runs in polynomial time whenever `t` is polynomial in `|S|` or all the input numbers are polynomially bounded. The FPTAS only earns its keep when the numeric values are genuinely large, which is precisely the regime where the binary encoding of the input makes the problem NP-complete in the first place.
- **The `ε/2n` choice is load-bearing, not cosmetic** — trimming with `ε` directly would be the obvious implementation and would be wrong: `n` compounded trims of `ε` each blow far past a factor of `1 + ε`. The entire correctness argument rests on `(1 + ε/2n)^n ≤ 1 + ε`, which in turn needs the `0 < ε < 1` precondition to close.

## Documentation Links

- [Cormen, Leiserson, Rivest, Stein — Introduction to Algorithms, 4th Edition, Chapter 35 "Approximation Algorithms", Section 35.5 "The subset-sum problem", pp. 1124-1130](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — doc
