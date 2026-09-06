---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Compare every model family covered in this discipline along the practical dimensions that actually drive a real choice: interpretability, data size, and nonlinearity.
- Walk through a complete, end-to-end model-selection and validation process on one worked scenario, using techniques from across this entire discipline together.
- Explain how this discipline's arc — from the feasibility of learning to neural networks — forms one coherent argument, not a list of unrelated algorithms.
- State precisely what has been deliberately left out of this discipline, and which sibling disciplines pick up each thread.

## Context & Motivation

This discipline opened by asking whether learning from a finite sample is even possible in principle, and closed, twenty-two concepts later, at the threshold of neural networks. In between, it built regression, classification, model-complexity control, evaluation, tree-based methods, support vector machines, clustering, dimensionality reduction, and the perceptron — each new technique built directly on tools from `foundations/mathematics-for-computing` and `foundations/probability-statistics`, and each addressing the same underlying feasibility concern from a different angle. This capstone does not introduce new machinery; it closes the loop by comparing every model family side by side and walking through one complete, realistic decision process using this discipline's tools together.

## Core Theory

### A comparison table across every model family

```text
Model                 Interpretability   Data needed    Handles nonlinearity   Closed-form fit?
Linear regression      High               Low            No (without eng. features)   Yes
Logistic regression     High               Low            No (linear boundary)        No (convex, GD)
GDA / Naive Bayes       Medium             Low             Depends on distribution     Yes (closed form)
Decision tree           High               Medium          Yes (natively)              No (greedy)
Random forest/boosting  Low                Medium-High     Yes                         No (iterative)
SVM (linear)            Medium             Medium          No                          No (convex QP)
SVM (kernel)            Low                Medium          Yes (via kernel)            No (convex QP)
K-means / GMM           N/A (unsupervised) Low-Medium      Depends on kernel/shape     No (iterative, EM)
Neural network          Very low           High            Yes                        No (backprop, later)
```

No single row dominates every column — the entire point of this table, and of the bias-variance and VC-dimension arguments earlier in this discipline, is that model choice is a real tradeoff decided by the specific problem's data size, need for interpretability, and true underlying complexity, not by picking "the best algorithm" in the abstract.

### Reading the arc of this discipline as one argument

The feasibility-of-learning question opened this discipline with an honest concern: can training performance be trusted at all? The Hoeffding bound and VC dimension answered this rigorously. Bias-variance, regularization, and cross-validation turned that rigor into practical tools for controlling overfitting. Each model family — regression, classifiers, trees, SVMs, clustering, PCA — is then a different way of trading off expressive power against these same generalization concerns, applied to a different kind of problem (numeric target, categorical target, no target at all). The perceptron and the bridge to neural networks close the discipline by showing that even the deepest architectures covered elsewhere in this curriculum are still, underneath their scale, answering exactly this same question.

## Worked Examples

### Example 1: A complete model-selection walkthrough

**Scenario**: predicting whether a loan applicant will default, from 20 features, 5,000 labeled examples, where the bank's compliance team requires the model's reasoning to be explainable to a regulator.

```text
Step 1 — Task type: labeled data, binary target → supervised classification.
Step 2 — Interpretability requirement rules out: random forests, kernel SVMs, neural networks.
Step 3 — Candidates remaining: logistic regression, a single decision tree, GDA/Naive Bayes.
Step 4 — Cross-validate all three candidates (5-fold), comparing precision/recall,
          since false negatives (approving a defaulter) and false positives
          (declining a good applicant) likely have different real costs to the bank.
Step 5 — Suppose logistic regression achieves the best cross-validated F1 score,
          and additionally supports a natural probability output regulators can
          interpret directly as a risk score — chosen as the final model.
Step 6 — Tune its regularization strength (ridge or lasso) via the same
          cross-validation, then evaluate exactly once on the held-out test set
          to report the final, honest performance number.
```

Every step in this walkthrough reuses a specific concept already built in this discipline — the taxonomy, cross-validation, evaluation metrics, regularization, and the train/test discipline — combined into one coherent real-world decision process.

### Example 2: When the interpretability constraint is absent

Repeating the same scenario without a regulatory interpretability requirement opens up random forests or gradient boosting as candidates, likely improving raw predictive accuracy at the direct cost of the model's decisions being explainable to a human — the same interpretability-versus-accuracy row from the comparison table, made concrete: the "best" model changes depending on a real-world constraint the comparison table alone cannot resolve, only inform.

## Common Misconceptions & Pitfalls

- **"There is one best machine learning algorithm, and the goal is to find it."** The comparison table and both worked examples make the opposite point directly: the right choice depends on data size, interpretability requirements, and the true shape of the relationship in the data — a fact this discipline has been building toward since its opening feasibility argument.
- **"More powerful models (neural networks, boosted ensembles) are always the right default choice."** They typically need more data to avoid overfitting (a direct consequence of higher effective capacity, hence higher VC dimension, from earlier in this discipline) and sacrifice interpretability — the loan-approval scenario above is a concrete case where this "more powerful" choice would actually be disqualified outright by a real business constraint.
- **"This discipline has now covered all of machine learning."** It has deliberately not covered reinforcement learning (already in `ai-theory/artificial-intelligence`) or deep learning's architectures and training algorithms (reserved for `ai-theory/deep-learning`) — this discipline's scope was always the classical supervised and unsupervised toolkit, built on the linear algebra and probability foundations already established elsewhere in this curriculum.

## Summary

Across every model family this discipline covered, no single choice dominates on every axis — interpretability, data requirements, and capacity to represent nonlinear relationships all trade off against each other, exactly as the bias-variance and VC-dimension arguments from early in this discipline predicted they must. A real model-selection process combines this discipline's tools — the supervised/unsupervised taxonomy, cross-validation, evaluation metrics, and regularization — into one coherent decision, as the loan-default worked example shows. Reinforcement learning and deep architectures are deliberately out of scope here, handled by `ai-theory/artificial-intelligence` and `ai-theory/deep-learning` respectively.

## Documentation Links

- [James, Witten, Hastie & Tibshirani — An Introduction to Statistical Learning](https://www.statlearning.com/) — closes with exactly this kind of practical model-comparison guidance across the same model families covered in this discipline.
- [Stanford CS229 — Course Syllabus](https://cs229.stanford.edu/syllabus-autumn2018.html) — the real course whose full arc, from foundations through classical ML to a brief neural-network bridge, this discipline's structure follows.
