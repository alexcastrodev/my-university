---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand quicksort: an in-place, divide-and-conquer sort that picks a *pivot*, partitions the array around it, and recursively sorts the two resulting pieces — average-case O(n log n) with small constants, at the cost of an O(n²) worst case if the pivot is chosen badly.

## Use Cases

- The default general-purpose sort when average-case speed and low memory overhead (in-place, no auxiliary array) matter more than a worst-case guarantee.
- A canonical example of divide-and-conquer: understanding quicksort's recursion makes mergesort, binary search, and most tree algorithms easier to reason about.
- A standard whiteboard/interview exercise — expect to be asked to implement partitioning, explain the worst case, or trace it by hand.

## Deep Dive

### The algorithm: partition, then recurse

Both books express the same three steps. Pick a pivot from the subarray, partition so everything ≤ pivot ends up to its left and everything ≥ pivot ends up to its right, then recursively sort each side:

```java
void quicksort(int[] a, int lo, int hi) {
    if (hi <= lo) return;
    int pivotIndex = partition(a, lo, hi);
    quicksort(a, lo, pivotIndex - 1);
    quicksort(a, pivotIndex + 1, hi);
}
```

The two books differ entirely in how `partition` works — and that difference is worth knowing, since it's a common source of off-by-one bugs when implementing quicksort from memory.

### Cormen's Lomuto partition: one forward scan, pivot at the end

CLRS picks the *last* element as the pivot and walks the subarray once with two indices, `i` tracking the boundary of the "≤ pivot" region:

```java
int partition(int[] a, int lo, int hi) {
    int pivot = a[hi];       // CLRS picks the last element
    int i = lo - 1;          // boundary of the "≤ pivot" region
    for (int j = lo; j < hi; j++) {
        if (a[j] <= pivot) {
            i++;
            swap(a, i, j);
        }
    }
    swap(a, i + 1, hi);      // pivot lands just right of the "≤" region
    return i + 1;
}
```

### Sedgewick's Hoare-style partition: two pointers scanning inward

Algorithms, 4th Ed. instead picks the *first* element as the pivot and scans from both ends toward the middle, swapping out-of-place pairs as it goes:

```java
int partition(int[] a, int lo, int hi) {
    int pivot = a[lo];               // Sedgewick picks the first element
    int i = lo, j = hi + 1;
    while (true) {
        while (a[++i] < pivot) if (i == hi) break;
        while (a[--j] > pivot) if (j == lo) break;
        if (i >= j) break;
        swap(a, i, j);
    }
    swap(a, lo, j);                  // pivot lands at the meeting point
    return j;
}
```

Both are correct, in-place, and O(n) per partition call — the difference is scan direction and which end holds the pivot, not asymptotic behavior.

### Watch it happen: the actual partitioning and swaps

Sedgewick's own running example shuffles the letters of "QUICKSORT" and sorts them. This runs the real Hoare-style partitioning shown above, step by step — every pivot pick and every exchange, not just where each letter ends up:

```viz
type: moves
mark 0 | Pivot for a[0..8] is "Q" — Sedgewick's partition always picks the leftmost element.
swap 1 6 | "U" (pos 1) is ≥ "Q", "O" (pos 6) is ≤ "Q" — they're on the wrong sides, trade them.
swap 0 4 | Scans meet at position 4: swap the pivot "Q" into place — left of it is now ≤ "Q", right is ≥ "Q".
mark 0 | Recurse left, a[0..3]: pivot is "K".
swap 1 3 | "O" (pos 1) is ≥ "K", "C" (pos 3) is ≤ "K" — trade them.
swap 0 2 | Scans meet at position 2: swap pivot "K" into place.
mark 0 | Recurse left again, a[0..1]: pivot is "I".
swap 0 1 | Only one comparison left — swap pivot "I" into its final slot.
mark 5 | Recurse right of the first partition, a[5..8]: pivot is "S".
swap 6 7 | "U" (pos 6) is ≥ "S", "R" (pos 7) is ≤ "S" — trade them.
swap 5 6 | Scans meet at position 6: swap pivot "S" into place.
mark 7 | Recurse right, a[7..8]: pivot is "U".
swap 7 8 | Last comparison — swap pivot "U" into its final slot.
---
Q
U
I
C
K
S
O
R
T
```

### Average case vs. worst case

A pivot that splits the subarray roughly in half each time gives the same recurrence as mergesort, `T(n) = 2T(n/2) + O(n)`, which solves to **O(n log n)**. A pivot that's always the smallest or largest element (already-sorted input with a naive first/last-element pivot choice) degrades every partition to a size-1/size-(n−1) split, giving `T(n) = T(n-1) + O(n)`, which solves to **O(n²)** — the worst case both books derive in detail.

## Trade-offs

- **Worst-case O(n²) on adversarial or already-sorted input, unlike mergesort's guaranteed O(n log n)** — the standard mitigation both books cover is randomizing the pivot choice (shuffle the array first, or pick a random element as pivot) so the worst case becomes vanishingly unlikely rather than triggered by common inputs like sorted or reverse-sorted data.
- **Not stable** — equal elements can be reordered relative to each other during partitioning, unlike mergesort or insertion sort. If preserving the original relative order of equal keys matters (e.g. sorting already-date-sorted transactions by amount), a stable sort is the safer default.
- **In production Java, you're not calling either textbook implementation** — `Arrays.sort()` on a primitive array (`int[]`, `long[]`, etc.) uses a **dual-pivot quicksort**, not the single-pivot scheme either book teaches, and `Arrays.sort()` on an `Object[]`/generic array uses **TimSort** (a stable merge/insertion-sort hybrid), not quicksort at all — because stability matters for objects with custom `compareTo()`/`Comparator` logic but not for raw primitives:

  ```java
  int[] nums = {5, 3, 1, 4, 2};
  Arrays.sort(nums);                 // dual-pivot quicksort, unstable, fine for primitives

  Integer[] boxed = {5, 3, 1, 4, 2};
  Arrays.sort(boxed);                // TimSort, stable, used because equal-key order can matter for objects
  ```

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4th Edition (Addison-Wesley, 2011) — Section 2.3 "Quicksort", pp. 288-307 — book
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4th Edition (MIT Press, 2022) — Chapter 7 "Quicksort", pp. 182-204 — book
- [Princeton Algorithms, 4th Ed. — Quicksort (companion site)](https://algs4.cs.princeton.edu/23quicksort/) — doc
- [Arrays — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html) — doc
