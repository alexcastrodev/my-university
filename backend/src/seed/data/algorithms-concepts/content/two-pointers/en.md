---
version: 1.0
updatedAt: 2026-09-01
---
## Objective

Understand the two-pointer technique: walking a structure with two indices instead of one — either converging from opposite ends or moving in the same direction at different speeds — to replace an O(n²) nested scan with a single O(n) pass. The trick only works because of a specific structural guarantee (usually sortedness, or a "next" link); it is not a free O(n) button for any nested loop.

## Use Cases

- **Two Sum on a sorted array** — find the pair that sums to a target without checking every pair.
- **Container With Most Water / trapping rain water** — the shorter of two boundary walls is always the one to move.
- **3Sum** — fix one element, two-pointer the rest of the (now sorted) remainder.
- **Merging two sorted arrays** — this is not a separate trick; it's the exact mechanism [Mergesort](mergesort)'s `merge()` step already uses.
- **Fast and slow pointers** — cycle detection and finding a linked list's midpoint in one pass, no extra memory.

## Deep Dive

### Opposite-end pointers: the exchange argument

`Two Sum II` (sorted input): `lo` starts at index 0, `hi` at the last index. If `a[lo] + a[hi]` is too small, `lo` must move right — `a[lo]` paired with *any* index it could reach is now provably too small, because every other candidate for `hi` is ≤ the current `hi`. Symmetrically, if the sum is too big, `hi` must move left. Each comparison eliminates one index from further consideration entirely, so the pointers can move at most n steps combined before they meet — O(n) total, not O(n) per step.

```java
public static int[] twoSumSorted(int[] a, int target) {
    int lo = 0, hi = a.length - 1;
    while (lo < hi) {
        int sum = a[lo] + a[hi];
        if (sum == target) return new int[] { lo, hi };
        if (sum < target) lo++;
        else hi--;
    }
    return new int[] { -1, -1 };
}
```

`Container With Most Water` uses the same shape with a sharper exchange argument: the area between `lo` and `hi` is bounded by `min(a[lo], a[hi]) * (hi - lo)`. Moving the *taller* wall can only shrink the width while the height stays capped by the same shorter wall or gets worse — every configuration it could reach is dominated by one already checked. Moving the *shorter* wall is the only move that can possibly find something taller. That's why the pointer to move is never a choice — it's forced.

### Same-direction pointers: fast and slow

A different shape entirely: both pointers start at the same place and move forward, one at double the speed of the other. On a linked list, if a cycle exists, the fast pointer eventually laps the slow one inside the loop — they collide. If no cycle exists, the fast pointer reaches `null` first. This is Floyd's cycle-detection algorithm, and the same fast/slow relationship finds a list's midpoint in one pass: when `fast` reaches the end, `slow` is sitting at the middle.

```java
public static boolean hasCycle(ListNode head) {
    ListNode slow = head, fast = head;
    while (fast != null && fast.next != null) {
        slow = slow.next;
        fast = fast.next.next;
        if (slow == fast) return true;
    }
    return false;
}
```

### Watch it happen: converging on Two Sum II

Searching `[2, 7, 11, 15]` for a pair summing to `18`:

| Step | lo | hi | a[lo] + a[hi] | Move |
|---|---|---|---|---|
| 1 | 0 (2) | 3 (15) | 17 | too small — lo++ |
| 2 | 1 (7) | 3 (15) | 22 | too big — hi-- |
| 3 | 1 (7) | 2 (11) | 18 | found |

Three comparisons for a 4-element array; the brute-force nested loop would have checked up to six pairs, and the gap only widens as `n` grows.

## Trade-offs

- **The opposite-ends variant needs sorted input** — if the data isn't already sorted, you pay O(n log n) to sort it first, which only pays off if the two-pointer scan that follows is cheap by comparison (it is, at O(n), but the sort dominates the asymptotic cost either way).
- **Correctness is proved per-problem, not once for the technique** — "moving the shorter wall is safe" and "the sum-too-small pointer must advance" are two different exchange arguments; the *shape* of the code transfers between problems, but the proof that a given pointer move never loses the answer does not.
- **Fast/slow pointers need O(1)-hop "next" access** — the technique's whole value on a linked list is doing cycle detection without an O(n) auxiliary hash set; on a random-access array, a visited-set is usually simpler and doesn't need the trick at all.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4th Edition (Addison-Wesley, 2011) — Section 2.2 "Mergesort," the `merge()` method — the two-pointer technique fully spelled out as the core of merging two sorted arrays — book
- Donald E. Knuth, *The Art of Computer Programming, Volume 2: Seminumerical Algorithms*, 3rd Edition (Addison-Wesley, 1997) — Section 3.1, Exercise 6 credits the cycle-detection algorithm popularized as "tortoise and hare" — book
