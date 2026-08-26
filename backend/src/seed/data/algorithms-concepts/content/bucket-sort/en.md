---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

Understand bucket sort: a non-comparison sort that scatters n keys — assumed to be uniformly distributed over a known interval `[0, K)` — into n buckets of equal width `K/n`, sorts each bucket with a simple algorithm, and concatenates the buckets in order. Under the uniformity assumption each bucket is expected to hold only a small, constant number of elements, which is what drives the whole sort's expected running time down to O(n) — a different structural assumption from the sibling `counting-sort` (small integer range) and `string-sorts-lsd-msd-radix` (fixed-width keys, sorted digit by digit) concepts, even though all three beat the same Ω(n log n) comparison-sort lower bound by refusing to compare keys pairwise at all.

## Use Cases

- Sorting a large batch of floating-point measurements or scores already known to be roughly uniform over a fixed range — sensor readings normalized to `[0, 1)`, percentile scores, random samples from a known distribution — where bucket sort's expected O(n) beats any comparison sort's Ω(n log n) floor.
- A pre-processing step before a comparison sort when the input is expected to be roughly evenly spread but the exact distribution isn't guaranteed enough to trust blindly — bucket sort degrades gracefully to whatever the per-bucket sort's complexity is, rather than failing outright.
- Any pipeline where data can be rescaled into `[0, 1)` first (min-max normalization) and back afterward — the same linear rescaling a numeric feature gets before many statistical or machine-learning routines, reused here purely to make the uniformity assumption hold.
- Teaching the general "non-comparison sort" family alongside its two siblings: seeing all three side by side makes clear that "beats Ω(n log n)" always means "found *some* structural assumption about the keys to exploit," never "found a cleverer way to compare."

## Deep Dive

### The core idea: scatter into equal-width buckets, sort each, concatenate

Given an interval `I = [0, K)` and n keys assumed to be uniformly distributed over it, the first step divides `I` into `n` buckets, each of width `K/n`: bucket `0` covers `[0, K/n)`, bucket `1` covers `[K/n, 2K/n)`, and so on up to bucket `n-1` covering `[(n-1)K/n, K)`. Every key `x` is placed into bucket `floor(n·x/K)` — for the common case `K = 1` (keys already rescaled into `[0, 1)`), that's simply `floor(n·x)`.

```
0     1     2     3     4          ...              n-1
[--- | --- | --- | --- | --- | ... | --- ]
0   K/n  2K/n 3K/n 4K/n 5K/n            (n-1)K/n    K
```

Under the uniformity assumption, the expected number of elements landing in any one bucket is small and constant — which is the entire point: if bucket sizes stay O(1) on average, sorting each bucket individually (even with an O(n²)-worst-case algorithm like insertion sort) costs only O(1) time *per bucket*, O(n) total across all n buckets. The last step walks the buckets in order and concatenates their sorted contents into the final output.

**Worked example** (`n = 8` keys, already in `[0, 1)`): `0.75, 0.1, 0.3, 0.95, 0.05, 0.6, 0.9, 0.15`. Each key's bucket index is `floor(8·x)`:

```
key:     0.75  0.10  0.30  0.95  0.05  0.60  0.90  0.15
bucket:   6     0     2     7     0     4     7     1
```

Bucket 0 holds two keys (`0.10`, `0.05`) and bucket 7 holds two (`0.95`, `0.90`) — an entirely expected, small overflow under uniformity, not a hashing "collision" in the adversarial sense the sibling `hash-tables-chaining-and-open-addressing` concept describes (there, an attacker who knows the hash function can deliberately force every key into one slot; here, uniformity is an assumption about the *data*, not a property to defend). Sorting each bucket (`{0.05, 0.10}`, `{0.15}`, `{0.30}`, `{0.60}`, `{0.75}`, `{0.90, 0.95}`) and concatenating buckets `0` through `7` in order yields the fully sorted `0.05, 0.10, 0.15, 0.30, 0.60, 0.75, 0.90, 0.95`.

### Java implementation

```java
static double[] bucketSort(double[] a, int n) {
    List<Double>[] buckets = new List[n];
    for (int i = 0; i < n; i++) buckets[i] = new ArrayList<>();

    for (double x : a) {
        int index = (x == 1.0) ? n - 1 : (int) Math.floor(n * x);  // x == 1.0 is the one edge case: it
        buckets[index].add(x);                                     // would otherwise index past bucket n-1
    }

    for (List<Double> bucket : buckets) {
        Collections.sort(bucket);   // insertion sort in the classic presentation -- any comparison sort works
    }

    double[] result = new double[a.length];
    int k = 0;
    for (List<Double> bucket : buckets)
        for (double x : bucket)
            result[k++] = x;
    return result;
}
```

Rescaling arbitrary data `[a, b]` into `[0, 1)` first (and back afterward) makes the uniformity assumption usable even when the real data isn't already in `[0, 1)`:

```
y_i = (x_i - x_min) / (x_max - x_min)              # forward: [a, b] -> [0, 1)
x_i = x_min + (x_max - x_min) * y_i                # inverse: [0, 1) -> [a, b], after sorting
```

