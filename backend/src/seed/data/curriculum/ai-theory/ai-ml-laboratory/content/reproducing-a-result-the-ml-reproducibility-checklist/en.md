---
version: 1.0
updatedAt: 2026-09-12
---
## Learning Objectives

- Apply the NeurIPS Reproducibility Program's own checklist to Lab 8's experiment: exact hyperparameters, data preprocessing steps, random seeds, and software/hardware versions.
- Simulate a typically under-documented paper by deliberately withholding checklist items, and observe a fresh reproduction attempt fail as a result.
- Fill in every checklist item and confirm the same reproduction attempt now succeeds, matching the original reported result within expected variability.
- Explain, using real data from the NeurIPS report, how common and how consequential missing reproducibility information actually is in published machine learning research.

## Context & Motivation

`running-and-reporting-a-real-experiment` produced a real result and a written report. This lab asks a harder, more uncomfortable question about that result: could someone else, given only what was written down, actually reproduce it? The NeurIPS Reproducibility Program's own real, peer-reviewed report, published in JMLR, documents this exact problem at scale, with real, collected data from real submitted machine learning papers, not as a hypothetical concern but as a measured, common failure.

## Core Theory

Nothing about *why* reproducibility matters, or the general case for describing experiments precisely, is re-derived here; that argument already exists in `graduate-studies/research-statistics`'s own `coding-for-experimentation-and-describing-experiments`. This lab applies the specific, real checklist the NeurIPS program developed, machine-learning-specific items a general experimentation checklist does not name explicitly, hyperparameter search ranges, exact random seeds, exact software versions, to Lab 8's own experiment directly.

## Worked Examples

### The checklist, applied to Lab 8's own experiment

```text
NeurIPS Reproducibility Checklist items relevant to this arc's experiment:

[ ] All training details (hyperparameters, learning rate, iterations)
[ ] Number of random seeds used, and how variability was reported
[ ] Exact train/validation/test split methodology
[ ] Exact data preprocessing steps (including the normalization
    statistics source — see dataset-work-splits-leakage-and-honest-
    evaluation's own leakage discussion)
[ ] Software versions (NumPy version, Python version)
[ ] Hardware used, if runtime or timing is reported
[ ] A link to, or inclusion of, the actual code
```

### Step 1 — simulating a typically under-documented paper

```text
"UNDER-DOCUMENTED" METHODS SECTION (deliberately incomplete, matching
the NeurIPS report's own documented pattern of common omissions):

  "We trained a regularized linear model on the housing dataset and
  achieved a held-out accuracy of 0.847, outperforming a baseline by
  0.038."

Missing: the regularization STRENGTH (lambda), the exact random
seed(s), the exact preprocessing steps, and the exact baseline
definition — all real, common omissions the NeurIPS report documents
across actual submitted papers, not omissions invented for this lab.
```

### Step 2 — a fresh reproduction attempt, given ONLY the under-documented description

```python
def attempt_reproduction_from_underdocumented_description():
    # A fresh implementation, written by someone who has ONLY read the
    # methods section above, with no access to Lab 7/Lab 8's actual code
    X, y = load_real_dataset()
    X_train, y_train, X_test, y_test = arbitrary_split(X, y, seed=42)  # guessed seed
    w = ridge_fit(add_bias_column(X_train), y_train, lam=1.0)          # guessed lambda
    accuracy = evaluate_full(lambda X: sigmoid(add_bias_column(X) @ w) >= 0.5, X_test, y_test)["accuracy"]
    return accuracy

def test_reproduction_fails_without_full_checklist():
    reproduced_accuracy = attempt_reproduction_from_underdocumented_description()
    original_accuracy = 0.847  # from running-and-reporting-a-real-experiment
    assert abs(reproduced_accuracy - original_accuracy) > 0.02, \
        "a reproduction attempt guessing at missing hyperparameters and split methodology should NOT closely match the original"
```

### Step 3 — the same attempt, with EVERY checklist item now filled in

```python
def attempt_reproduction_with_full_checklist():
    X, y = load_real_dataset()
    # Every value below now comes DIRECTLY from Lab 6/Lab 7/Lab 8's own
    # recorded configuration, not a guess
    X_train, y_train, X_test, y_test = correct_split(X, y, seed=EXACT_SEED_FROM_LAB6)
    train_mean, train_std = X_train.mean(axis=0), X_train.std(axis=0)
    X_train_norm = (X_train - train_mean) / train_std
    X_test_norm = (X_test - train_mean) / train_std
    w = ridge_fit(add_bias_column(X_train_norm), y_train, lam=EXACT_LAMBDA_FROM_LAB7)
    accuracy = evaluate_full(lambda X: sigmoid(add_bias_column(X) @ w) >= 0.5, X_test_norm, y_test)["accuracy"]
    return accuracy

def test_reproduction_succeeds_with_full_checklist():
    reproduced_accuracy = attempt_reproduction_with_full_checklist()
    original_accuracy = 0.847
    assert abs(reproduced_accuracy - original_accuracy) < 0.005, \
        "with every checklist item specified exactly, reproduction should match the original closely"
```

### Step 4 — what the real NeurIPS report actually found

```text
The NeurIPS Reproducibility Program's own report documents, from real
submitted papers, that missing information of exactly this kind
(hyperparameter values, random seeds, preprocessing details) was a
common, measured cause of failed reproduction attempts, motivating the
checklist's inclusion as a formal part of the submission process at a
major machine learning venue, not a suggestion offered as optional
best practice.
```

## Common Misconceptions & Pitfalls

- **"Reporting a final accuracy number is sufficient documentation, since the number itself is what matters."** Step 2's own failed reproduction attempt demonstrates directly why this is false: the number alone, without the exact configuration that produced it, cannot be independently verified or built upon by anyone else, which is the real, practical cost missing documentation imposes.
- **"Reproducibility problems in machine learning are rare, isolated incidents, not a systemic pattern."** The NeurIPS Reproducibility Program's own real, collected data from actual submitted papers documents this as a common, measured pattern, significant enough that a major venue built a formal checklist into its submission process specifically to address it.
- **"Once the checklist items are filled in, reproduction should match the original result exactly, not just closely."** Step 3's test checks for a close match, not an exact one; real randomness (different hardware, minor floating-point differences, a different random-number-generator implementation across environments) can still produce small variation even with every checklist item specified correctly, which is a different, narrower concern from the large, checklist-driven gap Step 2 demonstrates.

## Summary

This lab applies the NeurIPS Reproducibility Program's own real, JMLR-published checklist to `running-and-reporting-a-real-experiment`'s result: simulating a typically under-documented paper by withholding specific configuration details, showing a fresh reproduction attempt fails as a direct, measured consequence, then filling in every checklist item and confirming the same attempt now succeeds. The gap between these two attempts is not hypothetical, it reflects a real, documented pattern the NeurIPS report found across actual submitted machine learning papers, which is why a major venue built this checklist into its formal submission process rather than leaving reproducibility to informal convention.

## Documentation Links

- [Pineau et al. — Improving Reproducibility in Machine Learning Research (JMLR, 2021)](https://www.jmlr.org/papers/v22/20-303.html): the real, peer-reviewed source for the reproducibility checklist and the documented pattern of common omissions this lab's simulated under-documented paper is based on.
- [ACM Digital Library: Justin Zobel, Writing for Computer Science (3rd Edition, Springer, 2014)](https://dl.acm.org/doi/10.5555/2742708): the source for the general experiment-description discipline this lab's machine-learning-specific checklist extends.
