---
version: 1.0
updatedAt: 2026-09-13
---
## Learning Objectives

- Convert a standard-form linear program into a system of equations by introducing a slack variable for every inequality constraint.
- Set up a simplex tableau, identify its initial basic feasible solution, and read off the values of every variable directly from it.
- Apply the entering-variable rule (most negative coefficient in the objective row) and the leaving-variable ratio test to select a pivot.
- Execute a full pivot operation (Gauss-Jordan elimination around the pivot entry) and update the tableau accordingly.
- Recognize the optimality condition (no negative coefficients remain in the objective row) and read the optimal solution off the final tableau.

## Context & Motivation

The previous concept proved that a linear program's optimum, when one exists, always sits at a vertex, reducing the search to a finite list of candidate points. But "finite" is not the same as "fast": the number of vertices can grow combinatorially with the problem's size, and checking every one directly, exactly the brute-force approach the previous concept's proof made possible in principle, is far too slow to be practical for any real-sized problem. George Dantzig's **simplex method** (1947) is the answer: instead of checking every vertex, it starts at one vertex and repeatedly moves to an *adjacent* vertex with a strictly better (or equal) objective value, stopping the moment no adjacent vertex improves on the current one. This concept builds the method's mechanical engine, the **simplex tableau**, and works a complete example through to its known-correct answer, verified against the vertex this track's previous concept already found by direct inspection.

## Core Theory

### Introducing slack variables: turning inequalities into equations

