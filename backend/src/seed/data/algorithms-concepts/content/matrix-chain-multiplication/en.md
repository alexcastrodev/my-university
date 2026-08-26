---
version: 1.0
updatedAt: 2026-08-14
---
## Objective

Learn CLRS's second worked example of the dynamic-programming method (after rod cutting): given a chain of matrices to multiply, find the parenthesization that minimizes the total number of scalar multiplications — without actually performing any of the multiplications. This assumes you already know the general DP methodology (see `dynamic-programming-fundamentals.md` for the four-step recipe and the optimal-substructure / overlapping-subproblems hallmarks); the focus here is applying that recipe to a problem whose subproblems are indexed by a pair `(i, j)` — a contiguous range of the chain — rather than rod cutting's single length `n`.

## Use Cases

- Deciding the cheapest evaluation order before multiplying a chain of matrices together: the parenthesization chosen can make an order-of-magnitude difference in cost, not just a constant-factor one — CLRS's own three-matrix example computes 7,500 scalar multiplications with one parenthesization versus 75,000 with another, a 10x difference, even though both compute the exact same product.
- Recognizing when brute-force search over every possible parenthesization is infeasible: the number of ways to fully parenthesize a chain of `n` matrices, `P(n)`, grows as `Ω(2^n)` (it's closely related to the Catalan numbers, which grow as `Θ(4^n / n^(3/2))`), so exhaustively checking every parenthesization stops being practical long before a dynamic-programming table would.
- Seeing the general DP methodology applied a second time to a problem with a genuinely different subproblem shape than rod cutting: a 2D range `Ai...Aj` over the chain instead of a 1D prefix length, which is what motivates the `Θ(n^2)`-size table and `O(n^3)` fill time worked out below.

## Deep Dive

### The problem: parenthesizing a chain to minimize scalar multiplications

Given a chain `⟨A1, A2, ..., An⟩` of `n` matrices to multiply, where matrix `Ai` has dimensions `p[i-1] × p[i]`, the goal is to fully parenthesize the product `A1 A2 ... An` so as to minimize the number of scalar multiplications needed to compute it — using the standard algorithm for multiplying pairs of rectangular matrices as a subroutine. Matrix multiplication is associative, so every parenthesization yields the same product; the problem is purely about the *cost* of getting there, not correctness. The standard algorithm for multiplying a `p×q` matrix by a `q×r` matrix, `RECTANGULAR-MATRIX-MULTIPLY`, does exactly `p*q*r` scalar multiplications (its innermost loop runs `p*q*r` times):

```java
// RECTANGULAR-MATRIX-MULTIPLY(A, B, C, p, q, r): C += A * B, A is p x q, B is q x r
static void rectangularMatrixMultiply(double[][] a, double[][] b, double[][] c, int p, int q, int r) {
    for (int i = 0; i < p; i++) {
        for (int j = 0; j < r; j++) {
            for (int k = 0; k < q; k++) {
                c[i][j] += a[i][k] * b[k][j];
            }
        }
    }
}
```

CLRS's own three-matrix example shows why the parenthesization matters: a chain `⟨A1, A2, A3⟩` with dimensions `10×100`, `100×5`, and `5×50`. Parenthesizing as `((A1 A2) A3)` costs `10*100*5 = 5,000` multiplications to form the `10×5` product `A1 A2`, plus `10*5*50 = 2,500` to multiply that by `A3` — a total of `7,500`. Parenthesizing instead as `(A1 (A2 A3))` costs `100*5*50 = 25,000` to form the `100×50` product `A2 A3`, plus `10*100*50 = 50,000` to multiply `A1` by that — a total of `75,000`. The first parenthesization is 10 times faster, even though both compute the identical `10×50` matrix. The matrix-chain-multiplication problem is: given the dimension sequence `⟨p0, p1, ..., pn⟩`, fully parenthesize `A1 A2 ... An` to minimize the total scalar multiplications — the problem never actually multiplies the matrices, it only determines the cheapest order, on the premise that the time spent finding that order is usually paid back many times over once the real multiplications run (7,500 instead of 75,000, in the example above).

### Why brute force fails: counting the parenthesizations

Let `P(n)` be the number of distinct ways to fully parenthesize a chain of `n` matrices. A chain of one matrix has exactly one (trivial) parenthesization, so `P(1) = 1`. For `n ≥ 2`, a full parenthesization splits the chain into two fully parenthesized subchains at some matrix `k`, so:

```
P(n) = 1                                  if n = 1
P(n) = sum_{k=1}^{n-1} P(k) * P(n-k)      if n >= 2
```

This recurrence's solution is `Ω(2^n)` — related to the Catalan numbers, whose growth rate is `Θ(4^n / n^(3/2))`. Either way, the count of parenthesizations is exponential in `n`, which rules out exhaustively enumerating and costing every one as an efficient algorithm — exactly the situation dynamic programming is built for.

### Applying the DP method, steps 1 and 2: optimal substructure and the recurrence

Following the same four-step method as rod cutting, define `Ai:j` (for `i ≤ j`) as the matrix that results from evaluating the product `Ai Ai+1 ... Aj`. Parenthesizing `Ai:j` when `i < j` means splitting the product between `Ak` and `Ak+1` for some `k` with `i ≤ k < j`: first compute `Ai:k` and `Ak+1:j`, then multiply them together.

**Step 1 — optimal substructure.** If an optimal parenthesization of `Ai Ai+1 ... Aj` splits the product at `k`, then the way it parenthesizes the prefix subchain `Ai ... Ak` must itself be an optimal parenthesization of `Ai ... Ak` — if a cheaper parenthesization of that subchain existed, substituting it in would produce a cheaper parenthesization of the whole chain, contradicting optimality. The same argument applies to the suffix subchain `Ak+1 ... Aj`. So building an optimal solution means splitting the problem into two subproblems, solving each optimally, and combining — trying every possible split point `k` to find the best one.

**Step 2 — the recurrence.** Let `m[i, j]` be the minimum number of scalar multiplications needed to compute `Ai:j`; the answer to the full problem is `m[1, n]`. The base case is trivial: `m[i, i] = 0`, since a chain of one matrix needs no multiplications. For `i < j`, since each `Ai` is `p[i-1] × p[i]`, computing `Ai:k * Ak+1:j` costs `p[i-1] * p[k] * p[j]` scalar multiplications on top of whatever each side already cost, so:

```
m[i, j] = 0                                                              if i = j
m[i, j] = min{ m[i,k] + m[k+1,j] + p[i-1]*p[k]*p[j] : i <= k < j }        if i < j
```

`s[i, j]` records the value of `k` that achieves this minimum — it doesn't affect the cost, but it's exactly the information needed later to reconstruct which parenthesization produced it.

### Step 3: computing the optimal costs bottom-up

A recursive algorithm built directly on the recurrence above would take exponential time, for the same reason the naive recursive `CUT-ROD` does (see `dynamic-programming-fundamentals.md`): it would re-solve the same `(i, j)` subproblem repeatedly across different call paths. But there are only `Θ(n^2)` distinct subproblems — one for each pair `1 ≤ i ≤ j ≤ n` — so a table fills in every one of them exactly once. `m[i, j]` depends only on `m[i, k]` and `m[k+1, j]` for `k` strictly between, and both of those describe *shorter* chains than `Ai:j`. So the table must be filled in order of increasing chain length `l = j - i + 1`, from length 1 up to length `n`:

```java
// MATRIX-CHAIN-ORDER(p, n): p = <p0, p1, ..., pn>, matrix Ai is p[i-1] x p[i]
static int[][] matrixChainOrder(int[] p, int n) {
    int[][] m = new int[n + 1][n + 1]; // m[i][j]: min scalar mults to compute Ai..Aj
    int[][] s = new int[n + 1][n + 1]; // s[i][j]: the split point k that achieves m[i][j]

    for (int i = 1; i <= n; i++) {
        m[i][i] = 0; // chain length 1
    }
    for (int l = 2; l <= n; l++) {                    // l = chain length
        for (int i = 1; i <= n - l + 1; i++) {         // chain begins at Ai
            int j = i + l - 1;                         // chain ends at Aj
            m[i][j] = Integer.MAX_VALUE;
            for (int k = i; k <= j - 1; k++) {          // try Ai:k * Ak+1:j
                int q = m[i][k] + m[k + 1][j] + p[i - 1] * p[k] * p[j];
                if (q < m[i][j]) {
                    m[i][j] = q;                        // remember this cost
                    s[i][j] = k;                         // remember this split
                }
            }
        }
    }
    return m; // s is filled as a side effect; both are returned together in CLRS
}
```

The loop nesting is three deep (`l`, `i`, `k`), and each of the three loop indices takes on at most `n - 1` values, so `MATRIX-CHAIN-ORDER` runs in `O(n^3)` time — a dramatic improvement over exponential enumeration of parenthesizations. The `m` and `s` tables each require `Θ(n^2)` space.

### The worked example: a chain of 6 matrices

CLRS's own Figure 14.5 fills in the `m` table for `n = 6` matrices with dimensions:

| matrix | A1 | A2 | A3 | A4 | A5 | A6 |
|---|---|---|---|---|---|---|
| dimension | 30×35 | 35×15 | 15×5 | 5×10 | 10×20 | 20×25 |

Filling `m` by increasing chain length `l` (the diagonal `m[i,i] = 0` for all `i` is omitted since it's always zero):

| chain length | m[1,·] | m[2,·] | m[3,·] | m[4,·] | m[5,·] |
|---|---|---|---|---|---|
| l=2 | m[1,2]=15,750 | m[2,3]=2,625 | m[3,4]=750 | m[4,5]=1,000 | m[5,6]=5,000 |
| l=3 | m[1,3]=7,875 | m[2,4]=4,375 | m[3,5]=2,500 | m[4,6]=3,500 | |
| l=4 | m[1,4]=9,375 | m[2,5]=7,125 | m[3,6]=5,375 | | |
| l=5 | m[1,5]=11,875 | m[2,6]=10,500 | | | |
| l=6 | m[1,6]=15,125 | | | | |

The minimum number of scalar multiplications needed to multiply all 6 matrices is `m[1, 6] = 15,125`. The figure also shows which entries line 9 of the pseudocode compares when computing `m[2, 5]`, trying each split point `k` from 2 to 4:

```
m[2,2] + m[3,5] + p1*p2*p5 = 0    + 2,500 + 35*15*20 = 13,000
m[2,3] + m[4,5] + p1*p3*p5 = 2,625 + 1,000 + 35*5*20  = 7,125   <- minimum
m[2,4] + m[5,5] + p1*p4*p5 = 4,375 + 0     + 35*10*20 = 11,375
```

The middle split (`k = 3`) wins, giving `m[2, 5] = 7,125` — matching the table above, and illustrating exactly how line 9 of `MATRIX-CHAIN-ORDER` tries every `k` in the valid range and keeps the best.

### Step 4: reconstructing the actual parenthesization

`MATRIX-CHAIN-ORDER` determines the optimal *cost*, but not which multiplications to perform — that's what the `s` table is for. Each `s[i, j]` records the `k` at which an optimal parenthesization of `Ai...Aj` splits, so the final multiplication in computing `A1:n` is `A1:s[1,n] * A(s[1,n]+1):n`, and the same table, read recursively, gives every earlier split too. `PRINT-OPTIMAL-PARENS` walks the `s` table to print the parenthesization:

```java
// PRINT-OPTIMAL-PARENS(s, i, j)
static void printOptimalParens(int[][] s, int i, int j) {
    if (i == j) {
        System.out.print("A" + i);
    } else {
        System.out.print("(");
        printOptimalParens(s, i, s[i][j]);
        printOptimalParens(s, s[i][j] + 1, j);
        System.out.print(")");
    }
}
```

For the `n = 6` example above, the initial call `PRINT-OPTIMAL-PARENS(s, 1, 6)` prints the optimal parenthesization `((A1(A2 A3))((A4A5)A6))`. Decoding that string against the definition of `s[i, j]` (the split point `k` used at each level) gives the split points that produced it: the top-level split is between `A3` and `A4` (`s[1,6] = 3`), the left subchain `A1..A3` splits between `A1` and `A2` (`s[1,3] = 1`, with `s[2,3] = 2` forced since `k = 2` is the only choice when `i = 2, j = 3`), and the right subchain `A4..A6` splits between `A5` and `A6` (`s[4,6] = 5`, with `s[4,5] = 4` forced the same way). That structure is naturally a binary tree of multiplications, with the six matrices as leaves in order and each internal node the multiplication of its two children:

```viz
type: tree
insert r16 A1:6 | Final split s[1,6] = 3 -- multiply (A1..A3) by (A4..A6).
insert r13 A1:3 parent=r16 side=left | Left subchain splits at s[1,3] = 1 -- multiply A1 by (A2 A3).
insert r46 A4:6 parent=r16 side=right | Right subchain splits at s[4,6] = 5 -- multiply (A4 A5) by A6.
insert a1 A1 parent=r13 side=left | A single matrix -- no further split.
insert r23 A2:3 parent=r13 side=right | s[2,3] = 2 is the only possible split (i = k = 2, j = 3).
insert a2 A2 parent=r23 side=left
insert a3 A3 parent=r23 side=right
insert r45 A4:5 parent=r46 side=left | s[4,5] = 4 is the only possible split (i = k = 4, j = 5).
insert a6 A6 parent=r46 side=right
insert a4 A4 parent=r45 side=left
insert a5 A5 parent=r45 side=right
```

The leaves read left to right as `A1, A2, A3, A4, A5, A6` — the original chain, in order — with each internal node marking one of the multiplications `PRINT-OPTIMAL-PARENS` prints, exactly matching `((A1(A2 A3))((A4A5)A6))`.

## Trade-offs

- **Shares its shape with other interval-DP table fills, but not their exact cost** — matrix-chain multiplication and longest-common-subsequence (see `longest-common-subsequence.md`) are both dynamic programs over contiguous ranges with `Θ(n^2)`-size tables filled by increasing subproblem length, and both need optimal substructure over those ranges to work at all. But LCS fills its table in `O(mn)` because each cell does `O(1)` work; matrix-chain multiplication's `m[i,j]` cell must itself minimize over every split point `k` in range, so the same `Θ(n^2)` table costs `O(n^3)` total to fill, not `O(n^2)` — the "how many cells" and "how expensive is each cell" trade-offs are independent and both matter.
- **A time-for-time trade, not a time-for-nothing one** — CLRS is explicit that the matrix-chain problem never multiplies any matrices; it only searches for the cheapest order. The `O(n^3)` time (and `Θ(n^2)` space) spent finding that order is worthwhile specifically because it's typically paid back many times over once the real multiplications run — the example's `7,500` vs. `75,000` scalar multiplications is the payoff `MATRIX-CHAIN-ORDER`'s own cost has to be weighed against.
- **The cost table alone doesn't answer "how" — that's a second table** — `m[i,j]` gives the optimal cost but, on its own, gives no way to actually perform the multiplications in the cheapest order; `s[i,j]` has to be maintained alongside it and walked recursively (`PRINT-OPTIMAL-PARENS`) to recover the parenthesization itself, the same "value vs. actual solution" split noted for rod cutting's own extended table.
- **Brute force isn't just slower here, it's a different growth class** — `P(n) = Ω(2^n)` distinct parenthesizations means checking them all is exponential in the number of matrices, while the DP table is `O(n^3)`; this gap is much starker than, say, a constant-factor tuning decision, and it's what makes exhaustive search a non-starter even for modest chain lengths.

## Documentation Links

- [Introduction to Algorithms, 4th Edition](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — Cormen, Leiserson, Rivest, Stein — Section 14.2 "Matrix-chain multiplication", pp. 373-381 — doc
