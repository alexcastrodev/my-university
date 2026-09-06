---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Describe how a decision tree makes a prediction by following a sequence of feature-threshold tests from root to leaf.
- Define Gini impurity and explain how a greedy tree-growing algorithm selects each split to minimize it.
- Trace, by hand, one full split-selection step on a small dataset.
- Explain why an unpruned decision tree is a high-variance model, connecting directly back to this discipline's bias-variance and overfitting concepts.

## Context & Motivation

Every model covered so far in this discipline's classification cluster — logistic regression, GDA, Naive Bayes — commits to a specific mathematical form (a linear decision boundary, or a specific probability distribution) chosen in advance. Decision trees take a structurally different approach, building directly on a data structure already covered in this curriculum's very first discipline: the binary tree from `foundations/data-structures-i`. Here, each internal node asks a simple question about one feature (is `x₁ > 5`?), each branch follows the answer, and each leaf makes a final prediction — a model whose structure is discovered from the data itself, not fixed in advance, and one whose logic a human can read directly off the tree.

## Core Theory

### The tree structure and prediction rule

A decision tree is exactly the binary tree already covered in `foundations/data-structures-i`, specialized for prediction: each internal node stores a feature and a threshold (`xⱼ > t`?), each node has two children (following the "no"/"yes" answer), and each leaf stores a predicted class (for classification) or a predicted value (for regression). Predicting for a new example means starting at the root and following the branch matching the example's actual feature values at each node, until a leaf is reached — its stored prediction is the tree's output.

### Growing a tree: greedy splitting by impurity

A tree is built top-down, greedily: at each node, the algorithm considers every possible (feature, threshold) split and picks the one that most reduces **impurity** in the resulting two child nodes. A common impurity measure is **Gini impurity**, for a node containing a mix of classes with proportions `p₁, ..., pₖ`:

```text
Gini = 1 − Σᵢ pᵢ²
```

Gini impurity is 0 when a node is perfectly pure (all one class) and highest when classes are evenly mixed. The algorithm evaluates every candidate split's *weighted* Gini impurity across its two resulting children, and greedily picks whichever split reduces impurity the most — repeating recursively at each child node until a stopping condition (a maximum depth, or a minimum number of examples per leaf) is reached.

### Why unpruned trees overfit

A decision tree grown without any stopping condition can keep splitting until every leaf contains a single training example, achieving zero training error — but this is precisely the high-variance, low-bias regime from this discipline's bias-variance concept: a tree deep enough to perfectly separate every training point has almost certainly fit noise specific to that sample, and a different training sample from the same true distribution would likely produce a very differently shaped tree. Limiting tree depth, requiring a minimum number of examples per leaf, or pruning the tree after growing it are all direct, structural applications of the same capacity-control idea regularization applied to linear models earlier in this discipline.

## Worked Examples

### Example 1: Computing Gini impurity and choosing a split

Consider a node with 10 examples: 6 labeled "yes," 4 labeled "no." Its Gini impurity:

```text
p(yes) = 0.6, p(no) = 0.4
Gini = 1 − (0.6² + 0.4²) = 1 − (0.36 + 0.16) = 1 − 0.52 = 0.48
```

Suppose a candidate split on feature `age > 30` divides this into two children: Left (age ≤ 30): 5 examples, 1 "yes" / 4 "no" → `Gini_left = 1 − (0.2² + 0.8²) = 1 − 0.68 = 0.32`. Right (age > 30): 5 examples, 5 "yes" / 0 "no" → `Gini_right = 1 − (1.0² + 0²) = 0.0` (perfectly pure). The split's weighted impurity: `(5/10)(0.32) + (5/10)(0.0) = 0.16` — a large reduction from the parent's 0.48, making this a strong candidate split the greedy algorithm would likely select over weaker alternatives.

### Example 2: A tree tracing a full prediction

Given a fitted tree:

```text
Root: age > 30?
  ├── No  → income > 50000?
  │          ├── No  → predict: "decline"
  │          └── Yes → predict: "approve"
  └── Yes → predict: "approve"
```

For a new applicant with `age = 25, income = 60000`: starting at the root, `age > 30` is false, so follow the "No" branch to the `income > 50000` node; `income > 50000` is true, so follow to the leaf predicting "approve." Every prediction is exactly this kind of transparent, traceable path — the main practical advantage decision trees have over the less directly interpretable models earlier in this discipline.

## Common Misconceptions & Pitfalls

- **"Decision trees always find the globally optimal tree structure."** The greedy splitting algorithm picks the locally best split at each step, without looking ahead — this can miss a globally better tree that would require a locally suboptimal split now to enable a much better split later; finding the truly optimal tree is computationally intractable for realistic dataset sizes, which is exactly why the greedy approximation is used in practice.
- **"A deeper tree is always a better tree."** A sufficiently deep, unconstrained tree can memorize the training set exactly (each leaf holding one example), which is the textbook high-variance overfitting scenario from this discipline's bias-variance concept — depth must be limited, or the tree pruned, based on validation performance, not training performance.
- **"Decision trees can only handle numeric features."** Trees split naturally on categorical features too (is `color == "red"`?), one of their practical advantages over models like linear/logistic regression that require categorical features to be numerically encoded first.

## Summary

A decision tree reuses the binary tree data structure from `foundations/data-structures-i`, with each internal node testing one feature against a threshold and each leaf holding a prediction. It is grown greedily, top-down, by repeatedly choosing the split that most reduces impurity (commonly measured by Gini impurity) in the resulting children. Left unconstrained, a decision tree can grow deep enough to perfectly fit its training data — the same high-variance overfitting risk this discipline's bias-variance and regularization concepts already warned about — which is why depth limits, minimum leaf sizes, or pruning are essential in practice.

## Documentation Links

- [James, Witten, Hastie & Tibshirani — An Introduction to Statistical Learning](https://www.statlearning.com/) — Chapter 7 (Tree-Based Methods) derives Gini impurity and the greedy tree-growing algorithm in full.
- [Stanford CS229 — Course Syllabus](https://cs229.stanford.edu/syllabus-autumn2018.html) — lists decision trees and tree ensembles as the course's dedicated topic following the core regression/classification cluster.
