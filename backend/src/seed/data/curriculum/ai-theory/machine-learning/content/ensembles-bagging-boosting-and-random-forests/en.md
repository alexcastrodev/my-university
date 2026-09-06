---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Explain the general principle behind ensemble methods: combining many individually imperfect models into one that performs better than any single member.
- Describe bagging (bootstrap aggregating) and explain, precisely, why averaging many independent high-variance models reduces variance without changing bias.
- Describe how a random forest adds feature-sampling on top of bagging, and why this improves on plain bagged trees.
- Describe boosting's fundamentally different strategy — sequential correction of errors — and contrast it directly with bagging.

## Context & Motivation

The previous concept ended by noting that an unconstrained decision tree is a high-variance model — accurate on its own training data, but sensitive to exactly which sample it was trained on. Ensemble methods address this not by constraining any single tree (as pruning or depth limits do), but by training *many* trees and combining their predictions — turning the very instability that makes a single deep tree unreliable into an asset, since different unstable trees tend to make different mistakes that partially cancel out when averaged.

## Core Theory

### Bagging: averaging many independent, high-variance models

**Bootstrap aggregating (bagging)** draws many bootstrap samples (random samples of the same size as the original training set, drawn with replacement) from the training data, fits a separate deep, unconstrained decision tree to each bootstrap sample, and combines their predictions by averaging (for regression) or majority vote (for classification). Because each tree sees a slightly different bootstrap sample, each makes somewhat different errors; averaging many such trees reduces the *variance* component of prediction error (from this discipline's bias-variance decomposition) without meaningfully increasing bias, since the trees are, on average, still fitting the same true underlying pattern.

### Random forests: bagging plus feature randomness

A **random forest** adds one further source of randomness on top of bagging: at each split in each tree, only a random subset of the available features is considered as candidates, rather than every feature. This deliberately decorrelates the trees further — without it, if one feature is very strongly predictive, nearly every bagged tree would choose to split on it near the root, making the trees highly correlated with each other and limiting how much averaging can reduce variance (averaging correlated estimates reduces variance less than averaging independent ones). Forcing each tree to sometimes ignore the single best feature produces a more diverse ensemble, and empirically better variance reduction.

### Boosting: sequential error correction, a different strategy entirely

**Boosting** takes a fundamentally different approach from bagging's parallel, independent trees. Boosting builds trees **sequentially**, and each new tree is trained specifically to correct the errors of the ensemble built so far — for instance, by fitting the next tree to the *residual* errors of the current ensemble's predictions (as in gradient boosting), so each addition focuses computational effort exactly where the model is currently weakest. Unlike bagging's individually deep, high-variance trees, boosting typically uses very shallow trees (sometimes just a single split) as its individual members, since each one only needs to correct a small piece of the remaining error, not model the whole pattern alone.

## Worked Examples

### Example 1: Bagging reducing variance by averaging

Suppose 5 individually high-variance trees, each trained on a different bootstrap sample, predict a house's price as: `210k, 195k, 230k, 180k, 225k` (true price: 208k). Averaging:

```text
Bagged prediction = (210 + 195 + 230 + 180 + 225) / 5 = 1040 / 5 = 208k
```

The average lands very close to the true value, even though individual trees ranged from 180k to 230k — a real, computable illustration of variance reduction through averaging: each tree's individual error partly cancels against the others' errors in the opposite direction.

### Example 2: One round of gradient boosting, by hand

Suppose the true target values for 3 examples are `[10, 20, 30]`, and the current ensemble (perhaps just a single, very simple first tree) predicts `[8, 22, 25]`. The residuals — what boosting fits next — are:

```text
Residuals = true − predicted = [10−8, 20−22, 30−25] = [2, −2, 5]
```

A new, shallow tree is now trained specifically to predict these residuals (not the original targets), and its predictions are *added* to the current ensemble's predictions (typically scaled down by a small learning rate, exactly as in gradient descent from earlier in this discipline). If this new tree predicts residuals of `[1.8, −1.5, 4.2]`, the updated ensemble prediction becomes `[8+1.8, 22−1.5, 25+4.2] = [9.8, 20.5, 29.2]` — visibly closer to the true `[10, 20, 30]` than before this boosting round.

## Common Misconceptions & Pitfalls

- **"More trees in a bagged ensemble always risk overfitting, just like a deeper single tree."** This is false for bagging specifically: adding more bootstrap-sampled trees to average over generally does not increase overfitting risk (it further reduces variance), unlike increasing a single tree's depth, which directly increases that tree's own capacity to overfit.
- **"Random forests and bagged trees are essentially the same thing."** The feature-subsampling step is not a minor detail — it is specifically what decorrelates the trees when one feature dominates, and its absence (plain bagging) can leave an ensemble far less effective at variance reduction than a true random forest on data with a few very strong predictors.
- **"Boosting and bagging are interchangeable techniques for the same goal."** They address different halves of the bias-variance tradeoff: bagging primarily reduces variance by averaging many already-low-bias, high-variance models; boosting primarily reduces bias by sequentially adding capacity exactly where the current ensemble underfits, often starting from high-bias, low-variance individual trees.

## Summary

Ensemble methods combine many individually imperfect models to outperform any single one. Bagging trains many deep, unconstrained trees on independent bootstrap samples and averages their predictions, directly reducing the variance component of error identified by this discipline's bias-variance decomposition; random forests add random feature subsampling at each split to further decorrelate the trees for better variance reduction. Boosting takes a different strategy entirely — building trees sequentially, each one correcting the current ensemble's residual errors — primarily reducing bias rather than variance, and typically using much shallower individual trees than bagging does.

## Documentation Links

- [James, Witten, Hastie & Tibshirani — An Introduction to Statistical Learning](https://www.statlearning.com/) — Chapter 7 covers bagging, random forests, and boosting together with the bias-variance framing used here.
- [Caltech CS 156 — Learning From Data, Lecture 8: Bias-Variance Tradeoff](https://work.caltech.edu/telecourse.html) — the decomposition this concept applies directly to explain why bagging works.