A standard-form linear program has constraints like `4x₁ + 2x₂ ≤ 40`. To work with equations (which the tableau's linear algebra needs) rather than inequalities, a nonnegative **slack variable** `s` is added to each constraint, absorbing exactly the unused capacity: `4x₁ + 2x₂ + s = 40`, with `s ≥ 0`. When `s > 0`, the original constraint has room to spare; when `s = 0`, the constraint is tight (binding), exactly the algebraic notion of "tight constraint" the previous concept's vertex characterization used. A linear program with `m` inequality constraints picks up `m` slack variables this way, one per constraint, each appearing in only its own row.

### The initial tableau and its starting vertex

With slack variables added, a linear program in `n` original variables and `m` constraints becomes a system of `m` equations in `n + m` unknowns, arranged into a **tableau**: one row per constraint, one row for the objective, one column per variable (original and slack), plus a right-hand-side column. Setting every *original* variable to `0` and reading the slack variables off directly (`s = 40`, in the example above) gives an immediate, easy-to-find starting vertex, the origin, which is always feasible whenever every original right-hand side is nonnegative (true whenever the problem's resource limits are themselves nonnegative quantities, the typical case).

### The entering variable: which direction improves fastest

The objective row of the tableau, written as `z - c₁x₁ - c₂x₂ - ... = 0`, has a negative coefficient for every variable currently *not* in the solution (currently `0`) that would *increase* the objective if it were increased from `0`. The simplex method's **entering variable** is chosen as the one with the most negative coefficient in this row, the variable whose increase improves the objective fastest, per unit, among all the candidates. (This is a common, simple choice rule, sometimes called Dantzig's rule; other entering-variable rules exist and are used in practice, a point this track's later concept on complexity and degeneracy returns to.)

### The leaving variable: the ratio test

Increasing the entering variable's value must be balanced by decreasing some currently-basic variable's value (to keep every equation satisfied); the **ratio test** determines how far the entering variable can increase before some currently-positive variable is driven down to exactly `0` (and no further, since every variable must stay nonnegative). For each row with a strictly positive coefficient in the entering variable's column, compute (that row's right-hand side) divided by (that row's coefficient in the entering column); the row achieving the *smallest* such ratio identifies the **leaving variable**, the basic variable in that row, which will be driven to exactly `0` and leave the solution.

### Pivoting: Gauss-Jordan elimination around the chosen entry

The **pivot** operation updates the entire tableau so the entering variable's column becomes a unit vector (1 in the leaving variable's former row, 0 everywhere else, including the objective row), exactly the same Gauss-Jordan elimination technique used to solve linear systems directly: divide the pivot row by the pivot entry (making it exactly 1 there), then, for every *other* row (including the objective row), subtract an appropriate multiple of the now-normalized pivot row to zero out that row's entry in the entering variable's column.

### Termination: no more negative coefficients

The process repeats, entering variable, ratio test, leaving variable, pivot, until the objective row contains no negative coefficients at all. At that point, no remaining nonbasic variable could improve the objective by increasing from `0`, exactly the vertex-level local-optimality condition that (given the feasible region's convexity, established two concepts ago) is also global optimality. The current tableau's right-hand-side column then gives every basic variable's optimal value directly, with every nonbasic variable at `0`.

## Worked Examples

### Example 1: solving the modified workshop LP by simplex, verified against the known vertex

**Problem:** Solve `maximize 70x₁ + 90x₂` subject to `x₁ + x₂ ≤ 10`, `x₁ + 3x₂ ≤ 24`, `x₁, x₂ ≥ 0` (the same LP whose optimal vertex, `(3,7)` at value `840`, was found by the graphical method two concepts ago) using the simplex tableau, tracking every pivot.

**Setup with slacks:** `x₁ + x₂ + s₁ = 10`, `x₁ + 3x₂ + s₂ = 24`, objective row `z - 70x₁ - 90x₂ = 0`. Initial tableau: basic variables `s₁ = 10`, `s₂ = 24`, nonbasic `x₁ = x₂ = 0`, `z = 0`.

**Iteration 1, entering variable:** The objective row's coefficients are `-70` (for `x₁`) and `-90` (for `x₂`); `-90` is more negative, so `x₂` enters.

**Iteration 1, ratio test:** Row 1 (`s₁`): `10 / 1 = 10`. Row 2 (`s₂`): `24 / 3 = 8`. The smaller ratio is row 2's `8`, so `s₂` leaves.

**Iteration 1, pivot on row 2's `x₂` coefficient (3):** Divide row 2 by 3: `(1/3)x₁ + x₂ + (1/3)s₂ = 8`. Eliminate `x₂` from row 1 (subtract the new row 2 from row 1): `(2/3)x₁ + s₁ - (1/3)s₂ = 2`. Eliminate `x₂` from the objective row (add `90 ×` the new row 2 to it): `z - 40x₁ + 30s₂ = 720`.

**After iteration 1:** `x₂ = 8`, `s₁ = 2`, `x₁ = s₂ = 0`, `z = 720`, exactly the vertex `(0, 8)` at value `720` already computed by the graphical method (this track's second concept), a useful intermediate checkpoint confirming the tableau arithmetic so far is correct.

**Iteration 2, entering variable:** The objective row now reads `z - 40x₁ + 30s₂ = 720`; `-40` (for `x₁`) is the only negative coefficient, so `x₁` enters.

**Iteration 2, ratio test:** Row 1 (`s₁`, coefficient `2/3`): `2 / (2/3) = 3`. Row 2 (`x₂`, coefficient `1/3`): `8 / (1/3) = 24`. The smaller ratio is row 1's `3`, so `s₁` leaves.

**Iteration 2, pivot on row 1's `x₁` coefficient (2/3):** Divide row 1 by `2/3`: `x₁ + 1.5s₁ - 0.5s₂ = 3`. Eliminate `x₁` from row 2 (subtract `1/3 ×` the new row 1): `x₂ - 0.5s₁ + 0.5s₂ = 7`. Eliminate `x₁` from the objective row (add `40 ×` the new row 1): `z + 60s₁ + 10s₂ = 840`.

**After iteration 2:** `x₁ = 3`, `x₂ = 7`, `s₁ = s₂ = 0`, `z = 840`. The objective row (`z + 60s₁ + 10s₂ = 840`) has no negative coefficients left, so this is optimal: `(x₁, x₂) = (3, 7)`, objective value `840`, exactly matching the vertex the graphical method found directly, now arrived at mechanically, through exactly 2 pivots, without ever having to plot or visually inspect anything.

## Common Misconceptions & Pitfalls

- **"The simplex method checks every vertex, just more systematically."** Example 1 visited exactly 2 of the feasible region's 4 vertices (the origin implicitly as the start, then `(0,8)`, then `(3,7)`), never touching `(10,0)` at all; simplex moves only along a path of *improving* adjacent vertices, and its entire efficiency advantage over brute-force vertex enumeration comes from skipping every vertex that path doesn't need to visit.
- **"Any negative coefficient in the objective row means that variable should leave the solution."** A negative coefficient in the objective row belongs to a currently *nonbasic* variable (already at `0`), and signals that variable is a good *entering* candidate (increasing it improves the objective), not a candidate for removal; it is the ratio test, applied to a different column entirely, that determines which currently-basic variable leaves.
- **"The ratio test should pick the largest ratio, to make the most progress in one step."** Example 1's first ratio test picked the *smaller* ratio (`8`, not `10`) deliberately: picking the larger ratio would have driven a different basic variable negative, violating feasibility; the smallest ratio is exactly the amount the entering variable can safely increase before some other variable would be forced below zero.
- **"Once a variable leaves the basis, it can never return to a positive value in a later iteration."** Nothing in the tableau's mechanics prevents a variable from leaving in one iteration and re-entering (becoming positive again) in a later one; it happens to not occur in Example 1's particular short run, but is a real, well-documented possibility (related to degeneracy) that a later concept in this track addresses directly.

## Summary

Adding a nonnegative slack variable to every inequality converts a standard-form linear program into a system of equations, arranged in a tableau whose initial basic feasible solution (every original variable at `0`, every slack variable equal to its constraint's right-hand side) is always an easy, immediately available starting vertex. Each iteration picks an entering variable (the most negative coefficient in the objective row, the direction that improves the objective fastest), runs a ratio test to find the leaving variable (the smallest ratio of right-hand side to entering-column coefficient, the largest safe step before some variable would go negative), and pivots (Gauss-Jordan elimination around that entry) to move to the adjacent vertex. The method terminates the moment no negative coefficient remains in the objective row, at which point the tableau's right-hand-side column gives the optimal solution directly, exactly as Example 1's two pivots reached `(3,7)` at value `840`, matching the vertex already found graphically, mechanically and without any need to plot or visually inspect the feasible region. The next concept extends this same tableau machinery to linear programs that do not arrive in the clean maximize-with-all-≤-constraints shape this concept assumed.

## Documentation Links

- [MIT 6.251 - Introduction to Mathematical Programming (OCW)](https://ocw.mit.edu/courses/6-251j-introduction-to-mathematical-programming-fall-2009/): doc
- [Dantzig, G. B. (1963). Linear Programming and Extensions. Princeton University Press.](https://press.princeton.edu/books/paperback/9780691059136/linear-programming-and-extensions): book
