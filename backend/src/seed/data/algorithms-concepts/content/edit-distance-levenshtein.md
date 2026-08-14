---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Learn the standard dynamic-programming solution to **edit distance** (also called Levenshtein distance): the minimum number of single-character insertions, deletions, and substitutions needed to transform one string into another. This concept is a direct structural generalization of the sibling `longest-common-subsequence` (LCS) concept — same 2D-table shape, same bottom-up fill order, same "trace a path backward to reconstruct the actual answer, not just its length" technique — but with a different recurrence, because edit distance allows a third move (substitution) that LCS doesn't. Cormen, Leiserson, Rivest, and Stein (CLRS) pose edit distance as Problem 14-5, but their version is more elaborate than what's normally meant by the term: CLRS defines *six* operations (copy, replace, delete, insert, twiddle, kill), each with its own configurable cost, and leaves finding the minimum-cost transformation as an exercise for the reader. What this concept covers is the simpler, universally-used version — three operations (insert, delete, substitute), each costing 1 — the version that spell-checkers, `diff`, `git diff`, and virtually every algorithms course and interview mean when they say "edit distance."

## Use Cases

- Spell-checkers and autocorrect suggesting replacement words — the candidate words with the smallest edit distance to what you typed are the most likely corrections.
- Fuzzy string matching / "did you mean" search features, where an exact-match search returns nothing but a small-edit-distance match probably is what the user meant.
- Comparing DNA or protein sequences by *alignment* — inserting gaps into two sequences and scoring matches, mismatches, and gaps is a close relative of edit distance, and CLRS's own Problem 14-5 draws this connection directly.
- The underlying diff algorithm family used by version-control and text-comparison tools (`diff`, `git diff`) is closely related: both edit distance and line-level diffing solve "how few changes turn A into B," just at different granularities (characters vs. lines).

## Deep Dive

### The problem: transforming one string into another

Given two strings X and Y, the **edit distance** from X to Y is the minimum number of single-character operations needed to turn X into Y, where each operation is one of:

- **Insert** a character into X.
- **Delete** a character from X.
- **Substitute** one character of X for a different character.

Take the classic textbook pair:

```
X = "kitten"
Y = "sitting"
```

The well-known answer is 3 operations. Verifying it by hand: substitute `k` → `s` (`kitten` → `sitten`), substitute `e` → `i` (`sitten` → `sittin`), then insert `g` at the end (`sittin` → `sitting`). Three operations, and no sequence of fewer than three can work — `kitten` and `sitting` differ in length by 1 and share only 4 characters in matching positions once aligned, so at least 3 edits are unavoidable. The recurrence below derives this same answer mechanically, and later sub-topics trace the exact operation sequence back out of the filled table.

Brute-force search over all possible operation sequences is exponential — exactly the same obstacle LCS's brute force ran into by enumerating every subsequence — which is what makes a 2D dynamic-programming table worth building.

### The recurrence: extending LCS's table with a third option

Define `D(i, j)` as the edit distance between the first `i` characters of X and the first `j` characters of Y — the same style of definition the LCS concept used for `c[i][j]`, just naming the quantity distance instead of length. The base cases handle one string being empty:

- `D(i, 0) = i` — transforming the first `i` characters of X into the empty string takes exactly `i` deletions.
- `D(0, j) = j` — transforming the empty string into the first `j` characters of Y takes exactly `j` insertions.

For the general case, compare the last characters `X[i]` and `Y[j]`:

- **They match** (`X[i] == Y[j]`) — no operation is needed on this pair; the distance is whatever it already was for the two shorter prefixes: `D(i, j) = D(i-1, j-1)`.
- **They differ** — some operation has to reconcile them, and there are exactly three candidates, each costing 1 plus the best sub-solution: delete `X[i]` (`D(i-1, j)`), insert `Y[j]` (`D(i, j-1)`), or substitute `X[i]` for `Y[j]` (`D(i-1, j-1)`). Take the cheapest: `D(i, j) = 1 + min(D(i-1, j), D(i, j-1), D(i-1, j-1))`.

