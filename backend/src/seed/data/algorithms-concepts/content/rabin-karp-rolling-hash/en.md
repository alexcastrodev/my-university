---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

The KMP concept built an automaton from the pattern; Boyer-Moore built a skip table from it. Rabin-Karp does neither — it's a "completely different approach... based on hashing" (Sedgewick & Wayne): compute a numeric fingerprint of the M-character pattern once, then slide an M-character window across the text, computing that same fingerprint for every window in O(1) per slide, and only fall back to an actual character comparison when two fingerprints match. The KMP concept already flagged Rabin-Karp as the trade-off aside worth its own depth; this concept delivers it — the rolling-hash arithmetic that makes the O(1) slide possible, the correctness subtlety a hash match alone can't resolve (a collision), and the multi-pattern search this technique enables that neither KMP nor Boyer-Moore does as naturally.

## Use Cases

- **Plagiarism and duplicate-content detection.** Real systems (the MOSS-style tools this problem is famous for) hash overlapping windows of a document into a set of fingerprints, then check another document's window fingerprints against that set — turning "does any substring of document B match any substring of document A" into a batch of O(1) hash-set lookups instead of a per-document-pair search. This is Rabin-Karp's standout differentiator: KMP's automaton and Boyer-Moore's skip table are both built for *one* pattern against *one* text.
- **Multi-signature scanning.** Searching a text for any one of a large set of known patterns at once (malware signatures, banned-phrase lists) generalizes cleanly under Rabin-Karp — hash every pattern into a set once, then slide a single rolling hash across the text doing one O(1) set lookup per position — where running KMP or Boyer-Moore once per pattern costs a multiple of the text length per pattern.
- **Content-addressed deduplication.** Tools that detect duplicate or shifted blocks of data (rsync-style delta transfer, storage dedup) rely on the same rolling-hash trick to fingerprint every possible window of a byte stream cheaply, without ever paying the cost of hashing each window from scratch.

## Deep Dive

### Hash-then-verify: fingerprints, and why a hash match isn't proof of a match

A string of length M is just an M-digit base-R number (R = the alphabet size — 256 for extended ASCII). The pattern's fingerprint is that number reduced modulo a large prime Q: `patHash = value(pat) mod Q`. Searching means computing the same reduction for every M-character window of the text and comparing it against `patHash`. Done naively — recompute a window's hash from all M of its characters every time the window slides — this costs O(M) per position, O(NM) total: no better than brute force, and Sedgewick & Wayne say exactly that ("a straightforward implementation based on this description would be much slower than a brute-force search"). The payoff only shows up once the hash for the *next* window can be derived from the *current* one in O(1) — the rolling hash, covered next.

Before that, though, a correctness subtlety has to be nailed down: two different windows can hash to the same value. `ts ≡ p (mod Q)` does **not** imply `ts = p` — it only rules out a mismatch (Cormen et al.: "if `ts ≠ p (mod q)`, then you definitely know that `ts ≠ p`"). A hash match is a *candidate*, not a confirmed occurrence, until something resolves the possibility that it's a coincidence. CLRS's own Figure 32.4 makes this concrete with `Q = 13` (small on purpose, to make collisions likely enough to observe by hand). Text `2 3 5 9 0 2 3 1 4 1 5 2 6 7 3 9 9 2 1` (19 digits, 0-indexed), pattern `31415` (`M = 5`), whose value mod 13 is 7 (`31415 mod 13 = 7`, since `13 × 2416 = 31408`):

- **Shift s = 6**: `txt[6..10] = "31415"` — the literal pattern. Its value mod 13 is 7 — a hash match, and this time a real one.
- **Shift s = 12**: `txt[12..16] = "67399"`. `67399 mod 13 = 7` as well (`13 × 5184 = 67392`, remainder 7) — the *same* hash value, but `"67399" ≠ "31415"`. A spurious hit: the hash collided even though the substrings don't.

Two windows, same fingerprint, only one of them a real occurrence — this is exactly why Rabin-Karp's design has to decide, up front, what to do when the hash matches: verify with an actual character comparison, or trust the hash and accept some chance of being wrong. That decision is the Las Vegas/Monte Carlo split covered in the third sub-topic below.

