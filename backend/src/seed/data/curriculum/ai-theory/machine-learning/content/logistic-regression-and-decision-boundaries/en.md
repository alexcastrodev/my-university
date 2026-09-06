---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Explain why linear regression's squared-error loss is a poor fit for a binary classification target, and how logistic regression adapts the linear model to fix this.
- State the sigmoid function and explain how it turns a linear score `θᵀx` into a valid probability between 0 and 1.
- Derive the logistic regression loss (log loss / cross-entropy) from maximum likelihood, and explain why it, unlike squared error, is convex for this model.
- Define the decision boundary and compute it by hand for a small worked example.

## Context & Motivation

The previous two concepts fit linear regression, first as a direct least-squares problem and then as a maximum-likelihood argument assuming Gaussian noise. This concept confronts a different kind of target: not a number, but a category — a customer either churns or doesn't, an email is spam or isn't. Applying linear regression directly to a 0/1 target is a real, common mistake: the model can predict values below 0 or above 1, which have no sensible interpretation as a probability, and squared error penalizes a confidently correct prediction (say, predicting 0.99 for a true label of 1) almost as much as an unhelpful one.

Logistic regression keeps the same linear score `θᵀx` from linear regression — reusing the exact machinery just built, including gradient descent from the previous concept — but passes that score through a new function, the sigmoid, engineered specifically to squash any real number into a valid probability.

## Core Theory

### The sigmoid function

The **sigmoid** (or logistic) function is:

```text
σ(z) = 1 / (1 + e^(−z))
```

It has three properties that matter here: `σ(z) → 0` as `z → −∞`, `σ(z) → 1` as `z → +∞`, and `σ(0) = 0.5`. Logistic regression predicts `P(y=1 | x) = σ(θᵀx)` — the same linear score `θᵀx` as linear regression, now interpreted as a probability via the sigmoid rather than as a direct numeric prediction.

### The decision boundary

A prediction is classified as `1` when `P(y=1|x) ≥ 0.5`, which (since `σ(0) = 0.5` and `σ` is strictly increasing) happens exactly when `θᵀx ≥ 0`. The set of points where `θᵀx = 0` is the **decision boundary** — a hyperplane in the feature space (a line in 2D, a plane in 3D) separating the region predicted as class 1 from the region predicted as class 0. Because this boundary is defined by a linear equation in `x`, logistic regression is a **linear classifier**: its decision boundary is always a straight line (or hyperplane), even though the *probability* it outputs varies smoothly, not in a step function.

### The log-loss objective, from maximum likelihood

Following the same maximum-likelihood pattern used for linear regression, assume each label `y⁽ⁱ⁾ ∈ {0, 1}` is drawn from a Bernoulli distribution — the same distribution already covered in `foundations/probability-statistics` — with success probability `σ(θᵀx⁽ⁱ⁾)`. The likelihood of the training data is:

```text
L(θ) = Πᵢ σ(θᵀx⁽ⁱ⁾)^(y⁽ⁱ⁾) · (1 − σ(θᵀx⁽ⁱ⁾))^(1 − y⁽ⁱ⁾)
```

Taking the negative log gives the **log loss** (also called cross-entropy loss), minimized instead of maximizing the likelihood directly:

```text
J(θ) = − Σᵢ [ y⁽ⁱ⁾ log(σ(θᵀx⁽ⁱ⁾)) + (1 − y⁽ⁱ⁾) log(1 − σ(θᵀx⁽ⁱ⁾)) ]
```

Unlike squared error applied to a sigmoid output (which is non-convex and can trap gradient descent in poor local minima), this log-loss objective is convex in `θ` — gradient descent, from the previous concept, is guaranteed to converge to the single global minimum.

## Worked Examples

### Example 1: Computing a prediction and its probability

Suppose a fitted logistic regression model for spam detection has `θᵀx = 2.0` for a given email (a positive linear score, from features like "contains the word 'free' " and "excessive exclamation marks"). Then:

```text
P(spam | x) = σ(2.0) = 1 / (1 + e^(−2.0)) = 1 / (1 + 0.1353) ≈ 0.881
```

An 88.1% predicted probability of spam — since this exceeds 0.5, the model classifies the email as spam.

### Example 2: Finding the decision boundary by hand

Suppose a fitted 2-feature model has `θ = [θ₀, θ₁, θ₂] = [−4, 1, 1]` (with `x₀ = 1` as the intercept term), so `θᵀx = −4 + x₁ + x₂`. The decision boundary is where `θᵀx = 0`:

```text
−4 + x₁ + x₂ = 0
        x₂ = 4 − x₁
```

This is a straight line with slope −1 and intercept 4. A point like `(x₁, x₂) = (1, 1)` gives `θᵀx = −4 + 1 + 1 = −2 < 0`, so it is classified as class 0; a point like `(3, 3)` gives `θᵀx = −4 + 3 + 3 = 2 > 0`, classified as class 1 — the model draws exactly this line and classifies everything on one side as 1, the other as 0.

## Common Misconceptions & Pitfalls

- **"Logistic regression is a regression model, so it predicts a continuous target like linear regression."** Despite the name (a historical artifact), logistic regression is a classification method — the continuous quantity it outputs is a probability of class membership, not the target variable itself.
- **"Because the decision boundary is linear, logistic regression can only separate linearly separable classes."** This is true of the *basic* model on the raw features, but exactly as with linear regression, engineered nonlinear features (`x₁²`, `x₁x₂`, etc.) can be added as additional inputs, letting the same linear-in-`θ` decision-boundary machinery produce curved boundaries in the original feature space.
- **"Squared error would have worked fine here too, just less elegantly."** Applying squared error directly to sigmoid outputs makes the loss non-convex, meaning gradient descent can get stuck in poor local minima — the log-loss objective is not a stylistic preference but is specifically what keeps this optimization problem convex and tractable.

## Summary

Logistic regression reuses linear regression's linear score `θᵀx`, but passes it through the sigmoid function to produce a valid probability, and classifies based on whether that probability exceeds 0.5 — equivalently, whether `θᵀx` is positive, which defines a linear decision boundary. Following the same maximum-likelihood logic used for linear regression, but assuming a Bernoulli-distributed label instead of Gaussian noise, produces the log-loss objective — convex, and fit by the same gradient descent introduced in the previous concept.

## Documentation Links

- [Stanford CS229 — Lecture Notes, Part I: Linear Regression](https://cs229.stanford.edu/main_notes.pdf) — covers logistic regression's derivation via maximum likelihood in the section following linear regression.
- [James, Witten, Hastie & Tibshirani — An Introduction to Statistical Learning](https://www.statlearning.com/) — Chapter 3 (Classification) introduces logistic regression as the standard entry point to classification.