### Watch it happen: scattering the worked example into 8 buckets

```viz
type: formula
capacity = 8
slot = floor(number(item) * capacity)
---
0.75
0.1
0.3
0.95
0.05
0.6
0.9
0.15
```

This shows only the scatter-into-buckets step — the placement each key's index computes to, matching the hand-worked table above exactly (bucket 0 highlighted as holding two keys, bucket 7 likewise). It does **not** show the second pass, sorting each bucket's contents once they've landed — the engine's `formula` mode places tokens into slots but has no notion of a second, within-slot sorting operation, the same reason `simplex-tabular-method` and `linear-programming-formulation-and-duality` skip a viz block of their own for content this engine's modes don't model. Picture bucket 0 as `{0.10, 0.05}` momentarily out of order until its own tiny insertion-sort pass — not shown here — puts it right.

### Average-case analysis: why it comes out to O(n)

Let `X_i` be the number of keys that land in bucket `i`, and `Y_i` the number of comparisons needed to sort bucket `i`. Since any comparison sort costs no more than O(n²) in the worst case, `Y_i <= X_i²`, so `E[Y_i] <= E[X_i²]`. Writing `X_i` as a sum of indicator variables `X_ij` (1 if key `j` lands in bucket `i`, 0 otherwise) and expanding `E[X_i²] = E[(Σ_j X_ij)²]` splits into diagonal terms (`E[X_ij²] = P(X_ij = 1) = 1/n`, since `X_ij` is a 0/1 variable) and off-diagonal terms (`E[X_ij · X_ik] = E[X_ij]·E[X_ik] = 1/n²`, since distinct keys land in their buckets independently under uniformity). Summing both over `n` keys:

```
E[Y_i] <= Σ_j (1/n) + Σ_j Σ_{k≠j} (1/n²) = n·(1/n) + n(n-1)·(1/n²) = 1 + (n²-n)/n² = 2 - 1/n
```

That bounds the *expected* cost of sorting one bucket at just under 2 comparisons, regardless of `n`. Summed over all `n` buckets, the expected total cost is `E[Y] = n·(2 - 1/n) = 2n - 1` — linear in `n`. Adding the O(n) scatter pass and the O(n) concatenation pass, the overall expected running time is O(n).

### Worst case: what happens when the input isn't actually uniform

Every step of that analysis leans on independence and uniformity — `E[X_ij] = 1/n` only holds if a key is genuinely equally likely to land in any bucket. If the real input isn't uniform (or is adversarially chosen), all n keys can land in the *same* bucket, and every other bucket stays empty. In that case bucket sort degenerates to running a single comparison sort over all n elements: O(n²) if that per-bucket sort is insertion sort (the classic presentation's choice), or as low as O(n log n) if a comparison sort with a better worst case (mergesort, heapsort) is used per bucket instead — bucket sort's *worst* case is entirely inherited from whatever sort is chosen to clean up each bucket, since the scatter step itself is always O(n) regardless of how the keys happen to land.

## Trade-offs

- **The uniformity assumption is load-bearing, not a minor simplifying detail.** Unlike counting sort (which only needs a bounded integer range) or radix sort (which only needs fixed-width keys), bucket sort's O(n) *average* case depends on keys actually being spread roughly evenly across the interval. A skewed or adversarial input doesn't just slow bucket sort down gracefully — it can concentrate everything into one bucket, collapsing the entire benefit of having n buckets in the first place.
- **Worst-case complexity depends on the choice of per-bucket sort, not on bucket sort itself.** Because a degenerate input can put all n elements in one bucket, bucket sort's worst case is exactly its per-bucket sort's worst case: O(n²) with insertion sort, or O(n log n) with a sort that guarantees that bound in the worst case (at the cost of that sort's usually-higher constant factor on the small, expected-case buckets it's really handling).
- **Rescaling into `[0, 1)` and back is a real, usable escape hatch** — data that doesn't start out in `[0, 1)` can still use bucket sort, at the cost of one extra linear pass each direction, as long as the *rescaled* data is genuinely close to uniform. Rescaling a genuinely skewed distribution doesn't make it uniform; it only moves it into a different interval.
- **Space cost is O(n)** for the n buckets themselves, on top of whatever each per-bucket sort needs — unlike an in-place comparison sort, bucket sort always pays for that auxiliary bucket storage.
- **Stability follows directly from the per-bucket sort and the concatenation order** — since keys are scattered by value into non-overlapping bucket ranges and buckets are concatenated in increasing order, the overall sort is stable exactly when the per-bucket sort is (insertion sort, the classic choice, is stable).

## Documentation Links

- [Introduction to Algorithms, 4th Edition — Cormen, Leiserson, Rivest, Stein](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — Chapter 8 "Sorting in Linear Time", Section 8.4 "Bucket sort" — doc
- [Bucket sort — Wikipedia](https://en.wikipedia.org/wiki/Bucket_sort) — doc
