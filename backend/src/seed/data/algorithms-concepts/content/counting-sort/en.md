---
version: 1.0
updatedAt: 2026-08-14
---
## Objective

Understand counting sort: a sort that assumes every input element is an integer in the range 0 to k, and runs in Θ(n + k) time — Θ(n) when k = O(n) — by counting how many elements are less than or equal to each value and using that count to place each element directly into its final position, without ever comparing two input elements to each other.

## Use Cases

- Sorting n integers that are all known in advance to lie in a small range 0 to k, where k = O(n) — the case where counting sort's Θ(n) running time actually beats the Ω(n lg n) bound that comparison sorts are stuck with.
- As a subroutine inside radix sort, where each "digit" of a multi-key value is itself a small bounded integer sorted with counting sort — this only works correctly if counting sort is stable.
- Any situation where you need to know, for each element, how many other elements are less than or equal to it — the counting/prefix-sum pass produces exactly that information as a byproduct.

## Deep Dive

### The three passes: count, accumulate, place

Counting sort first determines, for each input element x, the number of elements less than or equal to x, then uses that number to place x directly into its position in the output array. If 17 elements are less than or equal to x, x belongs in output position 17 — with a twist to handle duplicate values so they don't all collide on the same position.

The book's `COUNTING-SORT(A, n, k)` procedure takes array `A[1..n]`, the size n, and the limit k on the nonnegative integer values in A. It returns sorted output in array `B[1..n]` and uses `C[0..k]` as temporary working storage. Translated to a 0-indexed Java array (the book's arrays are 1-indexed, so an output position `C[A[j]]` becomes `C[A[j]] - 1` once B is 0-indexed):

```java
static int[] countingSort(int[] a, int k) {
    int n = a.length;
    int[] b = new int[n];
    int[] c = new int[k + 1];

    for (int i = 0; i <= k; i++) {
        c[i] = 0;                          // lines 2-3: initialize C to all zeros
    }
    for (int j = 0; j < n; j++) {
        c[a[j]] = c[a[j]] + 1;             // lines 4-5: C[i] = # elements equal to i
    }
    for (int i = 1; i <= k; i++) {
        c[i] = c[i] + c[i - 1];            // lines 7-8: C[i] = # elements <= i
    }
    for (int j = n - 1; j >= 0; j--) {     // lines 11-13: copy A to B, from the end of A
        b[c[a[j]] - 1] = a[j];
        c[a[j]] = c[a[j]] - 1;             // decrement, to handle duplicate values
    }
    return b;
}
```

After the first loop zeroes `C`, the second loop makes a pass over `A` and increments `C[i]` each time it finds an element equal to `i`; after that pass, `C[i]` holds the number of input elements equal to `i` for each `i = 0, 1, ..., k`. The third loop turns that into a running sum, so `C[i]` now holds the number of input elements less than or equal to `i`. The final loop makes another pass over `A`, in reverse, placing each element into its correct sorted position in `B` and decrementing `C` so the next occurrence of the same value lands one slot earlier.

### Worked example, traced step by step

The book traces `COUNTING-SORT` on `A[1..8] = <2, 5, 3, 0, 2, 3, 0, 3>` with `k = 5` (every value is a nonnegative integer no larger than 5). Following the same array (1-indexed, matching the book):

```
Input A (positions 1..8):        2  5  3  0  2  3  0  3

After the counting pass (line 5), C[i] = # elements equal to i:
  i:  0  1  2  3  4  5
  C:  2  0  2  3  0  1

After the prefix-sum pass (line 8), C[i] = # elements <= i:
  i:  0  1  2  3  4  5
  C:  2  2  4  7  7  8
```

The last loop then walks `A` from `j = 8` down to `j = 1`, placing each `A[j]` at position `C[A[j]]` in `B` and decrementing `C[A[j]]` afterward:

