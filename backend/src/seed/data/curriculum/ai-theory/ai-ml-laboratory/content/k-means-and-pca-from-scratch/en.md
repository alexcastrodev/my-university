---
version: 1.0
updatedAt: 2026-09-12
---
## Learning Objectives

- Implement k-means clustering's assign-then-update loop from scratch, and verify total within-cluster distance decreases monotonically until convergence.
- Implement PCA by eigendecomposing a real dataset's covariance matrix, and verify the top components capture the claimed fraction of total variance.
- Explain why neither algorithm has a labeled "right answer" to check predictions against, and what correctness verification looks like in that setting instead.
- Apply both algorithms to the same real, unlabeled dataset and interpret what each one actually reveals about its structure.

## Context & Motivation

Every earlier lab in this arc, Labs 1 through 3, fit a model against known labels, a target value, a class, and verified correctness by comparing predictions against those labels or against an independently computed gradient. **k-Means Clustering** and **Principal Component Analysis** are genuinely different: both operate on data with no labels at all, which means this lab's whole point is confronting a real, practical question the earlier labs never had to ask, what does "correct" even mean when there is no known right answer to check against.

## Core Theory

Nothing about *why* k-means's alternating assign-and-update steps converge, or *why* PCA's top eigenvectors capture the directions of greatest variance, is re-derived here; both arguments already exist in `k-means-clustering` and `principal-component-analysis`. This lab implements both and identifies the real, checkable properties each algorithm's own theory guarantees, in place of label-based verification.

## Worked Examples

### API specification

```text
kmeans_fit(X, k: int, iters: int) -> (centroids: ndarray, assignments: ndarray)
pca_fit(X, n_components: int) -> (components: ndarray, explained_variance_ratio: ndarray)
```

### Step 1 — k-means: assign, then update, repeated

```python
def kmeans_fit(X, k, iters=100, seed=0):
    rng = np.random.default_rng(seed)
    centroids = X[rng.choice(len(X), k, replace=False)]  # initialize from real data points
    total_distance_history = []

    for _ in range(iters):
        distances = np.linalg.norm(X[:, None] - centroids[None, :], axis=2)
        assignments = np.argmin(distances, axis=1)  # ASSIGN step

        total_distance_history.append(
            sum(np.linalg.norm(X[i] - centroids[assignments[i]]) for i in range(len(X)))
        )

        for j in range(k):  # UPDATE step
            points_in_cluster = X[assignments == j]
            if len(points_in_cluster) > 0:
                centroids[j] = points_in_cluster.mean(axis=0)

    return centroids, assignments, total_distance_history
```

### Step 2 — the real check: total distance must decrease monotonically

```python
def test_kmeans_total_distance_decreases_monotonically():
    X = load_real_unlabeled_dataset()  # e.g. a real, small clustering dataset
    _, _, distance_history = kmeans_fit(X, k=3, iters=50, seed=0)

    for i in range(len(distance_history) - 1):
        assert distance_history[i + 1] <= distance_history[i] + 1e-9, \
            f"total within-cluster distance increased at iteration {i}, which k-means's own convergence guarantee forbids"
```

This is the correctness check `k-means-clustering`'s own theory actually guarantees, not that any particular clustering is "correct" (there is no labeled ground truth to compare against), but that the assign-then-update loop's total within-cluster distance can never increase from one iteration to the next; a bug that violates this specific, checkable property is a real bug, independent of whether the resulting clusters happen to look reasonable.

### Step 3 — PCA via eigendecomposition of the covariance matrix

```python
def pca_fit(X, n_components):
    X_centered = X - X.mean(axis=0)  # PCA requires zero-mean data
    covariance = (X_centered.T @ X_centered) / (len(X) - 1)
    eigenvalues, eigenvectors = np.linalg.eigh(covariance)  # eigh: covariance is symmetric

    order = np.argsort(eigenvalues)[::-1]  # largest eigenvalue first
    eigenvalues, eigenvectors = eigenvalues[order], eigenvectors[:, order]

    components = eigenvectors[:, :n_components]
    explained_variance_ratio = eigenvalues[:n_components] / eigenvalues.sum()
    return components, explained_variance_ratio
```

### Step 4 — the real check: explained variance is a checkable, not asserted, number

```python
def test_pca_explained_variance_matches_projection():
    X = load_real_unlabeled_dataset()
    components, explained_ratio = pca_fit(X, n_components=2)

    X_centered = X - X.mean(axis=0)
    projected = X_centered @ components
    reconstructed = projected @ components.T

    total_variance = np.var(X_centered, axis=0).sum()
    residual_variance = np.var(X_centered - reconstructed, axis=0).sum()
    variance_captured_directly = 1 - (residual_variance / total_variance)

    assert np.isclose(variance_captured_directly, explained_ratio.sum(), atol=1e-6), \
        "variance captured by actually projecting and reconstructing the data must match the eigenvalue-based claim"
```

`explained_variance_ratio` is a real, falsifiable claim, projecting the data down to `n_components` and reconstructing it should recover exactly that fraction of the original variance, not an approximate or asserted number; Step 4 checks that claim directly against the actual reconstruction, rather than trusting the eigenvalue computation alone.

## Common Misconceptions & Pitfalls

- **"Without labels, there's no real way to verify k-means or PCA are implemented correctly."** Both algorithms have real, checkable mathematical guarantees independent of any labels: k-means's total within-cluster distance must decrease monotonically, and PCA's claimed explained variance must match what an actual projection-and-reconstruction recovers; Steps 2 and 4 check exactly these properties.
- **"A 'good-looking' clustering or a high explained-variance number is itself evidence of a correct implementation."** Neither is: a buggy k-means could produce visually plausible clusters that still violate the monotonic-decrease guarantee on close inspection, and a buggy PCA could report an explained-variance number that does not actually match what reconstructing the data from those components recovers; the checks in Steps 2 and 4 test the underlying mathematical property directly, not just the final output's plausibility.
- **"PCA requires the input data to already be zero-mean before this function is called."** Step 3's implementation explicitly centers the data itself (`X - X.mean(axis=0)`) rather than assuming the caller already did; skipping this step, or centering incorrectly, produces components that describe variance around the wrong origin entirely, a subtle bug the explained-variance check in Step 4 would likely catch as a mismatch.

## Summary

k-means and PCA operate on unlabeled data, which means this lab's central lesson is different from every earlier lab in this arc: correctness verification cannot rely on comparing predictions against known right answers, but each algorithm still has a real, checkable mathematical guarantee, k-means's total within-cluster distance decreasing monotonically every iteration, and PCA's claimed explained variance matching what an actual projection-and-reconstruction recovers, and this lab implements both algorithms and tests exactly those guarantees directly.

## Documentation Links

- [James, Witten, Hastie & Tibshirani — An Introduction to Statistical Learning](https://www.statlearning.com/): covers both the k-means convergence guarantee and the PCA eigendecomposition this lab implements and verifies.
- [Stanford CS229 — Lecture Notes, Part I: Linear Regression](https://cs229.stanford.edu/main_notes.pdf): a companion real source for the unsupervised-learning material this lab's two algorithms are drawn from.
