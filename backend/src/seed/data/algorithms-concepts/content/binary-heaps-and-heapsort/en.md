---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand the binary heap: a complete-binary-tree shape stored implicitly in a plain array (no pointers), kept in heap order (parent ≥ both children) rather than fully sorted order — the standard implementation of the priority queue ADT (insert, remove-the-max), and the engine behind heapsort, an in-place sort with a guaranteed O(n log n) worst case.

## Use Cases

- The priority queue ADT itself — insert an item, repeatedly remove the highest- (or lowest-) priority one — for task/job scheduling, event-driven simulation (process events in time order), and as the core data structure inside Dijkstra's and Prim's algorithms, where the next node to process is always the current minimum-cost one.
- Heapsort, when a *guaranteed* O(n log n) worst case and O(1) extra space both matter — embedded systems, low-memory environments, or anywhere an adversarial input could otherwise trigger quicksort's O(n²) worst case.
- Any "find the top/bottom k of a huge stream" problem, where sorting everything is wasteful — a heap gives insert and remove-the-extreme in O(log n) without ever fully ordering the rest of the data.

## Deep Dive

### The complete binary tree hiding in a plain array

A binary heap is a **complete** binary tree — every level full except possibly the last, which fills left to right — with no gaps. That completeness is what makes an array representation possible with no explicit child/parent pointers at all. CLRS's Figure 6.1 example, using 1-indexed `A[1..n]` the way both books present the index arithmetic:

```
i     1    2    3   4   5   6   7   8   9  10
A[i]  16   14   10  8   7   9   3   2   4   1

              1
             16
       2              3
      14              10
   4      5       6       7
   8      7       9       3
 8   9  10
 2   4   1
```

For a node at 1-indexed position `k`: its children are at `2k` and `2k + 1`, and its parent is at `⌊k/2⌋`. Moving up or down the tree is just arithmetic on an index — no `left`/`right`/`parent` fields, no allocation per node. Sedgewick & Wayne present the identical formulas for their `pq[1..N]` array (`pq[0]` deliberately unused).

Real Java code almost always uses a plain 0-indexed array instead (this is what `java.util.PriorityQueue` does internally). The formulas shift by one:

```java
int parent(int i) { return (i - 1) / 2; }
int left(int i)   { return 2 * i + 1; }
int right(int i)  { return 2 * i + 2; }
```

Either convention gives O(log n) height for n elements, since a complete tree's height is `⌊lg n⌋` — that bound is what makes every heap operation below O(log n).

**Heap order is not sort order.** A max-heap only guarantees parent ≥ both children — it says nothing about how siblings or cousins compare. `A[2]=14` and `A[3]=10` in the array above are unrelated by heap order even though they're adjacent; `A[4]=8` could just as easily have been smaller than `A[7]=3`. That's the key difference from a binary search tree: a heap trades away the sorted-order property entirely in exchange for O(1) access to the *single* largest (or smallest) element and cheap rebalancing.

### swim (sift-up) and sink (sift-down)

Both operations restore heap order after a single-point violation, by walking a path from that point toward the root or toward a leaf — never scanning the whole array. Using the 0-indexed formulas above, for a max-heap of `n` live elements:

```java
// A node's key just increased (or a new node was appended at the end) —
// swim it up until its parent is no longer smaller.
private void swim(int[] heap, int k) {
    while (k > 0 && heap[(k - 1) / 2] < heap[k]) {
        swap(heap, (k - 1) / 2, k);
        k = (k - 1) / 2;
    }
}

// A node's key just decreased (typically: the root was replaced) —
// sink it down, always trading places with the LARGER child.
private void sink(int[] heap, int k, int n) {
    while (2 * k + 1 < n) {
        int j = 2 * k + 1;                              // left child
        if (j + 1 < n && heap[j] < heap[j + 1]) j++;     // pick the larger child
        if (heap[k] >= heap[j]) break;                   // heap order restored
        swap(heap, k, j);
        k = j;
    }
}
```

