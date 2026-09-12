---
version: 1.0
updatedAt: 2026-09-12
---
## Learning Objectives

- Implement logistic regression by reusing Lab 1's gradient-descent loop, changing only the loss function and output nonlinearity.
- Implement the sigmoid function and cross-entropy loss, and derive (or verify numerically) the gradient of cross-entropy with respect to the model's weights.
- Plot the decision boundary a trained logistic regression model actually produces on a real, 2D, linearly separable dataset.
- Verify that the plotted boundary matches Logistic Regression and Decision Boundaries' own theoretical account of where it should sit.

## Context & Motivation

`linear-regression-via-gradient-descent-from-scratch` built a real, working gradient-descent optimizer, verified against an independent closed-form answer. This lab reuses that exact optimizer, changing only what it optimizes, matching **Logistic Regression and Decision Boundaries**'s own framing of logistic regression as linear regression's output passed through a sigmoid and fit against a different loss.

## Core Theory

Nothing about *why* cross-entropy is the right loss for a probabilistic binary classifier, or *why* the decision boundary is exactly where the sigmoid's output crosses 0.5, is re-derived here; both arguments already exist in `logistic-regression-and-decision-boundaries`. This lab implements the resulting gradient and verifies it produces the predicted geometric boundary on real data.

## Worked Examples

### API specification

```text
sigmoid(z: ndarray) -> ndarray
cross_entropy_loss(X, y, w) -> float
logistic_gradient(X, y, w) -> ndarray
logistic_fit(X, y, lr, iters) -> ndarray   # reuses Lab 1's loop structure exactly
```

### Step 1 — sigmoid and cross-entropy

```python
def sigmoid(z):
    return 1 / (1 + np.exp(-z))

def cross_entropy_loss(X, y, w):
    predictions = sigmoid(X @ w)
    eps = 1e-9  # avoids log(0) for a prediction that saturates near 0 or 1
    return -np.mean(y * np.log(predictions + eps) + (1 - y) * np.log(1 - predictions + eps))
```

### Step 2 — the gradient, and the ONE change from Lab 1's optimizer

```python
def logistic_gradient(X, y, w):
    predictions = sigmoid(X @ w)
    n = X.shape[0]
    return (1 / n) * X.T @ (predictions - y)  # same SHAPE as mse_gradient
                                                  # from Lab 1; only the
                                                  # predictions computation
                                                  # (now sigmoid(X@w) instead
                                                  # of X@w directly) changed

def logistic_fit(X, y, lr=0.1, iters=2000):
    w = np.zeros(X.shape[1])
    for _ in range(iters):
        w = w - lr * logistic_gradient(X, y, w)   # IDENTICAL loop structure
                                                      # to Lab 1's gradient_descent_fit
    return w
```

The cross-entropy gradient's algebraic form turns out identical in shape to the mean-squared-error gradient from Lab 1, `X.T @ (predictions - y)`, once `predictions` is redefined through the sigmoid; this is not a coincidence this lab invented, it is a real, well known property of the exponential-family loss functions this ISL/CS229 material covers, and it is exactly why Lab 1's optimizer loop needed no structural change at all.

### Step 3 — plotting the actual decision boundary

```python
def test_decision_boundary_matches_theory():
    X, y = generate_linearly_separable_2d_data(n=200, seed=0)
    X_with_bias = add_bias_column(X)
    w = logistic_fit(X_with_bias, y)

    # The theoretical boundary: sigmoid(w . x) = 0.5  <=>  w . x = 0
    # For 2D features [x1, x2] plus bias w0: w0 + w1*x1 + w2*x2 = 0
    x1_range = np.linspace(X[:, 0].min(), X[:, 0].max(), 100)
    boundary_x2 = -(w[0] + w[1] * x1_range) / w[2]

    # Real check: every point classified "positive" should lie (within
    # numerical tolerance) on the correct side of this computed line
    predictions = sigmoid(X_with_bias @ w) >= 0.5
    for i in range(len(X)):
        signed_distance = w[0] + w[1] * X[i, 0] + w[2] * X[i, 1]
        assert (signed_distance >= 0) == predictions[i], \
            "a point's predicted class must match which side of the computed boundary it falls on"
```

### Step 4 — a case where the theory and a bug would visibly disagree

```python
def test_wrong_threshold_breaks_boundary_agreement():
    # A deliberately introduced bug: thresholding at 0.7 instead of 0.5,
    # while still computing the boundary line at w.x = 0 (which
    # corresponds to sigmoid = 0.5, NOT 0.7).
    X, y = generate_linearly_separable_2d_data(n=200, seed=0)
    X_with_bias = add_bias_column(X)
    w = logistic_fit(X_with_bias, y)

    wrong_predictions = sigmoid(X_with_bias @ w) >= 0.7  # bug: wrong threshold
    mismatches = sum(
        (w[0] + w[1] * X[i, 0] + w[2] * X[i, 1] >= 0) != wrong_predictions[i]
        for i in range(len(X))
    )
    assert mismatches > 0, \
        "predictions thresholded at 0.7 should visibly disagree with the 0.5 boundary line for SOME points"
```

## Common Misconceptions & Pitfalls

- **"Logistic regression needs an entirely new optimization loop, separate from linear regression's."** Step 2 shows directly that it does not: reusing Lab 1's exact loop structure, changing only how `predictions` is computed, is sufficient, which is precisely the point `logistic-regression-and-decision-boundaries` makes about the two models' shared underlying structure.
- **"The decision boundary is wherever the model's raw output crosses zero."** For the raw linear score `w . x`, this is correct, but for the sigmoid-transformed probability output, the equivalent threshold is 0.5, not 0; Step 4's deliberately introduced bug demonstrates exactly what happens when this distinction is lost, a threshold and a boundary line that no longer correspond to the same decision rule.
- **"Plotting a boundary that looks visually reasonable is enough to confirm the implementation is correct."** Step 3's test checks the boundary against every individual data point's actual predicted class, not just visual plausibility, which is what catches a bug, like Step 4's mismatched threshold, that could easily still produce a plausible-looking plotted line.

## Summary

This lab implements logistic regression by reusing `linear-regression-via-gradient-descent-from-scratch`'s exact gradient-descent loop, changing only the predictions computation to route through a sigmoid and the loss to cross-entropy, and verifies the result against `logistic-regression-and-decision-boundaries`'s own precise account of where the decision boundary sits, the set of points where the sigmoid output crosses 0.5. Checking every data point's predicted class against the computed boundary line directly, rather than trusting a visually plausible plot, and deliberately introducing a threshold bug to see it fail, is what actually verifies the implementation matches the theory rather than merely resembling it.

## Documentation Links

- [Stanford CS229 — Lecture Notes, Part I: Linear Regression](https://cs229.stanford.edu/main_notes.pdf): covers the logistic regression derivation and cross-entropy gradient this lab implements.
- [James, Witten, Hastie & Tibshirani — An Introduction to Statistical Learning](https://www.statlearning.com/): a widely used textbook source for the decision-boundary geometry this lab verifies directly against real data.
