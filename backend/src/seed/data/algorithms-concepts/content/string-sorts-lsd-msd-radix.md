---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand LSD and MSD radix sort: two string-sorting methods that examine individual *characters* rather than comparing whole keys, built on a shared primitive (key-indexed counting), that achieve linear-time sorting for strings by sidestepping the comparison-based N log N lower bound entirely.

## Use Cases

- Sorting large collections of fixed-length strings or numeric codes — license plates, IP addresses, fixed-width account numbers, telephone numbers — where LSD radix sort's linear time beats any comparison sort.
- Sorting huge collections of variable-length strings where most keys diverge in their first few characters — MSD radix sort can finish after examining only a handful of characters per key instead of the whole string.
- Understanding the theoretical floor of sorting: why a sort that avoids `compareTo()` entirely and indexes directly into an array by character value can beat the N log N bound that applies to comparison-based sorts.

## Deep Dive

### Key-indexed counting: the primitive underneath both radix sorts

Both radix sorts are built on the same simple idea: if keys are small integers in `[0, R)`, you can sort in one linear pass by counting how many items have each key value, turning those counts into starting positions, then distributing items directly to those positions — no comparisons at all.

Take six items with small-integer keys `[2, 3, 3, 0, 1, 2]`. The method breaks into four steps:

```java
int N = a.length;
String[] aux = new String[N];
int[] count = new int[R + 1];

// 1. Compute frequency counts (offset by +1 — see step 2).
for (int i = 0; i < N; i++)
    count[a[i].key() + 1]++;
// count[] is now: [0, 1, 1, 2, 2] -- one item with key 0, one with key 1, two with key 2, two with key 3.

// 2. Transform counts to indices: cumulative sum gives each key's start index.
for (int r = 0; r < R; r++)
    count[r + 1] += count[r];
// count[] is now: [0, 1, 2, 4, 6] -- key 0 starts at 0, key 1 at 1, key 2 at 2, key 3 at 4.

// 3. Distribute the records to their starting positions, advancing each as used.
for (int i = 0; i < N; i++)
    aux[count[a[i].key()]++] = a[i];

// 4. Copy back.
for (int i = 0; i < N; i++)
    a[i] = aux[i];
```

The `+1` offset in step 1 is what makes step 2's cumulative sum land on the *start* index for each key rather than the end. Because step 3 walks the original array left to right and always writes to the *next available* slot for that key (then advances the counter), items with equal keys keep their original relative order — key-indexed counting is stable. That stability is not a nice-to-have here; it is the entire reason the next algorithm works at all.

### LSD radix sort: fixed-length strings, right to left

LSD (least-significant-digit) radix sort sorts strings that are all the same length `W` by running key-indexed counting `W` times — once per character position, proceeding from the *rightmost* character to the leftmost:

```java
public class LSD {
    public static void sort(String[] a, int W) {
        // Sort a[] on leading W characters.
        int N = a.length;
        int R = 256;
        String[] aux = new String[N];

        for (int d = W - 1; d >= 0; d--) {
            // Sort by key-indexed counting on the dth character.
            int[] count = new int[R + 1];

            for (int i = 0; i < N; i++)
                count[a[i].charAt(d) + 1]++;

            for (int r = 0; r < R; r++)
                count[r + 1] += count[r];

            for (int i = 0; i < N; i++)
                aux[count[a[i].charAt(d)]++] = a[i];

            for (int i = 0; i < N; i++)
                a[i] = aux[i];
        }
    }
}
```

It is not obvious at first that sorting right-to-left, one character at a time, produces a correct final order — and it does not work at all unless each pass's key-indexed count is stable. The correctness argument (Sedgewick & Wayne's Proposition B) is an induction on the trailing characters already examined: after sorting on the `i` trailing characters, any two keys are either already in proper order because their `i`th-from-last characters differ (that pass placed them correctly), or their `i`th-from-last characters are equal, in which case stability keeps them in the order established by the previous pass on the remaining `i - 1` characters. Put another way: whatever the earlier (more significant) characters eventually decide, stability guarantees the current pass never disturbs an ordering that a later pass hasn't had the chance to fix yet.

### Watch it happen: LSD radix sort, pass by pass

