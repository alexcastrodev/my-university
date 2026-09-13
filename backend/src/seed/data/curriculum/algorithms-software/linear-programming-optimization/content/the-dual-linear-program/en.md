---
version: 1.0
updatedAt: 2026-09-13
---
## Learning Objectives

- Construct the dual of a standard-form (maximize, all `≤`, nonnegative variables) linear program mechanically: swap the objective direction, transpose the constraint matrix, swap the roles of the right-hand side and the objective coefficients, and flip constraint directions.
- State the general recipe as a correspondence: every primal constraint becomes a dual variable, and every primal variable becomes a dual constraint.
- Interpret a dual variable economically as a "shadow price," the marginal value of one additional unit of the resource its corresponding primal constraint limits.
- Compute a dual linear program's optimal value directly and observe, on a concrete example, that it matches the primal's optimal value exactly.
- Explain, at a conceptual level, why this exact match is not a coincidence, setting up the next concept's formal proof.

## Context & Motivation

Every linear program studied so far in this track has been approached from one direction: given an objective and some constraints, find the best assignment of the decision variables. This concept introduces a second, entirely different linear program, mechanically derived from the first, called its **dual**, that turns out to answer a related but genuinely distinct question: not "how should the resources be allocated," but "what is each limited resource actually worth." The relationship between a linear program (from here on, the **primal**) and its dual is one of the most productive ideas in all of optimization, useful for economic interpretation, for building faster algorithms (the next concept's dual simplex, and later this track's connection back to network flow), and for certifying a claimed optimal solution without re-solving the problem from scratch.

## Core Theory

### The mechanical construction

Given a primal linear program in standard form,

```
maximize   c₁x₁ + c₂x₂ + ... + cₙxₙ
subject to a₁₁x₁ + a₁₂x₂ + ... + a₁ₙxₙ ≤ b₁
           a₂₁x₁ + a₂₂x₂ + ... + a₂ₙxₙ ≤ b₂
           ...
           x₁, ..., xₙ ≥ 0
```

its **dual** is constructed by a fixed, mechanical recipe:

1. **Swap maximize for minimize.**
2. **One dual variable per primal constraint.** With `m` primal constraints, the dual has `m` variables, `y₁, ..., yₘ`, one per constraint.
3. **The dual's objective coefficients are the primal's right-hand sides.** The dual objective is `minimize b₁y₁ + b₂y₂ + ... + bₘyₘ`.
4. **One dual constraint per primal variable.** With `n` primal variables, the dual has `n` constraints, each built from that variable's *column* of coefficients across every primal constraint: `a₁ⱼy₁ + a₂ⱼy₂ + ... + aₘⱼyₘ ≥ cⱼ` for each primal variable `xⱼ`, using the original primal objective coefficient `cⱼ` as this dual constraint's right-hand side.
5. **Flip the inequality direction, and keep nonnegativity.** Primal `≤` constraints correspond to dual constraints written as `≥`, and every dual variable is itself nonnegative: `y₁, ..., yₘ ≥ 0`.

The pattern to hold onto: **rows become columns**. Every primal *constraint* (a row of the coefficient matrix) becomes a dual *variable*; every primal *variable* (a column of the coefficient matrix) becomes a dual *constraint*. The coefficient matrix itself is literally transposed between the two problems.

### The economic interpretation: shadow prices

Each dual variable `yᵢ` has a precise economic meaning: it is the **shadow price** of the `i`-th primal resource, the marginal increase in the primal's optimal objective value per one additional unit of that resource's limit `bᵢ`, holding every other limit fixed. If a factory's optimal profit is `Z` given `10` hours of some resource, and increasing that resource to `11` hours would raise optimal profit to `Z + 60`, that resource's shadow price is exactly `60`, information a manager could use directly, is it worth paying up to `$60` to acquire one more hour of that resource, a question the primal's own decision variables (units to produce) do not answer at all, but the dual's variables answer directly.

### Why the recipe produces a genuinely useful new problem, not just an algebraic curiosity

The recipe is mechanical, but what it produces is not arbitrary: the dual's constraints exist precisely to guarantee that any dual-feasible `y` gives an upper bound on every primal-feasible `x`'s objective value (a fact the next concept proves formally, as *weak duality*), which is exactly what makes a dual variable's value interpretable as a genuine per-unit worth rather than a bookkeeping artifact. Every one of this track's later concepts, the dual simplex algorithm, integer programming's relaxation bounds, and the closing connection back to network flow's max-flow min-cut theorem, relies on this same primal-dual relationship, first constructed mechanically here.

## Worked Examples

### Example 1: constructing the dual of the workshop linear program

**Problem:** Construct the dual of `maximize 70x₁ + 90x₂` subject to `x₁ + x₂ ≤ 10`, `x₁ + 3x₂ ≤ 24`, `x₁, x₂ ≥ 0` (this track's recurring example, with optimal primal solution `(3,7)` at value `840`).

**Applying the recipe.** Two primal constraints give two dual variables, `y₁` (for the first constraint) and `y₂` (for the second). The dual objective uses the primal's right-hand sides `10` and `24`: `minimize 10y₁ + 24y₂`. Two primal variables give two dual constraints, built from each variable's column of coefficients: `x₁`'s column is `(1, 1)` (its coefficient in each constraint), giving `y₁ + y₂ ≥ 70` (`70` being `x₁`'s objective coefficient); `x₂`'s column is `(1, 3)`, giving `y₁ + 3y₂ ≥ 90`. The full dual:

