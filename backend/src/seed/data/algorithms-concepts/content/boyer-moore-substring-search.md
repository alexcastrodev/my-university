---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Pick up where the Knuth-Morris-Pratt concept left off: it scans the pattern left to right and guarantees O(N+M), but briefly flagged Boyer-Moore as the "scans right-to-left, can skip multiple positions, faster in practice" alternative without going further. This concept delivers that depth — the mismatched-character heuristic that lets Boyer-Moore slide the pattern past several text characters on a single mismatch, why that makes it *sublinear* on typical text (it can examine fewer than N characters total, something brute force and KMP can never do), and the honest cost: the simplified version covered here gives that speed up in exchange for losing KMP's worst-case guarantee.

## Use Cases

- `grep`-style command-line search and the "find in file" feature of text editors, where Boyer-Moore's large practical skips on ordinary English-like text make it the traditional engine of choice over brute force or KMP.
- Virus/malware signature scanning against large files or memory images, where a short fixed byte signature is searched for repeatedly and the sublinear typical-case behavior (examining only a fraction of the bytes) matters at scale.
- Any one-shot search over a text you already hold fully in memory (a loaded document, a buffer, a byte array) — Boyer-Moore's right-to-left scan needs to look ahead within the current alignment window, so it fits data you can index freely rather than a stream you can only read once.

## Deep Dive

### Right-to-left scanning and the mismatched-character heuristic

Brute force and KMP both scan the pattern left to right. Boyer-Moore's central idea is to scan it right to left instead: compare the pattern's *last* character against the text first, then work backward. Scanning this direction is what makes large skips possible — a mismatch on the very first (rightmost) compare tells you about a text character the pattern hasn't even confirmed matching anything yet, so there's no accumulated partial match to preserve. Where that mismatched text character sits relative to the pattern's own contents decides how far it's safe to slide.

To make that decision in constant time, Boyer-Moore precomputes a table `right[c]` — for every character `c` in the alphabet, the index of its rightmost occurrence in the pattern, or -1 if `c` never appears in the pattern at all. That -1 case is where the dramatic skips come from. Take pattern `"ABCD"` (M = 4, so `right['A']=0, right['B']=1, right['C']=2, right['D']=3`, everything else -1) aligned at text position i = 3 against a text that reads `...ZABYZW...` starting there:

```
text:      X  Y  Z  A  B  X  Y  Z  W  ...
index:     0  1  2  3  4  5  6  7  8
pattern (i=3):        A  B  C  D
j:                     0  1  2  3
```

The scan starts at the pattern's rightmost position, j = 3: `pat[3] = 'D'` against `txt[3+3] = txt[6] = 'Y'`. Mismatch. Since `'Y'` never occurs anywhere in `"ABCD"`, `right['Y'] = -1`, and sliding the pattern by anything less than its full length would still land some pattern character on top of this same `'Y'` — which can never match, because `'Y'` isn't in the pattern at all. So the whole pattern is safe to jump past it: `skip = j - right['Y'] = 3 - (-1) = 4`, landing the next attempt at i = 3 + 4 = 7. Four text characters (positions 3 through 6) were eliminated from consideration after examining only one of them — the kind of skip brute force and KMP structurally can never make, since both are committed to advancing the text pointer one position at a time.

### The skip table, the in-pattern case, and never skipping backward

Building `right[]` is a single left-to-right pass over the pattern: initialize every entry to -1, then for each pattern position `j` from 0 to M-1, record `right[pat.charAt(j)] = j`. Because later positions overwrite earlier ones, each character ends up mapped to its *rightmost* occurrence automatically. This costs O(M + R) time and O(R) space, where R is the alphabet size — cheaper to build than KMP's O(MR) DFA, and using only O(R) extra space instead of O(MR).

