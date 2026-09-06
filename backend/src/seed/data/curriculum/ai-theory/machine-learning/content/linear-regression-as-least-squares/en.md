---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- State the linear regression model, `ŷ = θᵀx`, and the squared-error loss it minimizes over a training set.
- Explain, precisely, why fitting a linear regression model is exactly the least-squares problem already solved in this curriculum's linear algebra discipline — same equation, same normal-equation solution.
- Compute the closed-form least-squares solution `θ = (XᵀX)⁻¹Xᵀy` on a small worked dataset.
- Explain why a closed-form solution exists for linear regression specifically, and why most later models in this discipline do not have one and require gradient descent instead.

## Context & Motivation

This discipline's very first supervised learning model requires no new mathematics at all. `foundations/mathematics-for-computing` already built, in full and from scratch, the exact tool this concept needs: `least-squares-via-linear-algebra`, the capstone of that discipline, derived the best-fit line through data with no exact solution — twice, once geometrically (as a projection onto a column space) and once via optimization (setting a gradient to zero) — and showed both routes arrive at the identical normal equation. Linear regression, as a machine learning model, is that exact problem, reframed with a new vocabulary: the "best-fit line" becomes a "trained model," and the promise that it generalizes to new `x` values it has never seen is the new claim this discipline adds on top.

Kurose-Ross-style top-down courses tend to introduce applications before mechanism; CS229 and Caltech's course both do the reverse for regression — mechanism first, since the mechanism here is genuinely reused, not new. This concept follows that same order: restate the already-proven linear algebra result, then frame it explicitly as a predictive model.

## Core Theory

### The model and the loss function

A linear regression model predicts `ŷ = θᵀx` for an input feature vector `x` (with a constant `1` appended to `x` so `θ` includes an intercept term) and parameter vector `θ`. Given `N` training examples `(x⁽ⁱ⁾, y⁽ⁱ⁾)`, the model is fit by choosing `θ` to minimize the sum of squared errors:

```text
J(θ) = Σᵢ (θᵀx⁽ⁱ⁾ − y⁽ⁱ⁾)²
```

Stacking every training example's `x⁽ⁱ⁾` as a row of a matrix `X` and every `y⁽ⁱ⁾` into a vector `y`, this is exactly `J(θ) = ‖Xθ − y‖²` — the identical least-squares objective already minimized in `least-squares-via-linear-algebra`.

### Reusing the already-proven normal equation

That earlier concept proved, via both a geometric projection argument and by setting the gradient of `‖Xθ − y‖²` to zero, that the minimizing `θ` satisfies the **normal equation**:

```text
XᵀXθ = Xᵀy
```

which, whenever `XᵀX` is invertible, has the closed-form solution `θ = (XᵀX)⁻¹Xᵀy`. Nothing here is re-derived; it is the direct application of an already-proven result to a new setting — prediction on data not yet seen, rather than the purely descriptive "best-fit line through a fixed dataset" framing of the earlier discipline.

### Why a closed form exists here, but rarely later

Linear regression's loss function `‖Xθ − y‖²` is a smooth, quadratic (and therefore convex) function of `θ`, which is exactly why setting its gradient to zero yields a single, globally-optimal linear equation to solve. Almost every other model in this discipline — logistic regression, neural networks — has a loss function that is not this simple, and no closed-form solution exists; those models are fit instead by gradient descent (the next concept), an iterative method that works for a much broader class of loss functions but does not, in general, land on the exact answer in one step.

## Worked Examples

### Example 1: A tiny closed-form fit

Fit `ŷ = θ₀ + θ₁x` to four points: `(1, 3), (2, 5), (3, 7), (4, 8)`.

```text
X = [[1, 1], [1, 2], [1, 3], [1, 4]]   (first column is the intercept term)
y = [3, 5, 7, 8]

XᵀX = [[4, 10], [10, 30]]
Xᵀy = [23, 71]

Solving XᵀXθ = Xᵀy:
θ₀ ≈ 0.5,  θ₁ ≈ 2.0

Fitted line: ŷ = 0.5 + 2.0x
```

Checking: at `x=1`, `ŷ = 2.5` (actual 3); at `x=4`, `ŷ = 8.5` (actual 8) — a reasonable fit, with small residual errors exactly as expected from data with no perfect linear relationship.

### Example 2: Predicting on unseen input

Using the fitted line `ŷ = 0.5 + 2.0x` from Example 1, the model can now predict for `x = 5`, a value that was never in the training data: `ŷ = 0.5 + 2.0(5) = 10.5`. This is the entire point of the machine-learning framing added on top of the pre-existing linear algebra result — using the fitted parameters to generalize to new, unseen inputs, not merely to describe the training points themselves.

## Common Misconceptions & Pitfalls

- **"Linear regression can only fit straight lines."** The model is linear in its *parameters* `θ`, not necessarily in the original input — features like `x²` or `log(x)` can be added as additional columns of `X`, letting the same linear-in-`θ` machinery fit curves, at the cost of needing more care about overfitting (covered later in this discipline's model-complexity cluster).
- **"The normal equation always works."** It requires `XᵀX` to be invertible, which fails when features are perfectly collinear or when there are more features than examples — in practice, this is handled by regularization (a later concept) or by using gradient descent instead, which does not require inverting anything.
- **"This is a completely new algorithm I need to learn from scratch."** It is not — every step above is a direct restatement of `least-squares-via-linear-algebra`, already proven in this curriculum's linear algebra discipline; the only genuinely new idea here is the predictive framing.

## Summary

Linear regression fits `ŷ = θᵀx` by minimizing squared error over a training set, which is exactly the least-squares problem `‖Xθ − y‖²` already solved in full in `foundations/mathematics-for-computing`, with the identical closed-form solution `θ = (XᵀX)⁻¹Xᵀy` derived from the normal equation. The genuinely new content this discipline adds is the predictive framing — using the fitted parameters on inputs never seen during training — and the observation that this closed form is a special convenience of linear regression's convex, quadratic loss, not something available for most models covered later.

## Documentation Links

- [Stanford CS229 — Lecture Notes, Part I: Linear Regression](https://cs229.stanford.edu/main_notes.pdf) — the real lecture notes deriving this same model and normal equation.
- [James, Witten, Hastie & Tibshirani — An Introduction to Statistical Learning](https://www.statlearning.com/) — Chapter 2 (Regression) frames linear regression as the entry point to statistical learning, the same role it plays here.
