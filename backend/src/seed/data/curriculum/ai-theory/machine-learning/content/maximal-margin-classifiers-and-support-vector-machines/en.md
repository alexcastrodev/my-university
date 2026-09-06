---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Define the margin of a linear classifier, and explain why maximizing it (rather than merely achieving zero training error) is a principled choice.
- State the support vector machine's optimization problem, and define which training points are "support vectors."
- Explain why the SVM decision boundary depends only on the support vectors, not on every training point.
- Compute the margin and identify the support vectors for a small, linearly separable worked example.

## Context & Motivation

Logistic regression, earlier in this discipline, finds *a* linear decision boundary that separates two classes, but among the (typically infinite) family of boundaries that separate the training data with zero error, it has no explicit preference for one over another beyond what its probabilistic loss happens to produce. Support vector machines ask a sharper geometric question: among all separating hyperplanes, which one leaves the largest possible margin — the widest empty buffer zone — between the two classes? This is a genuinely different design principle, motivated by the same generalization concerns (bias-variance, VC dimension) already covered earlier: intuitively, a boundary with more breathing room on both sides is less likely to misclassify a new point that lands close to, but on the correct side of, the training data's boundary.

## Core Theory

### The margin and the maximal-margin classifier

For a linearly separable dataset, the **margin** of a separating hyperplane is the distance from the hyperplane to the nearest training point of either class. The **maximal-margin classifier** is the specific hyperplane that maximizes this distance — geometrically, the widest possible "street" that can be drawn between the two classes without touching any training point.

### Support vectors

The training points that lie exactly on the boundary of the margin — the closest points of each class to the decision hyperplane — are called the **support vectors**. A striking, non-obvious property of the maximal-margin solution: it is determined *entirely* by these support vectors. Every other training point could be moved anywhere further away from the boundary (as long as it stays correctly classified) without changing the fitted hyperplane at all — a sharp contrast with logistic regression, whose fitted parameters are influenced, at least a little, by every single training point.

### Soft margins for non-perfectly-separable data

Real data is rarely perfectly linearly separable. The **soft-margin SVM** relaxes the strict "every point outside the margin" requirement, allowing some points to violate the margin (or even be misclassified), controlled by a penalty parameter `C` that trades off margin width against the number and severity of violations: large `C` heavily penalizes violations (favoring a narrower margin that classifies more training points correctly), while small `C` tolerates more violations in exchange for a wider, more robust margin — a direct analogue of the regularization strength `λ` from earlier in this discipline's model-complexity cluster, now controlling the margin/violation tradeoff instead of coefficient size directly.

## Worked Examples

### Example 1: Identifying support vectors by hand

Consider a simple 1D dataset: class +1 at positions `{3, 4, 5}`, class −1 at positions `{−5, −4, −2}`. The maximal-margin hyperplane (here, a single threshold point) sits exactly halfway between the closest points of each class: the closest +1 point is at 3, the closest −1 point is at −2, so the boundary sits at `(3 + (−2))/2 = 0.5`, with margin width `(3 − (−2))/2 = 2.5` on each side. The support vectors are exactly the points at 3 and −2 — the closest point of each class — while the points at 4, 5, −5, and −4 play no role at all in determining this boundary; moving the point at 5 to 500 would not shift the fitted boundary by even a fraction.

### Example 2: A soft-margin tradeoff

Suppose one additional +1 point appears at position `−1` (inside what would otherwise be class −1's territory), making the data no longer perfectly separable by any single threshold. With a large `C` (heavy penalty for margin violations), the soft-margin SVM might set the boundary very close to this outlier to classify it correctly, at the cost of a much narrower margin overall. With a small `C`, the SVM might instead accept this one point as a margin violation (or even a misclassification), keeping the wide margin of 2.5 from Example 1 essentially intact — a real, direct illustration of `C` trading off the same "cost of getting this one exception right" against "risk of a fragile, narrow boundary" that regularization strength traded off for coefficient size earlier in this discipline.

## Common Misconceptions & Pitfalls

- **"SVMs find the boundary that best separates the classes on average, like logistic regression's likelihood-based fit."** SVMs optimize a fundamentally different, purely geometric objective — maximum margin — not a likelihood or average-error criterion; the two methods can produce visibly different boundaries even on the same linearly separable data.
- **"Every training point matters equally to an SVM's fitted boundary."** This is the opposite of true — as Example 1 shows, only the support vectors (the points closest to the boundary) determine the fitted hyperplane at all; this sparsity is a genuinely useful practical property, since the final model can be described using only the support vectors, not the entire training set.
- **"A large margin always means better generalization, with no downside."** A larger margin generally correlates with better generalization on separable data, but for non-separable data the soft-margin parameter `C` must be tuned (via cross-validation, from earlier in this discipline) — too small a `C` can force such a wide margin that too many real classification errors are tolerated, underfitting the data.

## Summary

Support vector machines choose, among every hyperplane that separates two classes, the one with the maximum margin — the widest possible buffer between the closest points of each class. That fitted boundary depends only on the support vectors, the handful of closest points, making SVMs both geometrically distinctive and practically sparse compared to the earlier classifiers in this discipline. The soft-margin variant, controlled by a penalty parameter `C`, extends this idea to realistically non-separable data, trading margin width against classification errors in a manner directly analogous to the regularization-strength tradeoff already covered.

## Documentation Links

- [Caltech CS 156 — Learning From Data, Lecture 14: Support Vector Machines](https://work.caltech.edu/telecourse.html) — the real lecture deriving the maximal-margin optimization problem and support vectors.
- [James, Witten, Hastie & Tibshirani — An Introduction to Statistical Learning](https://www.statlearning.com/) — Chapter 9 (Support Vector Machines) covers the soft-margin classifier and the `C` tradeoff in the same framing used here.
