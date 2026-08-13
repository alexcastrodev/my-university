---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Learn the specific 2D-table dynamic-programming technique for the longest-common-subsequence (LCS) problem: how to derive the table's recurrence by comparing the last characters of two sequences, how to fill the table bottom-up, and how to read the finished table to reconstruct the actual subsequence — not just its length. This assumes you already know what dynamic programming is in general (overlapping subproblems, memoization vs. tabulation); the focus here is this one classic 2D-table shape and how to trace a path back through it.

## Use Cases

- Diffing two files or two versions of a document — the "unchanged" lines a diff tool shows you are exactly an LCS of the two files' line sequences.
- Comparing two DNA or protein sequences to measure how similar two organisms are, by finding the longest sequence of bases that appears, in order, in both strands.
- Answering "what is the minimum edit distance / longest shared ordering between these two strings" style interview questions, where the 2D table is the expected solution shape.

## Deep Dive

### The problem: subsequence, not substring

A **subsequence** of a sequence is that sequence with zero or more elements deleted, without disturbing the relative order of what's left — the kept elements do not need to be contiguous. That's different from a **substring**, which must be a contiguous run. For example, `"ACE"` is a subsequence of `"ABCDE"` (delete B and D), but it is not a substring of it, because A, C, and E are not adjacent in the original.

Given two sequences X and Y, a **common subsequence** is a sequence that is a subsequence of both. The **longest common subsequence (LCS)** problem asks for the longest such sequence. Take a small concrete pair:

```
X = "ABCBDAB"
Y = "BDCABA"
```

`"BCBA"` is a subsequence of both (drop A, D from X; drop D, C from Y — check the order lines up), and it turns out to be an LCS of length 4; no common subsequence of length 5 exists for this pair.