### The rolling hash: deriving the next window's hash from the current one in O(1)

Treat the M characters of a window starting at text position `i` as digits of a base-R number, most significant digit first, and reduce mod Q:

```
hash(i) = (a[i]·R^(M-1) + a[i+1]·R^(M-2) + ... + a[i+M-1]·R^0) mod Q
```

Sliding the window one position right drops `a[i]` (the old leading digit), shifts every remaining digit up one place (multiply by R), and brings in `a[i+M]` (the new trailing digit):

```
newHash = ((hash - a[i]·R^(M-1)) · R + a[i+M]) mod Q
```

`R^(M-1) mod Q` — the weight of the digit about to leave — is the same constant on every slide, so it's computed exactly once, before the scan starts, and reused: Sedgewick & Wayne call it `RM`. That single precomputation is what turns each slide into a fixed number of arithmetic operations regardless of M — the whole reason this beats recomputing from scratch.

```java
public class RabinKarp {
    private final String pat;
    private final long patHash;   // pattern's fingerprint
    private final int M;          // pattern length
    private final long Q;         // a large prime modulus
    private final int R = 256;    // alphabet size
    private final long RM;        // R^(M-1) % Q, precomputed once

    public RabinKarp(String pat) {
        this.pat = pat;
        this.M = pat.length();
        this.Q = longRandomPrime(); // a large, well-chosen prime
        long rm = 1;
        for (int i = 1; i <= M - 1; i++)
            rm = (R * rm) % Q;      // RM = R^(M-1) % Q
        this.RM = rm;
        this.patHash = hash(pat, M);
    }

    private long hash(String key, int m) { // Horner's rule, mod Q throughout
        long h = 0;
        for (int j = 0; j < m; j++)
            h = (R * h + key.charAt(j)) % Q;
        return h;
    }

    public int search(String txt) {
        int N = txt.length();
        long txtHash = hash(txt, M);
        if (patHash == txtHash) return 0;
        for (int i = M; i < N; i++) {
            // remove leading digit, shift, add trailing digit — O(1) per slide
            txtHash = (txtHash + Q - RM * txt.charAt(i - M) % Q) % Q;
            txtHash = (txtHash * R + txt.charAt(i)) % Q;
            if (patHash == txtHash && check(txt, i - M + 1))
                return i - M + 1;
        }
        return N; // not found
    }

    private boolean check(String txt, int offset) { // Las Vegas verification — see below
        return txt.regionMatches(offset, pat, 0, M);
    }
}
```