```
minimize   10y₁ + 24y₂
subject to  y₁ +  y₂ ≥ 70
            y₁ + 3y₂ ≥ 90
            y₁, y₂ ≥ 0
```

### Example 2: solving the dual directly and comparing it to the primal's known optimum

**Problem:** Solve the dual constructed in Example 1 by the graphical method (evaluating its vertices directly, exactly as this track's second concept did for the primal), and compare its optimal value to the primal's known optimal value of `840`.

**Vertices of the dual's feasible region:** Setting `y₂ = 0`: `y₁ ≥ 70` and `y₁ ≥ 90`, so the binding requirement is `y₁ = 90`, giving vertex `(90, 0)`. Setting `y₁ = 0`: `y₂ ≥ 70` and `y₂ ≥ 30`, so `y₂ = 70`, giving vertex `(0, 70)`. The intersection of the two constraint lines: `y₁+y₂=70` and `y₁+3y₂=90`; subtracting gives `2y₂=20`, so `y₂=10`, `y₁=60`, giving vertex `(60, 10)`.

**Evaluating the dual objective:** At `(90,0)`: `10(90)+24(0)=900`. At `(0,70)`: `10(0)+24(70)=1680`. At `(60,10)`: `10(60)+24(10)=600+240=840`.

**Comparison:** The dual's minimum, `840` at `(y₁,y₂)=(60,10)`, matches the primal's maximum, `840` at `(x₁,x₂)=(3,7)`, exactly. This is not a coincidence specific to this example, the next concept proves this equality (called *strong duality*) holds for every linear program with an optimal solution, and it is exactly why a dual variable's value can be trusted as a genuine shadow price: `y₁=60` says one additional unit of the first resource (the constraint `x₁+x₂≤10`) is worth exactly `$60` in additional optimal profit, and `y₂=10` says one additional unit of the second resource is worth exactly `$10`.

## Common Misconceptions & Pitfalls

- **"The dual is just a renamed copy of the primal, solving the same problem."** Example 1's dual has different variables (`y₁, y₂`, not `x₁, x₂`), a different objective (minimizing resource cost, not maximizing production profit), and a different feasible region entirely (Example 2's dual vertices `(90,0)`, `(0,70)`, `(60,10)` bear no resemblance to the primal's vertices `(0,0)`, `(10,0)`, `(0,8)`, `(3,7)` from earlier concepts); only the optimal *value*, not the optimal *point*, is shared between them.
- **"Constructing the dual requires re-deriving it from economic reasoning about shadow prices each time."** The construction in Core Theory is a fixed, purely mechanical recipe, swap max/min, transpose the coefficient matrix, swap objective coefficients with right-hand sides, flip inequality directions, that can be applied directly to any standard-form linear program without needing to reason about resources or prices at all; the economic interpretation is a way to *understand* the result, not a step required to *construct* it.
- **"A primal constraint with a large right-hand side (a generous resource limit) always has a large shadow price."** The shadow price reflects how much the *optimal value* would improve from one more unit of that specific resource, which depends on how tightly that resource's constraint actually binds the optimum, not on the size of the limit itself; a very generously large limit that isn't actually a bottleneck typically has a shadow price of exactly `0` (its constraint isn't tight at the optimum at all), a connection the next concept's complementary slackness result makes precise.
- **"Every primal variable corresponds to exactly one dual variable, mirroring the primal one for one."** The correspondence runs the other way: primal *constraints* map to dual *variables* (two primal constraints gave exactly two dual variables `y₁,y₂` in Example 1), while primal *variables* map to dual *constraints* (the primal's two variables `x₁,x₂` produced the dual's two constraints, not two more dual variables).

## Summary

Every standard-form linear program has a mechanically constructed dual: maximize becomes minimize, the primal's right-hand sides become the dual's objective coefficients, the primal's objective coefficients become the dual's right-hand sides, the coefficient matrix is transposed, and inequality directions flip, with one dual variable per primal constraint and one dual constraint per primal variable. Each dual variable has a direct economic reading as a shadow price, the marginal value of one more unit of its corresponding primal resource. Example 1 and 2's fully worked construction and solution show the dual's optimal value, `840`, exactly matching the primal's own optimal value, the same number arrived at from a completely different feasible region and a completely different set of variables, a striking coincidence on the surface that the next concept proves is never actually a coincidence at all: the weak and strong duality theorems, and the complementary slackness relationship that ties a primal constraint's tightness directly to its dual variable's value.

## Documentation Links

- [MIT 6.251 - Introduction to Mathematical Programming (OCW)](https://ocw.mit.edu/courses/6-251j-introduction-to-mathematical-programming-fall-2009/): doc
- [Stanford CS261 - Optimization and Algorithmic Paradigms](https://web.stanford.edu/class/cs261/): doc
