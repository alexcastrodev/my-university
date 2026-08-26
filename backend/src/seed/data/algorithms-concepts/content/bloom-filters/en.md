---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

Understand the Bloom filter: a probabilistic data structure that answers "could this key be in the set?" using nothing but a fixed-size bit array and a handful of independent hash functions — no keys are ever actually stored. That trade produces a structure with a small, precisely tunable false-positive rate, O(k) time for both insertion and membership tests (k = the number of hash functions, typically single digits), and O(m) space that depends only on how many bits you allocated, never on the size or type of the keys themselves. The point isn't to replace a real set — it's to sit in *front* of one (a hash table, a database index, a linked list, anything) and cheaply answer "definitely not here" often enough to skip the expensive real lookup.

## Use Cases

- A cache or storage engine's "definitely not on disk" check before an expensive seek or network round-trip — LSM-tree databases (Cassandra, LevelDB/RocksDB, Bigtable) put a Bloom filter in front of each on-disk segment specifically to skip segments that can't possibly contain the key being looked up.
- Lightweight ("SPV") blockchain clients testing whether a block might contain a transaction relevant to their addresses, without downloading and scanning the whole block.
- Spell-checkers and autocomplete testing whether a word might be in a large dictionary before doing an exact lookup.
- Any situation where the real underlying structure being membership-tested doesn't matter to the filter — a Bloom filter sits in front of a linked list exactly as well as a hash table or a tree, since it never stores or compares the real keys, only bit positions derived from them.

## Deep Dive

### Structure: one bit array, k hash functions, nothing else

A Bloom filter is an array of `m` bits, all initialized to `0`, plus `k` independent hash functions `h_1, ..., h_k`, each mapping an arbitrary key to a position in `{0, ..., m-1}`.

**Insertion** of a key `x`: compute `h_1(x), h_2(x), ..., h_k(x)` and set all `k` of those bit positions to `1`. No key is stored anywhere — only the fact that these `k` positions are now `1`.

**Membership test** for a key `x`: compute the same `k` positions and check whether *every one* of them is currently `1`. If even one of the `k` bits is `0`, `x` was **definitely never inserted** — that's a hard guarantee, not a probability. If all `k` bits are `1`, the filter reports `x` as (probably) present — but this can be a **false positive**: those bits could all have been set to `1` by *other* keys' hash collisions, without `x` ever having been inserted at all.

**Worked example** (mirroring a small hand-traced filter with `m = 15` bits and `k = 3` hash functions): insert key `x` with `h1(x)=2, h2(x)=5, h3(x)=11`, then key `y` with `h1(y)=4, h2(y)=8, h3(y)=11`:

```
slot:  0  1  2  3  4  5  6  7  8  9 10 11 12 13 14
bit:   0  0  1  0  1  1  0  0  1  0  0  1  0  0  0
                ^x       ^x          ^x&y   ^y (via slot 4, 8)
```

Both `x` and `y` happen to hash to slot `11` under their third hash function — a genuine **collision between two different keys' bit sets**. This is not an error or a bug to fix; it's the entire mechanism by which false positives happen. If a third key `z` (never inserted) happened to hash to exactly `{2, 8, 11}` — mixing bits that `x` and `y` between them already set — the filter would report `z` as present, incorrectly.

### Why false positives are possible but false negatives are impossible

This asymmetry is the Bloom filter's defining guarantee, and it follows directly from one fact: **a bit, once set to `1`, is never cleared** by a normal insertion. So if `x` really was inserted, all `k` of its bits were set to `1` at that moment and can only ever stay `1` afterward (more insertions can only set more bits, never unset any) — meaning a membership test on a truly-inserted key can never fail. It is exactly the *sharing* of bit positions across different keys' hash outputs — visible above at slot `11` — that opens the door to a false positive: a key can look present purely because *other* keys' insertions happened to set every bit it would have needed.

### The false-positive-rate derivation

Under the simplifying assumption of uniform, independent hashing, the probability that one particular bit is *not* set by one particular hash function is `1 - 1/m`. With `k` independent hash functions, the probability that a given bit is untouched by *all* `k` of them is `(1 - 1/m)^k`. Using the standard limit `e = lim_{n→∞} (1 + 1/n)^n`, for large `m` this approximates to `(1 - 1/m)^k ≈ e^{-k/m}`. After `n` keys have been inserted (each setting `k` bits), the probability a given bit is still `0` is `(1 - 1/m)^{kn} ≈ e^{-kn/m}`, so the probability it's `1` is `1 - e^{-kn/m}`.

