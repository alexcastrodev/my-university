---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand how to describe an algorithm's running time as a function of input size `N`, independent of the machine it runs on or how carefully it's implemented — the vocabulary ("order of growth", "Big-O", "asymptotic notation") that every algorithms discussion, textbook, and technical interview assumes you already know.

## Use Cases

- Comparing two algorithms for the same problem *before* implementing either one, to avoid building the slower approach.
- Predicting whether an algorithm that works fine on a 1,000-row test dataset will still finish in reasonable time on a 10,000,000-row production table.
- Explaining, in a technical interview or a code review, *why* one solution is better than another — "it's O(n log n) instead of O(n²)" is a precise, checkable claim; "it feels faster" isn't.

## Deep Dive

### Cormen's formal bounds: O, Ω, and Θ

CLRS defines three asymptotic notations, each bounding a function's growth rate from a different side:

- **O(g(n))** — an *upper* bound: the function grows no faster than `g(n)`.
- **Ω(g(n))** — a *lower* bound: the function grows no slower than `g(n)`.
- **Θ(g(n))** — a *tight* bound: the function grows at exactly that rate (it's both O(g(n)) and Ω(g(n))).

Take `7n³ + 100n² − 20n + 6`. Its highest-order term is `7n³`, so:

```
7n³ + 100n² − 20n + 6  is  O(n³)   — grows no faster than n³ (also true of O(n⁴), O(n⁵), ...)
7n³ + 100n² − 20n + 6  is  Ω(n³)   — grows no slower than n³ (also true of Ω(n²), Ω(n), ...)
7n³ + 100n² − 20n + 6  is  Θ(n³)   — both hold, so the bound is tight
```

Only the highest-order term matters — constants and lower-order terms are asymptotically irrelevant, which is exactly what makes the notation useful for comparing algorithms independent of implementation details.

### Sedgewick's shorthand: tilde approximations and order of growth

Sedgewick and Wayne reach for the same idea through a more computational route. Counting how many times the inner `if` fires in a triple-nested loop over an array of size `N` gives an exact but unwieldy formula:

```
N(N−1)(N−2)/6  =  N³/6 − N²/2 + N/3
```

For `N = 1,000`, the leading term `N³/6 ≈ 166,666,667` dwarfs the rest (`−N²/2 + N/3 ≈ −499,667`) — so they define the **tilde notation** (`~`): `g(N) ~ f(N)` means `g(N)/f(N) → 1` as `N` grows. That lets them write `N³/6 − N²/2 + N/3 ~ N³/6` and drop everything but the leading term. The **order of growth** is then just the shape of that leading term, `f(N) = N^b (log N)^c`.

### The growth-rate vocabulary both books use

```java
// A rough feel for how these classes scale, for the SAME abstract cost measure:
constant:      1                 // array index, hash lookup
logarithmic:   log N             // binary search
linear:        N                 // scanning an array once
linearithmic:  N log N           // mergesort, quicksort (average case), heapsort
quadratic:     N²                // insertion sort, selection sort, nested loops over the same input
cubic:         N³                // naive matrix multiplication
exponential:   2^N                // brute-force subset enumeration
```

## Trade-offs

- **Θ is more rigorous than `~`, but costs more to establish** — proving a tight Θ bound formally requires showing both an O and an Ω bound hold; the tilde approximation gets a practically useful answer faster by just dropping low-order terms, at the cost of not being a formal proof.
- **"Big-O" in casual conversation (including most interviews) almost always means the Θ bound, not a literal upper bound** — saying an algorithm "is O(n²)" when it's actually Θ(n) is technically true (n grows no faster than n²) but misleading; know that the field's spoken shorthand is looser than the textbook definition, and default to stating the tight bound when you know it.
- **Asymptotic notation says nothing about the constant factor** — an O(n) algorithm with a large hidden constant can run slower in practice than an O(n log n) algorithm for every input size that actually shows up in production, since the notation only describes behavior as `n → ∞`:

  ```java
  // Both are O(n), but the second does ~50x more work per element.
  int sumFast(int[] a) { int s = 0; for (int x : a) s += x; return s; }
  int sumSlow(int[] a) { int s = 0; for (int x : a) for (int i = 0; i < 50; i++) s += x / 50; return s; }
  ```

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4th Edition (Addison-Wesley, 2011) — Section 1.4 "Analysis of Algorithms", pp. 172-215 — book
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4th Edition (MIT Press, 2022) — Chapter 3 "Characterizing Running Times", Section 3.1, pp. 49-63 — book
- [Princeton Algorithms, 4th Ed. — Analysis of Algorithms (companion site)](https://algs4.cs.princeton.edu/14analysis/) — doc
