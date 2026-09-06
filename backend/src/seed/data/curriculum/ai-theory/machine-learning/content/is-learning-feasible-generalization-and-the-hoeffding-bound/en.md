---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- State the feasibility-of-learning question precisely: can a hypothesis chosen to fit a finite training sample be trusted to perform well on data outside that sample?
- Distinguish the in-sample error (measured on the training data) from the out-of-sample error (the true, unmeasurable error on the whole population).
- State the Hoeffding inequality and explain, in plain terms, what it guarantees about the gap between in-sample and out-of-sample error as sample size grows.
- Explain why this bound, on its own, still does not fully solve the feasibility question — and what additional ingredient (the number of hypotheses considered) the rest of this discipline's model-complexity cluster exists to handle.

## Context & Motivation

Before writing a single learning algorithm, Caltech's "Learning From Data" course pauses on a question that is easy to skip past and genuinely foundational: is learning from a finite sample even possible in principle? A model can always be made to fit the training data perfectly — memorize it outright — but that guarantees nothing about new data. The entire enterprise of machine learning is a bet that patterns found in a sample generalize to data never seen; this concept is the first real, quantitative argument for why that bet is not blind faith.

The key statistical tool is the same law that already appeared in this curriculum's probability discipline in a different guise: the Law of Large Numbers says that a sample average converges to the true population mean as the sample grows. The Hoeffding inequality is a sharper, finite-sample version of exactly this idea, and it is the mathematical backbone underneath every later claim in this discipline that "more training data reduces overfitting."

## Core Theory

### In-sample error versus out-of-sample error

For a fixed hypothesis `h` (a candidate model), define the **in-sample error** `E_in(h)` as the fraction of training examples `h` gets wrong, and the **out-of-sample error** `E_out(h)` as the true probability `h` gets a randomly drawn example wrong, over the entire population the training data was sampled from. `E_in` is something that can actually be computed; `E_out` cannot — it would require testing on the whole population, usually infinite or unavailable. The feasibility question is exactly: how close is `E_in(h)` to `E_out(h)`?

### The Hoeffding inequality

For a single, *fixed* hypothesis `h` — chosen before looking at the data, not fit to it — the Hoeffding inequality states:

```text
P( |E_in(h) − E_out(h)| > ε ) ≤ 2·exp(−2ε²N)
```

where `N` is the sample size and `ε` is any tolerance you choose. Read in plain terms: the probability that the training error and the true error differ by more than `ε` shrinks exponentially fast as the sample size `N` grows. This is precisely the guarantee learning needs: with enough data, a hypothesis's measured performance on the sample becomes a reliable stand-in for its true performance everywhere.

### The catch: this bound is only valid for one fixed hypothesis

The Hoeffding bound above is proven for a single `h` fixed in advance — it says nothing yet about what happens when a *learning algorithm searches over many candidate hypotheses* and picks whichever one happens to fit the training data best. Searching over more hypotheses increases the chance that at least one of them fits the training sample well purely by luck, even if it has poor out-of-sample error — the same statistical hazard as testing many random stock-picking strategies and reporting only the one that happened to beat the market. This is exactly the concern the **VC dimension** (a later concept in this cluster) exists to quantify precisely: it counts how many hypotheses a model class can effectively produce, and extends the Hoeffding-style guarantee to cover the case of a learning algorithm actually choosing among them.

### Why this justifies, rather than undermines, the rest of the discipline

The purpose of walking through this argument first is not to cast doubt on machine learning — it is to establish, on real mathematical grounds, exactly what license a learning algorithm has to trust its training performance, and exactly where that license runs out (when the hypothesis space searched is too large relative to the sample size). Every later concept in this discipline's model-complexity cluster — bias-variance, VC dimension, regularization, cross-validation — is a different practical answer to the same feasibility concern raised here.

## Worked Examples

### Example 1: A concrete Hoeffding calculation

Suppose a fixed hypothesis `h` is tested on `N = 1000` independent samples, and a tolerance of `ε = 0.05` (5 percentage points) is chosen. Plugging into the bound:

```text
P( |E_in − E_out| > 0.05 ) ≤ 2·exp(−2 · 0.05² · 1000)
                            = 2·exp(−5)
                            ≈ 2 · 0.0067
                            ≈ 0.0135
```

So with 1000 samples, there is at most a 1.35% chance that the measured training error is off from the true error by more than 5 percentage points — a real, quantitative confidence statement, not a hand-wave.

### Example 2: How the bound tightens with more data

Holding `ε = 0.05` fixed and increasing `N` from 100 to 1000 to 10,000:

```text
N = 100:    bound = 2·exp(−2·0.0025·100)   = 2·exp(−0.5)  ≈ 1.213  (vacuous — exceeds 1)
N = 1000:   bound = 2·exp(−2·0.0025·1000)  = 2·exp(−5)    ≈ 0.0135
N = 10000:  bound = 2·exp(−2·0.0025·10000) = 2·exp(−50)   ≈ 3.9e-21
```

At `N = 100` the bound is a mathematically valid but useless probability greater than 1 (Hoeffding bounds are only informative once the exponential term is small); by `N = 10,000` the guarantee is essentially certainty. This is the real, numeric content behind the informal claim "more data means the model generalizes better."

## Common Misconceptions & Pitfalls

- **"The Hoeffding bound proves my trained model generalizes well."** It proves this only for one hypothesis fixed *before* seeing the training data. A model actually chosen by fitting the data (which is what every learning algorithm does) requires the extended, VC-dimension version of this argument — this concept is the honest first half of the story, not the whole one.
- **"A small training error guarantees a small true error."** Only probabilistically, and only given enough data relative to the size of the hypothesis space being searched — a model that memorizes the training set can have `E_in = 0` and arbitrarily bad `E_out`.
- **"This is just the Law of Large Numbers, nothing new."** The connection is real and intentional — Hoeffding's inequality is a sharper, non-asymptotic version of the same convergence idea, giving an explicit bound at any finite `N` rather than only a limiting guarantee as `N → ∞`.

## Summary

The feasibility of learning from a finite sample rests on the Hoeffding inequality: for a single, fixed hypothesis, the probability that its in-sample error diverges from its true out-of-sample error by more than any chosen tolerance shrinks exponentially as the sample size grows. This is real, quantitative justification for trusting training performance as a proxy for true performance — but it applies cleanly only before a learning algorithm has searched over many hypotheses and picked the best-fitting one, a gap the VC dimension closes later in this cluster. Every remaining concept about overfitting, regularization, and cross-validation is a practical response to the same underlying feasibility concern raised here.

## Documentation Links

- [Caltech CS 156 — Learning From Data, Lecture 2: Is Learning Feasible?](https://work.caltech.edu/telecourse.html) — the real lecture this concept is drawn from, including the full derivation of the Hoeffding bound.
- [Stanford CS229 — Course Syllabus](https://cs229.stanford.edu/syllabus-autumn2018.html) — confirms this discipline's broader sequencing after the feasibility question is settled.