```
j=8  A[8]=3  C[3]=7 -> B[7]=3   C[3] becomes 6
j=7  A[7]=0  C[0]=2 -> B[2]=0   C[0] becomes 1
j=6  A[6]=3  C[3]=6 -> B[6]=3   C[3] becomes 5
j=5  A[5]=2  C[2]=4 -> B[4]=2   C[2] becomes 3
j=4  A[4]=0  C[0]=1 -> B[1]=0   C[0] becomes 0
j=3  A[3]=3  C[3]=5 -> B[5]=3   C[3] becomes 4
j=2  A[2]=5  C[5]=8 -> B[8]=5   C[5] becomes 7
j=1  A[1]=2  C[2]=3 -> B[3]=2   C[2] becomes 2

Output B (positions 1..8):       0  0  2  2  3  3  3  5
```

If all n elements were distinct, `C[A[j]]` would already be `A[j]`'s correct final position the first time line 11 is entered, since `C[A[j]]` counts exactly the elements less than or equal to `A[j]`. Because elements can repeat, decrementing `C[A[j]]` after each placement causes the *previous* element in `A` with the same value — if one exists — to land immediately before it in `B`.

### Why Θ(n + k) doesn't violate the Ω(n lg n) sorting lower bound

Counting sort can beat the Ω(n lg n) comparison-sort lower bound because it is not a comparison sort — no comparisons between input elements occur anywhere in the code. Instead, it uses the actual values of the elements to index directly into an array (`C[A[j]]`). The Ω(n lg n) lower bound only applies to algorithms that determine sorted order by comparing elements; it does not apply once you depart from the comparison-sort model, which is exactly what indexing by value does.

Timing-wise: the initialization loop (lines 2-3) takes Θ(k), the counting loop (lines 4-5) takes Θ(n), the prefix-sum loop (lines 7-8) takes Θ(k), and the placement loop (lines 11-13) takes Θ(n). The overall running time is Θ(k + n). In practice counting sort is used when k = O(n), in which case the running time is Θ(n).

### Stability, and why the loop runs backward

Counting sort is stable: elements with the same value appear in the output array in the same order as they do in the input array — ties are broken by whichever element appears first in the input. Normally stability only matters when satellite data travels with the sorted key, but here it matters for another reason: counting sort is often used as a subroutine in radix sort, and radix sort only works correctly if counting sort is stable.

That stability isn't automatic — it depends on scanning `A` backward (`j = n downto 1`) and decrementing `C[A[j]]` after each placement. The book poses this directly as an exercise: rewrite the loop header at line 11 to run forward instead —

```java
for (int j = 0; j < n; j++) {   // instead of j = n - 1 downto 0
    b[c[a[j]] - 1] = a[j];
    c[a[j]] = c[a[j]] - 1;
}
```

— and the algorithm still sorts correctly, but it is no longer stable. Scanning from the end is what guarantees that among equal-valued elements, the one appearing earlier in `A` gets written to the earlier position in `B`.

## Trade-offs

- **Only sorts bounded nonnegative integer keys, not arbitrary comparable values** — the algorithm assumes every element is an integer in a known range 0 to k; it has no notion of comparison, so it can't be handed arbitrary `Comparable` objects the way a comparison sort can.
- **Θ(n + k) is linear only when k = O(n)** — the counting and prefix-sum passes each cost Θ(k) regardless of how many elements there actually are, so if k is much larger than n, those passes dominate and the sort stops behaving like Θ(n).
- **Stability comes from a specific implementation choice, not for free** — the reverse scan (`j = n downto 1`) combined with decrementing `C[A[j]]` after every placement is what makes counting sort stable; rewriting the final loop to scan forward still produces a sorted array, but breaks stability, which matters if counting sort is being used as radix sort's subroutine.
- **Costs Θ(n + k) auxiliary space** for the output array `B` and the counting array `C`, on top of the input array `A` — unlike an in-place comparison sort, counting sort always needs that extra storage.

## Documentation Links

- [Introduction to Algorithms, 4th Edition — Cormen, Leiserson, Rivest, Stein](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — Section 8.2 "Counting sort", pp. 209-211 — doc
