---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

Pick up exactly where the sibling `linear-programming-formulation-and-duality` concept deliberately stops. That concept covers how to formulate a linear program and how duality lets you *certify* a solution optimal — but it explicitly declines to teach the simplex algorithm itself, since its source (CLRS 4th edition) dropped the tableau mechanics on purpose. This concept is that missing algorithm: the **tabular simplex method** — turning inequality constraints into a starting "dictionary" with slack variables, reading a solution directly off a tableau, picking a pivot column and pivot row, and repeating Gauss-Jordan elimination until no further improvement is possible. It also covers what to do when a problem doesn't arrive in the simplex-friendly shape (a minimization objective, `>=` constraints, equality constraints) and closes with the two practical variants built on top of the same tableau machinery: the dual-simplex algorithm and the generalized simplex procedure that combines both.

## Use Cases

- Solving small-to-medium linear programs entirely by hand, which is precisely the tabular form's reason to exist — it organizes the same algebra a "dictionary"-based method performs, but as a fixed grid of numbers that's far less error-prone to update by hand than rewriting equations at every iteration.
- Understanding, mechanically, what an LP solver means when it reports "infeasible" or "unbounded" — infeasible corresponds to Phase I of the two-phase method finishing with a positive artificial-variable sum, and unbounded corresponds to a pivot column with no positive entry to run the ratio test against.
- Re-optimizing an LP that was already solved once, after a small change — a new constraint, a tightened right-hand side — without rebuilding the whole tableau from scratch. This is the dual-simplex algorithm's actual practical niche: it starts from a tableau that is still optimal but no longer feasible (exactly the shape you get by bolting one more constraint onto an already-optimal tableau) and restores feasibility while never giving up optimality.
- Modeling problems that naturally produce `>=` or `=` constraints — a minimum-nutrient blending requirement, an exact-shipment-quantity constraint — and needing a principled way (the two-phase method) to find a first feasible tableau to pivot from at all, since simplex's own machinery only starts from an *obviously* feasible one.

## Deep Dive

### From equations to a tableau: what the grid actually holds

The sibling concept's standard form is `maximize c^T x subject to Ax <= b, x >= 0`. To pivot on it, every `<=` constraint first becomes an equality by adding a nonnegative **slack variable**: `a_i1 x_1 + ... + a_in x_n <= b_i` becomes `a_i1 x_1 + ... + a_in x_n + s_i = b_i`. The objective row is rewritten with everything moved to one side, `Z - c_1 x_1 - ... - c_n x_n = 0`, so that reading a coefficient's sign directly answers "can this variable still improve the objective?" — a positive `c_j` still profitable, a zero-or-negative one already exhausted.

Each row of the resulting system names one **basic variable** (initially, the slack variables, one per constraint); every other variable is **nonbasic** and implicitly held at `0`. Setting all nonbasic variables to `0` and reading each basic variable off its row's right-hand side gives an immediate feasible solution — the "obvious" solution — with no arithmetic required. That's the entire point of the tableau layout: feasibility is read off directly, not solved for.

```java
// One row of a simplex tableau: which basic variable this row currently represents,
// its coefficients across every structural/slack variable, and its right-hand side.
record TableauRow(String basicVariable, double[] coefficients, double rhs) { }

record Tableau(TableauRow objectiveRow, List<TableauRow> constraintRows, List<String> variableNames) {

    /** The "obvious" solution: every nonbasic variable is 0, every basic variable is its row's rhs. */
    Map<String, Double> obviousSolution() {
        Map<String, Double> x = new LinkedHashMap<>();
        for (String name : variableNames()) x.put(name, 0.0);
        for (TableauRow row : constraintRows()) x.put(row.basicVariable(), row.rhs());
        return x;
    }

    /** Optimal (maximization) once every objective-row coefficient is >= 0 — nothing left to gain. */
    boolean isOptimal() {
        for (double c : objectiveRow().coefficients()) if (c < 0) return false;
        return true;
    }
}
```

### A full worked trace: max 5x1 + 2x2

Take a small linear program with three `<=` constraints, already in standard form:

| | |
|---|---|
| maximize | `Z = 5x1 + 2x2` |
| subject to | `x1 <= 3` |
| | `x2 <= 4` |
| | `x1 + 2x2 <= 9` |
| | `x1, x2 >= 0` |

