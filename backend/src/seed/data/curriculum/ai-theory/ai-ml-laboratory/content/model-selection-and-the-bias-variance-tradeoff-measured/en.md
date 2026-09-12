---
version: 1.0
updatedAt: 2026-09-12
---
## Learning Objectives

- Sweep model complexity (polynomial degree for Lab 1's regressor, hidden-layer width for Lab 3's network) and plot training error against held-out validation error across the sweep.
- Locate the point where validation error stops improving and starts getting worse, and connect it to the underfitting/overfitting boundary The Bias-Variance Tradeoff and Overfitting and the VC Dimension describe.
- Apply Ridge regularization and confirm, empirically, that it shifts that turning point rather than merely being asserted to.
- Select a final model complexity and regularization strength using only the validation set, honoring `dataset-work-splits-leakage-and-honest-evaluation`'s own discipline.

## Context & Motivation

`dataset-work-splits-leakage-and-honest-evaluation` established a correct, leak-free train/validation/test split. This lab uses that split to do the thing it exists to make honestly possible: choosing a model's complexity. **The Bias-Variance Tradeoff** and **Overfitting and the VC Dimension** already predict, theoretically, a U-shaped validation-error curve as complexity increases, underfitting (high bias) on one side, overfitting (high variance) on the other; this lab produces that curve for real, from Lab 1's and Lab 3's own implementations, and measures exactly where it turns.

## Core Theory

Nothing about *why* increasing model complexity trades bias for variance, or *why* that tradeoff produces a U-shaped validation curve, is re-derived here; both arguments already exist in `the-bias-variance-tradeoff` and `overfitting-and-the-vc-dimension`. This lab implements the sweep that actually produces the curve, and applies `regularization-ridge-and-lasso`'s own penalty term to confirm its predicted effect on that curve directly.

## Worked Examples

### Step 1 — sweeping polynomial degree for Lab 1's regressor

```python
def polynomial_features(X, degree):
    return np.hstack([X ** d for d in range(1, degree + 1)])

def sweep_polynomial_complexity(X_train, y_train, X_val, y_val, max_degree=10):
    train_errors, val_errors = [], []
    for degree in range(1, max_degree + 1):
        X_train_poly = add_bias_column(polynomial_features(X_train, degree))
        X_val_poly = add_bias_column(polynomial_features(X_val, degree))
        w = closed_form_fit(X_train_poly, y_train)  # Lab 1's own solver, reused
        train_errors.append(mse_loss(X_train_poly, y_train, w))
        val_errors.append(mse_loss(X_val_poly, y_val, w))
    return train_errors, val_errors
```

### Step 2 — locating the turning point directly, not just plotting it

```python
def test_validation_curve_is_u_shaped():
    X_train, y_train, X_val, y_val = load_split_from_lab6()
    train_errors, val_errors = sweep_polynomial_complexity(X_train, y_train, X_val, y_val)

    # Training error should decrease (or stay flat) monotonically —
    # more complexity can ALWAYS fit the training data at least as well
    for i in range(len(train_errors) - 1):
        assert train_errors[i + 1] <= train_errors[i] + 1e-9

    # Validation error should NOT be monotonically decreasing — it
    # should have a real minimum somewhere in the middle, not at the
    # highest complexity tested
    best_degree = np.argmin(val_errors) + 1
    assert best_degree < len(val_errors), \
        "the best validation error should occur before the maximum tested complexity, confirming overfitting sets in"
```

### Step 3 — Ridge regularization, and confirming it shifts the curve

