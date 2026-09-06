---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- State the three-way taxonomy that organizes machine learning — supervised, unsupervised, and reinforcement learning — and classify a given task into the correct one from its data alone.
- Distinguish supervised learning's two sub-tasks, regression (predicting a number) and classification (predicting a category), from a single description of the target variable.
- Explain what makes unsupervised learning fundamentally harder to evaluate than supervised learning: there is no ground truth to check a prediction against.
- Explain why this discipline covers supervised and unsupervised learning in depth but treats reinforcement learning as already covered material, not new content.

## Context & Motivation

Machine learning is not one algorithm or one kind of problem — it is a family of problems distinguished by one question: what kind of feedback does the learner get? Stanford's CS229 organizes its entire syllabus around this split, and it is the first thing worth fixing clearly before any algorithm is introduced, because the taxonomy determines which family of techniques even applies.

**Supervised learning** starts from a dataset of labeled examples — each input `x` paired with its correct output `y` — and the goal is to learn a function that predicts `y` for a new `x` it has never seen. When `y` is a real number (house price, temperature, tomorrow's stock value), this is called **regression**; when `y` is a category from a finite set (spam or not spam, digit 0–9, cancer subtype), this is called **classification**. Most of this discipline is organized around this pair.

**Unsupervised learning** starts from a dataset with no labels at all — just a collection of `x`'s — and the goal is to find structure in it anyway: group similar points together (clustering), or find a lower-dimensional summary that captures most of what varies across the data (dimensionality reduction). Because there is no `y` to check a prediction against, evaluating an unsupervised result is intrinsically harder and often more subjective than evaluating a supervised one.

**Reinforcement learning** is a third, distinct setting: an agent takes actions in an environment over time, receives a scalar reward signal, and must learn a policy that maximizes cumulative reward — feedback that is delayed, sparse, and depends on the agent's own past actions, unlike the fixed dataset supervised and unsupervised learning both assume. This curriculum's `ai-theory/artificial-intelligence` discipline already covers the mathematical core of this setting in full — Markov decision processes, the Bellman equation, and value/policy iteration — as the standard formalization of sequential decision-making under uncertainty. This discipline does not repeat that material; it exists here in the taxonomy only to be named and correctly located, not re-derived.

## Core Theory

### Why the taxonomy is about feedback, not algorithms

The three categories are not defined by which formula or model a learner uses — the same underlying idea (a neural network, say) can appear in supervised, unsupervised, or reinforcement settings. The taxonomy is defined entirely by what information the learning process has access to: complete labeled pairs (supervised), unlabeled raw data (unsupervised), or a reward signal received through interaction over time (reinforcement). This is why the very first design decision for a real-world ML problem is not "which algorithm," but "what kind of feedback do I actually have."

### Regression versus classification: reading the target variable

Within supervised learning, the regression/classification split is determined entirely by the type of `y`. If `y` ranges over the real numbers (or a continuous interval), it is regression; if `y` takes one of finitely many discrete labels, it is classification. This distinction determines which loss functions and evaluation metrics apply later in this discipline: squared error is a natural loss for a numeric target, but meaningless for a category with no ordering.

### Where this discipline sits relative to the rest of the curriculum

`ai-theory/artificial-intelligence` covers search, logic, and decision theory — including the reinforcement-learning-adjacent MDP/Bellman-equation formalism — as reasoning under a known or partially known model of the world. This discipline instead assumes no model is known in advance, and asks how to build one from data: linear and logistic regression, generative classifiers, decision trees, SVMs, clustering, and a first bridge into neural networks. The gradients and least-squares machinery from `foundations/mathematics-for-computing`, and the probability and estimation machinery from `foundations/probability-statistics`, are the two mathematical toolkits this entire discipline draws on directly rather than re-deriving.

## Worked Examples

### Example 1: Classifying five real tasks

```text
Task                                              Category
-------------------------------------------------  ----------------
Predict tomorrow's high temperature (°F)           Supervised — regression
Predict whether an email is spam                   Supervised — classification
Group customers into segments with no labels       Unsupervised — clustering
Compress 1000-dimensional data to 2 dimensions      Unsupervised — dim. reduction
Train a robot to walk via trial-and-reward          Reinforcement learning
```

The tell for each: is there a labeled `y` (supervised), no `y` at all (unsupervised), or a reward received through interaction over time (reinforcement)?

### Example 2: Why unsupervised evaluation is genuinely harder

Given a supervised classifier's predictions, checking correctness is mechanical: compare each prediction against its known true label. Given a clustering algorithm's output — say, three customer groups — there is no "true" grouping to check against unless one is independently defined by a human. Two different, reasonable clusterings of the same data can both be "correct" in different senses (grouped by spending amount vs. grouped by purchase category), which is why unsupervised learning's evaluation metrics (covered later in this discipline for the supervised case) are much less standardized for the unsupervised case.

## Common Misconceptions & Pitfalls

- **"Unsupervised learning means the algorithm learns without any human input."** The algorithm doesn't use labels, but a human still chooses the number of clusters, the distance metric, the number of dimensions to reduce to — unsupervised does not mean unsupervised of design choices.
- **"Reinforcement learning is just supervised learning with a different loss function."** It is not: supervised learning assumes i.i.d. labeled examples fixed in advance; reinforcement learning's data is generated by the agent's own actions, is not i.i.d., and the "label" (reward) is delayed and depends on a whole sequence of past decisions — a genuinely different mathematical setting, which is exactly why `artificial-intelligence` treats it with its own formalism (MDPs) rather than folding it into this discipline's toolkit.
- **"Regression only means linear regression."** Regression names the type of output (a number), not a specific model — decision trees, SVMs, and neural networks can all be used for regression just as well as for classification.

## Summary

Machine learning splits three ways by the kind of feedback available: supervised learning from labeled pairs (further split into regression for numeric targets and classification for categorical ones), unsupervised learning from unlabeled data alone, and reinforcement learning from a reward signal received through interaction over time. This discipline builds out supervised and unsupervised learning in depth, on top of the linear algebra and probability already covered elsewhere in this curriculum; reinforcement learning's mathematical core — MDPs and the Bellman equation — is already fully covered in `artificial-intelligence` and is not repeated here.

## Documentation Links

- [Stanford CS229 — Course Syllabus](https://cs229.stanford.edu/syllabus-autumn2018.html) — the real course schedule this discipline's structure follows, confirming the supervised → unsupervised → reinforcement ordering.
- [Caltech CS 156 — Learning From Data](https://work.caltech.edu/telecourse.html) — a second real course, opening with the feasibility-of-learning question this discipline's next concept picks up directly.
