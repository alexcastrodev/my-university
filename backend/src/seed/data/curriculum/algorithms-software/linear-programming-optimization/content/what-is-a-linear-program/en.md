---
version: 1.0
updatedAt: 2026-09-13
---
## Learning Objectives

- Define a linear program precisely: a linear objective function to optimize, subject to a system of linear constraints (equalities and/or inequalities) and, typically, nonnegativity restrictions on the variables.
- Translate a plain-language resource-allocation problem into a linear program's algebraic form.
- Convert a linear program into standard form (maximize, all constraints as ≤, all variables nonnegative) using the mechanical transformations that always work.
- Distinguish a linear program's decision variables, objective function, and constraints from one another, and explain why each must be *linear* specifically.
- Recognize why this discipline dedicates an entire track to linear programs, given how many real allocation and scheduling problems reduce to exactly this form.

## Context & Motivation

Every algorithmic paradigm covered elsewhere in this curriculum, divide-and-conquer, greedy, dynamic programming, network flow, is a *technique* aimed at a specific *shape* of problem. Linear programming is different in kind: it is a modeling *language*, general enough to express an enormous range of real allocation, scheduling, and resource-planning problems, paired with a general-purpose solution method (the simplex algorithm, this track's next several concepts) that does not need to be reinvented for each new problem shape the way a bespoke greedy or dynamic-programming algorithm does. A factory deciding how many units of each product to manufacture given limited raw materials and labor hours, an airline deciding how to allocate seats across fare classes, a diet planner deciding how much of each food to buy to hit nutritional targets at minimum cost, all of these are, underneath their specific vocabulary, the exact same mathematical object: optimize a linear function of some decision variables, subject to linear constraints on those variables. This concept establishes that object precisely, and shows how to translate a plain-language problem into it.

## Core Theory

### The three ingredients of a linear program

A **linear program (LP)** consists of exactly three pieces, all built from a set of **decision variables** `x₁, x₂, ..., xₙ`, the quantities the problem asks to determine:

1. **A linear objective function** to maximize or minimize: `c₁x₁ + c₂x₂ + ... + cₙxₙ`, for some fixed coefficients `c₁, ..., cₙ`.
2. **A set of linear constraints**: each one a linear expression in the `xᵢ` compared to a constant via `≤`, `≥`, or `=`.
3. **Nonnegativity restrictions**, typically `xᵢ ≥ 0` for every variable, reflecting that most real decision variables (units produced, hours worked, resources allocated) cannot meaningfully be negative.

The word **linear** is doing real, restrictive work here, not just describing "a formula": every term in the objective and every constraint must be a constant times a variable, added together, nothing else. `3x₁ + 2x₂` is linear; `x₁ · x₂` (a product of two variables), `x₁²`, and `max(x₁, x₂)` are all forbidden, this is exactly what separates linear programming from the far harder general world of nonlinear optimization, and exactly what the simplex method (built over the next few concepts) is able to exploit for a genuinely efficient solution method in practice.

### Translating a word problem into a linear program

**Problem:** A furniture workshop makes tables and chairs. Each table requires 4 hours of carpentry and 2 hours of finishing, and sells for a profit of $70. Each chair requires 2 hours of carpentry and 1 hour of finishing, and sells for a profit of $30. The workshop has 40 hours of carpentry time and 20 hours of finishing time available this week. How many tables and chairs should it make to maximize profit?

**Translation.** Let `x₁` = number of tables, `x₂` = number of chairs (the decision variables). The objective is to maximize profit: `maximize 70x₁ + 30x₂`. Carpentry time is limited: `4x₁ + 2x₂ ≤ 40`. Finishing time is limited: `2x₁ + x₂ ≤ 20`. Neither quantity can be negative: `x₁ ≥ 0, x₂ ≥ 0`. Put together:

```
maximize   70x₁ + 30x₂
subject to  4x₁ + 2x₂ ≤ 40
            2x₁ +  x₂ ≤ 20
            x₁, x₂ ≥ 0
```

This is a complete linear program: a linear objective, two linear inequality constraints, and nonnegativity.

### Standard form

Different sources state constraints in different directions (`≤`, `≥`, `=`) and ask for either maximization or minimization; to have one canonical shape the simplex method (the next concept) can be built against uniformly, a linear program is put into **standard form**: maximize an objective, subject to every constraint expressed as `≤`, with every variable nonnegative. Three mechanical rules get any LP into this shape:

- **Minimize → maximize.** `minimize z` is equivalent to `maximize -z` (solve the negated objective, then negate the optimal value back at the end).
- **`≥` → `≤`.** Multiply both sides of a `≥` constraint by `-1`, flipping the inequality: `2x₁ + x₂ ≥ 8` becomes `-2x₁ - x₂ ≤ -8`.
- **`=` → two `≤` constraints.** An equality `aᵀx = b` is equivalent to the pair `aᵀx ≤ b` and `aᵀx ≥ b` (the second then converted to `≤` form by the previous rule), since a value satisfies the equality exactly when it satisfies both inequalities simultaneously.

These three rules are purely mechanical and always applicable, so *any* linear program, regardless of how its constraints happen to be written, can be rewritten into standard form without changing its actual feasible region or its optimal value at all, only the surface presentation.

## Worked Examples

### Example 1: translating a diet-planning problem

**Problem:** A meal plan needs at least 20 units of protein and at least 15 units of vitamin C per day, using two foods. Food A provides 4 units of protein and 1 unit of vitamin C per serving, at a cost of $2 per serving. Food B provides 2 units of protein and 3 units of vitamin C per serving, at a cost of $3 per serving. Minimize cost while meeting both nutritional minimums.

**Translation.** Let `x₁` = servings of Food A, `x₂` = servings of Food B.

```
minimize   2x₁ + 3x₂
subject to 4x₁ + 2x₂ ≥ 20   (protein)
            x₁ + 3x₂ ≥ 15   (vitamin C)
           x₁, x₂ ≥ 0
```

### Example 2: converting Example 1 into standard form

**Problem:** Convert Example 1's linear program into standard form (maximize, all constraints as `≤`).

**Step 1, minimize → maximize:** `minimize 2x₁ + 3x₂` becomes `maximize -2x₁ - 3x₂` (the optimal cost, once found, is recovered by negating the maximized value back).

**Step 2, `≥` → `≤`:** `4x₁ + 2x₂ ≥ 20` becomes `-4x₁ - 2x₂ ≤ -20`. `x₁ + 3x₂ ≥ 15` becomes `-x₁ - 3x₂ ≤ -15`.

**Standard form:**

```
maximize   -2x₁ - 3x₂
subject to -4x₁ - 2x₂ ≤ -20
            -x₁ - 3x₂ ≤ -15
             x₁, x₂ ≥ 0
```

This represents the exact same underlying problem as Example 1, only rewritten so every constraint is a `≤` and the objective is a maximization, exactly the uniform shape the next concept's simplex method is built to consume directly.

## Common Misconceptions & Pitfalls

- **"Any optimization problem with an objective and some constraints is a linear program."** Linearity is a strict, checkable requirement on every single term: `x₁ · x₂`, `1/x₁`, `x₁²`, and `|x₁|` are all common expressions that immediately disqualify a formulation from being an LP; a problem with any such term needs a different (generally much harder) class of optimization technique entirely.
- **"Converting `≥` to `≤` changes the problem's actual answer."** The conversion `aᵀx ≥ b ⟺ -aᵀx ≤ -b` is an exact algebraic equivalence, not an approximation, both express identically the same set of feasible `x` values; standard form is a change of presentation, never a change of the underlying problem or its optimal solution.
- **"Nonnegativity (`xᵢ ≥ 0`) is just one constraint among many, with no special status."** It is treated separately from the general constraint list specifically because the simplex method (the next concept) is built to exploit it directly as a structural assumption, not as just another row in the constraint system; a variable that genuinely needs to be negative requires an explicit substitution (splitting it into a difference of two nonnegative variables) before standard form applies.
- **"The workshop example's answer is obviously 10 tables and 0 chairs, since tables are more profitable per unit."** Profit per unit alone ignores the *relative* resource cost of each product against the *specific* binding constraints; the actual optimal mix (found by the next several concepts' methods, not by inspection) depends on how the two constraints interact, and greedily maximizing the higher-profit item first, a tempting but unjustified shortcut, is exactly the kind of reasoning linear programming replaces with a method that is actually guaranteed correct.

## Summary

A linear program is built from decision variables, a linear objective function to maximize or minimize, a set of linear constraints, and (typically) nonnegativity restrictions, with "linear" strictly excluding products of variables, powers, and similar nonlinear terms. Any real allocation or scheduling problem whose costs and limits combine additively translates directly into this form, as the furniture-workshop and diet-planning examples show. Three mechanical rules, negate to convert minimize into maximize, flip `≥` into `≤` by negation, split `=` into a pair of `≤` constraints, put any linear program into standard form without altering its actual feasible region or optimal value, giving the uniform shape every method in the rest of this track is built to consume. The next concept turns to what a linear program's feasible region actually looks like geometrically, and why that geometry is the key to solving one.

## Documentation Links

- [MIT 6.251 - Introduction to Mathematical Programming (OCW)](https://ocw.mit.edu/courses/6-251j-introduction-to-mathematical-programming-fall-2009/): doc
- [Stanford CS261 - Optimization and Algorithmic Paradigms](https://web.stanford.edu/class/cs261/): doc
