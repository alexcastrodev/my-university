---
version: 1.0
updatedAt: 2026-09-12
---
## Learning Objectives

- Run this discipline's full research cycle, question, hypothesis, dataset, model, experiment, evaluation, reproduce, challenge, end to end against a genuinely withheld test set under a real, fixed deadline.
- Apply Lab 6's honest-splitting discipline, Lab 7's principled model-selection process, and Lab 8's fair-baseline standard to a single, real decision made under uncertainty and time pressure.
- Submit predictions against a held-out leaderboard score as the only feedback signal, exactly as Kaggle-style real competitive ML benchmarks work.
- Reflect on which parts of this arc's discipline held up under real deadline pressure, and which were tempting to skip, connecting the result back to Choosing and Validating a Model's own decision framework.

## Context & Motivation

This capstone runs this whole discipline's own named topic sequence, question, hypothesis, dataset, model, experiment, evaluation, reproduce, challenge, end to end, for the first time under conditions that make skipping any earlier lab's discipline actually costly: a dataset whose true test-set labels are genuinely withheld, not merely held aside by the student's own code, a fixed deadline, and a single held-out leaderboard score as the only feedback, the same structure real, well known competitive ML benchmarks like Kaggle use.

## Core Theory

Nothing new is derived here; this capstone is where **Choosing and Validating a Model: A Decision Guide**'s own theoretical framework, laid out at leisure across `machine-learning`'s full 23 concepts, gets applied under a real, binding constraint that earlier labs in this arc, working with a locally-held-out test set the student's own code controlled, did not impose.

## Worked Examples

### The challenge setup

```text
- A real, chosen dataset, split by the CHALLENGE ITSELF (not the
  student's own code) into a public training set and a genuinely
  withheld test set, whose true labels are not available to the
  student at all during the challenge.
- A fixed submission deadline.
- A single feedback signal: a leaderboard score, computed by
  submitting PREDICTIONS (not code, not labels) against the withheld
  set, updated each time a new submission is made.
```

### Step 1 — applying Lab 5's hypothesis discipline under a real deadline

```text
Under time pressure, the temptation is to skip straight to trying many
models and submitting whichever scores best on the leaderboard, a
version of the exact retroactive-metric-selection problem
forming-a-falsifiable-hypothesis-on-a-real-dataset was built to
prevent. This lab's own discipline requires the SAME upfront step:
state, before the first submission, which model class and feature set
are expected to perform best, and why — a real, falsifiable
prediction, even under deadline pressure.
```

### Step 2 — reusing Lab 6's split methodology on the PUBLIC training data

```python
def prepare_local_validation(train_X, train_y, seed=0):
    # The public training data still needs an HONEST local split,
    # exactly dataset-work-splits-leakage-and-honest-evaluation's own
    # discipline, since the real withheld test set gives no feedback
    # until a submission is actually made — local validation is the
    # only signal available before then.
    return correct_split(train_X, train_y, test_size=0.2, val_size=0.2, seed=seed)
```

### Step 3 — model selection under a real submission budget

```text
Unlike Lab 7, which could sweep complexity freely against a locally
held validation set, this capstone typically has a LIMITED number of
allowed submissions to the real leaderboard (a real, common
competitive-ML constraint, preventing a strategy of submitting every
possible model variant and picking the best-scoring one by brute
force, which would itself be a leaderboard-level version of the same
leakage problem Lab 6 already covered).

The correct strategy: use LOCAL validation (Step 2) to narrow down to
a small number of genuinely promising candidates FIRST, using only
1-2 of the limited real submissions to confirm the local estimate
roughly matches the leaderboard's real, independent signal.
```

### Step 4 — the honest report, closing the whole arc

```text
CAPSTONE REPORT

Original hypothesis (Step 1): [stated before the first submission]
Local validation estimate: [Lab 6/7's own honest, held-out estimate]
Leaderboard score (the REAL, independently computed result): [actual number]
Did local validation predict the real leaderboard score accurately?
  [YES/NO — and if NO, by how much, and a real, honest account of why]
Verdict on original hypothesis: [SUPPORTED / REFUTED, against the
  REAL leaderboard number, not the local estimate]
```

A local validation estimate that turns out to disagree with the real leaderboard score by more than expected is not a failure to hide; it is itself real, informative evidence, often revealing that the public training data's distribution differs somewhat from the withheld test set's, exactly the kind of honest, sometimes uncomfortable finding a real research project can produce and `good-and-bad-science-measurement-and-reflection`'s own honesty standard requires reporting rather than omitting.

## Common Misconceptions & Pitfalls

- **"Under deadline pressure, skipping the upfront hypothesis step to save time is reasonable, since the leaderboard will tell you the real answer anyway."** The leaderboard reveals a score, not whether that score was predicted in advance or only recognized as good after the fact; skipping Step 1 reintroduces exactly the retroactive-metric-selection problem this whole arc has been built to avoid, now under conditions where it is genuinely tempting to skip.
- **"Submitting many model variants and keeping whichever scores highest on the leaderboard is a legitimate strategy, since the leaderboard is the real ground truth."** Repeatedly submitting and selecting based on leaderboard feedback is itself a form of leakage, at the leaderboard level rather than the local-split level, which is precisely why Step 3's discipline uses local validation to narrow candidates first, treating the limited number of real submissions as a scarce, honest check rather than a search procedure.
- **"A local validation estimate that disagrees with the real leaderboard score means the earlier labs' methodology was wrong."** A real, honest disagreement between local and leaderboard performance is itself valid, informative evidence, often about how representative the public training data actually is of the withheld set, and Step 4's report treats it as a finding to state honestly, not a result to hide or explain away.

## Summary

This capstone runs this discipline's full named research cycle end to end under real, binding constraints a locally-held-out test set never imposed: a genuinely withheld leaderboard, a fixed deadline, and a limited submission budget that makes brute-force leaderboard search itself a form of leakage. Applying Lab 5's hypothesis discipline before the first submission, Lab 6's honest local-validation methodology to narrow candidates before spending scarce real submissions, and reporting the real leaderboard result honestly against the original hypothesis, even when it disagrees with the local estimate, is what closes this discipline's arc exactly where `choosing-and-validating-a-model-a-decision-guide`'s own theoretical framework opened, now tested under conditions that make its discipline actually costly to skip.

## Documentation Links

- [James, Witten, Hastie & Tibshirani — An Introduction to Statistical Learning](https://www.statlearning.com/): the source for the model-selection and validation framework this capstone applies under real, competitive-benchmark constraints.
- [Pineau et al. — Improving Reproducibility in Machine Learning Research (JMLR, 2021)](https://www.jmlr.org/papers/v22/20-303.html): a direct source for why documenting this capstone's own methodology, hypothesis, split, and submission strategy, matters as much here as it did in the preceding lab.
