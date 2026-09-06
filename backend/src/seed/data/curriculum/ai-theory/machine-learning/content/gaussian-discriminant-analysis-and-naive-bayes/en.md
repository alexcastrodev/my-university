---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Distinguish discriminative models (which model `P(y|x)` directly, like logistic regression) from generative models (which model `P(x|y)` and `P(y)`, then use Bayes' theorem to obtain `P(y|x)`).
- State the Gaussian Discriminant Analysis (GDA) model and describe how it fits a separate Gaussian distribution to each class's features.
- State the Naive Bayes conditional-independence assumption and explain what it buys computationally, and what it costs in modeling accuracy.
- Explain, with a worked example, exactly how Bayes' theorem converts a generative model's class-conditional densities into a classification decision.

## Context & Motivation

Logistic regression, just covered, is a **discriminative** classifier: it models the conditional probability `P(y|x)` directly, drawing a decision boundary between classes without ever describing how the data within each class looks. This concept introduces a fundamentally different strategy — **generative** classification — which instead models how each class *generates* its data, `P(x|y)`, together with each class's overall frequency `P(y)`, and then uses Bayes' theorem, already covered in full in `foundations/probability-statistics` with a complete diagnostic-test worked example, to invert these into the classification probability actually needed, `P(y|x)`.

This is a genuinely different modeling philosophy, not merely an algebraic variant of the same idea: a generative model can, in principle, generate synthetic examples of each class by sampling from its fitted distribution, something a discriminative model like logistic regression has no mechanism to do at all.

## Core Theory

### Bayes' theorem, applied to classification

Recall Bayes' theorem, exactly as proven and applied to a diagnostic test in `foundations/probability-statistics`:

```text
P(y | x) = P(x | y) · P(y) / P(x)
```

In the classification setting: `P(y)` is the **prior** probability of each class (how common it is overall), `P(x|y)` is the **class-conditional density** (how features look, given the class), and `P(y|x)` is the **posterior** — the quantity a classifier ultimately needs, exactly as in the diagnostic-test example where a positive test result and known disease prevalence combined to give the true probability of disease. Here, `P(x|y)` and `P(y)` are what the model actually fits from training data; `P(y|x)` is derived afterward via this same formula, not fit directly.

### Gaussian Discriminant Analysis (GDA)

GDA assumes each class's features are drawn from a multivariate normal distribution — the same normal distribution from `foundations/probability-statistics`, generalized to several dimensions — with a class-specific mean `μ_y` (and, in the simplest version, a shared covariance across classes). Fitting the model means estimating each class's mean and the shared covariance directly from the training examples belonging to that class; classifying a new point means computing `P(x|y)` under each class's fitted Gaussian, multiplying by that class's prior `P(y)`, and picking the class with the larger result.

### Naive Bayes and the conditional-independence assumption

Naive Bayes takes a different, and computationally much cheaper, generative approach: it assumes every feature is **conditionally independent given the class** — that is, `P(x₁, x₂, ..., xₙ | y) = P(x₁|y) · P(x₂|y) · ... · P(xₙ|y)`. This assumption is almost always literally false (in a spam classifier, the words "free" and "money" genuinely tend to co-occur, not independently), which is exactly why the model is called "naive" — but the assumption reduces fitting an entire joint distribution over `n` features to fitting `n` separate one-dimensional distributions, one per feature, per class, making it dramatically cheaper to estimate from limited data and fast to compute at prediction time.

## Worked Examples

### Example 1: A GDA-style classification decision

Suppose a two-class problem (disease present or absent) has fitted class priors `P(disease) = 0.01`, `P(no disease) = 0.99`, and fitted class-conditional densities for a single feature `x` (a test score) evaluated at a patient's actual score: `P(x | disease) = 0.6`, `P(x | no disease) = 0.02`. Applying Bayes' theorem to compare the two posterior numerators (the denominator `P(x)` is the same for both classes, so it can be ignored when just comparing which class is more likely):

```text
Numerator for "disease":    P(x|disease)·P(disease)    = 0.6 · 0.01  = 0.006
Numerator for "no disease": P(x|no disease)·P(no disease) = 0.02 · 0.99 = 0.0198
```

Even though the test score is much more likely under "disease" in isolation (0.6 vs. 0.02), the low prior probability of disease (0.01) still leaves "no disease" as the more probable class overall (0.0198 > 0.006) — the same prevalence-dominates-a-single-observation lesson already demonstrated with concrete numbers in the Bayes' theorem diagnostic-test example.

### Example 2: Naive Bayes for spam, with the independence assumption made explicit

For an email with features "contains 'free'" (`x₁=1`) and "contains 'winner'" (`x₂=1`), Naive Bayes computes:

```text
P(x₁=1, x₂=1 | spam) ≈ P(x₁=1|spam) · P(x₂=1|spam) = 0.3 · 0.25 = 0.075
```

instead of estimating the true joint probability `P(x₁=1, x₂=1 | spam)` directly from data, which would require far more training examples to estimate reliably (every combination of feature values needs enough examples to estimate its own probability). The independence assumption trades this modeling accuracy for a `n`-times cheaper estimation problem — in practice, a tradeoff that works surprisingly well for text classification despite being technically false.

## Common Misconceptions & Pitfalls

- **"Naive Bayes assumes the features are actually independent, so it's a bad model whenever that's false."** Naive Bayes routinely performs well even when the independence assumption is clearly violated (as with words in a document) — what matters for correct classification is not that the estimated probabilities are exactly right, only that the *relative ordering* of classes by posterior probability comes out correct, which the independence assumption often preserves even when it distorts the raw probability values.
- **"Generative and discriminative models with the same data should give the same decision boundary."** They generally do not — GDA implicitly assumes a specific parametric form (Gaussian class-conditionals), and when that assumption is wrong, its decision boundary can differ meaningfully from logistic regression's, which makes no assumption about the shape of the data at all, only about the shape of the boundary.
- **"Bayes' theorem here is a different formula from the one in the probability discipline."** It is the identical formula, applied to a different domain — classes and features in place of disease status and test results — the same structure, the same caution about prior probabilities dominating a single piece of evidence.

## Summary

Gaussian Discriminant Analysis and Naive Bayes are both generative classifiers: instead of modeling `P(y|x)` directly like logistic regression, they model each class's data-generating distribution `P(x|y)` and its prior `P(y)`, then invert these via Bayes' theorem — already proven in full in `foundations/probability-statistics` — to obtain the classification probability actually needed. GDA assumes each class's features follow a multivariate normal distribution; Naive Bayes instead assumes every feature is conditionally independent given the class, a usually-false but computationally powerful simplification that still routinely yields correct classifications in practice.

## Documentation Links

- [Stanford CS229 — Lecture Notes, Part II: Classification and Logistic Regression](https://cs229.stanford.edu/main_notes.pdf) — covers GDA and Naive Bayes as the generative counterpart to logistic regression.
- [James, Witten, Hastie & Tibshirani — An Introduction to Statistical Learning](https://www.statlearning.com/) — Chapter 3 discusses generative classifiers (linear/quadratic discriminant analysis, Naive Bayes) alongside logistic regression.