(`+ Q` before the subtraction keeps the intermediate value non-negative so `%` behaves as expected — Java's `%` can return a negative result for a negative left operand.)

A hand-verified worked example, reusing Sedgewick & Wayne's own numbers: pattern `"26535"` (`M = 5`), text `"3141592653589793"`, `R = 10`, `Q = 997`. `RM = 10^4 mod 997 = 30`. `patHash = 26535 mod 997 = 613`. The first window's hash, `31415 mod 997`, is 508 — no match, so slide:

| window | leaving digit | update | new hash |
|---|---|---|---|
| `31415` | — | `31415 mod 997` | **508** |
| `14159` | 3 | `(508 − 3·30)·10 + 9 = 4189`, `mod 997` | **201** |
| `41592` | 1 | `(201 − 1·30)·10 + 2 = 1712`, `mod 997` | **715** |
| `15926` | 4 | `(715 − 4·30)·10 + 6 = 5956`, `mod 997` | **971** |
| `59265` | 1 | `(971 − 1·30)·10 + 5 = 9415`, `mod 997` | **442** |
| `92653` | 5 | `(442 − 5·30)·10 + 3 = 2923`, `mod 997` | **929** |
| `26535` | 9 | `(929 − 9·30)·10 + 5 = 6595`, `mod 997` | **613** ← match |

Six non-matches, each computed from the last in a fixed handful of arithmetic operations, then a hash match on the seventh window that's also a genuine substring match (`"26535"` is literally the pattern) — `search()` returns `i = 6`.

The moves engine's `type: moves` mode was worth a genuine attempt here before falling back to the table above. Its `mark` command highlights exactly one array slot per step — no swap, no multi-slot range — so the closest honest fit is marking the *rightmost* index of each window as it slides, one slot per step, matching how the sibling KMP and Boyer-Moore concepts use a single-row text array:

```viz
type: moves
mark 4 | Window0 = txt[0..4] = "31415". hash = 31415 mod 997 = 508. Pattern hash ("26535") = 613 — no match, slide right.
mark 5 | Window1 = txt[1..5] = "14159". Rolling update: (508 − 3·30)·10 + 9 mod 997 = 201 — still no match. (Leaving digit 3, weight RM = 30.)
mark 6 | Window2 = txt[2..6] = "41592". (201 − 1·30)·10 + 2 mod 997 = 715 — no match.
mark 7 | Window3 = txt[3..7] = "15926". (715 − 4·30)·10 + 6 mod 997 = 971 — no match.
mark 8 | Window4 = txt[4..8] = "59265". (971 − 1·30)·10 + 5 mod 997 = 442 — no match.
mark 9 | Window5 = txt[5..9] = "92653". (442 − 5·30)·10 + 3 mod 997 = 929 — no match.
mark 10 | Window6 = txt[6..10] = "26535". (929 − 9·30)·10 + 5 mod 997 = 613 — hash match, and the substring really is "26535": search() returns i = 6.
---
3
1
4
1
5
9
2
6
5
3
5
8
9
7
9
3
```

Where this genuinely falls short of the sibling traces: KMP and Boyer-Moore's marked positions *are* the mechanic — a character comparison happening at a specific array index. Rabin-Karp's mechanic is the hash number itself, which isn't a position in any array and so can never appear in the row the engine renders — only in the caption text. The engine also has no way to highlight all five characters of a window at once (only ever one slot per `mark`), so the single trailing-index mark stands in for "the window currently under test" rather than showing it. A printed step-by-step trace — the table above — states the actual state (the window, its hash, the pattern's hash, match or not) directly, which is why it's the primary presentation here and the `viz` block is a secondary, honestly-caveated illustration rather than the main one.

### Las Vegas vs. Monte Carlo: what happens when the hash matches

Once a hash match is found, there are exactly two disciplined choices, and Rabin & Karp's own framing (via Sedgewick & Wayne) names them precisely:

- **Monte Carlo**: trust the hash match as a real match, with no character-by-character verification at all. This gives an unconditional O(N + M) running time — every slide is O(1), and there's no verification step to ever slow it down — at the cost of a small, nonzero probability of reporting a false positive (a hash collision mistaken for a match). Sedgewick & Wayne: "an early and famous example of a Monte Carlo algorithm that has a guaranteed completion time but fails to output a correct answer with a small probability."
- **Las Vegas**: verify every hash match with an actual comparison of the M characters before reporting it (the `check()` call in the code above). This guarantees correctness unconditionally, at the cost of degrading toward brute force's O(NM) in the pathological case where many spurious hits occur and each has to be individually ruled out by an O(M) comparison.

Sedgewick & Wayne's Property P states the pairing exactly: "The Monte Carlo version of Rabin-Karp substring search is linear-time and extremely likely to be correct, and the Las Vegas version of Rabin-Karp substring search is correct and extremely likely to be linear-time." Neither version gets both guarantees unconditionally — one or the other has to be given up.

What makes this a safe trade in practice is the modulus Q. Reducing values modulo Q behaves, for well-chosen Q, like a random mapping from the alphabet into `{0, ..., Q-1}` — Cormen et al.'s heuristic analysis puts the expected number of spurious hits at `O(n/q)`. Sedgewick & Wayne go further and just pick Q enormous — "a long value greater than 10^20" — since Rabin-Karp never actually builds a hash table of size Q (there's only ever one key, the pattern, being checked against), so there's no cost to choosing Q far larger than any real table could afford. Rabin and Karp showed the collision probability for a well-chosen Q is about `1/Q`; at `Q > 10^20` that's a probability low enough that Sedgewick & Wayne note you can square it again (run the algorithm twice) to push the failure probability under 10^-40 if that's still not reassuring enough. In practice this makes Monte Carlo's small risk close to theoretical rather than operational — but Las Vegas remains the only version with an actual correctness guarantee, and costs only the (extremely rare, with a good large Q) verification step to get it.

