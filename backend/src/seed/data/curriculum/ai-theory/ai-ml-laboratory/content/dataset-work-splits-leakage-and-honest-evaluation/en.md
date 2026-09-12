---
version: 1.0
updatedAt: 2026-09-12
---
## Learning Objectives

- Implement a correct train/validation/test split, ensuring the test set is never touched until final evaluation.
- Implement a deliberately broken version that leaks test-set information into preprocessing (a normalization step fit on the full dataset before splitting), and measure how much that leak inflates reported accuracy.
- Implement k-fold cross-validation, and explain what problem it solves that a single validation split does not.
- Connect the measured leakage effect directly back to Lab 5's hypothesis: does the honestly evaluated result still support or refute it, once the leak is removed.

## Context & Motivation

`forming-a-falsifiable-hypothesis-on-a-real-dataset` produced a precise, falsifiable claim, but that claim is only honestly testable if the evaluation itself is honest. **Training, Test, and Validation Splits** already establishes why a model can only be fairly evaluated on data it never touched during training; this lab makes that discipline concrete, and, deliberately, makes its violation concrete too, by implementing both a correct split and a broken one, and measuring the real, numeric gap between them.

## Core Theory

Nothing about *why* evaluating on training data overestimates real performance is re-derived here; that argument already exists in `training-test-and-validation-splits`. This lab implements the correct split, a specific, common, and easy-to-miss leakage bug, and `cross-validation`'s own k-fold discipline, treating the measured accuracy gap between the correct and broken versions as this lab's real, central result.

## Worked Examples

### Step 1 — a correct split, test set locked away until the very end

```python
def correct_split(X, y, test_size=0.2, val_size=0.2, seed=0):
    rng = np.random.default_rng(seed)
    n = len(X)
    indices = rng.permutation(n)
    test_end = int(n * test_size)
    val_end = test_end + int(n * val_size)

    test_idx, val_idx, train_idx = indices[:test_end], indices[test_end:val_end], indices[val_end:]
    return (X[train_idx], y[train_idx]), (X[val_idx], y[val_idx]), (X[test_idx], y[test_idx])
    # test_idx is returned but MUST NOT be touched again until the
    # final, one-time evaluation in Lab 8
```

### Step 2 — the deliberately broken version: normalization fit on the FULL dataset

```python
def broken_split_with_leakage(X, y, test_size=0.2, val_size=0.2, seed=0):
    # THE BUG: fitting the normalizer's mean/std on ALL of X, including
    # what will become the test set, BEFORE splitting — a real, common
    # mistake, since it looks harmless: "just normalizing the data."
    mean, std = X.mean(axis=0), X.std(axis=0)
    X_normalized = (X - mean) / std

    return correct_split(X_normalized, y, test_size, val_size, seed)  # split
                                                                          # happens
                                                                          # AFTER
                                                                          # the leak
```

The bug is specifically that computing `mean` and `std` over the full dataset lets information about the test set's own distribution, its mean and spread, leak into every training example's normalized features, before the split that is supposed to keep the test set unseen has even happened.

### Step 3 — measuring the actual size of the leak

```python
def test_leakage_inflates_reported_accuracy():
    X, y = load_real_dataset()

    # Correct version: normalize using ONLY training-set statistics,
    # applied to validation/test afterward
    (X_train, y_train), (X_val, y_val), (X_test, y_test) = correct_split(X, y)
    train_mean, train_std = X_train.mean(axis=0), X_train.std(axis=0)
    X_train_norm = (X_train - train_mean) / train_std
    X_test_norm = (X_test - train_mean) / train_std  # SAME train-set stats applied
    model_correct = logistic_fit(add_bias_column(X_train_norm), y_train)
    acc_correct = accuracy(model_correct, add_bias_column(X_test_norm), y_test)

    # Broken version: normalize before splitting at all
    (X_train_b, y_train_b), (X_val_b, y_val_b), (X_test_b, y_test_b) = broken_split_with_leakage(X, y)
    model_broken = logistic_fit(add_bias_column(X_train_b), y_train_b)
    acc_broken = accuracy(model_broken, add_bias_column(X_test_b), y_test_b)

    print(f"Correct (no leakage): {acc_correct:.3f}")
    print(f"Broken (with leakage): {acc_broken:.3f}")
    # On a real dataset, acc_broken is typically higher — this gap IS
    # the leak's real, measured cost, not a hypothetical one
```

### Step 4 — k-fold cross-validation: a different problem than the leak above

```python
def k_fold_cross_validate(X, y, k=5, seed=0):
    rng = np.random.default_rng(seed)
    indices = rng.permutation(len(X))
    folds = np.array_split(indices, k)
    scores = []

    for i in range(k):
        val_idx = folds[i]
        train_idx = np.concatenate([folds[j] for j in range(k) if j != i])
        model = logistic_fit(add_bias_column(X[train_idx]), y[train_idx])
        scores.append(accuracy(model, add_bias_column(X[val_idx]), y[val_idx]))

    return np.mean(scores), np.std(scores)  # reports variability across folds, too
```

Cross-validation solves a different problem than the leakage bug above: even with a correct, leak-free single split, a single validation set's own estimate of performance can vary a lot just from which specific examples happened to land in it, especially on a small dataset; k-fold averages that estimate over several different splits, and its reported standard deviation is itself real, useful information about how stable the estimate actually is, the same variability-reporting discipline `graduate-studies/research-statistics`'s own `aggregation-variability-and-reporting` already covers.

## Common Misconceptions & Pitfalls

- **"Normalizing the whole dataset before splitting is a harmless preprocessing convenience."** Step 3's own measured comparison shows the opposite directly: computing normalization statistics over data that includes the test set lets real information about the test set leak into training, inflating the reported accuracy in a way that will not hold up once the model is actually deployed on genuinely unseen data.
- **"A single, correct train/test split is sufficient; cross-validation is just extra rigor for a slightly better number."** Cross-validation addresses a genuinely different problem, the instability of a single split's estimate on a small dataset, not the leakage bug Steps 1-3 are built around; both matter, for different reasons, and conflating them misses what each one actually protects against.
- **"Once the leak is identified and fixed, the original hypothesis can be re-evaluated by simply rerunning the broken version's numbers with the corrected code."** The honest, correct comparison is exactly what Step 3 already ran; the hypothesis from `forming-a-falsifiable-hypothesis-on-a-real-dataset` needs to be checked against `acc_correct`, not `acc_broken`, and if the leak's inflation was large enough to flip the hypothesis from supported to refuted, that is a real, important finding this lab's own measurement surfaced, not something to paper over.

## Summary

This lab makes `training-test-and-validation-splits`'s theoretical warning against evaluating on already-seen data concrete in two ways: implementing a correct split where the test set is genuinely locked away until final evaluation, and implementing a specific, realistic leakage bug, normalization statistics computed before splitting, then measuring directly how much that leak inflates reported accuracy on a real dataset. `cross-validation`'s k-fold discipline addresses a different, complementary concern, the instability of a single validation split's estimate, and Lab 5's original hypothesis needs to be checked against this lab's honestly evaluated result, not the leaked one, which is a real, sometimes hypothesis-changing consequence this lab's own measurement makes visible.

## Documentation Links

- [James, Witten, Hastie & Tibshirani — An Introduction to Statistical Learning](https://www.statlearning.com/): the direct source for the split, leakage, and cross-validation discipline this lab implements and measures.
- [Caltech CS 156 — Learning From Data, Lecture 13: Validation](https://work.caltech.edu/telecourse.html): a second, independent real course covering the same validation and honest-evaluation material this lab is grounded in.
