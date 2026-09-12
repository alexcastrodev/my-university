---
version: 1.0
updatedAt: 2026-09-12
---
## Learning Objectives

- Run the final, selected model from Lab 7 against a genuinely fair baseline, applying `graduate-studies/research-statistics`'s own baseline-fairness discipline.
- Evaluate the result using precision, recall, and ROC curves rather than accuracy alone, matching Evaluation Metrics: Precision, Recall, and ROC's own account of what accuracy hides.
- Run the evaluation across multiple random seeds and report honest variability, not a single, seed-dependent number.
- Write a short report answering Lab 5's original hypothesis directly, stating whether it was supported or refuted by the actual evidence.

## Context & Motivation

Every earlier lab in this arc, forming a hypothesis, splitting data honestly, selecting model complexity, has been building toward this one moment: the single, real experiment this whole discipline's research cycle exists to produce. This lab applies `graduate-studies/research-statistics`'s own `baselines-and-persuasive-data` discipline directly, choosing a genuinely fair baseline, not a strawman, and reports the result the way that discipline requires, with honest variability and a direct answer to the hypothesis that motivated the whole project.

## Core Theory

Nothing about *why* a baseline needs to be fair, or *why* accuracy alone can be misleading on an imbalanced dataset, is re-derived here; both arguments already exist in `baselines-and-persuasive-data` and `evaluation-metrics-precision-recall-and-roc`. This lab applies both directly to Lab 7's selected model, run for the first and only time against the test set locked away since Lab 6.

## Worked Examples

### Step 1 — choosing a fair baseline, not a strawman

```python
def majority_class_baseline(y_train):
    # A genuinely standard, real baseline: predict the most common
    # class always — deliberately NOT an untrained or randomly
    # initialized version of the same model, which would be a
    # strawman comparison baselines-and-persuasive-data warns against
    majority = np.bincount(y_train).argmax()
    return lambda X: np.full(len(X), majority)

def logistic_baseline(X_train, y_train):
    # A SECOND, stronger baseline: an UNREGULARIZED logistic
    # regression at Lab 6's original feature set, no complexity
    # sweep applied — a real, standard comparison point, not the
    # weakest possible one
    w = logistic_fit(add_bias_column(X_train), y_train)
    return lambda X: sigmoid(add_bias_column(X) @ w) >= 0.5
```

### Step 2 — evaluating with the full metric set, not accuracy alone

```python
def evaluate_full(model_predict_fn, X_test, y_test):
    predictions = model_predict_fn(X_test)
    tp = np.sum((predictions == 1) & (y_test == 1))
    fp = np.sum((predictions == 1) & (y_test == 0))
    fn = np.sum((predictions == 0) & (y_test == 1))
    tn = np.sum((predictions == 0) & (y_test == 0))

    precision = tp / (tp + fp) if (tp + fp) > 0 else 0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0
    accuracy = (tp + tn) / len(y_test)
    return {"accuracy": accuracy, "precision": precision, "recall": recall}
```

On a dataset where one class is rare, exactly the case `evaluation-metrics-precision-recall-and-roc` uses to motivate this in the first place, `majority_class_baseline` can achieve a deceptively high accuracy purely by always predicting the common class, while its recall on the rare class is exactly zero; reporting accuracy alone here would make a genuinely useless baseline look competitive.

### Step 3 — running across multiple seeds, reporting honest variability

```python
def test_final_experiment_across_seeds():
    results = []
    for seed in range(10):
        X_train, y_train, X_val, y_val, X_test, y_test = load_split(seed=seed)
        selected_degree = select_final_model_from_lab7(X_train, y_train, X_val, y_val)
        final_model = fit_final_model(X_train, y_train, degree=selected_degree)

        metrics = evaluate_full(final_model.predict, X_test, y_test)
        results.append(metrics)

    accuracies = [r["accuracy"] for r in results]
    print(f"Final model accuracy: {np.mean(accuracies):.3f} +/- {np.std(accuracies):.3f} across 10 seeds")
    # THIS is the honest number — a single seed's result, reported
    # alone, would hide exactly this variability
```

### Step 4 — the written report, answering Lab 5's hypothesis directly

```text
EXPERIMENT REPORT

Hypothesis (from forming-a-falsifiable-hypothesis-on-a-real-dataset):
  "Regularization improves held-out R² by at least 0.03 compared to
  the unregularized version, on [dataset]'s held-out split."

Baseline: unregularized logistic/linear model at Lab 6's original
  feature set (a real, standard baseline — see Step 1).

Result: Ridge-regularized model achieved a mean held-out accuracy of
  0.847 +/- 0.012 across 10 seeds, versus 0.809 +/- 0.019 for the
  unregularized baseline, an improvement of 0.038.

Verdict: HYPOTHESIS SUPPORTED — the observed improvement (0.038)
  exceeds the pre-registered threshold (0.03), and the variability
  across seeds (+/- 0.012 and +/- 0.019) is small relative to that gap.
```

## Common Misconceptions & Pitfalls

- **"A single, well chosen run is enough to report a final result."** Step 3's own comparison across 10 seeds is specifically what would reveal a result that only looked strong due to one favorable random initialization or split; a single run cannot distinguish a real, reliable effect from a coincidence of that one run's particular randomness.
- **"An untrained or randomly initialized model is a fine baseline, since anything trained should beat it."** This is exactly the weak, unfairly easy comparison `baselines-and-persuasive-data` warns against; Step 1's two baselines, majority-class prediction and an actual trained logistic model, are both genuinely standard, competitive comparison points a knowledgeable reader would expect, not strawmen chosen to make the final model look better than it is.
- **"Reporting whichever metric shows the model in the best light is acceptable, since the model did genuinely improve on it."** This is the exact failure `forming-a-falsifiable-hypothesis-on-a-real-dataset` was written specifically to prevent; Step 4's report answers the metric and threshold pre-registered in Lab 5, not a metric selected after the fact because it happened to look favorable.

## Summary

This lab runs the single, real experiment this discipline's research cycle has been building toward: Lab 7's selected model evaluated against a genuinely fair baseline (not a strawman), using the full precision/recall/accuracy metric set rather than accuracy alone, across multiple random seeds to report honest variability rather than a single, seed-dependent number. The lab's real deliverable is a written report answering Lab 5's pre-registered hypothesis directly, stating plainly whether the actual, honestly measured evidence supports or refutes it, exactly the discipline `graduate-studies/research-statistics` establishes and this lab applies to a real, hands-on ML project for the first time.

## Documentation Links

- [James, Witten, Hastie & Tibshirani — An Introduction to Statistical Learning](https://www.statlearning.com/): the source for the precision/recall/ROC evaluation metrics this lab applies instead of accuracy alone.
- [ACM Digital Library: Justin Zobel, Writing for Computer Science (3rd Edition, Springer, 2014)](https://dl.acm.org/doi/10.5555/2742708): the source for the baseline-fairness and variability-reporting discipline this lab's final experiment and report are built on.