Brute force would enumerate every subsequence of X (there are 2^m of them, one per subset of X's indices) and test each against Y — exponential time, unworkable once the sequences get past a few dozen characters.

### The recurrence: comparing last characters

The way out is to notice that an LCS of X and Y is built from an LCS of a *prefix* of X and a *prefix* of Y — the problem has optimal substructure. Define `c[i][j]` as the length of an LCS of the first `i` characters of X and the first `j` characters of Y. Reasoning about the *last* characters `x_i` and `y_j` gives exactly three cases:

1. **Base case** — if `i == 0` or `j == 0`, one prefix is empty, so `c[i][j] = 0`.
2. **Last characters match** (`x_i == y_j`) — that shared character must belong to the LCS (appending it to an LCS of the two shorter prefixes can't be beaten), so `c[i][j] = c[i-1][j-1] + 1`.
3. **Last characters differ** (`x_i != y_j`) — the LCS either skips `x_i` or skips `y_j` (it can't need both, since they don't match), so take the better of the two: `c[i][j] = max(c[i-1][j], c[i][j-1])`.

Each cell depends only on the cell diagonally above-left, the cell directly above, and the cell directly to the left — all of which are already computed if the table is filled in row-major order (top row first, left to right within each row). That dependency shape is what makes a bottom-up table possible instead of an exponential tree of recursive calls:

```java
int[][] buildLcsTable(String x, String y) {
    int m = x.length(), n = y.length();
    int[][] c = new int[m + 1][n + 1]; // c[0][*] and c[*][0] stay 0 (base case)

    for (int i = 1; i <= m; i++) {
        for (int j = 1; j <= n; j++) {
            if (x.charAt(i - 1) == y.charAt(j - 1)) {
                c[i][j] = c[i - 1][j - 1] + 1;
            } else {
                c[i][j] = Math.max(c[i - 1][j], c[i][j - 1]);
            }
        }
    }
    return c; // c[m][n] is the length of the LCS
}
```

### The filled table and reconstructing the actual subsequence

Filling in `c` for `X = "ABCBDAB"` (rows) against `Y = "BDCABA"` (columns) gives:

| c[i][j] | ""  | B   | D   | C   | A   | B   | A   |
|---------|-----|-----|-----|-----|-----|-----|-----|
| **""**  | 0   | 0   | 0   | 0   | 0   | 0   | 0   |
| **A**   | 0   | 0   | 0   | 0   | 1   | 1   | 1   |
| **B**   | 0   | 1   | 1   | 1   | 1   | 2   | 2   |
| **C**   | 0   | 1   | 1   | 2   | 2   | 2   | 2   |
| **B**   | 0   | 1   | 1   | 2   | 2   | 3   | 3   |
| **D**   | 0   | 1   | 2   | 2   | 2   | 3   | 3   |
| **A**   | 0   | 1   | 2   | 2   | 3   | 3   | 4   |
| **B**   | 0   | 1   | 2   | 2   | 3   | 4   | 4   |

`c[7][6] = 4` in the bottom-right corner: the LCS has length 4. Only the length is visible so far — recovering the actual characters means tracing a path backward from `c[7][6]` to `c[0][0]`, at each cell asking which case of the recurrence produced its value:

- If `x_i == y_j` at that cell, this character belongs to the LCS — record it, then move diagonally to `c[i-1][j-1]`.
- Otherwise, move toward whichever of `c[i-1][j]` (up) or `c[i][j-1]` (left) equals the current cell's value (on a tie, either direction is a valid LCS; picking "up" matches the classic pseudocode).

Walking it through for this table: start at `c[7][6]=4` (row B, col A) — `x_7='B'`, `y_6='A'` don't match, `c[6][6]=4 >= c[7][5]=4`, so move up to `c[6][6]`. There, `x_6='A'`, `y_6='A'` match — record **A**, move diagonally to `c[5][5]=3`. There, `x_5='D'`, `y_5='B'` don't match, `c[4][5]=3 >= c[5][4]=2`, move up to `c[4][5]`. There, `x_4='B'`, `y_5='B'` match — record **B**, move diagonally to `c[3][4]=2`. There, `x_3='C'`, `y_4='A'` don't match, `c[2][4]=1 < c[3][3]=2`, move left to `c[3][3]`. There, `x_3='C'`, `y_3='C'` match — record **C**, move diagonally to `c[2][2]=1`. There, `x_2='B'`, `y_2='D'` don't match, `c[1][2]=0 < c[2][1]=1`, move left to `c[2][1]`. There, `x_2='B'`, `y_1='B'` match — record **B**, move diagonally to `c[1][0]=0`, which hits the base case and stops.

The characters were recorded in backward order **A, B, C, B**; reversing gives the LCS itself: **`"BCBA"`** — the same length-4 answer `c[7][6]` reported, but now as an actual string, not just a number.

```java
String reconstructLcs(String x, String y, int[][] c) {
    StringBuilder sb = new StringBuilder();
    int i = x.length(), j = y.length();
    while (i > 0 && j > 0) {
        if (x.charAt(i - 1) == y.charAt(j - 1)) {
            sb.append(x.charAt(i - 1));
            i--; j--;
        } else if (c[i - 1][j] >= c[i][j - 1]) {
            i--;
        } else {
            j--;
        }
    }
    return sb.reverse().toString(); // "BCBA"
}
```

### Running time: O(mn) instead of exponential

The table has `(m + 1) * (n + 1)` cells, and each cell does O(1) work (one character comparison and at most one addition or max of two already-known values), so filling the whole table costs O(mn). Reconstructing the subsequence afterward walks from `c[m][n]` to some `c[i][0]` or `c[0][j]`, decrementing at least one index per step, so that pass is O(m + n). Total: O(mn) — a dramatic improvement over the brute-force approach's O(2^m) enumeration of every subsequence of X, and squarely inside what's practical for sequences with thousands of characters (DNA strands, source files, document revisions) where exponential brute force would never finish.

## Trade-offs

- **O(mn) time and space vs. exponential brute force** — the full `c` table costs Θ(mn) memory, which is significant for very long sequences (e.g., two 100,000-character DNA strands is 10 billion cells), but it's the price of turning an exponential problem into a polynomial one.
- **Full table vs. length-only space savings** — if you only need the LCS *length*, not the actual subsequence, the table can be collapsed to two rows (current and previous), dropping space to O(min(m, n)); but that smaller representation doesn't retain enough history to retrace which cells produced which values, so reconstructing the actual subsequence still needs the full O(mn) table (or a more advanced technique such as Hirschberg's divide-and-conquer algorithm, which reconstructs it in O(mn) time but only O(m + n) space).
- **Row-major fill order is one valid choice, not the only one** — any order that fills `c[i-1][j-1]`, `c[i-1][j]`, and `c[i][j-1]` before `c[i][j]` works (e.g., filling by anti-diagonals is common when parallelizing); row-major is simply the simplest to implement and reason about.

## Documentation Links

- Cormen, Leiserson, Rivest, Stein, "Introduction to Algorithms", 4th Edition (MIT Press, 2022) — Chapter 14 "Dynamic Programming", Section 14.4 "Longest common subsequence", pp. 393-399 — book
- [GNU diffutils manual — How diff Works](https://www.gnu.org/software/diffutils/manual/html_node/Comparison-Style.html) — doc