Sorting five 3-digit strings — `329, 720, 133, 910, 352` — with LSD radix sort. Each pass is one key-indexed-counting distribution on a single digit position, moving every token straight to its new slot (this is the `aux[count[key]++] = a[i]` distribution step, not a comparison-based swap):

```viz
type: moves
move 329 4 | Pass 1 (rightmost digit, d=2): key-indexed count on the units digit. "329" (units digit 9) goes to the last bucket, slot 4.
move 720 0 | "720" (units digit 0) goes to the first bucket, slot 0.
move 133 3 | "133" (units digit 3) goes to slot 3.
move 910 1 | "910" (units digit 0, same bucket as "720") lands right after it at slot 1 -- stability preserves their original relative order.
move 352 2 | "352" (units digit 2) goes to slot 2. After pass 1: 720, 910, 352, 133, 329.
move 720 1 | Pass 2 (tens digit, d=1): "720" (tens digit 2) goes to slot 1.
move 910 0 | "910" (tens digit 1, the smallest) goes to slot 0.
move 352 4 | "352" (tens digit 5, the largest) goes to slot 4.
move 133 3 | "133" (tens digit 3) goes to slot 3.
move 329 2 | "329" (tens digit 2, same bucket as "720") lands right after it at slot 2 -- stability again. After pass 2: 910, 720, 329, 133, 352.
move 910 4 | Pass 3 (leftmost digit, d=0): "910" (hundreds digit 9) goes to the last slot, 4.
move 720 3 | "720" (hundreds digit 7) goes to slot 3.
move 329 1 | "329" (hundreds digit 3) goes to slot 1.
move 133 0 | "133" (hundreds digit 1, the smallest) goes to slot 0.
move 352 2 | "352" (hundreds digit 3, same bucket as "329") lands right after it at slot 2 -- stability across all three passes is what makes this final order correct: 133, 329, 352, 720, 910.
---
329
720
133
910
352
```

Three passes, each a single linear scan with no character comparisons — and the array ends up fully sorted purely because each pass trusted the ordering the previous pass had already established for ties.

### MSD radix sort: variable-length strings, left to right

LSD radix sort needs every key to be the same length. MSD (most-significant-digit) radix sort handles variable-length strings by working left to right instead: key-indexed-count on the *first* character, then recursively apply the same method to each resulting bucket (the subarray of strings sharing that first character), moving on to the second character, and so on — structurally similar to quicksort, except the partition is by one character into up to `R` buckets instead of two or three comparison-based partitions.