Adding one slack per constraint (`x3`, `x4`, `x5`) gives the equality system `Z - 5x1 - 2x2 = 0`, `x1 + x3 = 3`, `x2 + x4 = 4`, `x1 + 2x2 + x5 = 9`, which becomes the initial tableau:

| V.B. | Z | x1 | x2 | x3 | x4 | x5 | const. |
|---|---|---|---|---|---|---|---|
| Z | 1 | -5 | -2 | 0 | 0 | 0 | 0 |
| x3 | 0 | **1** | 0 | 1 | 0 | 0 | 3 |
| x4 | 0 | 0 | 1 | 0 | 1 | 0 | 4 |
| x5 | 0 | 1 | 2 | 0 | 0 | 1 | 9 |

The obvious solution is `x1=0, x2=0, x3=3, x4=4, x5=9, Z=0` — feasible, but not optimal, since the objective row still has negative entries (`-5`, `-2`). Two rules drive every iteration from here:

- **Entering variable (optimality condition):** among nonbasic variables with a negative objective-row coefficient, pick one to become basic. The simplest rule (and the one this trace uses) is *most negative coefficient* — here, `x1` at `-5`.
- **Leaving variable (feasibility / ratio test):** among rows with a strictly positive coefficient in the entering column, pick the row with the smallest ratio of `const. / coefficient` — the tightest limit on how far the entering variable can grow before some basic variable would go negative. Here: `3/1 = 3` (row `x3`), `4/0 = ∞` (row `x4`, skipped — a zero or negative coefficient never limits growth), `9/1 = 9` (row `x5`). The minimum is `3`, so `x3` leaves.

The cell where the entering column meets the leaving row (`x1`/`x3`, value `1`) is the **pivot element**. Pivoting means: divide the pivot row by the pivot element (here already `1`, no change needed), then, for every other row (including the objective row), subtract that row's own pivot-column coefficient times the new pivot row — the same Gauss-Jordan elimination used to zero out a column. After pivoting:

| V.B. | Z | x1 | x2 | x3 | x4 | x5 | const. |
|---|---|---|---|---|---|---|---|
| Z | 1 | 0 | -2 | 5 | 0 | 0 | 15 |
| x1 | 0 | 1 | 0 | 1 | 0 | 0 | 3 |
| x4 | 0 | 0 | 1 | 0 | 1 | 0 | 4 |
| x5 | 0 | 0 | **2** | -1 | 0 | 1 | 6 |

New obvious solution: `x1=3, x2=0, x4=4, x5=6, Z=15` — better, but `x2`'s objective-row coefficient is still negative (`-2`), so a second pivot is needed. Ratio test on the `x2` column: `4/1=4` (row `x4`), `6/2=3` (row `x5`) — `x5` leaves, pivoting on `2`:

| V.B. | Z | x1 | x2 | x3 | x4 | x5 | const. |
|---|---|---|---|---|---|---|---|
| Z | 1 | 0 | 0 | 4 | 0 | 1 | 21 |
| x1 | 0 | 1 | 0 | 1 | 0 | 0 | 3 |
| x4 | 0 | 0 | 0 | 1/2 | 1 | -1/2 | 1 |
| x2 | 0 | 0 | 1 | -1/2 | 0 | 1/2 | 3 |

No negative coefficient remains in the objective row, so this tableau is optimal: `x1=3, x2=3, x3=0, x4=1, x5=0, Z=21`. Every intermediate "obvious solution" — `(0,0)`, `(3,0)`, `(3,3)` — is a vertex of the feasible region, exactly the "walk from vertex to neighboring vertex" behavior the sibling concept's Deep Dive describes without showing; this is that walk, made concrete.

### The pivoting arithmetic, stated generally

For a pivot on element `a_sp` (row `s`, column `p`, the variable `x_j` entering with objective coefficient `c_j < 0`):

1. **Normalize the pivot row**: divide every entry in row `s` by `a_sp`.
2. **Clear every other row**, including the objective row: `new_row_i = old_row_i - (old_row_i's entry in column p) * new_pivot_row`, for every row `i != s`.