This is the LCS recurrence's shape with one extra predecessor cell. LCS's mismatch case only ever *extends* an existing common subsequence or *skips* a character from one side — two predecessor cells, `c[i-1][j]` and `c[i][j-1]`. Edit distance's mismatch case also allows *substituting*, reaching the diagonal predecessor `D(i-1, j-1)` directly instead of only through a match — three predecessor cells instead of two. That's the entire structural difference between the two problems: same table, same fill order, one additional arrow into each cell.

```java
int[][] buildEditDistanceTable(String x, String y) {
    int m = x.length(), n = y.length();
    int[][] d = new int[m + 1][n + 1];

    for (int i = 0; i <= m; i++) d[i][0] = i; // delete all i characters of x
    for (int j = 0; j <= n; j++) d[0][j] = j; // insert all j characters of y

    for (int i = 1; i <= m; i++) {
        for (int j = 1; j <= n; j++) {
            if (x.charAt(i - 1) == y.charAt(j - 1)) {
                d[i][j] = d[i - 1][j - 1];
            } else {
                d[i][j] = 1 + Math.min(d[i - 1][j - 1],
                              Math.min(d[i - 1][j], d[i][j - 1]));
            }
        }
    }
    return d; // d[m][n] is the edit distance
}
```

Each cell still depends only on the cell above, the cell to the left, and the cell diagonally above-left, so row-major fill order (top row first, left to right within each row) works exactly as it did for LCS.

### The filled table and backtracking to the actual edit sequence

Filling `D` for `X = "kitten"` (rows) against `Y = "sitting"` (columns):

| D[i][j] | ""  | s   | i   | t   | t   | i   | n   | g   |
|---------|-----|-----|-----|-----|-----|-----|-----|-----|
| **""**  | 0   | 1   | 2   | 3   | 4   | 5   | 6   | 7   |
| **k**   | 1   | 1   | 2   | 3   | 4   | 5   | 6   | 7   |
| **i**   | 2   | 2   | 1   | 2   | 3   | 4   | 5   | 6   |
| **t**   | 3   | 3   | 2   | 1   | 2   | 3   | 4   | 5   |
| **t**   | 4   | 4   | 3   | 2   | 1   | 2   | 3   | 4   |
| **e**   | 5   | 5   | 4   | 3   | 2   | 2   | 3   | 4   |
| **n**   | 6   | 6   | 5   | 4   | 3   | 3   | 2   | 3   |

`D[6][7] = 3` in the bottom-right corner: the edit distance is 3, matching the hand count from the first sub-topic. Recovering the actual operations means tracing a path backward from `D[6][7]` to `D[0][0]`, at each cell asking which case of the recurrence produced its value:

- If `X[i] == Y[j]`, this position needed no operation — move diagonally to `D[i-1][j-1]` with no operation recorded.
- Otherwise, check which predecessor the current value came from: diagonal (`D[i-1][j-1]`) means substitute, up (`D[i-1][j]`) means delete `X[i]`, left (`D[i][j-1]`) means insert `Y[j]`. Move to whichever predecessor equals `D[i][j] - 1`.

Walking it through: start at `D[6][7]=3` (`X[6]='n'`, `Y[7]='g'`) — mismatch; predecessors are `D[5][7]=4` (up), `D[6][6]=2` (left), `D[5][6]=3` (diagonal); the left cell is the one that's `3-1=2`, so **insert 'g'**, move left to `D[6][6]`. There, `X[6]='n'`, `Y[6]='n'` match — no operation, move diagonally to `D[5][5]=2`. There, `X[5]='e'`, `Y[5]='i'` mismatch; predecessors `D[4][5]=2` (up), `D[5][4]=2` (left), `D[4][4]=1` (diagonal); the diagonal cell is `2-1=1`, so **substitute e → i**, move diagonally to `D[4][4]=1`. There, `X[4]='t'`, `Y[4]='t'` match — move diagonally to `D[3][3]=1`. There, `X[3]='t'`, `Y[3]='t'` match — move diagonally to `D[2][2]=1`. There, `X[2]='i'`, `Y[2]='i'` match — move diagonally to `D[1][1]=1`. There, `X[1]='k'`, `Y[1]='s'` mismatch; predecessors `D[0][1]=1` (up), `D[1][0]=1` (left), `D[0][0]=0` (diagonal); the diagonal cell is `1-1=0`, so **substitute k → s**, move diagonally to `D[0][0]=0`, the base case — stop.