### The multi-pattern differentiator, and expected running time

Both preprocessing and matching are cheap: computing the pattern's hash and `RM` is Θ(M) (Horner's rule touches each pattern character once), and Cormen et al. give Θ(n − m + 1) for the matching phase's hash computations. The catch — the reason this is stated as *expected* rather than worst-case, unlike KMP's unconditional Proposition N — is verification cost. If the expected number of *valid* matches is O(1) and Q is chosen larger than the pattern length, Cormen et al.'s bound is `O(n) + O(m·(v + n/q))`, which collapses to O(N + M) exactly when spurious hits stay rare, i.e., almost always, for a large Q. Sedgewick & Wayne's own cost-summary table puts both Rabin-Karp versions at "7N" typical operations against brute force's 1.1N or Boyer-Moore's N/M — the per-step cost here isn't a single character compare but "several arithmetic operations" (a multiply, an add, a remainder), so the constant factor is real even though the asymptotic class is the best of the four algorithms covered across this trio of concepts.

The running-time story, though, isn't the reason to reach for Rabin-Karp over KMP or Boyer-Moore — both of those already deliver linear or sublinear time for a single pattern with a tighter worst-case guarantee. The reason is that Rabin-Karp is the only one of the three whose core mechanic *generalizes* to many patterns at once almost for free. Hashing is symmetric: nothing about "compute a fingerprint, look it up" cares whether the lookup target is one stored value or a set of thousands. Hash every pattern in a candidate set into a `HashSet<Long>` once; then slide a single rolling hash across the text, and each window costs one O(1) hash update plus one O(1) average-case set lookup, regardless of how many patterns are being searched for simultaneously. This is genuinely how plagiarism detectors and duplicate-content systems work in practice — hashing overlapping windows of a document into a fingerprint set, then checking another document's windows against it — and neither KMP's per-pattern automaton nor Boyer-Moore's per-pattern skip table extends to "many patterns, one pass over the text" this cleanly; each would need to be rebuilt and rerun once per pattern.

## Trade-offs

- **Constant extra space — the best of the three algorithms on this axis.** Rabin-Karp needs O(1) space beyond the input (just the running hash and a few precomputed constants), against KMP's O(MR) DFA table or Boyer-Moore's O(R) skip table. It's also the cheapest to preprocess in the sense that there's no table to build at all — just one Θ(M) hash computation.
- **A real constant-factor cost per step.** Each slide is a multiply, a subtract, an add, and two modulus operations — Sedgewick & Wayne's own comparison table rates this at ~7N typical operations against brute force's ~1.1N or Boyer-Moore's ~N/M. Rabin-Karp wins asymptotically and on generality, not on raw constant-factor speed for a single ordinary pattern.
- **Monte Carlo keeps the streaming property Las Vegas gives up.** Sedgewick & Wayne's cost table records this precisely: the Monte Carlo version needs no backup in the text — it never re-reads a character once consumed, the same streaming-friendly property that makes KMP attractive for unbuffered input — while the Las Vegas version's verification step re-reads the M characters of the window to confirm a hash match, which does require backup. Guaranteed correctness and single-pass streaming are, in this algorithm, in tension with each other.
- **The multi-pattern case is the genuine reason to reach for this over the sibling concepts**, not single-pattern speed — see the Deep Dive's last sub-topic. For one pattern against one in-memory text, Boyer-Moore's sublinear typical-case skips or KMP's unconditional linear guarantee are usually the better-motivated choice.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4th Edition (Addison-Wesley, 2011) — Section 5.3 "Substring Search", Rabin-Karp fingerprint search, pp. 774-779 — book
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4th Edition (MIT Press, 2022) — Section 32.2 "The Rabin-Karp Algorithm", pp. 962-966 — book
- [Princeton Algorithms, 4th Ed. — Substring Search (companion site)](https://algs4.cs.princeton.edu/53substring/) — doc
- [HashSet — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/HashSet.html) — doc