```java
public class BoyerMoore {
    private final int[] right;
    private final String pat;

    public BoyerMoore(String pat) {
        this.pat = pat;
        int M = pat.length();
        int R = 256;
        right = new int[R];
        for (int c = 0; c < R; c++)
            right[c] = -1;                    // -1 for characters not in the pattern
        for (int j = 0; j < M; j++)
            right[pat.charAt(j)] = j;         // rightmost occurrence wins
    }

    public int search(String txt) {
        int N = txt.length();
        int M = pat.length();
        int skip;
        for (int i = 0; i <= N - M; i += skip) {
            skip = 0;
            for (int j = M - 1; j >= 0; j--) {
                if (pat.charAt(j) != txt.charAt(i + j)) {
                    skip = j - right[txt.charAt(i + j)];
                    if (skip < 1) skip = 1;   // guarantee forward progress
                    break;
                }
            }
            if (skip == 0) return i;          // full pattern matched
        }
        return N;                             // not found
    }
}
```

`right[]` also unifies the case where the mismatched character *does* appear in the pattern — the same formula, `skip = j - right[c]`, handles it. If the mismatched text character's rightmost pattern occurrence is to the left of the current comparison position `j`, the pattern slides forward to line that occurrence up with the mismatch point, just by a smaller amount than a full-length skip. Using pattern `"ABAB"` (`right['A'] = 2, right['B'] = 3`, built the same way — later `j` overwrites earlier), suppose a scan reaches `j = 1` (`pat[1] = 'B'`) and the text character there is `'A'`: `skip = j - right['A'] = 1 - 2 = -1`. Negative — the naive formula wants to slide the pattern *backward*, because `'A'`'s rightmost occurrence in the pattern (index 2) is to the right of where the mismatch happened (index 1); some of the pattern already scanned as a match would have to be un-matched. That's never allowed to happen: `search()` clamps `skip` to 1 whenever the computed value is less than 1, which guarantees the outer loop always makes forward progress regardless of how the mismatched character overlaps with the pattern.

### Worked trace: one dramatic skip, verified by hand

Search for pattern `"ABCD"` (M = 4) in text `"XYZABXYZWABCDXYZAB"` (N = 18). The real match sits at i = 9 (`text[9..12] = "ABCD"`); tracing the algorithm by hand confirms Boyer-Moore reaches it after only three failed alignments — including one 4-position jump, the maximum possible skip for this pattern:

- **i = 0**: `j=3`, `pat[3]='D'` vs `txt[3]='A'` — mismatch. `'A'` is in the pattern at index 0, so `skip = 3 - 0 = 3` → next attempt at i = 3.
- **i = 3**: `j=3`, `pat[3]='D'` vs `txt[6]='Y'` — mismatch. `'Y'` isn't in the pattern at all, so `skip = 3 - (-1) = 4` → next attempt at i = 7. This is the dramatic case: the full pattern length skipped in one step.
- **i = 7**: `j=3`, `pat[3]='D'` vs `txt[10]='B'` — mismatch. `'B'` is in the pattern at index 1, so `skip = 3 - 1 = 2` → next attempt at i = 9.
- **i = 9**: `j=3,2,1,0` all match (`txt[9..12] = "ABCD"`) → `search()` returns i = 9.

Total: 7 character compares (1 each for the 3 failed alignments, 4 for the successful one) to search 18 characters of text — brute force would need up to 4 compares at several of the 15 possible starting positions to rule each one out.

This is a fixed text scanned by a sliding pattern, not an in-place array transformation, so it doesn't map perfectly onto the moves engine's swap-based model the way an array sort does. But treating the text as the single row and using `mark` to highlight the text position being compared at each step reproduces the trace faithfully — the same approach the KMP concept's own viz block uses for its brute-force trace:

```viz
type: moves
mark 3 | Align i=0 (pattern "ABCD" under text[0..3]). Right-to-left scan: j=3, pat[3]='D' vs txt[3]='A' — mismatch on the very first compare.
mark 6 | 'A' occurs in the pattern at index 0, so skip = j - right['A'] = 3 - 0 = 3, sliding to i=3. New alignment: j=3, pat[3]='D' vs txt[6]='Y' — mismatch.
mark 10 | 'Y' never appears in "ABCD" at all (right['Y'] = -1), so skip = j - (-1) = 3 - (-1) = 4 — the whole pattern jumps past it, sliding to i=7. New alignment: j=3, pat[3]='D' vs txt[10]='B' — mismatch.
mark 12 | 'B' occurs in the pattern at index 1, so skip = j - right['B'] = 3 - 1 = 2, sliding to i=9. New alignment: j=3, pat[3]='D' vs txt[12]='D' — match, continue scanning right to left.
mark 11 | j=2: pat[2]='C' vs txt[11]='C' — match.
mark 10 | j=1: pat[1]='B' vs txt[10]='B' — match.
mark 9 | j=0: pat[0]='A' vs txt[9]='A' — match. All four positions verified: search() returns i=9, after 7 character compares total.
---
X
Y
Z
A
B
X
Y
Z
W
A
B
C
D
X
Y
Z
A
B
```