`insert` appends the new key at the end and calls `swim`; `removeMax` swaps the root with the last live element, shrinks the live region by one, and calls `sink` on the new root. Both are O(log n), since each loop takes at most one step per tree level.

A small hand-traced example. Start from the valid max-heap `[9, 5, 7, 3, 1]` and insert `8`:

```
insert 8       → append at the end:        [9, 5, 7, 3, 1, 8]
swim(5)        → parent of index 5 is index 2 ("7"); 8 > 7, swap
               → [9, 5, 8, 3, 1, 7]
               → parent of index 2 is index 0 ("9"); 8 < 9, stop
```

Now `removeMax` on that same heap `[9, 5, 8, 3, 1, 7]`:

```
remove root 9  → move the last element ("7") to the root, shrink to size 5:
               → [7, 5, 8, 3, 1]
sink(0, 5)     → children of index 0 are "5" and "8"; larger is "8" (index 2), and 7 < 8, swap
               → [8, 5, 7, 3, 1]
               → index 2 has no live children (2*2+1 = 5 is out of range), stop
```

Both traces restore heap order in exactly one swap because the violation started right next to where the fix needed to happen — the general case just repeats the same check-and-swap until it doesn't.

### Building a heap bottom-up in O(n) — not O(n log n)

Inserting `n` items one at a time (`n` calls to `swim`) builds a heap in O(n log n). CLRS's `BUILD-MAX-HEAP` does better by going the other direction — calling `sink` on every *internal* node, from the last one up to the root:

```java
// 0-indexed: internal nodes are 0 .. n/2 - 1; everything from n/2 onward is a leaf.
void buildMaxHeap(int[] heap) {
    int n = heap.length;
    for (int k = n / 2 - 1; k >= 0; k--) {
        sink(heap, k, n);
    }
}
```

