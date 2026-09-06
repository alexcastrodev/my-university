---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Explain the goal of dimensionality reduction: summarizing high-dimensional data using far fewer dimensions while preserving as much of its variation as possible.
- State precisely how principal components are defined as directions of maximum variance, and how this connects directly to the eigenvectors of the data's covariance matrix.
- Compute the principal components of a small 2D dataset by hand, using its covariance matrix's eigenvalues and eigenvectors.
- Explain how the eigenvalues themselves quantify how much variance each principal component captures, and how this guides choosing how many components to keep.

## Context & Motivation

`foundations/mathematics-for-computing` proved, in its `eigenvalues-of-symmetric-matrices` concept, a genuinely non-obvious guarantee: a symmetric matrix always has real eigenvalues and orthogonal eigenvectors — and flagged explicitly, at the time, that this exact guarantee "underlies PCA and every optimization problem built on a symmetric matrix." This concept is where that forward reference is finally cashed in: principal component analysis takes a dataset's covariance matrix — always symmetric, by construction — and its guaranteed-orthogonal eigenvectors turn out to be exactly the directions along which the data varies the most, in decreasing order.

## Core Theory

### The goal: variance-preserving dimensionality reduction

Given data with many features (dimensions), PCA looks for a smaller number of new, synthetic directions — **principal components** — that capture as much of the data's original variance as possible. The first principal component is the single direction along which the data varies the most; the second is the direction of next-most variance, subject to being orthogonal (at a right angle) to the first; and so on. Projecting the original high-dimensional data onto just the first few principal components compresses it into far fewer dimensions while discarding the least informative variation.

### Why eigenvectors of the covariance matrix are exactly the answer

Given data with covariance matrix `Σ` (a symmetric matrix, since covariance is always symmetric between any pair of features), it can be shown that the direction of maximum variance is exactly the eigenvector of `Σ` with the largest eigenvalue. This is not a coincidence or an approximation — it is a direct consequence of the already-proven fact that a symmetric matrix's eigenvectors are orthogonal and its eigenvalues are real: this guarantees that the principal components (the top eigenvectors) are automatically at right angles to each other, and that each eigenvalue directly measures the amount of variance captured along its corresponding eigenvector direction.

### Choosing how many components to keep

Each eigenvalue `λᵢ` of the covariance matrix equals the variance captured by its corresponding principal component. The proportion of total variance captured by keeping the top `m` components is:

```text
(λ₁ + λ₂ + ... + λₘ) / (λ₁ + λ₂ + ... + λₙ)
```

where the denominator sums over all `n` original eigenvalues. A common practice is to keep enough components to retain, say, 95% of total variance — a direct, computable criterion, rather than an arbitrary choice of how many dimensions to keep.

## Worked Examples

### Example 1: PCA on a small 2D dataset, by hand

Consider 2D data with covariance matrix:

```text
Σ = [[4, 2],
     [2, 3]]
```

Finding eigenvalues via the characteristic equation `det(Σ − λI) = 0`:

```text
(4−λ)(3−λ) − 4 = 0
λ² − 7λ + 12 − 4 = 0
λ² − 7λ + 8 = 0
λ = (7 ± √(49−32)) / 2 = (7 ± √17) / 2 ≈ (7 ± 4.123) / 2

λ₁ ≈ 5.56,   λ₂ ≈ 1.44
```

Solving `(Σ − λ₁I)v = 0` for the eigenvector at `λ₁ ≈ 5.56` gives a direction roughly `v₁ ≈ (0.79, 0.62)` (normalized) — this is the first principal component, the direction of maximum variance. The second principal component `v₂`, guaranteed orthogonal to `v₁` by the symmetric-matrix property already proven in `foundations/mathematics-for-computing`, points roughly `(−0.62, 0.79)`.

### Example 2: Computing variance retained

Using the eigenvalues from Example 1, the proportion of total variance captured by keeping only the first principal component:

```text
λ₁ / (λ₁ + λ₂) = 5.56 / (5.56 + 1.44) = 5.56 / 7.00 ≈ 0.794
```

Keeping just the first of the two original dimensions' worth of information (as a single new synthetic direction) retains about 79.4% of the data's total variance — a real, quantitative basis for deciding whether reducing from 2 dimensions to 1 is an acceptable simplification for a given application, generalizing directly to deciding how many of many original dimensions to keep.

## Common Misconceptions & Pitfalls

- **"PCA selects a subset of the original features."** It does not — principal components are new, synthetic directions, each typically a linear combination of *all* the original features, not a selection of some original features and a discarding of others (that alternative approach is feature selection, a different technique).
- **"More principal components always mean a better model."** Keeping more components retains more of the original variance but defeats the purpose of dimensionality reduction (simplification, noise reduction, visualization) — the right number of components to keep is a tradeoff, guided by the retained-variance criterion from Example 2, not simply "as many as possible."
- **"PCA requires labels, like the classifiers earlier in this discipline."** PCA is entirely unsupervised — it only looks at the covariance structure of the features themselves, with no reference to any target variable `y`, exactly like k-means and GMM before it in this discipline's unsupervised cluster.

## Summary

Principal component analysis finds new, synthetic directions of maximum variance in high-dimensional data by computing the eigenvectors of the data's covariance matrix — a direct application of the already-proven guarantee, from `foundations/mathematics-for-computing`, that a symmetric matrix's eigenvectors are orthogonal and its eigenvalues real. Each eigenvalue directly quantifies how much variance its corresponding principal component captures, giving a precise, computable basis for deciding how many components to keep when compressing data down to fewer dimensions.

## Documentation Links

- [Stanford CS229 — Course Syllabus](https://cs229.stanford.edu/syllabus-autumn2018.html) — lists PCA as the culminating technique of this course's unsupervised learning unit.
- [MIT 18.065 — Syllabus (OCW)](https://ocw.mit.edu/courses/18-065-matrix-methods-in-data-analysis-signal-processing-and-machine-learning-spring-2018/pages/syllabus/) — the same applied-linear-algebra course already cited for eigenvalues of symmetric matrices, deriving PCA directly from that property.
