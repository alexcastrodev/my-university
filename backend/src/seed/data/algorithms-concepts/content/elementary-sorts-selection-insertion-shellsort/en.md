---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand the three elementary array sorts that ground the rest of this module: selection sort (find the minimum, swap it into place, repeat), insertion sort (build up a sorted prefix by inserting each new element where it belongs), and shellsort (insertion sort extended to move elements over long distances first). All three are in-place, and comparing them surfaces the two properties that matter most when picking a sort: how much data movement it does, and whether it adapts to input that's already partially ordered.

## Use Cases

- Sorting very small arrays, where insertion sort's low overhead beats the asymptotically-better but constant-heavier quicksort, mergesort, or heapsort.
- Sorting nearly-sorted data (a few new records appended to an already-sorted log, a mostly-ordered import) — insertion sort's running time is proportional to the number of *inversions*, not the array size, so it's close to linear here.
- Selection sort's minimal-data-movement property (only N exchanges, the fewest of any sort in this module) matters when writes are expensive relative to reads — e.g. sorting on flash storage, where every write shortens the medium's lifespan.
- As the small-subarray cutoff inside production quicksort/mergesort implementations — both Java's dual-pivot quicksort and TimSort drop into insertion sort once a partition or run gets small, rather than recursing all the way down.

## Deep Dive

### Selection sort: minimal movement, but blind to input order

Scan the unsorted remainder for its minimum, swap it into place at the front, and repeat — advancing the sorted boundary by one each pass:

```java
public static void sort(Comparable[] a) {
    int n = a.length;
    for (int i = 0; i < n; i++) {
        int min = i;
        for (int j = i + 1; j < n; j++) {
            if (less(a[j], a[min])) min = j;
        }
        exch(a, i, min);
    }
}
```

Sedgewick's Proposition A: selection sort uses **N²/2 compares and N exchanges** to sort an array of length N — for each `i` from 0 to N−1, the inner loop runs N−1−i compares and there's exactly one exchange, so the compares sum to N(N−1)/2 and the exchanges sum to N.

The two signature properties both follow directly from that shape:

- **Running time is insensitive to input order.** Finding the minimum on one pass gives no information about where the next minimum is, so an already-sorted array, a reverse-sorted array, and a random array all cost the same N²/2 compares. Insertion sort (below) does not share this weakness.
- **Data movement is minimal.** Exactly N exchanges, full stop — no other sort in this module gets below linearithmic exchange counts. If writes are the expensive operation, this is the one property that can outweigh the quadratic compare count.

Trace on `[5, 3, 8, 1, 9, 4, 7, 2]` — each pass marks the minimum found by the scan, then swaps it to the front:

```viz
type: moves
mark 3 | Scan a[0..7] for the minimum: found "1" at index 3.
swap 0 3 | Exchange it into place — a[0] is now final.
mark 7 | Scan a[1..7] for the minimum: found "2" at index 7.
swap 1 7 | Exchange into place — a[0..1] are now final.
mark 7 | Scan a[2..7] for the minimum: found "3" at index 7.
swap 2 7 | Exchange into place — a[0..2] are now final.
mark 5 | Scan a[3..7] for the minimum: found "4" at index 5.
swap 3 5 | Exchange into place — a[0..3] are now final.
mark 5 | Scan a[4..7] for the minimum: found "5" at index 5.
swap 4 5 | Exchange into place — a[0..4] are now final.
mark 6 | Scan a[5..7] for the minimum: found "7" at index 6.
swap 5 6 | Exchange into place — a[0..5] are now final.
mark 7 | Scan a[6..7] for the minimum: found "8" at index 7.
swap 6 7 | Exchange into place — the array is fully sorted.
---
5
3
8
1
9
4
7
2
```

Seven exchanges for eight elements — one per pass, exactly N as Proposition A predicts (the trivial N-th pass, where the last element is already alone and in place, does no exchange at all).

### Insertion sort: adaptive to existing order

Grow a sorted prefix one element at a time: take the next element and exchange it leftward past every already-sorted entry bigger than it.

```java
public static void sort(Comparable[] a) {
    int n = a.length;
    for (int i = 1; i < n; i++) {
        for (int j = i; j > 0 && less(a[j], a[j - 1]); j--) {
            exch(a, j, j - 1);
        }
    }
}
```

Sedgewick's Proposition B: for a randomly ordered array of distinct keys, insertion sort uses **~N²/4 compares and ~N²/4 exchanges** on average, with a worst case of N²/2 and a best case of just N−1 compares and 0 exchanges. Proposition C sharpens this: the number of exchanges equals the number of *inversions* (out-of-order pairs) in the array, and compares are within N−1 of that same count.

