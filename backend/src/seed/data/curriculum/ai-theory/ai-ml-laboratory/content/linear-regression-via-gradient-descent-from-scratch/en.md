---
version: 1.0
updatedAt: 2026-09-12
---
## Learning Objectives

- Implement the closed-form (normal equation) solution to least-squares linear regression in NumPy.
- Implement batch gradient descent for the same problem, using only the loss function and its gradient, with no closed-form shortcut.
- Verify that gradient descent converges to the same parameters the closed-form solution computes directly, on a real, small dataset.
- Explain why this agreement, not just a decreasing loss curve, is the real correctness check this lab depends on.

## Context & Motivation

**Linear Regression as Least Squares** and **Gradient Descent as a General Optimizer** already prove, on paper, two real, independent facts: that minimizing mean squared error over a linear model has an exact, closed-form solution (the normal equation), and that gradient descent, run on that same loss function, converges toward a minimum through purely iterative, local steps. This lab is where those two independently-arrived-at answers get computed for real and checked against each other, the first lab of this discipline's build-the-toolkit arc, using only NumPy, with no scikit-learn anywhere in the implementation.

## Core Theory

Nothing about *why* the normal equation solves least squares exactly, or *why* gradient descent converges under the right learning rate, is re-derived here; both arguments already exist in `linear-regression-as-least-squares` and `gradient-descent-as-a-general-optimizer`. This lab implements both computations directly and treats their agreement as the actual correctness test, not either one's derivation alone.

## Worked Examples

### API specification

```text
closed_form_fit(X: ndarray, y: ndarray) -> ndarray        # returns weights
gradient_descent_fit(X, y, lr: float, iters: int) -> ndarray  # returns weights
mse_loss(X, y, w) -> float
```

### Step 1 — the closed-form solution

```python
def closed_form_fit(X, y):
    # X: (n_samples, n_features), with a column of 1s already prepended
    # for the bias term. The normal equation: w = (X^T X)^-1 X^T y
    return np.linalg.inv(X.T @ X) @ X.T @ y
```

### Step 2 — gradient descent, using ONLY the loss and its gradient

```python
def mse_loss(X, y, w):
    predictions = X @ w
    return np.mean((predictions - y) ** 2)

def mse_gradient(X, y, w):
    predictions = X @ w
    n = X.shape[0]
    return (2 / n) * X.T @ (predictions - y)

def gradient_descent_fit(X, y, lr=0.01, iters=1000):
    w = np.zeros(X.shape[1])
    loss_history = []
    for _ in range(iters):
        w = w - lr * mse_gradient(X, y, w)
        loss_history.append(mse_loss(X, y, w))
    return w, loss_history
```

Nothing in `gradient_descent_fit` uses the matrix inverse from Step 1 at all; it reaches its answer purely by repeatedly nudging `w` opposite the gradient, which is precisely what makes agreement between the two functions' final outputs a real, independent check rather than a circular one.

### Step 3 — the real correctness check: do the two independent answers agree?

```python
def test_gradient_descent_converges_to_closed_form():
    X, y = load_small_real_dataset()  # e.g. a housing-price dataset,
                                        # a handful of features, real values
    X = add_bias_column(X)
    w_closed = closed_form_fit(X, y)
    w_gd, loss_history = gradient_descent_fit(X, y, lr=0.05, iters=5000)

    assert np.allclose(w_closed, w_gd, atol=1e-2), \
        f"gradient descent {w_gd} should converge close to the closed form {w_closed}"
    assert loss_history[-1] < loss_history[0], "loss should have decreased overall"
    assert all(loss_history[i] >= loss_history[i+1] - 1e-9 for i in range(len(loss_history)-1)), \
        "with this learning rate, loss should decrease monotonically, not oscillate"
```

### Step 4 — diagnosing a learning rate that is too large

```python
def test_too_large_learning_rate_diverges():
    X, y = load_small_real_dataset()
    X = add_bias_column(X)
    w_gd, loss_history = gradient_descent_fit(X, y, lr=5.0, iters=50)  # deliberately too large
    assert loss_history[-1] > loss_history[0], \
        "an excessively large learning rate should make loss WORSE, not better, demonstrating overshoot"
```

## Common Misconceptions & Pitfalls

- **"A steadily decreasing loss curve is enough evidence gradient descent implemented it correctly."** A loss curve can decrease and still converge to the wrong point, or converge very slowly to a point far from the true minimum, if the gradient computation itself has a subtle bug; Step 3's direct comparison against the independently-computed closed-form answer is a much stronger check than the loss curve's shape alone.
- **"The learning rate is a minor tuning detail, not something worth testing directly."** Step 4 demonstrates directly that a learning rate chosen too large does not merely converge slowly, it can make the loss increase, overshooting the minimum on every step; this failure mode is real and common enough that testing for it explicitly, rather than only testing the well-tuned case, is worth the lab's own time.
- **"Since the closed-form solution is exact and fast, gradient descent is just a slower, worse way to solve the same problem here."** For linear regression specifically, this is a fair practical observation, but the point of implementing gradient descent here is that it generalizes to problems Lab 2 and Lab 3 need it for, logistic regression and neural networks, which have no closed-form solution at all; this lab is where its correctness is verified while a closed-form answer is still available to check against.

## Summary

This lab implements both the closed-form normal-equation solution and iterative gradient descent for least-squares linear regression, in plain NumPy, and treats their agreement, not either method's theoretical derivation alone, as the real correctness check: gradient descent's purely local, iterative process converging to the same parameters the closed-form solution computes directly confirms both implementations are actually correct, not merely plausible. This gradient-descent implementation, and the discipline of checking it against an independent answer, is reused unchanged in Lab 2 and extended in Lab 3, where no closed-form comparison will be available at all.

## Documentation Links

- [Stanford CS229 — Lecture Notes, Part I: Linear Regression](https://cs229.stanford.edu/main_notes.pdf): the direct source for both the normal equation and the gradient descent derivation this lab implements and cross-checks.
- [James, Witten, Hastie & Tibshirani — An Introduction to Statistical Learning](https://www.statlearning.com/): a widely used textbook covering the same least-squares regression theory this lab's implementation is built on.