This is where the naive bound is misleading. `sink` costs O(height of the node it's called on), not O(log n) flat — and in a complete tree, *most* nodes are near the bottom, where height is small. Half the nodes are leaves (height 0, free). A quarter are at height 1. Only a single node — the root — is at the maximum height, `⌊lg n⌋`.

Summing `height × (number of nodes at that height)` across all levels gives, per CLRS:

```
Σ (h=0 to lg n)  n / 2^(h+1) · h   =   O(n) · Σ (h=0 to lg n) h / 2^h   =   O(n)
```

The inner sum `Σ h/2^h` converges to a constant (2, by the standard identity for `Σ h·x^h`) regardless of how large `n` gets — it doesn't grow with the tree. So the total work is a constant times `n`, i.e. **O(n)**, not `O(n log n)`. The intuition in one sentence: heap construction spends `O(log n)` work only on the tiny handful of nodes actually that tall, and `O(1)`-ish work on the vast majority of nodes near the leaves — the weighted sum is linear, because the "expensive" cases are exponentially rare.

### Heapsort: build once, then repeatedly extract the max

Heapsort has exactly two phases, both driven by `sink` and nothing else:

```java
public static void heapSort(int[] a) {
    int n = a.length;
    for (int k = n / 2 - 1; k >= 0; k--) sink(a, k, n);   // phase 1: build the heap, O(n)
    for (int end = n - 1; end > 0; end--) {                // phase 2: sortdown, O(n log n)
        swap(a, 0, end);          // move the current max into its final sorted slot
        sink(a, 0, end);          // restore heap order in the shrunken live region
    }
}
```

Phase 1 turns the unordered array into a max-heap in place, in O(n) (previous sub-topic). Phase 2 repeats "swap the root with the last live element, shrink, sink" exactly `n − 1` times, each `sink` costing O(log n) on a shrinking heap — O(n log n) total, and because the "last live element" position is exactly where the extracted max belongs in final sorted order, the array ends up fully sorted with **no auxiliary array at all**.

A full, hand-verified trace on seven elements — `[4, 10, 3, 5, 1, 8, 7]` — first heapified, then sorted down. The `mark` at index 5 shows the moment the build phase ends and sortdown begins:

```viz
type: moves
mark 0 | Build phase starts at the last internal node (index 2, value "3") and sinks it — leaves need no work.
swap 2 5 | sink(2): children are "8" (index 5) and "7" (index 6); "8" is the larger, and it beats "3" — swap.
swap 0 1 | sink(0): children are "10" (index 1) and "8" (index 2, after the previous swap); "10" beats "4" — swap.
swap 1 3 | The old root "4" landed at index 1, which now loses to its child "5" (index 3) — sink continues, swap again. Heap built: [10,5,8,4,1,3,7].
mark 0 | Heap built in O(n). Sortdown: swap the root (the max) with the last live slot, shrink the heap, sink the new root — repeat.
swap 0 6 | Extract max: "10" trades with "7" (last live index) — "10" is now in its final sorted position.
swap 0 2 | sink(0) over the shrunk heap: "8" (index 2) beats the new root "7" — swap.
swap 0 5 | Extract max: "8" trades with "3" (new last live index) — "8" is sorted.
swap 0 2 | sink(0): "7" (index 2) beats the new root "3" — swap.
swap 0 4 | Extract max: "7" trades with "1" (last live index) — "7" is sorted.
swap 0 1 | sink(0): "5" (index 1) beats the new root "1" — swap.
swap 1 3 | The demoted "1" still loses to its child "4" (index 3) — sink continues, swap again.
swap 0 3 | Extract max: "5" trades with "1" (last live index) — "5" is sorted.
swap 0 1 | sink(0): "4" (index 1) beats the new root "1" — swap.
swap 0 2 | Extract max: "4" trades with "3" (last live index) — "4" is sorted. The 2-element heap [3,1] is already heap-ordered, no sink needed.
swap 0 1 | Final extract: "3" and "1" trade places. One element remains — heapsort is done: [1,3,4,5,7,8,10].
---
4
10
3
5
1
8
7
```

## Trade-offs

- **In-place, O(1) extra space, unlike mergesort** — heapsort sorts within the original array, needing no auxiliary buffer the way mergesort's `merge()` step does.
- **Guaranteed O(n log n) worst case, unlike quicksort's O(n²)** — no input, adversarial or otherwise, can degrade heapsort below `~2n lg n` compares (Sedgewick & Wayne's Proposition S); there's no pivot choice to get unlucky with.
- **Not stable** — extracting the max repeatedly reorders equal keys arbitrarily as they get swapped around the heap; if preserving original relative order of ties matters, this rules heapsort out (mergesort is the stable alternative).
- **Rarely the default in practice, despite the nice worst-case bound** — Sedgewick & Wayne note it explicitly: heapsort has poor cache behavior, since array entries are compared and swapped with others far away in the array (parent/child jumps of `~n/2`), not with nearby entries the way quicksort's or insertion sort's inner loops do. A well-tuned quicksort (with randomized/median-of-three pivot selection to avoid its worst case) typically wins on real hardware despite the theoretically worse bound — which is exactly why `Arrays.sort()` uses dual-pivot quicksort for primitives rather than heapsort.
- **Still the right tool when the *max/min alone* is needed repeatedly, not a full sort** — a heap-based priority queue does `insert`/`removeMax` in O(log n) each, versus O(n) for an unordered array or O(n) insert for a kept-sorted array; that's the whole reason `java.util.PriorityQueue` and algorithms like Dijkstra's lean on a heap instead of just sorting upfront.

## Documentation Links

- [Robert Sedgewick, Kevin Wayne, *Algorithms*, 4th Edition (Addison-Wesley, 2011) — Section 2.4 "Priority Queues", pp. 308-327](https://algs4.cs.princeton.edu/24pq/) — book
- [Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4th Edition (MIT Press, 2022) — Chapter 6 "Heapsort", pp. 161-181](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — book
- [PriorityQueue — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/PriorityQueue.html) — doc
