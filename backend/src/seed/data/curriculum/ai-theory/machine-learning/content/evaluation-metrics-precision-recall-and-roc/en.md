---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Explain why raw accuracy is a misleading metric on imbalanced classification data, with a concrete numeric example.
- Define the confusion matrix and derive precision, recall, and F1 score from it.
- Explain the precision-recall tradeoff, and describe how the ROC curve visualizes it across every possible classification threshold.
- Choose an appropriate metric for a given real-world classification scenario based on the relative cost of false positives versus false negatives.

## Context & Motivation

Every classifier covered so far in this discipline — logistic regression, GDA, Naive Bayes — has been judged, implicitly, by whether its predictions are correct. This concept makes that judgment precise and, crucially, shows that "correct" is not a single number once classes are imbalanced or once false positives and false negatives carry different real-world costs. A spam filter that never flags anything as spam still achieves high raw accuracy if spam is rare — a genuinely misleading result that motivates every metric introduced here.

## Core Theory

### The confusion matrix

For a binary classifier, every prediction falls into one of four categories, forming the **confusion matrix**:

```text
                    Predicted Positive    Predicted Negative
Actual Positive     True Positive (TP)    False Negative (FN)
Actual Negative     False Positive (FP)   True Negative (TN)
```

### Precision, recall, and F1

```text
Precision = TP / (TP + FP)      — of everything predicted positive, what fraction actually is?
Recall    = TP / (TP + FN)      — of everything actually positive, what fraction did the model catch?
F1        = 2 · (Precision · Recall) / (Precision + Recall)     — the harmonic mean of the two
```

Precision and recall answer genuinely different questions and can move in opposite directions: a classifier that predicts "positive" for almost everything achieves near-perfect recall (it catches nearly every true positive) but very poor precision (most of its positive predictions are wrong). F1 combines both into a single number, useful when both matter and neither should be optimized at the total expense of the other.

### The ROC curve

Most classifiers (like logistic regression) output a probability, and a threshold (commonly 0.5) converts that probability into a hard positive/negative decision. The **ROC (Receiver Operating Characteristic) curve** plots the true positive rate against the false positive rate as this threshold is swept across every possible value from 0 to 1, giving a full picture of the tradeoff between catching more true positives and accepting more false positives, rather than committing to a single threshold's single point on that tradeoff. The **area under the ROC curve (AUC)** summarizes this entire tradeoff in one number, useful for comparing classifiers independent of any specific threshold choice.

## Worked Examples

### Example 1: Why accuracy misleads on imbalanced data

Consider a dataset with 1000 emails, of which 950 are legitimate and 50 are spam (a realistic imbalance). A classifier that predicts "not spam" for every single email achieves:

```text
Accuracy = (TP + TN) / Total = (0 + 950) / 1000 = 95.0%
```

A 95% accuracy that is completely useless — the classifier catches zero spam. Its recall is `0 / 50 = 0%`, immediately exposing the problem accuracy alone hid.

### Example 2: A full confusion-matrix worked example

Suppose the same 1000-email dataset is evaluated with an actual spam classifier, yielding:

```text
                  Predicted Spam    Predicted Not-Spam
Actual Spam       TP = 35           FN = 15
Actual Not-Spam   FP = 20           TN = 930

Precision = 35 / (35 + 20) = 35/55 ≈ 0.636   (63.6% of flagged emails are truly spam)
Recall    = 35 / (35 + 15) = 35/50 = 0.700   (70.0% of true spam was caught)
F1        = 2 · (0.636 · 0.700) / (0.636 + 0.700) ≈ 0.667

Accuracy  = (35 + 930) / 1000 = 96.5%
```

The 96.5% accuracy looks strong, but the precision (63.6%) and recall (70.0%) reveal the real, more nuanced picture: nearly a third of flagged emails are false alarms, and 30% of actual spam still slips through — information the accuracy figure alone completely obscures.

## Common Misconceptions & Pitfalls

- **"A model with 99% accuracy is almost certainly excellent."** On imbalanced data, 99% accuracy can be achieved by a trivial classifier that never predicts the rare class at all, exactly as demonstrated in Example 1 — accuracy alone is uninformative without knowing the class balance and checking precision/recall directly.
- **"Precision and recall should always be maximized together."** They are frequently in direct tension: raising the classification threshold typically raises precision (fewer, more confident positive predictions) while lowering recall (more true positives missed) — the right balance depends entirely on the real-world cost of a false positive versus a false negative (e.g., in cancer screening, missing a true case — low recall — is usually far costlier than a false alarm, so high recall is prioritized even at some precision cost).
- **"AUC alone is enough to fully evaluate a classifier."** AUC summarizes performance across every threshold, which is useful for comparing models in the abstract, but a deployed system commits to one specific threshold — the actual precision and recall at that chosen operating point still need to be checked directly, not inferred from AUC alone.

## Summary

Raw accuracy can be dangerously misleading on imbalanced classification data, exactly as a naive "always predict the majority class" classifier demonstrates. Precision (correctness of positive predictions) and recall (coverage of true positives) decompose the confusion matrix into two metrics that trade off against each other as the classification threshold changes, with F1 combining them into a single balanced score and the ROC curve/AUC visualizing the full tradeoff across every possible threshold. Choosing the right metric — and the right threshold — depends on the real-world relative cost of false positives versus false negatives in the specific application.

## Documentation Links

- [James, Witten, Hastie & Tibshirani — An Introduction to Statistical Learning](https://www.statlearning.com/) — Chapter 3 (Classification) introduces the confusion matrix, precision/recall, and ROC curves in the same worked-example style used here.
- [Stanford CS229 — Lecture Notes, Part II: Classification and Logistic Regression](https://cs229.stanford.edu/main_notes.pdf) — covers classifier evaluation metrics alongside the logistic regression model they apply to.