The subtlety is what to do when a string is shorter than the character position currently being examined. MSD radix sort treats "past the end of the string" as its own sentinel character value that sorts *before* every real character — implemented as `-1`, then shifted by `+1` (or `+2`, alongside the counting array's own offset) so it can still be used as a non-negative array index:

```java
public class MSD {
    private static final int R = 256;   // radix
    private static final int M = 15;    // cutoff for small subarrays
    private static String[] aux;        // auxiliary array for distribution

    private static int charAt(String s, int d) {
        return d < s.length() ? s.charAt(d) : -1;   // end-of-string sentinel
    }

    public static void sort(String[] a) {
        int N = a.length;
        aux = new String[N];
        sort(a, 0, N - 1, 0);
    }

    private static void sort(String[] a, int lo, int hi, int d) {
        // Sort from a[lo] to a[hi], starting at the dth character.
        if (hi <= lo + M) {
            Insertion.sort(a, lo, hi, d);
            return;
        }

        int[] count = new int[R + 2];   // one extra slot for the sentinel

        for (int i = lo; i <= hi; i++)
            count[charAt(a[i], d) + 2]++;

        for (int r = 0; r < R + 1; r++)
            count[r + 1] += count[r];

        for (int i = lo; i <= hi; i++)
            aux[count[charAt(a[i], d) + 1]++] = a[i];

        for (int i = lo; i <= hi; i++)
            a[i] = aux[i - lo];

        // Recursively sort each bucket (skip r = 0, the end-of-string bucket).
        for (int r = 0; r < R; r++)
            sort(a, lo + count[r], lo + count[r + 1] - 1, d + 1);
    }
}
```

The recursion bottoms out into a *specialized* insertion sort once a bucket is small enough (`hi <= lo + M`) — exactly the same cutoff-to-insertion-sort trick used for quicksort and mergesort, but far more important here. With no cutoff, sorting millions of distinct strings eventually gives every string its own bucket of size one — and each of those tiny buckets still pays the fixed overhead of allocating and cumulating an `R + 2`-entry `count[]` array. For `R = 256` that overhead alone can dominate the sort; for Unicode (`R = 65536`) it gets far worse. Sedgewick & Wayne report roughly a 10x speedup from cutting off to insertion sort for buckets of size 10 or smaller in a typical application. The insertion sort used for the cutoff skips the leading `d` characters that the recursion has already proven equal for every string in the bucket:

```java
public class Insertion {
    public static void sort(String[] a, int lo, int hi, int d) {
        for (int i = lo; i <= hi; i++)
            for (int j = i; j > lo && less(a[j], a[j - 1], d); j--)
                exch(a, j, j - 1);
    }

    private static boolean less(String v, String w, int d) {
        return v.substring(d).compareTo(w.substring(d)) < 0;
    }
}
```

### Trade-off aside: 3-way radix quicksort for large alphabets

MSD radix sort's weakness is the alphabet size `R`: every recursive call allocates and cumulates an array of size roughly `R`, even for a bucket holding only one or two strings. That is cheap for `R = 256` (extended ASCII) but can be disastrous for `R = 65536` (Unicode) — many mostly-empty buckets, paid for on every call.

Three-way radix quicksort is the hybrid fix: instead of partitioning the current character into `R` buckets, it 3-way-partitions on the current character exactly like quicksort's 3-way partitioning (Chapter 2) — into "less than," "equal to," and "greater than" the pivot character — and only recurses to the next character on the *equal* partition:

```java
private static void sort(String[] a, int lo, int hi, int d) {
    if (hi <= lo) return;
    int lt = lo, gt = hi;
    int v = charAt(a[lo], d);
    int i = lo + 1;
    while (i <= gt) {
        int t = charAt(a[i], d);
        if      (t < v) exch(a, lt++, i++);
        else if (t > v) exch(a, i, gt--);
        else            i++;
    }
    // a[lo..lt-1] < v = a[lt..gt] < a[gt+1..hi]
    sort(a, lo, lt - 1, d);
    if (v >= 0) sort(a, lt, gt, d + 1);
    sort(a, gt + 1, hi, d);
}
```

This never depends on `R` at all — it always produces exactly three partitions, whatever the alphabet — and it needs no auxiliary array, only the implicit recursion stack, unlike MSD radix sort's `aux[]` and `count[]`. The cost is doing more data movement to achieve the same effect as one multiway partition, since a single MSD-style split into many buckets now takes a series of 3-way partitions instead of one pass. It is the method of choice whenever keys share long common prefixes or come from a large alphabet — exactly the situations where MSD radix sort's per-call overhead stops paying off.

## Trade-offs

- **LSD radix sort needs fixed-length keys** — it has no notion of "past the end of the string," so variable-length keys require padding or a separate adaptation; when that constraint holds (IP addresses, fixed-width codes), it is linear time (`~7WN + 3WR` array accesses) and hard to beat.
- **Both radix sorts break the N log N comparison lower bound by not comparing at all** — they index directly into an array using a character's value, which a `compareTo()`-based sort can never do; this is *why* they can be faster than even an optimal comparison sort, not just a constant-factor tweak.
- **MSD radix sort's performance depends on the data, not just N** — for random strings it is sublinear (it stops as soon as keys are distinguished), but for inputs with many equal keys or long common prefixes it degrades toward the same linear-in-total-characters cost as LSD, and the `count[]` array's `O(R)` overhead per call can dominate for small buckets or large alphabets without the insertion-sort cutoff.
- **In practice, Java's own `String` sorting doesn't use any of this** — `Arrays.sort()` on `String[]` relies on `String.compareTo()`, which the JDK implements efficiently enough that, per Sedgewick & Wayne's own assessment, standard comparison-based sorts stay competitive with hand-rolled radix sorts for ordinary `String` keys; radix sort over raw `char[]` is a specialist's tool for when you have enormous volumes of strings and have already profiled `compareTo()` as the bottleneck.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4th Edition (Addison-Wesley, 2011) — Section 5.1 "String Sorts", pp. 702-725 — book
- [Princeton Algorithms, 4th Ed. — Radix Sorts (companion site)](https://algs4.cs.princeton.edu/51radix/) — doc
- [String#compareTo — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/String.html#compareTo(java.lang.String)) — doc
