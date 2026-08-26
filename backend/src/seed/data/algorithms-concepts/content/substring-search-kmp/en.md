---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand substring search: finding a pattern of length M inside a text of length N. Start with the obvious brute-force approach and its O(NM) worst case, then see the insight — a mismatch already tells you something about the text you just scanned — that Knuth-Morris-Pratt (KMP) turns into a small automaton built once from the pattern, letting it scan the text exactly once, left to right, with no backup, in O(N) after preprocessing.

## Use Cases

- The "find" feature in a text editor or browser, or a `grep`-style search for a fixed string inside a large log or document.
- Scanning an input stream you can't rewind — network traffic, `stdin`, an intercepted message — where an algorithm that never backs up the text pointer avoids buffering characters you've already consumed.
- Signature/pattern detection against a long, fixed body of text (an important phrase in an intercepted communication, a known marker string in a large binary blob) where the same short pattern gets searched for repeatedly.

## Deep Dive

### Brute-force substring search and its worst case

The obvious algorithm: for every possible starting position `i` in the text, check whether the pattern matches character by character, stopping at the first mismatch.

```java
public static int search(String pat, String txt) {
    int M = pat.length();
    int N = txt.length();
    for (int i = 0; i <= N - M; i++) {
        int j;
        for (j = 0; j < M; j++)
            if (txt.charAt(i + j) != pat.charAt(j)) break;
        if (j == M) return i; // found
    }
    return N; // not found
}
```

Sedgewick and Wayne also give an "explicit backup" version that keeps a single index `i` into the text (tracking `i + j` from the version above) and a second index `j` into the pattern, incrementing both together on a match and resetting on a mismatch. Naming the reset explicitly is what matters here — it's exactly the operation KMP is designed to avoid:

```java
public static int search(String pat, String txt) {
    int M = pat.length(), N = txt.length();
    int i, j;
    for (i = 0, j = 0; i < N && j < M; i++) {
        if (txt.charAt(i) == pat.charAt(j)) j++;
        else { i -= j; j = 0; } // back up: retry starting one position later
    }
    if (j == M) return i - M; // found
    else return N;            // not found
}
```

On typical text this is fast — nearly every mismatch happens on the pattern's very first character, so the running time is close to N. But the worst case is genuinely O(NM): make both pattern and text runs of the same repeated character followed by a different one. Take pattern `"AAAB"` (M = 4) against text `"AAAAAAAAAAAAAAAB"` (fifteen `A`s then a `B`, N = 16). At every starting position `i` from 0 to 11, the first three characters match (`"AAA"` against `"AAA"`), and only the fourth comparison — pattern's `'B'` against the text's `'A'` — fails. Nearly the entire pattern gets re-compared at every one of the twelve failing starting positions before the match is finally found at `i = 12`. Sedgewick and Wayne's Proposition M states the general result: brute-force search requires ~NM character compares in the worst case.

```viz
type: moves
mark 3 | pat = "AAAB". Attempt i=0: text[0..2] = "AAA" matches pat[0..2], but text[3] = 'A' vs pat[3] = 'B' mismatches on the 4th compare.
mark 4 | Attempt i=1: brute force resets j to 0 and slides the window by exactly one position. Same story — text[1..3] = "AAA" matches, then text[4] = 'A' vs pat[3] = 'B' mismatches again.
mark 5 | Attempt i=2: identical shape, mismatch one position later. This repeats for every starting position up to i=11 — nearly the whole pattern re-compared each time.
mark 14 | Attempt i=11, the last failing start: text[11..13] = "AAA" matches, text[14] = 'A' vs pat[3] = 'B' mismatches one final time.
mark 12 | Attempt i=12: text[12] = 'A' matches pat[0] = 'A'.
mark 13 | text[13] = 'A' matches pat[1] = 'A'.
mark 14 | text[14] = 'A' matches pat[2] = 'A'.
mark 15 | text[15] = 'B' matches pat[3] = 'B' — full match. search() returns i = 12, after roughly M(N-M-1) ≈ 4×11 character compares: the O(NM) worst case in action.
---
A
A
A
A
A
A
A
A
A
A
A
A
A
A
A
B
```

### The core KMP insight: a mismatch already tells you something

Brute force's `i -= j; j = 0;` throws away information for free: at the moment of a mismatch, the previous `j` characters of the text are known — they're exactly the first `j` characters of the pattern, because that's what just matched. KMP's founding idea is that this known text can rule out some of the next starting positions before even looking at them, so the text pointer never needs to move backward.

Sedgewick and Wayne's own illustration: search for pattern `"BAAAAAAAAA"` (a `B` followed by nine `A`s) over a two-character alphabet, and suppose five characters match before a mismatch on the sixth. At that point the text is known to read `"BAAAAB"` at the point of mismatch (five `A`s matched, then a `B` where the pattern expected an `A`). Brute force would back up the text pointer four times, retrying starting positions that only contain more of those known `A`s — none of which can possibly match the pattern's leading `B`. The character actually sitting at the mismatch position, though, *is* a `B` — exactly the pattern's first character. So instead of backing up the text pointer at all, the fix is simply to reset `j` to 1 (not 0) and keep `i` moving forward. No backup, and the search still finishes correctly.