One consequence is worth deriving directly: the objective value after a pivot is `Z' = Z - c_j * (b_s / a_sp)`. Since the ratio test guarantees `b_s / a_sp > 0` (it's a ratio of nonnegative quantities, by construction) and the entering variable was chosen because `c_j < 0`, `-c_j > 0`, so `Z' > Z` strictly — **every pivot strictly improves the objective** (outside of degeneracy, covered below), which is exactly why the algorithm never revisits a tableau it has already produced and is guaranteed to terminate on a nondegenerate problem.

Two termination conditions bookend every run: if every objective-row coefficient is `>= 0`, the current tableau is optimal, full stop. If instead some column `j` has a negative objective-row coefficient *and* every entry in that column is `<= 0`, the ratio test has nothing to compare — `x_j` can grow without bound and so can `Z`, so the problem is **unbounded** and the algorithm halts having proven that, rather than looping.

### Non-standard forms: getting to a starting tableau at all

Real problems rarely arrive as a maximization with only `<=` constraints. Three transformations bring them into a shape simplex can pivot on:

- **Minimization**: use `min Z = max(-Z)` — negate the objective's coefficients, solve as a maximization, then negate the optimal value back. Nothing about the constraints changes.
- **`>=` constraints**: rewrite `a_1 x_1 + ... + a_n x_n >= b` as `a_1 x_1 + ... + a_n x_n - e + A = b`, introducing a nonnegative **surplus variable** `e` (coefficient `-1`, capturing how much the constraint is over-satisfied) *and* a nonnegative **artificial variable** `A` (coefficient `+1`). The surplus alone can't give a feasible starting basic solution — setting every structural variable to `0` would force `e = -b < 0`, violating nonnegativity — so the artificial variable is what actually seeds the basis.
- **`=` constraints**: introduce only an artificial variable `A` (no surplus needed, since equality already pins the row down); same purpose, a placeholder basic variable to start from.

Both of the last two cases leave artificial variables sitting in the basis with no business being in the *final* answer, which is what the **two-phase method** exists to clean up:

- **Phase I** replaces the real objective with `minimize W = sum of every artificial variable` (equivalently `maximize -W`), and runs ordinary simplex on that auxiliary problem. If it terminates with `W* = 0`, every artificial variable has been driven out of the basis (or pinned at `0`), which hands back a genuine feasible basic solution to the *original* constraints. If it terminates with `W* > 0` instead, no combination of artificial variables can reach zero — the original problem has no feasible solution at all, full stop.
- **Phase II** drops the artificial-variable columns entirely, restores the real objective row in their place, and resumes ordinary simplex from the feasible basis Phase I handed over.

**Worked example** (from the same source as the trace above): `max Z = 3x1 - 5x2` subject to `x1 <= 4`, `2x2 <= 12`, `3x1 + 2x2 >= 18`, `x1, x2 >= 0`. The third constraint needs a surplus `x5` and artificial `A1`: `3x1 + 2x2 - x5 + A1 = 18`. Phase I minimizes `A1` (equivalently maximizes `-W`); after clearing the artificial variable's coefficient out of the objective row (it starts nonzero there purely because `A1` is basic) and two pivots (entering `x1`, then `x2`), Phase I terminates at `x1=4, x2=3, x3=0, x4=6, x5=0, A1=0, W=0` — a genuine feasible point, since `A1` reached zero. Phase II then drops the `A1` column, restores `Z - 3x1 + 5x2 = 0` as the objective row, re-clears the basic variables' columns in it (`x1` and `x2` are already basic from Phase I, so their objective-row entries must be re-zeroed before reading off optimality), and pivots once more to the true optimum: `x1=2, x2=6, x3=2, Z=-24`.

### Variants built on the same tableau: dual-simplex and generalized simplex

Ordinary simplex keeps a **feasible** tableau at every step (every basic variable's value is `>= 0`) and works to reach **optimality** (every objective-row coefficient `>= 0` on a maximization). The **dual-simplex algorithm** runs that pairing backwards: it starts from a tableau that is already optimal — the objective row already satisfies the sign condition — but *infeasible*, meaning some basic variable's right-hand side is negative. That situation arises naturally whenever a new constraint is bolted onto an already-solved LP (a common case in sensitivity analysis, or when an integer-programming method adds a cutting-plane constraint to a relaxation it already optimized): the old optimal tableau's objective row is untouched by the new row, so optimality survives, but the new row can easily make some previously-fine basic variable go negative.

Dual-simplex's pivot rule mirrors ordinary simplex's, with roles reversed: the **leaving** variable is chosen first — the basic variable with the most negative right-hand side — and the **entering** variable is whichever nonbasic variable, among those with a negative coefficient in that row, minimizes the ratio of `|objective-row coefficient| / |that row's coefficient|`. Pivoting proceeds by the same Gauss-Jordan elimination as before. Each iteration restores a little more feasibility while never sacrificing the optimality condition, until every right-hand side is nonnegative — at which point the tableau is both feasible and optimal, done. Its real payoff is avoiding a full re-solve from scratch: reusing an already-optimal tableau as the starting point is cheaper than rebuilding a fresh feasible basis and pivoting all the way back up.

When a starting tableau is *neither* feasible nor optimal at once — some right-hand side is negative *and* some objective-row coefficient still violates the optimality condition — neither algorithm alone applies directly. The **generalized simplex procedure** is simply running them in sequence: first, dual-simplex iterations to clear the negative right-hand sides (restoring feasibility while holding optimality's sign pattern fixed), then, once every right-hand side is nonnegative, switching to ordinary simplex iterations to clear the remaining negative objective-row coefficients (restoring optimality while holding feasibility). It isn't a third algorithm with its own pivot rule — it's a scheduling decision (dual-simplex first, then simplex) built entirely from the two pivot rules already described.

## Trade-offs

- **Exponential worst case, excellent practical performance — the same split the sibling concept flags for LP algorithms generally.** [George Dantzig](https://en.wikipedia.org/wiki/George_Dantzig) devised simplex in 1947; in 1972 Klee and Minty constructed an explicit family of LPs (the "Klee-Minty cube," a distorted `n`-dimensional hypercube) that forces the most-negative-coefficient pivot rule through all `2^n` vertices before terminating — proof that no worst-case polynomial bound can hold for that rule. In practice, simplex nonetheless usually reaches the optimum in a number of iterations closer to linear in the number of constraints, which is why it, rather than a provably-polynomial method, remained the default solver for decades.
- **Cost per iteration is small and mechanical; the number of iterations is what's unbounded.** Each pivot is a full Gauss-Jordan update of an `m`-row tableau over `N = n + m` columns (`n` structural plus `m` slack/surplus/artificial variables) — `O(mN)` arithmetic operations, dominated by clearing every other row against the new pivot row. The number of *possible* tableaus, however, is the number of ways to choose `m` basic variables out of `N`, `C(N, m)` — a binomial coefficient that grows combinatorially, which is where the exponential worst case actually comes from, not from any single pivot being expensive.
- **Degeneracy can stall progress, and in the worst case cycle forever.** If a basic variable's right-hand side is already `0`, a pivot can leave the objective value completely unchanged (`Z' = Z` when `b_s = 0` in the formula above) — a wasted iteration that doesn't move to a genuinely new vertex. Repeated degenerate pivots can, in principle, cycle back to a tableau visited earlier and loop forever; **Bland's rule** (always break ties in the entering/leaving variable choice by picking the smallest-indexed variable) is a well-known fix that provably prevents cycling, at the cost of usually being slower per problem than a more aggressive tie-breaking heuristic.
- **The Big-M method and the two-phase method solve the same "no obvious starting feasible tableau" problem with different failure modes.** A Big-M formulation (penalizing artificial variables in the real objective by a very large constant `M`, in a single pass) avoids ever needing two separate optimizations, but a poorly chosen `M` is a real footgun: too small, and the penalty doesn't dominate, letting an infeasible-looking solution with a leftover artificial variable appear attractive; too large, and floating-point arithmetic on a real solver loses precision comparing tiny true coefficients against `M`-scaled ones. Two-phase sidesteps the constant-choice problem entirely, at the cost of running simplex twice.
- **No `viz` walkthrough here.** A simplex tableau is a numeric grid whose meaningful transformation is arithmetic (Gauss-Jordan row reduction), not a structural change to a token, tree, or graph shape — none of this engine's `formula`/`moves`/`tree`/`graph`/`btree` modes fit that, the same reasoning the sibling `linear-programming-formulation-and-duality` and `knapsack-01-vs-fractional` concepts already established for tableau- and table-shaped content. The worked trace above is the tableau equivalent of those concepts' own markdown tables.

## Documentation Links

- [Hamdy A. Taha — *Operations Research: An Introduction*, 8th Edition (Pearson/Prentice Hall, 2007-2008)](https://www.pearson.com/en-us/subject-catalog/p/operations-research-an-introduction/P200000003221/9780137625727) — book
- [Simplex algorithm — Wikipedia](https://en.wikipedia.org/wiki/Simplex_algorithm) — doc
- [George Dantzig — Wikipedia](https://en.wikipedia.org/wiki/George_Dantzig) — doc
- [Bland's rule — Wikipedia](https://en.wikipedia.org/wiki/Bland%27s_rule) — doc
