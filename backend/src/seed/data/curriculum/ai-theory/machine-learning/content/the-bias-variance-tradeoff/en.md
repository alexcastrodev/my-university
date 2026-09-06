---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- State the bias-variance decomposition of expected prediction error, and define bias and variance precisely, not just qualitatively.
- Explain why a model too simple for the true pattern has high bias, and why a model too flexible has high variance.
- Compute a concrete, numeric bias-variance decomposition on a small worked example.
- Explain why reducing bias and reducing variance are generally in tension, and connect this directly to model complexity.

## Context & Motivation

Every model covered so far in this discipline — linear regression, logistic regression, GDA, Naive Bayes — has a fixed level of flexibility built into its form. This concept asks a question that applies to all of them equally: given a choice between a simple model and a more flexible one, which one actually generalizes better? Caltech's "Learning From Data" course dedicates a full lecture to exactly this question, framed as a formal decomposition of prediction error into two distinct, competing sources, rather than a vague appeal to "don't overfit."

This decomposition is the conceptual foundation for nearly every practical technique in this discipline's remaining model-complexity and evaluation cluster: regularization, cross-validation, and the choice between simple and complex model families all exist because of the tension this concept makes precise.

## Core Theory

### The decomposition

For a model trained on random samples of training data, the expected squared prediction error at a fixed test point, averaged over many possible training sets, decomposes into three terms:

```text
Expected Error = Bias² + Variance + Irreducible Noise
```

- **Bias** is the error from the model's own assumptions being wrong — a linear model trying to fit a genuinely curved relationship will systematically miss it, regardless of how much training data it gets. Bias is high when the model class is too simple to represent the true pattern.
- **Variance** is the error from the model's sensitivity to which particular training sample it happened to see — a highly flexible model can fit very different curves depending on which noisy sample of points it was trained on, even if the underlying true relationship never changes. Variance is high when the model class is so flexible that it fits the noise in each particular sample, not just the signal.
- **Irreducible noise** is the error from randomness inherent in the data itself, which no model, however well chosen, can eliminate.

### Why the two sources trade off against each other

Reducing bias generally means using a more flexible model (more features, a higher-degree polynomial, a deeper decision tree) — but a more flexible model has more capacity to fit the specific noise of whatever training sample it receives, which increases variance. Conversely, reducing variance by choosing a simpler, more constrained model increases bias, because the simpler model may be structurally unable to capture the true relationship no matter how much data it sees. This is the **bias-variance tradeoff**: total expected error is minimized not by pushing bias or variance to zero individually, but by finding the model complexity that balances the two.

### Connecting to overfitting and underfitting

A model with high bias and low variance is said to **underfit** — it is too simple and performs poorly even on the training data itself. A model with low bias and high variance **overfits** — it performs very well on its own training data but poorly on new data, because it has fit noise specific to that sample rather than the true underlying pattern. The next concept in this discipline, the VC dimension, gives a precise, quantitative way to measure how much capacity a model class has to overfit, before ever fitting it to real data.

## Worked Examples

### Example 1: A numeric bias-variance decomposition

Suppose the true relationship is `y = 3 + 2x` plus noise with variance 1, and three model classes are compared by fitting each to many independently drawn training sets and averaging their predictions at `x = 5` (true value: `3 + 2(5) = 13`):

```text
Model A (constant, ŷ = c): average prediction 10.0 across many training sets, prediction varies little (9.8–10.2)
   Bias² = (13 − 10.0)² = 9.0        Variance ≈ 0.04       Total ≈ 9.04 (dominated by bias)

Model B (linear, ŷ = θ₀+θ₁x): average prediction 13.0, prediction varies a bit (12.7–13.3)
   Bias² = (13 − 13.0)² = 0.0        Variance ≈ 0.09       Total ≈ 0.09 (well balanced)

Model C (degree-9 polynomial): average prediction 13.0, prediction varies wildly (8.0–18.0)
   Bias² = (13 − 13.0)² = 0.0        Variance ≈ 9.0        Total ≈ 9.0 (dominated by variance)
```

Model A underfits (systematic bias from assuming no slope at all); Model C overfits (correct on average, but wildly unreliable per-sample); Model B, matching the true linear form, achieves both low bias and low variance — the lowest total error of the three.

### Example 2: Same total error, opposite causes

Notice that Model A and Model C in Example 1 both land near a total expected error of ~9, despite being wrong for opposite reasons — Model A is too rigid (high bias, low variance) and Model C is too flexible (low bias, high variance). This is the concrete illustration of why "total error is low" alone does not diagnose the problem; decomposing it into its bias and variance components tells you which direction — simplify, or add more data/regularize — is the correct fix.

## Common Misconceptions & Pitfalls

- **"A model with low training error is a good model."** Low training error indicates low bias on that particular sample, but says nothing about variance — Model C in Example 1 can achieve near-zero training error while performing terribly on new data, exactly the overfitting scenario this decomposition is built to diagnose.
- **"More training data always fixes overfitting."** More data specifically reduces variance (a flexible model has less room to fit noise when the noise is averaged over more examples), but does nothing to reduce bias — an underfitting model given more data remains just as biased, since its structural assumption about the relationship's form never changes.
- **"Bias and variance are properties of the data, not the model."** They are properties of the *combination* of a model class and the data-generating process — the same dataset can be fit by a high-bias model (a constant) or a high-variance one (a degree-20 polynomial); bias and variance describe how a chosen model class responds to that data, not an intrinsic property of the data alone.

## Summary

Expected prediction error decomposes into bias (systematic error from a model too simple to represent the true relationship), variance (error from sensitivity to which particular training sample was seen), and irreducible noise. Reducing one generally increases the other — simplifying a model reduces variance but raises bias, and vice versa — so the practical goal is not eliminating either term individually but choosing the model complexity that minimizes their sum. This tension is the conceptual foundation for the VC dimension, regularization, and cross-validation techniques that follow in this discipline's model-complexity cluster.

## Documentation Links

- [Caltech CS 156 — Learning From Data, Lecture 8: Bias-Variance Tradeoff](https://work.caltech.edu/telecourse.html) — the real lecture this decomposition and its learning-curve framing are drawn from.
- [James, Witten, Hastie & Tibshirani — An Introduction to Statistical Learning](https://www.statlearning.com/) — Chapter 2 presents the same decomposition with real learning-curve plots.