That's the adaptive property, made concrete: the eight-element array traced below, `[4, 2, 7, 1, 5, 3, 8, 6]`, has 10 inversions, so insertion sort does exactly 10 exchanges to sort it. Compare that to `[1, 2, 3, 4, 5, 6, 8, 7]` — the same eight values, sorted except for one adjacent swap. That array has a single inversion (8-7), so insertion sort does **one** exchange and finishes in effectively linear time. Selection sort, by contrast, would still burn through its full N²/2 = 28 compares on that nearly-sorted array, oblivious to how close it already is to done — this is exactly the asymmetry Sedgewick calls out between the two algorithms.

Trace on `[4, 2, 7, 1, 5, 3, 8, 6]` — each step is one adjacent exchange as an element shifts left past larger neighbors:

```viz
type: moves
swap 1 0 | Insert a[1] = "2": smaller than a[0] = "4" — shift left.
swap 3 2 | Insert a[3] = "1": smaller than a[2] = "7" — shift left.
swap 2 1 | "1" is still smaller than a[1] = "4" — keep shifting left.
swap 1 0 | "1" is still smaller than a[0] = "2" — one more shift; it's now the smallest so far.
swap 4 3 | Insert a[4] = "5": smaller than a[3] = "7" — shift left. Now ≥ a[2] = "4", so it stops here.
swap 5 4 | Insert a[5] = "3": smaller than a[4] = "7" — shift left.
swap 4 3 | "3" is still smaller than a[3] = "5" — keep shifting left.
swap 3 2 | "3" is still smaller than a[2] = "4" — one more shift; now ≥ a[1] = "2", so it stops here.
swap 7 6 | Insert a[7] = "6": smaller than a[6] = "8" — shift left.
swap 6 5 | "6" is still smaller than a[5] = "7" — one more shift; now ≥ a[4] = "5", so it stops here.
---
4
2
7
1
5
3
8
6
```

Ten exchanges, matching the ten inversions in the starting array exactly, as Proposition C predicts.

