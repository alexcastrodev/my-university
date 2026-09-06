---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Define overfitting precisely: training error keeps decreasing while true (out-of-sample) error starts increasing.
- Define "shattering" a set of points, and state the VC dimension of a model class as the largest number of points it can shatter in every possible labeling.
- Compute the VC dimension of a simple model class (a linear classifier in 2D) by hand.
- Explain how the VC dimension extends the single-hypothesis Hoeffding bound from earlier in this discipline to the realistic case of a learning algorithm that searches over many hypotheses.

## Context & Motivation

The very first concept in this discipline's foundations cluster raised the feasibility-of-learning question, and the Hoeffding bound gave a real guarantee — but only for a single hypothesis fixed in advance, explicitly flagging that a learning algorithm which *searches* over many hypotheses and picks whichever fits best needs a stronger argument. The VC (Vapnik–Chervonenkis) dimension is that stronger argument: a precise, computable number that measures how much a model class can "cheat" by fitting essentially any labeling of a finite set of points, and which extends the generalization guarantee to cover realistic learning algorithms.

## Core Theory

### Overfitting, defined precisely

**Overfitting** occurs when, as model complexity increases, training error keeps decreasing while out-of-sample (test) error decreases for a while and then starts increasing again. The point where out-of-sample error is minimized — before training error's continued decrease starts actively hurting generalization — is the complexity level the bias-variance tradeoff (previous concept) says is optimal. Overfitting is not simply "fitting the data well"; it is specifically fitting the noise in the training data at the expense of the true underlying signal.

### Shattering and the VC dimension

A model class **shatters** a set of `N` points if, for every one of the `2^N` possible ways to label those points (assign each one to class +1 or −1), there exists some hypothesis in the model class that gets every labeling exactly right. The **VC dimension** of a model class is the largest `N` for which some set of `N` points can be shattered by that class. This is a property of the model class alone — it does not depend on any actual dataset, only on how expressive the class of hypotheses is.

### Extending Hoeffding to a searched hypothesis

The earlier Hoeffding bound applied to one hypothesis, fixed in advance. The **VC generalization bound** extends this to cover a learning algorithm that picks the best-fitting hypothesis from an entire model class, replacing the single-hypothesis bound with one that scales with the model class's VC dimension `d_VC` and the sample size `N`:

```text
E_out(g) ≤ E_in(g) + O( √( d_VC · log(N) / N ) )
```

where `g` is the hypothesis the learning algorithm actually selects. The key qualitative lesson: the gap between training and true error grows with the VC dimension (a more expressive model class can overfit more) and shrinks as sample size `N` grows — this is the rigorous version of "a more complex model needs more data to generalize as well as a simpler one."

## Worked Examples

### Example 1: The VC dimension of a 2D linear classifier is 3

Consider linear classifiers in two dimensions (a line separating +1 points from −1 points). Any 3 points in "general position" (not all on one line) can be shattered: all `2³ = 8` labelings can be achieved by some line — including, for instance, isolating any single point from the other two with a line drawn close to it, and separating any 2-versus-1 split with a line between them.

However, no set of 4 points can be shattered by a line in every case. A specific counterexample: 4 points arranged as a "XOR" pattern — two points labeled +1 diagonally opposite each other, and two points labeled −1 on the other diagonal — cannot be separated by any single straight line, since the +1 points and −1 points are interleaved in a way no line can untangle. Because some 4-point configuration cannot be shattered, but every 3-point configuration (in general position) can, the VC dimension of a 2D linear classifier is exactly 3.

### Example 2: What VC dimension 3 means in practice

Applying the generalization bound above with `d_VC = 3`: a 2D linear classifier needs relatively little data to generalize reliably, because its VC dimension is small and fixed regardless of how large the training set grows. Contrast this with a degree-9 polynomial classifier in 2D, whose VC dimension is much larger (it can represent far more complex, wiggly boundaries) — the same generalization bound predicts it needs substantially more training data before its in-sample and out-of-sample errors are guaranteed to track closely, matching the informal observation from the bias-variance concept that flexible models need more data to avoid overfitting.

## Common Misconceptions & Pitfalls

- **"VC dimension equals the number of parameters in a model."** This is a common but false shortcut — VC dimension measures actual *expressive power* to shatter labelings, which can differ from parameter count (a model can have many parameters but low VC dimension if those parameters are heavily constrained, or vice versa).
- **"A model with lower VC dimension is always a better choice."** Lower VC dimension means a tighter generalization guarantee (less risk of overfitting for a given sample size), but if the model class is too simple to represent the true pattern at all, it will have high bias regardless of how well its in-sample and out-of-sample errors track each other — a precise, low-variance estimate of a systematically wrong answer is still wrong.
- **"Overfitting only happens with 'too many parameters.' "** It happens whenever a model's effective capacity (measured by VC dimension, not raw parameter count) is large relative to the available training sample size — this is exactly why regularization (the next concept), which constrains the *effective* capacity a model uses without necessarily changing its parameter count, is an effective countermeasure.

## Summary

Overfitting is the phenomenon where training error keeps improving while true out-of-sample error worsens; the VC dimension gives a rigorous, model-class-specific measure of how much a hypothesis class can shatter arbitrary labelings, which in turn extends the single-hypothesis Hoeffding bound from earlier in this discipline into a generalization guarantee that correctly accounts for a learning algorithm searching over an entire model class. Higher VC dimension means more expressive power but requires proportionally more training data to generalize reliably — the rigorous foundation underneath the informal bias-variance intuition from the previous concept.

## Documentation Links

- [Caltech CS 156 — Learning From Data, Lecture 7: The VC Dimension](https://work.caltech.edu/telecourse.html) — the real lecture deriving shattering and the VC dimension in full.
- [Caltech CS 156 — Learning From Data, Lecture 11: Overfitting](https://work.caltech.edu/telecourse.html) — the companion lecture connecting VC dimension to the practical overfitting phenomenon.
