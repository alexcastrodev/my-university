---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- State the perceptron model and its prediction rule, and contrast it with logistic regression's smooth sigmoid output.
- State the perceptron learning algorithm precisely, and explain why it only ever updates on misclassified examples.
- Trace, by hand, the perceptron algorithm converging on a small linearly separable dataset.
- State the perceptron convergence theorem's guarantee, and explain precisely why it fails when data is not linearly separable.

## Context & Motivation

This discipline has now covered generative and discriminative linear classifiers (logistic regression, GDA, Naive Bayes), margin-based linear and kernelized classifiers (SVMs), and non-linear tree-based models. The perceptron, historically the very first of all these — introduced by Frank Rosenblatt in 1958 — returns to the simplest possible linear classifier, both because of its historical role as the direct ancestor of every neural network, and because its update rule is the cleanest possible bridge into the layered, gradient-trained networks this discipline's final content cluster introduces.

## Core Theory

### The perceptron model

Like logistic regression, the perceptron computes a linear score `θᵀx` — but instead of passing it through a smooth sigmoid to get a probability, it applies a hard threshold:

```text
ŷ = +1  if θᵀx ≥ 0
ŷ = −1  if θᵀx < 0
```

There is no probability output at all — only a hard, binary decision, with no notion of confidence the way logistic regression's sigmoid output provides.

### The perceptron learning algorithm

The perceptron is trained by an update rule that only acts when it makes a mistake: for each training example `(x⁽ⁱ⁾, y⁽ⁱ⁾)` with `y⁽ⁱ⁾ ∈ {+1, −1}`, if the current model correctly classifies it (`ŷ⁽ⁱ⁾ = y⁽ⁱ⁾`), do nothing; if it misclassifies it, update:

```text
θ := θ + y⁽ⁱ⁾ · x⁽ⁱ⁾
```

This nudges `θ` in the direction that would have made this specific example's score more positive (if `y⁽ⁱ⁾ = +1`) or more negative (if `y⁽ⁱ⁾ = −1`) — a simple, greedy correction after each mistake, repeated by cycling through the training set until no more mistakes occur.

### The convergence theorem, and where it breaks down

The **perceptron convergence theorem** guarantees that if the training data is linearly separable, this update rule is guaranteed to find a separating hyperplane in a finite number of updates — a real, provable convergence guarantee for the simplest possible learning rule. Critically, this guarantee has a hard dependency: if the data is *not* linearly separable (as with the classic XOR pattern from this curriculum's discussion of VC dimension, or any dataset requiring a nonlinear boundary), the perceptron algorithm will never converge — it will cycle forever, repeatedly correcting mistakes that keep recurring, because no single linear boundary can ever classify the data perfectly.

## Worked Examples

### Example 1: Perceptron convergence on a linearly separable dataset

Consider 2D data with `x₀=1` (intercept) always prepended: `x⁽¹⁾=(1,2,2), y⁽¹⁾=+1`; `x⁽²⁾=(1,−1,−1), y⁽²⁾=−1`. Starting with `θ = (0,0,0)`:

```text
Check x⁽¹⁾: θᵀx⁽¹⁾ = 0, predicted +1 (ties classified as +1 by convention) → correct, no update
Check x⁽²⁾: θᵀx⁽²⁾ = 0, predicted +1, but true label is −1 → MISTAKE
  Update: θ := θ + y⁽²⁾·x⁽²⁾ = (0,0,0) + (−1)·(1,−1,−1) = (−1, 1, 1)

Second pass, check x⁽¹⁾: θᵀx⁽¹⁾ = −1 + 1·2 + 1·2 = 3 ≥ 0, predicted +1 → correct, no update
Check x⁽²⁾: θᵀx⁽²⁾ = −1 + 1·(−1) + 1·(−1) = −3 < 0, predicted −1 → correct, no update
```

Both examples now correctly classified with `θ = (−1, 1, 1)` — the algorithm converged after exactly one update, exactly as the perceptron convergence theorem guarantees for linearly separable data.

### Example 2: A perceptron that never converges on XOR-like data

Consider the classic non-linearly-separable pattern already invoked in this discipline's own VC-dimension discussion as the reason a 2D linear classifier cannot shatter 4 points: four points, `(1,1)→+1, (−1,−1)→+1, (1,−1)→−1, (−1,1)→−1`. No straight line can separate the `+1` points (diagonal) from the `−1` points (opposite diagonal). Running the perceptron update rule on this data: each pass through the four points produces at least one mistake, and the corresponding update disturbs `θ` in a way that fixes that mistake but reintroduces a different one on a different point — the algorithm cycles through updates indefinitely, never reaching a state with zero mistakes, exactly as the convergence theorem's precondition (linear separability) predicts must happen when that precondition fails.

## Common Misconceptions & Pitfalls

- **"The perceptron always converges to a good classifier, given enough time."** The convergence theorem's guarantee is conditional on linear separability — for genuinely non-separable data, as Example 2 shows, no amount of additional training time will produce convergence; the algorithm cycles forever.
- **"The perceptron and logistic regression are basically the same algorithm."** Both compute a linear score and classify by its sign, but their *training* procedures are fundamentally different: the perceptron only updates on mistakes with no notion of "how wrong" a prediction was, while logistic regression's gradient-descent update (from earlier in this discipline) is driven by a smooth probability-based loss that reflects confidence, updating even on correctly classified points if the predicted probability is not yet extreme enough.
- **"The perceptron is a purely historical curiosity with no modern relevance."** Its update-on-mistake mechanism is the direct conceptual ancestor of gradient-based training in neural networks — stacking many perceptron-like units into layers, and replacing the hard threshold with a smooth activation function, is exactly the step the next concept in this discipline takes.

## Summary

The perceptron computes a linear score and classifies by its sign, exactly like logistic regression, but is trained by a simple mistake-driven update rule rather than gradient descent on a smooth loss. The perceptron convergence theorem guarantees this update rule finds a perfect separating hyperplane in finite time whenever the data is linearly separable — and, just as critically, guarantees nothing (the algorithm cycles forever) whenever it is not, a real limitation directly connected to the linear-separability concerns already raised via the VC dimension earlier in this discipline. The perceptron is the direct historical and conceptual ancestor of the neural networks the next concept introduces.

## Documentation Links

- [Stanford CS229 — Lecture Notes, Part I: Linear Regression](https://cs229.stanford.edu/main_notes.pdf) — introduces the perceptron alongside logistic regression as a related linear classifier with a different update rule.
- [Caltech CS 156 — Learning From Data, Lecture 3: The Linear Model I](https://work.caltech.edu/telecourse.html) — covers the perceptron learning algorithm and its convergence guarantee in the same derivation style used here.