A false positive on a key that was never inserted requires *all* `k` of its hash positions to happen to be `1` already — an event whose probability, treating the bits as independent (an approximation, since they aren't quite independent in practice, but a good one), is:

```
p(k, m, n) ≈ (1 - e^{-kn/m})^k
```

**Worked example**: `n = 1000` keys stored in `m = 10000` bits using `k = 10` hash functions gives `p ≈ (1 - e^{-1})^{10} ≈ 0.0102` — about a 1% false-positive rate.

**The optimal k.** Differentiating `p(k, m, n)` with respect to `k` and setting it to zero (the derivation substitutes `p = e^{-kn/m}` and reduces to solving `p = 1 - p`, i.e. `p = 1/2`) yields the number of hash functions that *minimizes* the false-positive rate for a fixed `m/n` ratio:

```
k_optimal = (m/n) · ln(2)
```

For `m = 15`, `n = 3`: `k = 5·ln(2) ≈ 3.465`, rounded to the nearest integer hash-function count, `k = 3` — matching the worked example's own choice above. Substituting `k_optimal` back into the false-positive formula and solving for the required bits-per-key ratio at a target false-positive rate `ε` gives:

```
m/n = -ln(ε) / (ln 2)^2         i.e.  m ≈ -n·ln(ε) / (ln 2)^2
```

Concretely: targeting `ε = 0.01` (1%) needs `m ≈ 9.585n` bits per key (for `n = 100` keys, `m ≈ 959` bits, about 1 KB); targeting `ε = 0.001` (0.1%) needs `m ≈ 14.377n` (for `n = 100`, `m ≈ 1438` bits, about 1.5 KB). Getting an order of magnitude better false-positive rate costs only a linear, not exponential, increase in bits per key — the whole reason a Bloom filter can be "apparently a lot of bits" and still have genuinely low space complexity: the array's size depends only on `n` and the target `ε`, never on how large or complex the actual keys are.

### No deletions — the same sharing that causes false positives forbids removal

Because bit positions are shared across different keys' hash outputs by design (exactly what made slot `11` collide between `x` and `y` above), a plain Bloom filter **cannot support deletion**. Clearing a bit to "remove" a key risks also erasing a bit some *other*, still-present key depends on — there is no way to tell, from the bit array alone, whether a `1` at some position is "owned" by only the key being removed or shared with others. The standard extension that adds deletion support, a **counting Bloom filter**, replaces each single bit with a small counter (incremented on insert, decremented on delete, membership test checks "counter > 0" instead of "bit == 1") — at the cost of `O(m · log(max count))` space instead of `O(m)` bits.

### Java implementation

A real implementation almost never computes `k` independent hash functions from scratch — the standard technique (Kirsch & Mitzenmacher) derives all `k` positions from just **two** underlying hash functions `h1`, `h2` via double hashing:

```java
public class BloomFilter {
    private final BitSet bits;
    private final int m;
    private final int k;

    public BloomFilter(int m, int k) {
        this.bits = new BitSet(m);
        this.m = m;
        this.k = k;
    }

    // Simulates k independent hash functions from just two real ones:
    // g_i(x) = h1(x) + i * h2(x), for i = 0..k-1 (Kirsch-Mitzenmacher technique).
    private int hashAt(Object key, int i) {
        int h1 = key.hashCode();
        int h2 = Integer.reverse(h1) | 1; // odd, decorrelated from h1
        int combined = h1 + i * h2;
        return Math.floorMod(combined, m);
    }

    public void add(Object key) {
        for (int i = 0; i < k; i++) {
            bits.set(hashAt(key, i));
        }
    }

    public boolean mightContain(Object key) {
        for (int i = 0; i < k; i++) {
            if (!bits.get(hashAt(key, i))) {
                return false; // definitely not present
            }
        }
        return true; // present, or a false positive
    }
}
```

Kirsch and Mitzenmacher proved this two-hash simulation produces asymptotically the same false-positive rate as `k` genuinely independent hash functions — so real implementations skip computing `k` separate hashes and just vary `i` over the same two.

### Watch it happen: inserting three keys, each hashing to 3 slots

Each key below is listed three times in a row — once per (simulated) hash function `h1/h2/h3` — because the engine's `place` step never removes a token from a slot it already occupies: placing the same token into a second and third slot makes it visually present in all three simultaneously, exactly matching "this key set 3 bits." Hand-computed from the same `hash()` (Java `String.hashCode()`) the sibling hash-table concept uses: `cat` sets bits `{0, 2, 11}`, `dog` sets bits `{4, 6, 15}`, `pig` sets bits `{4, 7, 10}`. Watch slot 4, where `dog`'s first hash and `pig`'s third hash land on the same bit — a real collision between two different keys' bit sets, precisely the mechanism that makes false positives possible.

```viz
type: formula
capacity = 20
slot = mod(hash(item) * (1 + mod(index, 3)) + mod(index, 3) * 7, capacity)
---
cat
cat
cat
dog
dog
dog
pig
pig
pig
```

## Trade-offs

- **False positives are possible; false negatives are impossible.** This asymmetry is the entire design — a Bloom filter can only ever be wrong in the "yes" direction, never the "no" direction, because bits are only ever set, never cleared.
- **Space is O(m), independent of key size or type** — a filter over million-character strings costs exactly as many bits as one over single integers. This is the structure's whole value proposition versus actually storing the keys.
- **No deletion**, unless you pay for a counting Bloom filter's extra per-slot counter space (`O(m · log(max count))` instead of `O(m)` bits) — a plain bit can't tell whether it's "owned" by one key or shared by several.
- **`m` and `k` must be chosen for an expected `n`, up front.** The false-positive-rate formula assumes a specific `n`; inserting far more keys than planned silently pushes the real false-positive rate above the design target, since the bit array itself never resizes.
- **The false-positive rate is tunable, cheaply** — going from a 1% to a 0.1% target false-positive rate costs roughly 1.5x more bits per key (9.585n → 14.377n), not an order of magnitude more; the size scales linearly in `-ln(ε)`, not in `1/ε`.

## Documentation Links

- [Burton H. Bloom, "Space/Time Trade-offs in Hash Coding with Allowable Errors," Communications of the ACM, Vol. 13, No. 7 (1970), pp. 422-426](https://dl.acm.org/doi/10.1145/362686.362692) — paper
- [Adam Kirsch, Michael Mitzenmacher, "Less Hashing, Same Performance: Building a Better Bloom Filter," ESA 2006](https://link.springer.com/chapter/10.1007/11841036_42) — paper
- [Bloom filter — Wikipedia](https://en.wikipedia.org/wiki/Bloom_filter) — doc
