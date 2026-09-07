---
version: 1.0
updatedAt: 2026-09-07
---
## Learning Objectives

- State the batch normalization transformation precisely, including its two learnable parameters.
- Explain why normalizing to zero mean and unit variance alone is not enough, and why the learnable scale and shift parameters are necessary.
- Explain why batch normalization reduces sensitivity to weight initialization and allows larger learning rates.
- Trace batch normalization's forward computation by hand on a small batch of values.

## Context & Motivation

`weight-initialization-and-the-vanishing-exploding-gradient-problem` addressed the vanishing/exploding gradient problem at the very start of training, by calibrating initial weight scales. But as training proceeds and weights change, nothing guarantees that a layer's input distribution stays well-behaved — a phenomenon researchers call **internal covariate shift**: as earlier layers' weights update, the distribution of activations flowing into every later layer keeps shifting, forcing each layer to continually re-adapt to a moving target. Batch normalization is a layer that directly enforces stable input statistics at every layer, for the entire duration of training, rather than only calibrating the starting point.

## Core Theory

### The normalization step

For a mini-batch of pre-activation values `{z₁, ..., zₘ}` at a given layer, batch normalization first computes the batch's own mean `μ_B` and variance `σ²_B`, then normalizes each value to zero mean and unit variance:

```text
ẑᵢ = (zᵢ − μ_B) / √(σ²_B + ε)
```

(`ε` a tiny constant preventing division by zero). This is inserted between a layer's linear step and its activation function — normalizing the input to the nonlinearity, not the layer's final output.

### The learnable scale and shift

Forcing every layer's input to exactly zero mean and unit variance would actually *reduce* the network's expressive power — for instance, it would prevent a sigmoid layer from ever operating in its more linear, less-saturating regime near zero, since that regime requires a specific, non-unit input scale. Batch normalization compensates with two additional, learned parameters per unit, `γ` (scale) and `β` (shift):

```text
BN(z)ᵢ = γ·ẑᵢ + β
```

`γ` and `β` are ordinary parameters, updated by gradient descent exactly like any weight — critically, this means the network can *learn* to undo the normalization entirely (by setting `γ = √(σ²_B + ε)` and `β = μ_B`) if that turns out to be optimal, so batch normalization strictly adds flexibility rather than removing it; it just changes what the *default*, easy-to-reach initial state looks like.

### Why this helps training

With batch normalization in place, no layer's input distribution can drift arbitrarily far as training proceeds — every layer sees inputs recentered and rescaled by the batch's own statistics, layer by layer, on every forward pass. This has two concrete, well-documented effects: it makes the network dramatically less sensitive to the specific weight-initialization scheme covered two concepts ago (since batch normalization actively re-corrects the scale regardless of how a layer's weights happen to be initialized), and it allows meaningfully larger learning rates without destabilizing training, because a large weight update in one layer no longer directly translates into an equally large shift in the *distribution* the next layer has to cope with.

## Worked Examples

### Example 1: Normalizing a small batch by hand

Consider a mini-batch of 4 pre-activation values for one unit: `z = (2, 4, 4, 6)`.

```text
μ_B = (2 + 4 + 4 + 6) / 4 = 4.0
σ²_B = ((2-4)² + (4-4)² + (4-4)² + (6-4)²) / 4 = (4 + 0 + 0 + 4) / 4 = 2.0
√(σ²_B + ε) ≈ √2.0 ≈ 1.414   (taking ε ≈ 0 for simplicity)

ẑ = ((2-4)/1.414, (4-4)/1.414, (4-4)/1.414, (6-4)/1.414)
  = (−1.414, 0, 0, 1.414)
```

The normalized batch now has exactly zero mean and unit variance, regardless of what scale or offset the original values happened to have — the same normalization is applied identically no matter what upstream weights produced this particular batch of pre-activations.

### Example 2: Applying the learned scale and shift

Continuing Example 1, suppose training has learned `γ = 3` and `β = 1` for this unit:

```text
BN(z) = 3·(−1.414, 0, 0, 1.414) + 1 = (−4.243 + 1, 1, 1, 4.243 + 1) = (−3.243, 1, 1, 5.243)
```

The final output is no longer zero-mean, unit-variance — it has whatever mean and spread `γ` and `β` have learned is useful for this specific unit — confirming that batch normalization's fixed normalization step and its learned scale/shift together give the network full flexibility, not a fixed, imposed distribution.

## Common Misconceptions & Pitfalls

- **"Batch normalization forces every layer's activations to be standard normal, permanently."** The learnable `γ` and `β` mean the network can recover, or move away from, any distribution it needs — the fixed part is only the *intermediate* normalization step, not the final output of the batch normalization layer.
- **"Batch normalization makes weight initialization irrelevant."** It substantially reduces sensitivity to initialization scale, but does not eliminate the need for reasonable initialization altogether — the two techniques are complementary, addressing the same underlying training-stability problem from different angles (a fixed starting point versus an ongoing correction).
- **"Batch normalization behaves identically at training and test time."** During training it uses the current mini-batch's own mean and variance; at test time (where a single example, or a differently-sized batch, may be processed) it instead uses a running average of `μ_B` and `σ²_B` accumulated across training — the same train/test behavioral split already seen for dropout, for an analogous reason: test-time predictions should not depend on which other examples happen to share the current batch.

## Summary

Batch normalization normalizes each layer's pre-activation values to zero mean and unit variance using the current mini-batch's own statistics, then applies a learned scale `γ` and shift `β` so the network retains full expressive flexibility rather than being permanently constrained to one distribution. By keeping every layer's input distribution stable throughout training — not just at initialization, which is all `weight-initialization-and-the-vanishing-exploding-gradient-problem` addressed — batch normalization reduces sensitivity to the initial weight scale and allows meaningfully larger learning rates, making it one of the standard tools (alongside careful initialization, the previous concepts' optimizers, and regularization) for training the deep architectures the rest of this discipline builds.

## Documentation Links

- [CS231n — Neural Networks Part 2: Batch Normalization](https://cs231n.github.io/neural-networks-2/) — the "forcing activations to take on a unit gaussian distribution" framing and robustness-to-initialization benefit this concept covers.
- [Dive into Deep Learning — Batch Normalization](https://d2l.ai/chapter_convolutional-modern/batch-norm.html) — the `BN(x) = γ⊙(x − μ̂_B)/σ̂_B + β` transformation and its train/test statistics distinction.
