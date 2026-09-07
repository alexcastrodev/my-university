---
version: 1.0
updatedAt: 2026-09-07
---
## Learning Objectives

- Define the softmax function and explain why it turns arbitrary real-valued scores into a valid probability distribution over classes.
- Derive cross-entropy loss from maximum likelihood estimation on the softmax distribution, in the same style already used for logistic regression's probabilistic derivation.
- Compute softmax probabilities and cross-entropy loss by hand for a small, concrete example.
- Explain why cross-entropy's gradient with respect to the pre-softmax scores has an unusually simple closed form, and why this matters for backpropagation.

## Context & Motivation

`ai-theory/machine-learning`'s `the-probabilistic-view-of-linear-regression` showed that minimizing squared error is not an arbitrary choice — it falls directly out of maximizing the likelihood of the data under a Gaussian noise assumption. `logistic-regression-and-decision-boundaries` did the analogous thing for binary classification: squashing a linear score through a sigmoid and interpreting the result as `P(y=1|x)`. This concept extends both ideas to the general multi-class case that dense networks in this discipline almost always end with: a network's final layer produces one raw score per class, softmax turns those scores into a probability distribution, and cross-entropy is the loss function that falls out of maximizing the likelihood of the true label under that distribution — the same MLE argument, one more time, now for a categorical rather than Gaussian or Bernoulli outcome.

This is not a peripheral detail. Nearly every classifier trained in this discipline — from a simple multilayer network through the CNNs, RNNs, and Transformers covered later — uses exactly this loss function at its output layer, computed via exactly the backpropagation machinery from the previous concept.

## Core Theory

### The softmax function

Given a vector of raw scores (**logits**) `z = (z₁, ..., zₖ)` for `k` classes, softmax converts them into a probability distribution:

```text
softmax(z)ᵢ = e^zᵢ / Σⱼ e^zⱼ
```

Every output is positive (since `e^zᵢ > 0` for any real `zᵢ`), and all outputs sum to exactly 1 (by construction — dividing by the total). Softmax is also **shift-invariant**: adding the same constant to every `zᵢ` leaves the output distribution unchanged, since the constant factors out of both numerator and denominator — a property used in practice to subtract the maximum logit before exponentiating, for numerical stability, without changing the result.

### Cross-entropy as maximum likelihood

If `softmax(z)ᵢ` is interpreted as the model's estimate of `P(y = i | x)`, then for a training example with true label `y`, the likelihood of that label under the model is `softmax(z)_y` — the probability the model assigned to the correct class. Maximizing this likelihood is equivalent to minimizing its negative log, which is exactly the **cross-entropy loss**:

```text
L = −log(softmax(z)_y) = −log( e^z_y / Σⱼ e^zⱼ )
```

This is the identical MLE pattern `the-probabilistic-view-of-linear-regression` already used — pick the loss that maximizing-likelihood produces, rather than choosing a loss by intuition — applied here to a categorical rather than Gaussian outcome. When there are only two classes, this reduces exactly to logistic regression's loss, confirming softmax-plus-cross-entropy as the direct multi-class generalization of that earlier concept, not a different idea.

### Why the gradient is unusually simple

Differentiating `L` with respect to the pre-softmax logits `zᵢ` yields a strikingly clean result:

```text
∂L/∂zᵢ = softmax(z)ᵢ − 1[i = y]
```

In words: the gradient at each output is simply "predicted probability minus 1 if this is the true class, predicted probability minus 0 otherwise." This closed form is precisely why softmax and cross-entropy are almost always paired together in practice — combined, they hand backpropagation (the previous concept) an extremely cheap local gradient to start propagating backward from, rather than requiring the chain rule to be applied separately through a softmax node and then a log node.

## Worked Examples

### Example 1: Softmax probabilities and loss for a 3-class score vector

Let the network's raw output for one example be `z = (2.0, 1.0, 0.1)`, with true label `y = 1` (the first class, zero-indexed as class 0).

```text
e^2.0 = 7.389,  e^1.0 = 2.718,  e^0.1 = 1.105
Sum = 7.389 + 2.718 + 1.105 = 11.212

softmax(z)₀ = 7.389 / 11.212 ≈ 0.659
softmax(z)₁ = 2.718 / 11.212 ≈ 0.242
softmax(z)₂ = 1.105 / 11.212 ≈ 0.099

L = −log(softmax(z)_0) = −log(0.659) ≈ 0.417
```

The model assigned 65.9% probability to the correct class, producing a moderate loss of about 0.417 — a confident, correct prediction would push this probability toward 1 and the loss toward 0.

### Example 2: The gradient's closed form, checked directly

Using the same `z` and `y = 0` from Example 1, the gradient formula gives:

```text
∂L/∂z₀ = softmax(z)₀ − 1 = 0.659 − 1 = −0.341
∂L/∂z₁ = softmax(z)₁ − 0 = 0.242
∂L/∂z₂ = softmax(z)₂ − 0 = 0.099
```

The negative gradient at the correct class (`−0.341`) means gradient descent will *increase* `z₀` — pushing the model toward assigning even more probability to the correct class — while the positive gradients at the incorrect classes push their scores down. This is exactly the intuitive behavior expected of a classification loss, now derived, not assumed.

## Common Misconceptions & Pitfalls

- **"Softmax and cross-entropy are two independent design choices."** They are typically derived and used together for a reason: softmax is what a network's raw scores are converted through to become a valid distribution, and cross-entropy is exactly the loss that maximum likelihood produces for that distribution — using cross-entropy without softmax (or vice versa) breaks the probabilistic interpretation this concept derived.
- **"Cross-entropy loss is unrelated to logistic regression's loss."** Setting `k = 2` in the softmax-cross-entropy formula reduces algebraically to logistic regression's binary cross-entropy loss — this concept is the direct multi-class generalization already anticipated by `logistic-regression-and-decision-boundaries`, not an unrelated new loss.
- **"A confident wrong prediction and an unconfident wrong prediction are penalized about the same."** Cross-entropy's `−log` term grows without bound as the assigned probability to the correct class approaches zero — a confident wrong answer (say, `softmax(z)_y = 0.01`) is penalized far more heavily than an unconfident one (`softmax(z)_y = 0.4`), which is precisely the intended behavior for a probabilistic loss.

## Summary

Softmax converts a network's raw output scores into a valid probability distribution over classes; cross-entropy loss is exactly the negative log-likelihood of the true label under that distribution — the same maximum-likelihood derivation already used for linear and logistic regression, now applied to the categorical case. The resulting gradient with respect to the pre-softmax scores has an unusually simple closed form (`predicted probability minus the one-hot true label`), which is exactly what makes softmax-plus-cross-entropy the default output layer and loss for nearly every classifier this discipline covers from here forward.

## Documentation Links

- [CS231n — Neural Networks Part 2: Setting up the Data and the Loss](https://cs231n.github.io/neural-networks-2/) — the softmax classifier loss `−log(e^f_yi / Σⱼe^f_j)` this concept derives and uses.
- [Eaton & Epstein — Artificial Intelligence in the CS2023 Undergraduate Computer Science Curriculum](https://ojs.aaai.org/index.php/AAAI/article/view/30352/32394) — confirms "objective functions and gradient descent" as explicit KA Core content for undergraduate machine learning coverage, the same framing this concept and the previous one build on.