That particular shortcut — jump straight to matching the pattern's first character — doesn't generalize to every pattern, because a pattern can overlap with itself. Searching for `"AABAAA"` in `"AABAABAAAA"` hits a mismatch at position 5, but the correct restart point is position 3, not further ahead: skipping past position 3 would miss a real match. The generalization KMP makes is that exactly how far it's safe to jump — and to what pattern position to resume at — depends only on the pattern itself, and so it can be worked out once, ahead of time, before the text is ever scanned.

### Building the DFA: precompute once, scan the text once with no backup

KMP turns the pattern into a small deterministic finite automaton (DFA): one state per character of the pattern (plus a final "found" state M), where the state number is the pattern index `j` currently being matched. Reading a text character while in state `j` looks up a transition table `dfa[c][j]` — the state to move to next — and advances the text pointer by exactly one, every single time, whether that lookup was a match or a mismatch. `dfa[pat.charAt(j)][j]` is always `j + 1` (a match advances one state); every other character causes `dfa[c][j]` to point to some state ≤ j, precomputed to reflect exactly how much of the pattern's prefix the known text characters already satisfy.

```java
public class KMP {
    private final String pat;
    private final int[][] dfa;

    public KMP(String pat) {
        this.pat = pat;
        int M = pat.length();
        int R = 256;
        dfa = new int[R][M];
        dfa[pat.charAt(0)][0] = 1;
        for (int X = 0, j = 1; j < M; j++) {
            for (int c = 0; c < R; c++)
                dfa[c][j] = dfa[c][X];      // copy the mismatch cases from the restart state X
            dfa[pat.charAt(j)][j] = j + 1;  // set the match case
            X = dfa[pat.charAt(j)][X];      // update the restart state
        }
    }

    public int search(String txt) {
        int i, j, N = txt.length(), M = pat.length();
        for (i = 0, j = 0; i < N && j < M; i++)
            j = dfa[txt.charAt(i)][j];
        if (j == M) return i - M; // found
        else return N;            // not found
    }
}
```

The construction is the subtle part. Each state `X` tracked during the build is the state the DFA *would* land in if a mismatch happened right at column `j` and the search had to restart — the trick is that `X` only depends on the pattern positions before `j`, which are already built, so `dfa[c][j]` can just copy `dfa[c][X]` for every mismatching character `c`, then overwrite the one matching character with `j + 1`. For pattern `"ABABAC"`, this produces:

```
j:              0   1   2   3   4   5
pat.charAt(j):  A   B   A   B   A   C
dfa['A'][j]:    1   1   3   1   5   1
dfa['B'][j]:    0   2   0   4   0   4
dfa['C'][j]:    0   0   0   0   0   6
```

Once `dfa[][]` is built, `search()` never inspects `i - 1` again — it reads each text character exactly once and moves `j` around inside the table. Sedgewick and Wayne's Proposition N: KMP accesses no more than M + N characters total to search for a pattern of length M in a text of length N — O(M) to access each pattern character while building the DFA, and O(N) to scan the text once, an actual worst-case guarantee, not an average-case one. The cost of building the table itself is O(MR), where R is the alphabet size, since each of the M columns copies R entries.

## Trade-offs

- **Brute force is simple, cache-friendly, and typically ~1.1N compares — but O(NM) on adversarial or self-repetitive input** (long runs of a repeated character in both pattern and text, as shown above). It's not just a textbook toy: Sedgewick and Wayne note that Java's own `String.indexOf()` uses brute-force search, because the common case is fast enough that the extra bookkeeping KMP or Boyer-Moore need rarely pays for itself in general-purpose library code.
- **KMP trades preprocessing time and space for a worst-case guarantee.** The full DFA costs O(MR) time and space to build (an M-column, R-row table), which is real extra memory brute force never needs — and in practice the speedup over brute force rarely matters, because few real applications search for a highly self-repetitive pattern in highly self-repetitive text. What KMP guarantees unconditionally is that the text pointer never moves backward, which matters far more than the raw speedup whenever the input is a stream that can't be rewound.
- **Boyer-Moore scans the pattern right-to-left and is often faster in practice, but with a different worst case.** Its mismatched-character heuristic uses a `right[]` table — for each character, its rightmost position in the pattern — to sometimes skip several text positions at once on a single mismatch, rather than advancing by one. On typical English-like text this gives ~N/M character compares, sublinear in the pattern length, which is why many text editors use it. But the simple mismatched-character-heuristic version (unlike KMP) has no linear worst-case guarantee — Sedgewick and Wayne note it can still take time proportional to NM; only the full Boyer-Moore algorithm, which adds a KMP-like table for the pattern's self-overlaps, restores a linear-time guarantee.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4th Edition (Addison-Wesley, 2011) — Section 5.3 "Substring Search", pp. 758-786 — book
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4th Edition (MIT Press, 2022) — Chapter 32 "String Matching", pp. 957-1002 — book
- [Princeton Algorithms, 4th Ed. — Substring Search (companion site)](https://algs4.cs.princeton.edu/53substring/) — doc
- [String — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/String.html) — doc
