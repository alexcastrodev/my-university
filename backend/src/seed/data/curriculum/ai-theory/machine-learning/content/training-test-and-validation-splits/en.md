---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Explain why a model must be evaluated on data it did not train on, and why measuring performance on the training set alone is close to meaningless.
- Distinguish the three-way split — training, validation, and test — and state what each one is used for.
- Explain the discipline of touching the test set exactly once, at the very end, and why repeatedly checking test performance while iterating on a model silently turns the test set into a second validation set.
- Describe how this practical discipline is the direct, applied answer to the feasibility-of-learning question raised in the previous concept.

## Context & Motivation

The Hoeffding bound in the previous concept gives a mathematical guarantee that in-sample error tracks out-of-sample error — but only if the error is actually measured on data genuinely separate from what a model was fit to. This concept turns that guarantee into a concrete engineering practice: never trust a number computed on the same data a model trained on, because a sufficiently flexible model can always be made to fit its own training data almost perfectly, telling you nothing about how it performs elsewhere.

This is one of the most consequential habits in applied machine learning, and it is also one of the easiest to violate by accident — for instance, by trying ten different models, checking each one's performance on a "test set," and reporting the best one. That practice quietly reintroduces exactly the many-hypotheses problem flagged in the previous concept: the test set has effectively become part of the search, and the reported number no longer means what it claims to mean.

## Core Theory

### The three-way split

A dataset is typically divided into three disjoint parts:

1. **Training set** — the data a model's parameters are actually fit to.
2. **Validation set** — held out from training, used to compare different models or different hyperparameter choices (how many trees, how much regularization) and pick a winner.
3. **Test set** — held out from both training and validation, touched exactly once, at the very end, to report a final, honest estimate of how the chosen model performs on unseen data.

A common split ratio is 60/20/20 or 70/15/15, though the right proportions depend on how much data is available in total.

### Why validation and test cannot be the same set

If model selection (comparing many candidate models or hyperparameters) is done directly against the test set, the model that happens to score best on that particular set is chosen — which reintroduces the many-hypotheses overfitting risk from the previous concept, now applied to the test set itself rather than the training set. The validation set exists specifically to absorb this search process, leaving the test set's number uncontaminated and trustworthy as a final report.

### The one-touch rule

The discipline this concept is really teaching is behavioral: the test set is touched exactly once. Every decision about which model, which features, which hyperparameters — all of that happens using only the training and validation sets. Only after every such decision is locked in is the test set evaluated, a single time, to report the number that will actually be trusted or published. Checking test performance repeatedly during development and adjusting the model in response turns the test set into an informal second validation set, and the reported final number stops meaning what it is supposed to mean.

## Worked Examples

### Example 1: A concrete 1000-example split

```text
Total examples: 1000
Training:   600 examples (60%) — model parameters fit here
Validation: 200 examples (20%) — compare 5 candidate models here, pick the best
Test:       200 examples (20%) — touched once, at the end, to report final accuracy
```

Suppose 5 candidate models are trained on the 600 training examples and evaluated on the 200 validation examples:

```text
Model A: 78% validation accuracy
Model B: 85% validation accuracy   ← chosen
Model C: 81% validation accuracy
Model D: 83% validation accuracy
Model E: 79% validation accuracy
```

Model B is selected based on validation performance. Only now is it run once on the 200 test examples, yielding (say) 84% — the number that gets reported as the model's true generalization performance.

### Example 2: The contamination scenario

Suppose instead all 5 models above are evaluated directly on the test set, and Model B (84% test accuracy) is chosen because it scored highest there. Even though 84% is a real number, it is now an optimistically biased estimate of true performance: Model B was chosen *because* it happened to score best on this particular test set among 5 candidates, so some of that 84% reflects lucky alignment between Model B and this specific 200-example sample, not purely Model B's true out-of-sample accuracy. Reporting 84% as the expected performance on new data would be misleading.

## Common Misconceptions & Pitfalls

- **"If my model gets 99% accuracy on the training set, it's a great model."** This measures memorization capacity, not generalization — a sufficiently flexible model can reach near-100% training accuracy while performing far worse on new data (a symptom of the overfitting this discipline's model-complexity cluster addresses directly).
- **"I can peek at the test set a few times while tuning, as long as I don't retrain on it."** Even without retraining directly on the test data, choosing which model or hyperparameters to keep based on test performance is itself a form of fitting to the test set — this is exactly the contamination in Example 2.
- **"Validation and test sets serve the same purpose, so one held-out set is enough."** They serve different purposes: validation supports model *selection* (comparing many candidates), test supports final *reporting* (one honest number) — collapsing them into one set makes the final reported number no longer trustworthy as an unbiased estimate.

## Summary

Because a model's performance on its own training data says little about how it will perform on new data, a real ML workflow splits data into training (fit parameters), validation (select among candidate models or hyperparameters), and test (report one final, honest performance number, touched exactly once). This is the direct practical answer to the feasibility-of-learning concern raised by the Hoeffding bound: the guarantee that in-sample error tracks out-of-sample error only holds if "in-sample" and "out-of-sample" are kept genuinely separate, and this three-way split is how that separation is actually enforced in practice.

## Documentation Links

- [James, Witten, Hastie & Tibshirani — An Introduction to Statistical Learning](https://www.statlearning.com/) — Chapter 5 (Resampling Methods) covers this split and the cross-validation technique this discipline returns to later.
- [Caltech CS 156 — Learning From Data, Lecture 13: Validation](https://work.caltech.edu/telecourse.html) — the real lecture formalizing the validation set's role between training and test.
