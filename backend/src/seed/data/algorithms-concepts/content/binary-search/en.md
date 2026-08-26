---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand binary search: how repeatedly halving a sorted array's search range finds a target in O(log n) comparisons instead of the O(n) a linear scan needs, and why the algorithm only works at all because the array is sorted.

## Use Cases

- Looking up a value in a large sorted array or list without scanning every element.
- The canonical building block for any "closest match" or "insertion point" query (`Collections.binarySearch()`, `Arrays.binarySearch()`) — most JDK sorted-search APIs are binary search underneath.
- A standard first algorithm-design/interview question — expect to be asked for the recursive and iterative forms, and to explain the O(log n) bound precisely, not just recite it.

## Deep Dive

### The core idea: halve the search range every comparison

Sedgewick and Wayne's `rank()` method (from their `BinarySearch` class) is the canonical Java implementation. Given a sorted array and a key, it tracks a shrinking `[lo, hi]` window and compares against the midpoint each time:

```java
public static int rank(int key, int[] a) {
    int lo = 0;
    int hi = a.length - 1;
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;
        if (key < a[mid]) hi = mid - 1;
        else if (key > a[mid]) lo = mid + 1;
        else return mid;
    }
    return -1;
}
```

Each iteration eliminates *half* of whatever's left, regardless of how large the array started — that's what gives it O(log n) comparisons instead of linear search's O(n). `mid = lo + (hi - lo) / 2` (rather than the more obvious `(lo + hi) / 2`) is deliberate: on a large enough array, `lo + hi` can overflow `int` before the division happens, a real historical bug (including in early JDK `Arrays.binarySearch()` implementations) that this formulation avoids.

### Watch it happen: the search window closing in

Searching a sorted 9-element array for a value that isn't in it (`5`) — watch each `mid` narrow the live range until `lo` crosses `hi`:

```viz
type: moves
mark 4 | mid = 4: a[4] = 8, target 5 < 8 -- search the left half, hi = 3.
mark 1 | mid = 1: a[1] = 2, target 5 > 2 -- search the right half, lo = 2.
mark 2 | mid = 2: a[2] = 4, target 5 > 4 -- search the right half, lo = 3.
mark 3 | mid = 3: a[3] = 6, target 5 < 6 -- search the left half, hi = 2. lo > hi: not found.
---
1
2
4
6
8
11
14
17
20
```

Nine elements, and only four comparisons were needed to conclude the value isn't there — a linear scan would have had to check up to all nine.

### CLRS's framing: correctness by loop invariant

Cormen et al. present binary search as a canonical example (exercise 2.3-6) for proving an algorithm correct via a loop invariant: at the start of every iteration, if the key is present in the array at all, it must lie within `A[lo..hi]` — the halving step preserves that invariant on every iteration, and the loop terminates either by finding the key or by `lo` crossing `hi` (proving the invariant now implies the key isn't present anywhere).

## Trade-offs

- **Requires the array to already be sorted** — binary search itself is O(log n), but sorting first (if the data isn't sorted yet) costs O(n log n), which only pays off if the same sorted structure is searched many times; a single one-off search on unsorted data is faster with a plain linear scan.
- **O(log n) comparisons, but each comparison on a huge dataset may not be O(1)** — comparing two large objects (long strings, big records) isn't free; the log n *count* of comparisons is what's guaranteed, not that the whole search runs in constant time per step regardless of what's being compared.
- **Works cleanly on a random-access array; awkward on a linked structure** — jumping straight to the midpoint is O(1) on an array but O(n) on a `LinkedList`, which erases binary search's advantage entirely; this is exactly why sorted tree structures (binary search trees, covered separately) exist as the linked-structure equivalent of this idea.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4th Edition (Addison-Wesley, 2011) — Section 1.1 "Basic Programming Model", pp. 8-9 — book
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4th Edition (MIT Press, 2022) — Chapter 2 "Getting Started", Exercise 2.3-6, p. 45 — book
- [Arrays.binarySearch — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html#binarySearch(int%5B%5D,int)) — doc
