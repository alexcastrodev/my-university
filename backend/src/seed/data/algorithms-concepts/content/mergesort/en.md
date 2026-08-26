---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand mergesort: a divide-and-conquer sort that recursively splits an array in half, sorts each half, and merges the two sorted halves back together — guaranteed O(n log n) in every case, unlike quicksort's O(n²) worst case, at the cost of needing extra memory.

## Use Cases

- Sorting when a *guaranteed* O(n log n) bound matters more than average-case speed — no adversarial input can degrade it to O(n²) the way it can for quicksort.
- Sorting linked lists, where mergesort's sequential-access pattern works well and quicksort's random-access partitioning doesn't.
- The canonical stable sort — when preserving the relative order of equal elements matters, mergesort (implemented correctly) guarantees it and quicksort's partition scheme doesn't.

## Deep Dive

### Divide, conquer, combine

Both books express the same three-step structure. Split the array in half, recursively sort each half, then merge the two sorted halves into one:

```java
void sort(Comparable[] a, int lo, int hi) {
    if (hi <= lo) return;
    int mid = lo + (hi - lo) / 2;
    sort(a, lo, mid);        // sort left half
    sort(a, mid + 1, hi);    // sort right half
    merge(a, lo, mid, hi);   // merge results
}
```

CLRS's `MERGE-SORT` is the same shape in pseudocode: `if p ≥ r return; q = ⌊(p+r)/2⌋; MERGE-SORT(A,p,q); MERGE-SORT(A,q+1,r); MERGE(A,p,q,r)`. The recursion bottoms out at subarrays of size 0 or 1, which are trivially already sorted.

### The merge step: combining two sorted halves in linear time

The actual work happens in `merge()`. Sedgewick's version copies the subrange into an auxiliary array first, then reads back from that copy while writing the merged result into the original array — a deliberate choice, since merging *directly* in place without a second array would overwrite values still needed for comparison:

```java
public static void merge(Comparable[] a, int lo, int mid, int hi) {
    int i = lo, j = mid + 1;
    for (int k = lo; k <= hi; k++) aux[k] = a[k];  // copy to scratch space first
    for (int k = lo; k <= hi; k++) {
        if      (i > mid)              a[k] = aux[j++];  // left exhausted
        else if (j > hi)               a[k] = aux[i++];  // right exhausted
        else if (less(aux[j], aux[i])) a[k] = aux[j++];  // right's head is smaller
        else                           a[k] = aux[i++];  // left's head is smaller (or equal — stability)
    }
}
```

Each of the four branches handles one case: one side ran out, or compare the two current heads and take the smaller — with ties resolved in favor of the *left* half, which is exactly what makes this merge stable. CLRS's `MERGE` is the same idea with a different mechanical trick: it copies the two halves into separate temporary arrays `L` and `R`, each with a sentinel value (`∞`) appended at the end, so the merge loop never needs an explicit "which side ran out" check — comparing against `∞` handles it automatically.

### Watch it happen: merging two already-sorted halves

Both halves of an 8-element array are already individually sorted — `[1,3,5,7]` on the left, `[2,4,6,8]` on the right. Watch `merge()` interleave them into one fully sorted array:

```viz
type: moves
mark 0 | Left half a[0..3] = [1,3,5,7] and right half a[4..7] = [2,4,6,8] are each already sorted — merge() combines them into one sorted array.
swap 1 2 | "3" and "5" trade places — the first step toward each value reaching its position in the merged order.
swap 1 4 | "5" and "2" trade places — "2" (from the right half) settles into index 1, "5" settles into index 4: both now in their final merged positions.
swap 3 6 | "7" and "6" trade places — the same repositioning, now for the pair ending up around indices 3 and 6.
swap 3 5 | "6" and "4" trade places — "4" settles into index 3, "6" settles into index 5: the array is now fully merged and sorted.
---
1
3
5
7
2
4
6
8
```

### Why O(n log n) is guaranteed, not just average-case

Sedgewick's Proposition F: top-down mergesort uses between ½N lg N and N lg N compares to sort any array of length N — the recurrence `C(N) = C(⌊N/2⌋) + C(⌈N/2⌉) + N` falls directly out of the algorithm's own structure (sort the left half, sort the right half, then N compares to merge). Unlike quicksort's recurrence, this one doesn't depend on how lucky the pivot choice was — the split is always exactly in half, every time, regardless of the input's order.

## Trade-offs

- **Guaranteed O(n log n), but not in-place** — the auxiliary array costs O(n) extra memory, unlike quicksort's O(log n) (just recursion stack). For huge arrays where memory is the binding constraint, that difference matters.
- **Stable by construction, if the merge ties favor the left half** — this is a real advantage over quicksort's partition scheme, which offers no stability guarantee at all.
- **In production Java, this is closer to what actually runs than quicksort is** — `Arrays.sort()` on an `Object[]`/generic array (not a primitive array) uses **TimSort**, a hybrid that's fundamentally merge-based: it finds already-sorted runs in the input, extends short runs with insertion sort, and merges runs together using the same core `merge()` mechanic shown above — chosen specifically because object sorts need the stability mergesort provides and primitive sorts don't:

  ```java
  Integer[] boxed = {5, 3, 1, 4, 2};
  Arrays.sort(boxed);           // TimSort — merge-based, stable

  int[] nums = {5, 3, 1, 4, 2};
  Arrays.sort(nums);            // dual-pivot quicksort — not merge-based, not stable (doesn't need to be)
  ```

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4th Edition (Addison-Wesley, 2011) — Section 2.2 "Mergesort", pp. 270-287 — book
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4th Edition (MIT Press, 2022) — Chapter 2 "Getting Started", Section 2.3, pp. 34-40 — book
- [Princeton Algorithms, 4th Ed. — Mergesort (companion site)](https://algs4.cs.princeton.edu/22mergesort/) — doc
- [Arrays — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html) — doc
