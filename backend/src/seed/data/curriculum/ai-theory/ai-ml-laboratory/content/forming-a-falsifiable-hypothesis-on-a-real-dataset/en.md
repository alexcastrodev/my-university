---
version: 1.0
updatedAt: 2026-09-12
---
## Learning Objectives

- Apply `graduate-studies/research-statistics`'s falsifiable-hypothesis framework to a real, unresolved question about a real dataset, before any model fitting begins.
- Distinguish a vague ML project idea from a hypothesis specific enough that a concrete experiment could refute it.
- State, in advance, what evidence would count as support and what would count as refutation for the chosen hypothesis.
- Explain why forming the hypothesis before touching model selection or evaluation matters for the honesty of every later lab in this arc.

## Context & Motivation

Labs 1 through 4 built a real toolkit, linear and logistic regression, a small neural network, k-means and PCA, each verified against its own independent correctness check. This lab opens this discipline's second arc, and its first move is deliberately not technical at all: forming a real, falsifiable hypothesis, exactly as `graduate-studies/research-statistics`'s own `hypotheses-questions-and-forms-of-evidence` concept defines one, about a real, chosen dataset, before any of Lab 6's dataset work or Lab 7's model selection begins.

## Core Theory

Nothing about *why* a hypothesis needs to be falsifiable, or what forms of evidence can support or refute one, is re-derived here; that argument already exists in full in `hypotheses-questions-and-forms-of-evidence`. This lab is the discipline of applying that already-established framework specifically to a machine learning project, where the temptation to skip straight to model fitting without a precise question in hand is a real, common, and specifically ML-flavored version of the vagueness problem that concept already warns against.

## Worked Examples

### From a vague ML idea to a falsifiable hypothesis

```text
Vague idea:        "I want to build a model that predicts housing prices."
                    (Not falsifiable: almost any model, however poor,
                    technically "predicts" something; nothing here
                    specifies what would count as the model failing.)

Sharpened, once:    "A model using square footage, location, and age
                    should predict housing price reasonably well."
                    (Still vague: what counts as "reasonably well"?)

Falsifiable
hypothesis:         "A regularized linear model trained on square
                    footage, location, and age achieves a held-out R²
                    of at least 0.7 on [this specific real dataset],
                    outperforming a mean-prediction baseline by at
                    least 0.5."
```

The final version specifies an exact metric, an exact threshold, an exact comparison baseline, and an exact dataset, which is what makes it falsifiable: a specific, concrete experimental result, run in Lab 8, could show this claim to be false, not merely disappointing.

### Step 1 — choosing a real, still-open question about the chosen dataset

```text
Dataset: a real, publicly available dataset (not synthetic data
generated specifically to make the hypothesis trivially true or false).

The question this lab requires is NOT "does this dataset exist" or
"can a model be fit to it" (both trivially true), but something
genuinely uncertain in advance: does a specific feature actually carry
predictive signal, does a specific model class outperform a specific
simpler baseline by a meaningful margin, does a specific preprocessing
choice change the outcome.
```

### Step 2 — stating, explicitly, what evidence would refute the hypothesis

```text
Hypothesis:  "Regularization (Ridge, from model-selection-and-the-
             bias-variance-tradeoff-measured) improves this model's
             held-out R² by at least 0.03 compared to the unregularized
             version, on this specific dataset's held-out split."

Would REFUTE it:  held-out R² improves by less than 0.03, or gets worse.

Would SUPPORT it:  held-out R² improves by 0.03 or more, measured
                   honestly on data the model never saw during fitting
                   or hyperparameter selection (the exact discipline
                   the NEXT lab, dataset-work-splits-leakage-and-
                   honest-evaluation, is built to enforce).
```

### Step 3 — a written hypothesis statement, the lab's actual deliverable

```text
HYPOTHESIS STATEMENT (this lab's real output):

Dataset: [name, source, size]
Question: [the specific, still-open question motivating this project]
Hypothesis: [the exact falsifiable claim, with metric, threshold,
             and baseline named explicitly]
Evidence that would refute it: [stated explicitly, in advance]
Evidence that would support it: [stated explicitly, in advance]
```

### Step 4 — why writing this BEFORE fitting any model matters

```text
Without a hypothesis written in advance, a common, real failure mode
is: fit several models, notice one happens to perform well on SOME
metric, and retroactively frame that metric as the one that "mattered"
all along — a subtle, easy-to-fall-into form of the honest-scope
violation good-and-bad-science-measurement-and-reflection already
warns against, specific to ML projects where many metrics and many
model variants are cheap to try.

Writing the hypothesis, including the SPECIFIC metric and threshold,
before Lab 6's dataset work even begins is what prevents this.
```

## Common Misconceptions & Pitfalls

- **"A hypothesis for an ML project should just be 'this model will work well.'"** This is exactly the vague, unfalsifiable form Step 1's worked example starts from and deliberately sharpens; without a specific metric, threshold, and baseline, no experimental result could ever actually refute the claim, which means it was never a real hypothesis to begin with.
- **"It's fine to decide the hypothesis after seeing how the models perform, as long as the final report is accurate."** This is precisely the failure mode Step 4 describes: choosing which metric "mattered" after already seeing the results makes it nearly impossible not to unconsciously favor whichever framing makes the actual results look best, which is why the hypothesis is written down, specifically and completely, before any model in this arc is trained on the real dataset.
- **"This step is bureaucratic overhead that doesn't actually change what code gets written."** It changes what Lab 8's experiment is actually testing: a lab that starts with a precise hypothesis has a real, predetermined answer to "did this work," while a lab that starts by just training models and looking at results afterward has no such answer, only a post-hoc story about whichever number turned out to look good.

## Summary

This lab opens the second arc of this discipline by applying `hypotheses-questions-and-forms-of-evidence`'s falsifiable-hypothesis framework directly to a real, chosen dataset: sharpening a vague ML project idea into a specific, falsifiable claim naming an exact metric, threshold, and comparison baseline, and stating explicitly, in advance, what evidence would support or refute it. Doing this before any of Lab 6's dataset work or Lab 7's model selection begins is what prevents a real, common failure mode in ML projects specifically, retroactively deciding which metric "mattered" only after already seeing which one makes the results look best.

## Documentation Links

- [ACM Digital Library: Justin Zobel, Writing for Computer Science (3rd Edition, Springer, 2014)](https://dl.acm.org/doi/10.5555/2742708): the source for the falsifiable-hypothesis framework this lab applies directly to a real machine learning project.