Reading the recorded operations in forward order (reverse of the backward trace): substitute `k`→`s`, match `i`, match `t`, match `t`, substitute `e`→`i`, match `n`, insert `g` — exactly the 3-operation sequence hand-verified earlier, now derived mechanically from the table instead of asserted.

```java
List<String> reconstructOperations(String x, String y, int[][] d) {
    Deque<String> ops = new ArrayDeque<>();
    int i = x.length(), j = y.length();

    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && x.charAt(i - 1) == y.charAt(j - 1)) {
            ops.addFirst("match " + x.charAt(i - 1));
            i--; j--;
        } else if (i > 0 && j > 0 && d[i][j] == d[i - 1][j - 1] + 1) {
            ops.addFirst("substitute " + x.charAt(i - 1) + " -> " + y.charAt(j - 1));
            i--; j--;
        } else if (i > 0 && d[i][j] == d[i - 1][j] + 1) {
            ops.addFirst("delete " + x.charAt(i - 1));
            i--;
        } else {
            ops.addFirst("insert " + y.charAt(j - 1));
            j--;
        }
    }
    return new ArrayList<>(ops); // ["substitute k -> s", "match i", "match t", "match t", "substitute e -> i", "match n", "insert g"]
}
```

### Running time and the sequence-alignment connection

The table has `(m + 1) * (n + 1)` cells, and each cell does O(1) work — one character comparison and a min of at most three already-known values — so filling the table costs O(mn), same as LCS. Backtracking afterward decrements at least one index per step, so that pass is O(m + n). Total: O(mn) time and space.

CLRS's own text frames edit distance as a generalization of DNA-sequence alignment: given two sequences, insert gaps into each so they end up the same length, then score each position (a bonus for matching characters, a penalty for mismatches, a larger penalty for a gap), and sum the scores across the alignment. Finding the best-scoring alignment is solved with the same style of 2D table as edit distance, just with a scoring function instead of a unit cost per operation — a direct real-world use of this table-filling technique beyond text editing. On the text-editing side, this is the algorithm underneath practical tools: spell-checkers ranking correction candidates by edit distance, and `diff`-style tools that, at the character or line level, are computing (or approximating) exactly this minimum-operation-count problem.

## Trade-offs

- **O(mn) time and space vs. exponential brute force** — same trade as LCS: the full `D` table costs Θ(mn) memory, substantial for very long strings, but it turns an exponential search over operation sequences into a polynomial one.
- **Full table vs. length-only space savings** — if only the distance *value* is needed, not the operation sequence, the table collapses to two rows, dropping space to O(min(m, n)); reconstructing the actual operations, like reconstructing LCS's actual subsequence, needs the full table (or a Hirschberg-style divide-and-conquer approach to keep the space down).
- **Unit-cost Levenshtein vs. weighted edit distance** — this concept assumes every insert, delete, and substitute costs exactly 1, matching the standard definition; some applications (e.g., OCR error correction, bioinformatics) weight operations differently, which only changes the "+1" terms in the recurrence to operation-specific costs, not the table's shape.
- **Standard 3-operation version vs. CLRS's full 6-operation generalization** — CLRS's actual Problem 14-5 defines six operations (copy, replace, delete, insert, twiddle for transposing adjacent characters, and kill for truncating the rest of the source), each with its own configurable cost, and poses the minimum-cost transformation as an open exercise rather than a worked example. That fuller version is a real generalization worth knowing exists, but it's not what "edit distance" means in practice — the 3-operation Levenshtein form covered here is what spell-checkers, `diff`, and interview questions actually use.

## Documentation Links

- [Cormen, Leiserson, Rivest, Stein, "Introduction to Algorithms", 4th Edition (MIT Press, 2022)](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — Chapter 14 "Dynamic Programming", Problem 14-5 "Edit distance", pp. 409-411 — book
- [NIST Dictionary of Algorithms and Data Structures — Levenshtein distance](https://xlinux.nist.gov/dads/HTML/Levenshtein.html) — doc
