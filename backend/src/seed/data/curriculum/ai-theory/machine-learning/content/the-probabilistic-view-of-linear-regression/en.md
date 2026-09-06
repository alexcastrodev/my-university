---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- State the probabilistic assumption behind linear regression: that observed `y` values equal `θᵀx` plus independent, normally distributed noise.
- Derive the log-likelihood of the training data under this assumption, and show that maximizing it is algebraically identical to minimizing squared error.
- Explain why this derivation justifies squared error as *the* natural loss for linear regression, rather than an arbitrary convenient choice.
- Connect this argument to maximum likelihood estimation as a general principle for fitting models to data.

## Context & Motivation

The previous concept fit linear regression by directly minimizing squared error, treating that choice as a given. This concept asks the deeper question: why squared error, and not some other measure of fit — absolute error, say? The answer comes from making an explicit probabilistic assumption about how the data was generated, and showing that squared error is not an arbitrary convention but the loss function implied by the single most natural noise model: independent Gaussian noise around a true linear relationship, exactly the normal distribution already covered in this curriculum's probability discipline.

This is the first appearance in this discipline of a pattern that recurs throughout machine learning: **maximum likelihood estimation** — choosing model parameters to make the observed data as probable as possible under an assumed generative model. Linear regression is the cleanest possible illustration of this principle, because the resulting optimization problem turns out to be one already solved.

## Core Theory

### The generative assumption

Assume each observed `y⁽ⁱ⁾` is generated as:

```text
y⁽ⁱ⁾ = θᵀx⁽ⁱ⁾ + ε⁽ⁱ⁾,      ε⁽ⁱ⁾ ~ N(0, σ²), independently
```

That is: there is a true underlying linear relationship `θᵀx`, and each observation deviates from it by independent noise drawn from a normal distribution centered at zero with some fixed variance `σ²` — the same normal distribution whose bell-curve shape and parameters were covered in `foundations/probability-statistics`.

### The likelihood of the data

Under this assumption, `y⁽ⁱ⁾` given `x⁽ⁱ⁾` and `θ` is itself normally distributed with mean `θᵀx⁽ⁱ⁾` and variance `σ²`. The probability density of a single observation is:

```text
p(y⁽ⁱ⁾ | x⁽ⁱ⁾; θ) = (1 / √(2πσ²)) · exp( − (y⁽ⁱ⁾ − θᵀx⁽ⁱ⁾)² / (2σ²) )
```

Assuming the `N` training examples are independent, the **likelihood** of the entire dataset is the product of these individual densities:

```text
L(θ) = Πᵢ p(y⁽ⁱ⁾ | x⁽ⁱ⁾; θ)
```

### Maximizing log-likelihood is minimizing squared error

Taking the logarithm of `L(θ)` (a strictly increasing function, so maximizing `log L(θ)` maximizes `L(θ)` too) turns the product into a sum:

```text
log L(θ) = Σᵢ [ −½log(2πσ²) − (y⁽ⁱ⁾ − θᵀx⁽ⁱ⁾)² / (2σ²) ]
         = N·(−½log(2πσ²)) − (1/2σ²) · Σᵢ (y⁽ⁱ⁾ − θᵀx⁽ⁱ⁾)²
```

The first term does not depend on `θ` at all. Maximizing `log L(θ)` over `θ` is therefore equivalent to minimizing `Σᵢ (y⁽ⁱ⁾ − θᵀx⁽ⁱ⁾)²` — exactly the squared-error loss `J(θ)` from the previous concept. This is the precise sense in which squared error is not an arbitrary convention: it is the loss implied by assuming Gaussian noise, derived from the single most standard probabilistic model of measurement error.

## Worked Examples

### Example 1: The full algebraic reduction, step by step

Starting from the log-likelihood derived above, with `σ²` treated as fixed:

```text
maximize:  log L(θ) = C − (1/2σ²) · Σᵢ (y⁽ⁱ⁾ − θᵀx⁽ⁱ⁾)²        (C constant in θ)

⟺ maximize:  − Σᵢ (y⁽ⁱ⁾ − θᵀx⁽ⁱ⁾)²      (dropping the positive constant 1/2σ²)

⟺ minimize:  Σᵢ (y⁽ⁱ⁾ − θᵀx⁽ⁱ⁾)²       (flipping the sign flips max to min)
```

The last line is exactly `J(θ)` from `linear-regression-as-least-squares` — the derivation is a direct, mechanical equivalence, not an analogy.

### Example 2: Why the noise variance σ² doesn't affect which θ is chosen

Notice in the derivation above that `σ²` appears only as a positive scaling factor `1/(2σ²)` multiplying the sum of squared errors — it never changes *which* `θ` minimizes the expression, only how sharply the likelihood penalizes deviation. This means the maximum-likelihood estimate of `θ` is identical whether the assumed noise is small (`σ² = 0.1`) or large (`σ² = 10`) — a real, checkable consequence of the algebra, not a coincidence, and the reason `θ` can be estimated by least squares without ever needing to know the true noise variance in advance.

## Common Misconceptions & Pitfalls

- **"Assuming Gaussian noise is just a convenient trick with no real justification."** It is a specific, falsifiable modeling assumption — if the true noise is heavily skewed or has extreme outliers, a different noise model (and correspondingly different loss function, such as absolute error under Laplace-distributed noise) would be more appropriate. Squared error's dominance in practice comes from Gaussian noise being an excellent approximation for a great many real measurement processes, not from having no alternative.
- **"Maximum likelihood and least squares are two different techniques that happen to agree here."** For linear regression under Gaussian noise, they are not merely in agreement — they are the exact same optimization problem, shown algebraically identical above.
- **"This derivation only matters for regression."** The maximum-likelihood principle used here — choose parameters to make the observed data most probable under an assumed model — reappears later in this discipline in a different guise for the generative classifiers (Gaussian Discriminant Analysis and Naive Bayes), which fit their class-conditional distributions by the same principle.

## Summary

Assuming that observed targets equal a true linear function plus independent, normally distributed noise, and choosing `θ` to maximize the likelihood of the observed training data under that assumption, is algebraically identical to minimizing squared error — the same objective already solved via linear algebra. This gives squared error a real probabilistic justification rather than treating it as an arbitrary convenience, and introduces maximum likelihood estimation, a principle this discipline returns to when it reaches generative classifiers.

## Documentation Links

- [Stanford CS229 — Lecture Notes, Part I: Linear Regression](https://cs229.stanford.edu/main_notes.pdf) — derives this exact probabilistic interpretation of least squares.
- [Caltech CS 156 — Learning From Data, Lecture 3: The Linear Model I](https://work.caltech.edu/telecourse.html) — presents the linear model together with its probabilistic motivation.
