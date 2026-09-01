---
version: 1.0
updatedAt: 2026-09-01
---
## Objective

Understand backtracking: a general recursive search technique for enumerating every solution (or every valid configuration) to a combinatorial problem, built from exactly three steps repeated at each decision point — choose an option, recurse on the smaller remaining problem, then undo the choice before trying the next option. The undo step is the entire idea: it's what lets the same mutable state (an array, a partial board, a running set) be reused across every branch instead of copying it. What separates backtracking from plain brute-force enumeration is pruning — abandoning a branch the instant it's provably invalid, rather than building it out to the end and checking afterward.

## Use Cases

- **Subsets / Power Set** — include or exclude each element.
- **Permutations** — choose which unused element goes next, in every order.
- **N-Queens** — the canonical constraint-satisfaction problem: place N queens so none attacks another.
- **Combination Sum** — choose numbers (with repetition) that sum to a target.
- **Sudoku solver** — fill each empty cell with a digit that doesn't conflict with its row, column, or box.

## Deep Dive

### The skeleton: choose, recurse, un-choose

Every backtracking solution has the same shape, regardless of the problem:

```java
static void backtrack(List<Integer> nums, int start, List<Integer> current, List<List<Integer>> result) {
    result.add(new ArrayList<>(current));   // record: 'current' is a valid subset right now
    for (int i = start; i < nums.size(); i++) {
        current.add(nums.get(i));                       // choose
        backtrack(nums, i + 1, current, result);         // recurse
        current.remove(current.size() - 1);              // un-choose
    }
}
```

For `Subsets`, "record" happens on every call, because every partial selection is itself a valid subset. Other problems only record at the leaves (a complete permutation, a fully filled board) and use the loop purely to explore.

### Pruning: the difference between backtracking and brute force

A brute-force solution to N-Queens would generate every possible arrangement of N queens on the board, then filter out the ones with conflicts — the majority of that work is wasted the moment the first two queens conflict. Backtracking checks the constraint *before* recursing deeper: place a queen in the current row only in a column that doesn't conflict with any queen already placed, and skip every column that does without ever exploring what's below it.

```java
static boolean isSafe(int[] cols, int row, int col) {
    for (int r = 0; r < row; r++) {
        if (cols[r] == col) return false;                          // same column
        if (Math.abs(cols[r] - col) == row - r) return false;       // same diagonal
    }
    return true;
}
```

That single check, applied before each recursive call rather than after the board is complete, is what makes 4-Queens explore a handful of branches instead of all 4⁴ = 256 raw placements.

### Watch it happen: 4-Queens, row by row

| Row | Column tried | Safe? | Action |
|---|---|---|---|
| 0 | 0 | yes | place, recurse to row 1 |
| 1 | 0, 1 | no (col/diag conflict) | skip both |
| 1 | 2 | yes | place, recurse to row 2 |
| 2 | 0, 1, 2, 3 | no (all conflict with rows 0–1) | **dead end — backtrack to row 1** |
| 1 | 3 | yes | place, recurse to row 2 |
| 2 | 0, 1, 2, 3 | no (all conflict) | **dead end — backtrack to row 0** |
| 0 | 1 | yes | place, recurse... (eventually finds a full solution) |

The "dead end" rows are where pruning pays off: the search abandons an entire subtree of row-2/row-3 placements the moment row 2 has no safe column left, instead of enumerating them.

### Backtracking vs. Branch and Bound

[Branch and Bound](branch-and-bound) is backtracking with one addition: a bound function that estimates the best possible outcome still reachable from the current partial solution, and prunes a branch the moment that bound can't beat the best complete solution found so far. Plain backtracking (as used for Subsets, Permutations, N-Queens) has no such notion — it's built to enumerate valid configurations, not to compare them and pick a winner. Reach for Branch and Bound specifically when the problem is "find the *best* one," not "find *all* of them" or "find *one*."

### Backtracking vs. dynamic programming

When a backtracking search's subproblems overlap — the same partial state gets explored from multiple branches — plain backtracking redoes that work every single time, which is exactly the gap [Dynamic Programming](dynamic-programming-fundamentals) closes by caching each distinct subproblem's result. If a backtracking solution's state space turns out to have heavy overlap (many recursive calls with identical arguments), memoizing those calls is what turns exponential backtracking into polynomial DP — same recursive skeleton, one line of caching added.

## Trade-offs

- **Worst-case running time is inherently exponential** — pruning cuts the *practical* search space dramatically on most real inputs (that's the entire point), but it does not change the worst-case bound, which stays exponential for genuinely hard instances; that's expected, not a sign the implementation is wrong.
- **Pruning only helps if the constraint check happens as early as possible** — validating only at a completed leaf (a full board, a full permutation) degenerates back into generate-and-test, with none of backtracking's actual benefit; the constraint must be checked at the earliest recursive call where it can possibly fail.
- **No built-in notion of "best"** — backtracking finds *a* valid configuration or *all* of them, but nothing about the plain technique compares candidates against each other; optimizing among valid solutions needs Branch and Bound's added bound-and-compare bookkeeping.

## Documentation Links

- Steven S. Skiena, *The Algorithm Design Manual*, 3rd Edition (Springer, 2020) — Chapter 9, "Combinatorial Search," Section 9.1 "Backtracking" — book
- Donald E. Knuth, "Dancing Links" (2000) — arXiv:cs/0011047 — Algorithm X for the exact cover problem, an efficient backtracking search applied to N-Queens and Sudoku — doc
