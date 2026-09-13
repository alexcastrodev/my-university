---
version: 1.0
updatedAt: 2026-09-13
---
## Learning Objectives

- Prove weak duality: every dual-feasible objective value is an upper bound on every primal-feasible objective value, for any pair of feasible solutions whatsoever.
- State strong duality: at optimality, the primal and dual objective values are exactly equal, not merely bounded.
- Read a dual-optimal solution directly off a primal simplex tableau's final objective row, using the slack variables' coefficients, and verify it against the dual solved directly.
- State and verify complementary slackness: a primal variable is positive only if its corresponding dual constraint is tight, and a primal constraint is tight only if its corresponding dual variable is positive.
- Use complementary slackness as a fast way to check whether a proposed primal-dual pair could possibly both be optimal, without solving either problem from scratch.

## Context & Motivation

The previous concept constructed the dual of a linear program and observed, on one worked example, that its optimal value matched the primal's exactly, `840` on both sides, arrived at through entirely different variables and an entirely different feasible region. This concept proves that match is never a coincidence, in two stages: first the easy half (**weak duality**, true for *any* feasible pair, proved directly from the constraints alone), then the deep half (**strong duality**, true specifically *at* optimality, made concrete here by reading the optimal dual solution directly out of the primal simplex tableau this track already computed). A third result, **complementary slackness**, then pins down the precise relationship between which primal variables are positive and which dual constraints are tight.

## Core Theory

### Weak duality: a short, general proof

**Claim.** For any primal-feasible `x` (satisfying `Ax ≤ b`, `x ≥ 0`) and any dual-feasible `y` (satisfying `Aᵀy ≥ c`, `y ≥ 0`): `cᵀx ≤ bᵀy`.

**Proof.** Since `x ≥ 0` and `Aᵀy ≥ c` (component-wise), multiplying both sides of the dual constraint by the nonnegative `x` preserves the inequality: `xᵀ(Aᵀy) ≥ xᵀc`, i.e. `(Ax)ᵀy ≥ cᵀx`. Since `y ≥ 0` and `Ax ≤ b` (the primal constraint), multiplying both sides by the nonnegative `y` preserves *that* inequality: `(Ax)ᵀy ≤ bᵀy`. Chaining the two: `cᵀx ≤ (Ax)ᵀy ≤ bᵀy`. `∎`

This holds for *every* feasible pair, not just optimal ones, which already has an immediate practical use: any dual-feasible `y`, however it was found, certifies an upper bound on the primal's optimal value (since the primal optimum is itself primal-feasible, weak duality applies to it directly), and symmetrically any primal-feasible `x` certifies a lower bound on the dual's optimal value.

### Strong duality: reading the dual solution off the primal tableau

**Strong duality** states that when both the primal and dual have optimal solutions, their optimal objective values are *exactly* equal, `cᵀx* = bᵀy*`, not merely related by the inequality weak duality already established. The full proof of this fact is a substantial argument (it can be derived from the geometry of the simplex method's own termination condition, tracing through why the final tableau's structure forces equality), beyond what this concept reproduces from scratch; instead, this concept makes the result concrete and directly checkable through a fact simplex hands over for free: **at the optimal tableau, the coefficient of each slack variable in the final objective row is exactly that constraint's optimal dual variable value**.

### Complementary slackness, stated precisely

**Complementary slackness** ties the two halves of a primal-dual pair together, precisely, in both directions at once:

- For every primal variable `xⱼ`: if `xⱼ > 0`, then its corresponding dual constraint holds with **equality** (is tight). Equivalently, if the dual constraint is **not** tight (has slack), then `xⱼ` must be exactly `0`.
- For every primal constraint `i`: if that constraint has slack (`sᵢ > 0`, not tight), then its corresponding dual variable `yᵢ` must be exactly `0`. Equivalently, if `yᵢ > 0`, then primal constraint `i` must be tight.

Both directions follow directly from weak duality's proof: the two inequality steps chained together (`cᵀx ≤ (Ax)ᵀy ≤ bᵀy`) become *equalities* precisely at optimality (since strong duality forces the two ends to match exactly), which forces each individual multiplication step in that chain to also be an equality, exactly the componentwise conditions complementary slackness states.

## Worked Examples

### Example 1: reading the dual solution directly off the primal's final tableau

**Problem:** This track's simplex-method concept solved `maximize 70x₁ + 90x₂` subject to `x₁+x₂≤10`, `x₁+3x₂≤24` and reached the final tableau row `z + 60s₁ + 10s₂ = 840`. Read the dual-optimal solution directly off this row, and verify it matches the dual solved independently in the previous concept.

**Reading the tableau:** The slack variables `s₁` and `s₂` correspond, in order, to the two primal constraints, and therefore to the two dual variables `y₁` and `y₂`. Their coefficients in the final objective row are `60` and `10` respectively.

