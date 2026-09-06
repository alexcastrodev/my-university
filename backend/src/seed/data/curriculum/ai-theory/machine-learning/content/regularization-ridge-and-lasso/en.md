---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Explain the general idea of regularization: constraining a model's effective capacity by penalizing large parameter values, without changing the model's raw parameter count.
- State the ridge (L2) and lasso (L1) penalty terms and their combined objective functions.
- Explain the geometric reason lasso can shrink coefficients to exactly zero while ridge cannot, using each penalty's constraint-region shape.
- Trace, on a small worked example, how increasing the regularization strength changes fitted coefficients.

## Context & Motivation

The previous two concepts established that overfitting comes from a model class with too much effective capacity relative to the available data, measured rigorously by the VC dimension. Regularization is the most direct practical countermeasure: instead of changing the model's structural form (fewer features, a lower-degree polynomial), it constrains how large the fitted parameters are allowed to grow, by adding a penalty term to the loss function that grows with the size of the parameter vector. This reduces a model's *effective* capacity to overfit without discarding any features outright — or, in lasso's case, effectively discards the least useful ones automatically.

## Core Theory

### Ridge regression (L2 penalty)

**Ridge regression** adds a penalty proportional to the sum of squared coefficients to the ordinary least-squares loss:

```text
J_ridge(θ) = ‖Xθ − y‖² + λ · Σⱼ θⱼ²
```

where `λ ≥ 0` is a hyperparameter controlling the penalty's strength: `λ = 0` recovers ordinary least squares exactly, and larger `λ` shrinks every coefficient toward zero more aggressively, though rarely to exactly zero.

### Lasso regression (L1 penalty)

**Lasso** replaces the squared-coefficient penalty with the sum of absolute values:

```text
J_lasso(θ) = ‖Xθ − y‖² + λ · Σⱼ |θⱼ|
```

The mathematical form looks similar, but the behavior differs sharply: lasso can shrink some coefficients to *exactly* zero, effectively performing automatic feature selection by discarding features the model doesn't need — ridge, by contrast, shrinks every coefficient toward zero but essentially never sets one to exactly zero.

### The geometric reason for the difference

Both penalized objectives can be understood as ordinary least squares subject to a constraint region: ridge constrains `θ` to lie inside a circle (or a sphere in higher dimensions), while lasso constrains `θ` to lie inside a diamond (a shape with sharp corners on the axes). The least-squares solution, when constrained to lie within either region, tends to land at the point in the region closest to the unconstrained optimum. Because the diamond's corners lie exactly on the coordinate axes (where one coefficient is zero), the constrained optimum frequently lands precisely at a corner — setting that coefficient to exactly zero. The circle has no corners, so the constrained optimum can land anywhere on its boundary, essentially never exactly on an axis, which is exactly why ridge shrinks but does not zero out coefficients.

## Worked Examples

### Example 1: Ridge shrinking coefficients as λ increases

Suppose ordinary least squares (λ = 0) fits `θ = [θ₁, θ₂] = [5.0, 3.0]` for a two-feature regression. Increasing the ridge penalty:

```text
λ = 0:    θ = [5.00, 3.00]    (no shrinkage — ordinary least squares)
λ = 1:    θ = [4.20, 2.55]    (both coefficients shrink toward 0, neither reaches it)
λ = 10:   θ = [2.10, 1.35]    (further shrinkage, still both nonzero)
λ = 100:  θ = [0.45, 0.30]    (heavy shrinkage — both coefficients nearly, but not exactly, zero)
```

Both coefficients shrink together, proportionally, as `λ` grows — but neither is driven to precisely zero even at very large `λ`, consistent with ridge's circular constraint region having no corners.

### Example 2: Lasso zeroing out a coefficient

Fitting the same data with lasso instead, at a comparable penalty strength:

```text
λ = 0:    θ = [5.00, 3.00]    (ordinary least squares)
λ = 1:    θ = [4.10, 2.30]
λ = 5:    θ = [2.60, 0.90]
λ = 8:    θ = [1.20, 0.00]    ← θ₂ has been driven to exactly zero
λ = 12:   θ = [0.00, 0.00]    ← both coefficients now exactly zero
```

At `λ = 8`, lasso has effectively dropped the second feature from the model entirely — its coefficient is exactly zero, not merely small — a real, computable feature-selection effect that ridge, applied to the same data, would not produce at any finite `λ`.

## Common Misconceptions & Pitfalls

- **"Regularization always improves a model."** Regularization trades some increase in bias for a decrease in variance — exactly the bias-variance tradeoff from earlier in this discipline. Too large a regularization strength can push a model to underfit, shrinking useful coefficients toward zero along with unhelpful ones.
- **"Lasso is strictly better than ridge because it performs feature selection."** Lasso's feature selection is useful specifically when many features are truly irrelevant, but when features are highly correlated with each other, lasso tends to arbitrarily pick one and zero out the others, while ridge shrinks correlated features together more evenly — the better choice genuinely depends on the structure of the actual features.
- **"The regularization strength λ should be chosen to minimize training error."** Minimizing training error with respect to `λ` always favors `λ = 0` (no regularization), since regularization exists specifically to sacrifice some training fit for better generalization — `λ` must instead be chosen using a held-out validation set or cross-validation (the next concept in this discipline), never the training set alone.

## Summary

Regularization constrains model capacity by adding a penalty on coefficient size to the loss function, directly countering the overfitting risk quantified by the VC dimension. Ridge regression's squared-coefficient penalty shrinks all coefficients smoothly toward zero without eliminating any; lasso's absolute-value penalty can drive some coefficients to exactly zero, performing automatic feature selection — a real geometric consequence of the sharp corners in lasso's diamond-shaped constraint region versus ridge's cornerless circular one. Choosing the regularization strength correctly requires a held-out validation set, never the training data the model was fit to.

## Documentation Links

- [James, Witten, Hastie & Tibshirani — An Introduction to Statistical Learning](https://www.statlearning.com/) — Chapter 5 (Linear Model Selection and Regularization) derives ridge and lasso with the same geometric constraint-region argument used here.
- [Caltech CS 156 — Learning From Data, Lecture 12: Regularization](https://work.caltech.edu/telecourse.html) — the real lecture motivating regularization directly from the overfitting concern of the previous concept.