```python
def ridge_fit(X, y, lam):
    n_features = X.shape[1]
    identity = np.eye(n_features)
    identity[0, 0] = 0  # don't regularize the bias term
    return np.linalg.inv(X.T @ X + lam * identity) @ X.T @ y

def test_regularization_reduces_overfitting_at_high_complexity():
    X_train, y_train, X_val, y_val = load_split_from_lab6()
    high_degree = 10  # deliberately chosen to be well past the unregularized optimum

    X_train_poly = add_bias_column(polynomial_features(X_train, high_degree))
    X_val_poly = add_bias_column(polynomial_features(X_val, high_degree))

    w_unregularized = closed_form_fit(X_train_poly, y_train)
    val_error_unregularized = mse_loss(X_val_poly, y_val, w_unregularized)

    w_regularized = ridge_fit(X_train_poly, y_train, lam=1.0)
    val_error_regularized = mse_loss(X_val_poly, y_val, w_regularized)

    assert val_error_regularized < val_error_unregularized, \
        "at this deliberately high complexity, Ridge regularization should measurably reduce validation error"
```

### Step 4 — the same sweep, for Lab 3's neural network (hidden-layer width)

```python
def sweep_network_width(X_train, y_train, X_val, y_val, widths=(1, 2, 4, 8, 16, 32, 64)):
    train_errors, val_errors = [], []
    for width in widths:
        W1, b1, W2, b2 = init_small_network(n_features=X_train.shape[1], n_hidden=width)
        # train for a fixed number of iterations using Lab 3's own
        # forward/backward implementation (omitted here for brevity)
        train_errors.append(final_train_loss)
        val_errors.append(final_val_loss)
    return list(widths), train_errors, val_errors
```

Running the identical sweep-and-plot methodology against a genuinely different model class, Lab 1's polynomial regression and Lab 3's neural network, and observing the same qualitative U-shape in both is itself a real, independent confirmation that `the-bias-variance-tradeoff`'s claim is about model complexity generally, not an artifact specific to one particular algorithm.

### Step 5 — selecting a final model, using ONLY validation error

```python
def select_final_model(train_errors, val_errors, complexities):
    best_idx = np.argmin(val_errors)
    return complexities[best_idx]
    # NOTE: this selection uses val_errors exclusively; the test set
    # from dataset-work-splits-leakage-and-honest-evaluation is not
    # touched anywhere in this function, and will not be touched until
    # running-and-reporting-a-real-experiment's own, one-time final check
```

## Common Misconceptions & Pitfalls

- **"The best model is whichever one achieves the lowest training error."** Step 2's own test confirms training error decreases, or stays flat, monotonically as complexity increases, essentially by construction, more complexity can always fit training data at least as well; it is validation error's U-shape, not training error, that reveals where generalization actually stops improving.
- **"Regularization always helps, so it should be applied at maximum strength."** Step 3's test deliberately applies Ridge only at a complexity level already past the unregularized optimum, where overfitting is a real, measured problem; regularization applied too strongly at a complexity level that was not overfitting to begin with would instead push the model toward underfitting, the OTHER side of the same U-shaped curve.
- **"Selecting the final model complexity can use test-set performance, since it's just one more evaluation."** This is exactly the leakage `dataset-work-splits-leakage-and-honest-evaluation` warns against, applied at the model-selection stage instead of the preprocessing stage; Step 5's selection function uses only validation error specifically so the test set remains genuinely unseen until Lab 8's one-time, final evaluation.

## Summary

This lab sweeps model complexity, polynomial degree for Lab 1's regressor and hidden-layer width for Lab 3's network, and plots the resulting U-shaped validation-error curve `the-bias-variance-tradeoff` and `overfitting-and-the-vc-dimension` predict theoretically, locating the actual turning point where overfitting begins rather than only describing it. Applying `regularization-ridge-and-lasso`'s Ridge penalty at a deliberately high complexity level and confirming it measurably reduces validation error, and selecting the final model complexity using only the validation set, never the test set, honors both the bias-variance theory and the honest-evaluation discipline this whole lab arc has been building toward.

## Documentation Links

- [Caltech CS 156 — Learning From Data, Lecture 8: Bias-Variance Tradeoff](https://work.caltech.edu/telecourse.html): the direct source for the bias-variance decomposition this lab's complexity sweep is built to reproduce empirically.
- [James, Witten, Hastie & Tibshirani — An Introduction to Statistical Learning](https://www.statlearning.com/): the source for the Ridge regularization this lab applies and measures directly against the unregularized case.