**Verification:** The previous concept solved the dual (`minimize 10y₁+24y₂` subject to `y₁+y₂≥70`, `y₁+3y₂≥90`) directly by the graphical method and found `(y₁,y₂)=(60,10)` at value `840`. This matches the tableau reading exactly: `y₁=60`, `y₂=10`, with both objective values equal to `840`, confirming strong duality concretely on this example, and demonstrating that the dual's optimal solution was, in a real sense, already sitting inside the primal's own final tableau the entire time, without needing to solve the dual as a separate problem at all.

### Example 2: verifying complementary slackness on the same solved example

**Problem:** Using the primal-optimal `(x₁,x₂)=(3,7)` and dual-optimal `(y₁,y₂)=(60,10)`, verify both complementary slackness conditions: (a) every positive primal variable has a tight corresponding dual constraint, and (b) every tight primal constraint has (or may have) a positive corresponding dual variable, while every slack primal constraint has a zero corresponding dual variable.

**Condition (a), primal variables to dual constraints:** `x₁=3>0`, so its dual constraint (`y₁+y₂≥70`) should be tight: `60+10=70` ✓, exactly tight. `x₂=7>0`, so its dual constraint (`y₁+3y₂≥90`) should be tight: `60+30=90` ✓, exactly tight. Both hold.

**Condition (b), primal constraints to dual variables:** The first primal constraint (`x₁+x₂≤10`) is tight (`3+7=10`), consistent with its dual variable `y₁=60` being positive. The second primal constraint (`x₁+3x₂≤24`) is tight (`3+21=24`), consistent with its dual variable `y₂=10` being positive. (Neither primal constraint has slack here, so the "slack constraint forces its dual variable to zero" direction isn't exercised by this particular example, but is stated precisely in Core Theory's general rule above.)

## Common Misconceptions & Pitfalls

- **"Weak duality only applies to optimal solutions, the same as strong duality."** Weak duality's proof uses only feasibility (`Ax≤b`, `Aᵀy≥c`, both nonnegative), never optimality at all; it holds for any dual-feasible `y` paired with any primal-feasible `x`, however far either is from optimal, which is exactly what makes it useful for bounding an unknown optimum from a single feasible guess.
- **"Reading the dual solution off the primal's slack coefficients is a shortcut that only works by coincidence on this particular example."** This is a general, reliable fact about the simplex method's final tableau, not an artifact of this specific problem's numbers; it holds because the slack variables' reduced costs at optimality are mathematically identical to the corresponding dual variables, a structural consequence of how the simplex method's own arithmetic mirrors the dual construction, verified here rather than merely asserted.
- **"Complementary slackness says a positive primal variable and its dual constraint can never both be tight-and-positive at once."** The conditions are not mutually exclusive in the way that phrasing implies: Example 2 shows `x₁>0` *and* its dual constraint being exactly tight simultaneously, that is precisely what the condition requires, not a contradiction; what complementary slackness actually forbids is a positive primal variable paired with a *slack* (non-tight) dual constraint.
- **"If a proposed primal and dual solution both look plausible and complementary slackness holds, they must be optimal."** Complementary slackness holding is a *necessary* condition for optimality (true optimal pairs always satisfy it), verified in Example 2 for a pair already independently confirmed optimal by simplex, but checking it alone, without also confirming both solutions are actually feasible for their respective problems, is not sufficient on its own to certify optimality; it is best used as a quick consistency check or an aid to constructing a solution, not a replacement for feasibility verification.

## Summary

Weak duality is the easy, general half: for any primal-feasible `x` and dual-feasible `y`, `cᵀx ≤ bᵀy`, proved directly by chaining the primal and dual constraints through nonnegative multiplications, holding regardless of optimality. Strong duality is the deep half: at optimality, this inequality becomes an exact equality, made concrete in Example 1 by reading the dual-optimal solution `(60,10)` directly off the primal's final simplex tableau, exactly matching the value independently computed by solving the dual from scratch in the previous concept, both reaching the shared optimal value `840`. Complementary slackness then pins down precisely which primal-dual pairs can coexist: a positive primal variable forces its dual constraint tight, and a slack primal constraint forces its dual variable to zero, both directions verified concretely against this track's own running numbers in Example 2. Together, these three results are the formal foundation underneath everything the rest of this track builds on the primal-dual relationship, from the next concept's dual simplex algorithm to this track's closing connection back to network flow's max-flow min-cut theorem.

## Documentation Links

- [MIT 6.251 - Introduction to Mathematical Programming (OCW)](https://ocw.mit.edu/courses/6-251j-introduction-to-mathematical-programming-fall-2009/): doc
- [Stanford CS261 - Optimization and Algorithmic Paradigms](https://web.stanford.edu/class/cs261/): doc