Insertion sort earns a second mention beyond Sedgewick: CLRS uses it as the running example for how to *prove* an algorithm correct, via a loop invariant. Their framing states the invariant — "at the start of each iteration, `A[1..i-1]` consists of the original elements of `A[1..i-1]`, but in sorted order" — and walks through the standard three-part proof: **initialization** (the invariant holds trivially before the first iteration, when the "sorted prefix" is a single element), **maintenance** (each iteration's inner `while` loop shifts larger elements right and inserts the key, extending the sorted prefix by one while preserving the invariant), and **termination** (the loop ends when `i` exceeds `n`, at which point the invariant — applied to the whole array — is exactly the sortedness postcondition). It's a notable pedagogical choice: rather than picking a more "interesting" algorithm, CLRS uses the simplest sort in the book to introduce the proof technique it then reuses throughout the text.

### Shellsort: insertion sort with a shrinking gap

Insertion sort is slow on large arrays specifically because its only exchanges move elements one position at a time — an element that belongs at the far end has to shuffle its way there one swap at a time. Shellsort's fix: first sort the array by comparing elements that are `h` positions apart for some large `h` (an *h-sort*, equivalent to running insertion sort independently on `h` interleaved subsequences), then repeat with smaller and smaller `h`, finishing at `h = 1` — which is ordinary insertion sort, but now running on an array that earlier passes have already dragged into rough order, so that final pass is fast.

```java
public static void sort(Comparable[] a) {
    int n = a.length;
    int h = 1;
    while (h < n / 3) h = 3 * h + 1;      // 1, 4, 13, 40, 121, ...
    while (h >= 1) {
        for (int i = h; i < n; i++) {
            for (int j = i; j >= h && less(a[j], a[j - h]); j -= h) {
                exch(a, j, j - h);
            }
        }
        h = h / 3;
    }
}
```

Sedgewick's own increment sequence — 1, 4, 13, 40, 121, … (each term is `3×previous + 1`) — is easy to compute and performs well in practice, though it isn't the only sequence in use.

Trace on `[6, 1, 8, 3, 5, 2, 7, 4]` (n = 8, so the sequence above gives h = 4, then h = 1):

```viz
type: moves
mark 0 | h = 4 — Sedgewick's 3×+1 increment sequence, the largest h < n/3 reached by h = 3h + 1 starting from 1. 4-sort the array: insertion-sort each of the 4 interleaved subsequences (stride 4) independently.
swap 4 0 | Subsequence {a[0], a[4]}: "5" < "6" — shift left by one gap.
swap 6 2 | Subsequence {a[2], a[6]}: "7" < "8" — shift left by one gap.
mark 0 | h = 1 — the final pass is an ordinary insertion sort, but the array is already 4-sorted (roughly in order), so this pass does far less work than insertion sort would on the raw input.
swap 1 0 | Insert a[1] = "1": smaller than a[0] = "5" — shift left.
swap 3 2 | Insert a[3] = "3": smaller than a[2] = "7" — shift left.
swap 2 1 | "3" is still smaller than a[1] = "5" — keep shifting left.
swap 4 3 | Insert a[4] = "6": smaller than a[3] = "7" — shift left.
swap 5 4 | Insert a[5] = "2": smaller than a[4] = "7" — shift left.
swap 4 3 | "2" is still smaller than a[3] = "6" — keep shifting left.
swap 3 2 | "2" is still smaller than a[2] = "5" — keep shifting left.
swap 2 1 | "2" is still smaller than a[1] = "3" — one more shift; it's now the smallest so far.
swap 7 6 | Insert a[7] = "4": smaller than a[6] = "8" — shift left.
swap 6 5 | "4" is still smaller than a[5] = "7" — keep shifting left.
swap 5 4 | "4" is still smaller than a[4] = "6" — keep shifting left.
swap 4 3 | "4" is still smaller than a[3] = "5" — one more shift; the array is fully sorted.
---
6
1
8
3
5
2
7
4
```

Two exchanges in the h = 4 pass move elements four positions at a time — something plain insertion sort can never do in one step — and the h = 1 pass that follows, while it does most of the remaining exchanges, is operating on an array that's already close to sorted.

Shellsort is genuinely surprising, complexity-wise. For certain increment sequences — including Sedgewick's own 1, 4, 13, 40, 121, … — shellsort has been *proven* to run in subquadratic worst-case time, beating the Θ(N²) bound that governs selection and insertion sort. But the exact worst-case complexity for many practical increment sequences remains an open problem: nobody has found a provably best sequence, and it's not fully understood how far the tradeoff between number of increments and their arithmetic relationships (shared divisors and the like) can be pushed. It's a rare example of a simple, decades-old, widely-used algorithm whose full theoretical analysis is still unfinished. One more property worth flagging: unlike insertion sort, **shellsort is not stable** — an h-sort with h > 1 can swap two equal elements past each other, since they're compared against elements h positions away rather than their immediate neighbor.

### When to reach for one of these — and when not to

- **Tiny arrays (roughly a few dozen elements or fewer):** insertion sort's low constant-factor overhead beats quicksort/mergesort/heapsort's better asymptotics, which only start paying off once N is large enough for the O(N log N) vs. O(N²) gap to dominate the constants. This is exactly why production sorts use insertion sort as a cutoff rather than recursing to size 1 — see Trade-offs below.
- **Nearly-sorted data:** insertion sort is the right choice whenever the input has few inversions relative to its size — appending new records to a sorted log, re-sorting after a small edit. Selection sort and shellsort don't share this adaptive advantage to the same degree.
- **Write-expensive storage:** selection sort's N-exchange guarantee is the one scenario where it beats insertion sort outright, regardless of how sorted the input already is.
- **Everything else — large or unpredictable arrays:** reach for quicksort (average-case speed, in-place), mergesort (guaranteed O(N log N), stable), or heapsort (guaranteed O(N log N), in-place) instead. All three elementary sorts here are Θ(N²) in the worst case, which stops being competitive well before N reaches the thousands.

## Trade-offs

- **Selection sort's N²/2 compares are paid regardless of input order — even an already-sorted array gets the full scan** — its only advantage is the N-exchange bound, which matters specifically when writes cost more than compares (flash storage, for instance). For anything else, insertion sort dominates it.
- **Insertion sort's worst case is still Θ(N²)** — it's adaptive, not asymptotically better; a large, genuinely random array will still be slow. Its real value is the small-subarray cutoff role: rather than recursing quicksort or mergesort all the way down to trivial subarrays, real implementations switch to insertion sort once a subarray is small enough that its low overhead and adaptiveness beat the cost of further recursion — the same underlying idea behind the insertion-sort run-extension step inside TimSort noted in the mergesort concept's Trade-offs.
- **Shellsort is not stable, unlike insertion sort** — equal keys can cross during a large-gap pass, so it's not a safe substitute when relative order of ties matters. Its complexity is also the one genuinely open question among the sorts in this module: subquadratic worst-case behavior is proven for specific increment sequences, but no sequence has been proven optimal.
- **In production Java, this isn't just textbook theory** — `Arrays.sort()`'s dual-pivot quicksort (for primitive arrays) drops into a plain insertion-sort pass once a partition shrinks below a small size threshold, the exact cutoff-optimization idea described above, not merely a classroom trick:

  ```java
  int[] nums = {5, 3, 1, 4, 2};
  Arrays.sort(nums);   // dual-pivot quicksort for large partitions,
                        // insertion sort once a partition gets small enough
  ```

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4th Edition (Addison-Wesley, 2011) — Section 2.1 "Elementary Sorts", pp. 244-265 — book
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4th Edition (MIT Press, 2022) — Section 2.1 "Insertion sort", pp. 17-24 — book
- [Princeton Algorithms, 4th Ed. — Elementary Sorts (companion site)](https://algs4.cs.princeton.edu/21elementary/) — doc
- [Arrays — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html) — doc