### Sublinear on typical text, but not worst-case safe

Sedgewick and Wayne's Property O states the payoff precisely: on typical inputs, Boyer-Moore's mismatched-character heuristic uses ~N/M character compares to search a text of length N for a pattern of length M — *sublinear*, because most alphabet characters simply don't appear in a short pattern at all, so nearly every mismatch triggers a full M-length skip the way the worked trace's dramatic jump did. That's a genuinely different class of guarantee than anything brute force or KMP can offer, since both of those are structurally committed to examining every text character at least once.

The honest cost of the *simplified* version covered here — the mismatched-character heuristic alone, without Sedgewick's additional "strong good suffix" rule — is that it has no linear worst-case guarantee. It can still degrade to O(NM) on adversarial or highly repetitive input. Concretely: pattern `"BAAAA"` (M = 5, so `right['A'] = 4`, `right['B'] = 0`) against a text of nothing but `'A'` characters (say 12 of them, no `'B'` anywhere — the pattern is never found). At every one of the ~8 possible alignments, the scan matches all four trailing `'A'`s (`j=4` down to `j=1`) before finally mismatching at `j=0` (`pat[0]='B'` vs `txt[i]='A'`) — a full M compares every single time. Worse, the skip computed there is `skip = 0 - right['A'] = 0 - 4 = -4`, clamped to 1: no meaningful skip at all. ~8 attempts × 5 compares ≈ 40 compares to search 12 characters — proportional to NM, no better than brute force's own worst case.

This is exactly the trade-off the sibling KMP concept's DFA is built to avoid: KMP's Proposition N guarantees no more than M + N character accesses *regardless of input*, by construction, because its automaton has already absorbed every possible self-overlap of the pattern ahead of time. Boyer-Moore's mismatched-character-only heuristic makes no such promise — it wins big on typical, low-self-overlap text (English prose, source code, most real-world search targets) and loses badly on self-repetitive input. Sedgewick and Wayne note that the *full* Boyer-Moore algorithm adds a second, KMP-like table capturing the pattern's self-overlaps (the "strong good suffix" rule) and does restore a linear-time worst-case guarantee — but that construction is only mentioned in passing in the source text, not implemented, because the mismatched-character heuristic alone is what controls performance in typical practical applications.

## Trade-offs

- **Large practical skips, no worst-case guarantee (this version).** The mismatched-character heuristic alone gives ~N/M compares on typical text but can degrade to O(NM) on adversarial or self-repetitive input, as shown above — unlike KMP's unconditional O(N+M). The full algorithm (adding the strong-good-suffix table) fixes this, at the cost of more preprocessing and more memory than either version needs today.
- **Cheap preprocessing, small table.** `right[]` costs O(M + R) time and O(R) space to build — less setup and less memory than KMP's O(MR) DFA, since it only ever records one rightmost index per alphabet character rather than a full per-state transition table.
- **Requires lookahead within the current window — no streaming guarantee.** Unlike KMP, which never moves its text pointer backward and can process a stream character by character, Boyer-Moore's right-to-left scan needs to read `txt.charAt(i+j)` for `j` up to M-1 before it can even begin, and a failed attempt re-reads characters within the new window. That's fine for text already held in memory, but it rules out the same single-pass, unbuffered stream processing that makes KMP attractive for network input or `stdin`.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4th Edition (Addison-Wesley, 2011) — Section 5.3 "Substring Search", Boyer-Moore (mismatched-character heuristic), pp. 769-774 — book
- [Princeton Algorithms, 4th Ed. — Substring Search (companion site)](https://algs4.cs.princeton.edu/53substring/) — doc
- [String — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/String.html) — doc
