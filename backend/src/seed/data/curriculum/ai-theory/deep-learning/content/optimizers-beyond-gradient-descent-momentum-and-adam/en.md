---
version: 1.0
updatedAt: 2026-09-07
---
## Learning Objectives

- Explain why plain (mini-batch) gradient descent, already covered in full in `ai-theory/machine-learning`, converges slowly or oscillates on the kind of loss surfaces deep networks actually have.
- State the momentum update rule and explain, geometrically, how it smooths out noisy or oscillating gradient directions.
- State the Adam update rule and explain how it combines momentum with a per-parameter adaptive learning rate.
- Trace a concrete comparison between plain gradient descent and momentum on a loss surface where one converges much faster than the other.

## Context & Motivation

`gradient-descent-as-a-general-optimizer` in `ai-theory/machine-learning` derived the update rule `θ := θ − α·∇J(θ)` and covered batch, stochastic, and mini-batch variants in full — none of that is re-derived here. What that concept did not need to confront is the specific shape of loss surfaces that deep networks with millions of parameters actually produce: long, narrow ravines where the surface is steep in some directions and nearly flat in others, and highly stochastic per-batch gradient estimates from the mini-batches typical of large-scale training. Plain gradient descent handles both poorly — it oscillates across a narrow ravine's steep walls while making painfully slow progress along its flat floor. Momentum and Adam are the two optimizers built specifically to address this, and one or the other is the default choice for training essentially every network covered later in this discipline.

## Core Theory

### Momentum: smoothing the update direction

Momentum maintains a running, exponentially-decaying average of past gradients — a **velocity** vector `v` — and updates parameters using that velocity rather than the raw gradient directly:

```text
v := β·v − α·∇J(θ)
θ := θ + v
```

`β` (typically around 0.9) controls how much of the previous velocity is retained. Intuitively, this is the same idea as a ball rolling down a hill: it accelerates in directions where the gradient consistently points the same way across several steps (building up velocity along the ravine's floor), while oscillating gradients in perpendicular directions partially cancel out in the running average (damping the zig-zag across the ravine's walls). Momentum does not change what direction any single gradient computation points in — it changes how that information is accumulated and used across steps.

### Adam: momentum plus a per-parameter adaptive learning rate

Adam (Adaptive Moment Estimation) tracks two running averages per parameter: a first moment `m` (essentially the same momentum term above) and a second moment `s` (a running average of the *squared* gradient, tracking how large that parameter's gradient has typically been in magnitude, regardless of sign):

```text
m := β₁·m + (1 − β₁)·∇J(θ)
s := β₂·s + (1 − β₂)·(∇J(θ))²
θ := θ − α · m / (√s + ε)
```

(with `β₁ ≈ 0.9`, `β₂ ≈ 0.999`, and a small `ε` to avoid division by zero; both `m` and `s` are also bias-corrected in the first few steps, since they start at zero.) The `m/√s` term is the key idea: parameters whose gradients have historically been large get an *effectively smaller* learning rate (dividing by a large `√s`), while parameters whose gradients have historically been small and consistent get an *effectively larger* one. This makes Adam far less sensitive to manually tuning a single global learning rate than plain gradient descent, which is exactly why it became the default optimizer for most of the architectures covered later in this discipline.

## Worked Examples

### Example 1: Plain gradient descent oscillating on an elongated bowl

Minimize `J(θ₁, θ₂) = θ₁² + 25θ₂²` — a loss surface much steeper in the `θ₂` direction than the `θ₁` direction, a simplified stand-in for the "narrow ravine" shape common in real networks. Starting at `(θ₁, θ₂) = (5, 1)` with `α = 0.03`:

```text
∇J = (2θ₁, 50θ₂)
Iteration 0: θ = (5.000, 1.000),  ∇J = (10.00, 50.00), θ ← (5.000 − 0.30, 1.000 − 1.50) = (4.700, −0.500)
Iteration 1: θ = (4.700, −0.500), ∇J = (9.40, −25.00), θ ← (4.700 − 0.282, −0.500 + 0.750) = (4.418, 0.250)
Iteration 2: θ = (4.418, 0.250),  ∇J = (8.836, 12.500), θ ← (4.418 − 0.265, 0.250 − 0.375) = (4.153, −0.125)
```

`θ₂` is oscillating in sign every step (`1.000 → −0.500 → 0.250 → −0.125`) while barely shrinking in magnitude, and `θ₁` is decreasing only very slowly — plain gradient descent is spending most of its progress bouncing across the steep direction instead of making headway along the shallow one.

### Example 2: The same surface, with momentum damping the oscillation

Repeating with momentum (`β = 0.8`, same `α = 0.03`), tracking `θ₂` and its velocity `v₂` only (started at `v₂ = 0`):

```text
Iteration 0: v₂ ← 0.8(0) − 0.03(50.00) = −1.500,  θ₂ ← 1.000 + (−1.500) = −0.500
Iteration 1: ∇θ₂ = 50(−0.500) = −25.00
             v₂ ← 0.8(−1.500) − 0.03(−25.00) = −1.200 + 0.750 = −0.450
             θ₂ ← −0.500 + (−0.450) = −0.950
Iteration 2: ∇θ₂ = 50(−0.950) = −47.50
             v₂ ← 0.8(−0.450) − 0.03(−47.50) = −0.360 + 1.425 = 1.065
             θ₂ ← −0.950 + 1.065 = 0.115
```

`θ₂` is still oscillating in sign, but its magnitude is shrinking noticeably faster than in Example 1 (`1.000 → −0.500 → −0.950 → 0.115` versus plain gradient descent's slower `1.000 → −0.500 → 0.250 → −0.125`) — this is momentum's damping effect starting to take hold, converging to the minimum in fewer effective iterations on exactly the ravine-shaped surface plain gradient descent struggled with.

## Common Misconceptions & Pitfalls

- **"Momentum and Adam compute a different gradient than plain gradient descent."** Both use the exact same `∇J(θ)` from backpropagation — nothing about how the gradient itself is computed changes. What changes is how successive gradients are accumulated and turned into a parameter update.
- **"Adam is strictly better than plain gradient descent or momentum, so it should always be used."** Adam's adaptive per-parameter scaling is a real advantage for the noisy, ill-conditioned loss surfaces typical of deep networks, but it is not universally superior — plain SGD with momentum, tuned carefully, is still preferred in some large-scale training setups for its slightly better final generalization in practice. The choice is a real, contested engineering decision, not a settled default.
- **"A higher momentum coefficient `β` always converges faster."** Too high a `β` (close to 1) makes the velocity retain too much history, causing the parameters to overshoot the minimum and oscillate on a longer timescale than plain gradient descent would — momentum trades faster progress along consistent directions for the risk of overshooting if tuned too aggressively.

## Summary

Momentum accumulates a running, decaying average of past gradients into a velocity term, damping oscillation across steep directions while accelerating progress along consistently-sloped ones — directly addressing the elongated, ravine-shaped loss surfaces plain gradient descent (`ai-theory/machine-learning`) struggles with. Adam extends this with a second running average of squared gradients, giving each parameter its own effectively-scaled learning rate. Neither optimizer changes how the gradient itself is computed (that remains backpropagation, unchanged); both change only how successive gradients are turned into parameter updates, and one of the two is the practical default for training essentially every architecture the rest of this discipline covers.

## Documentation Links

- [CS231n — Neural Networks Part 3: Parameter Updates](https://cs231n.github.io/neural-networks-3/) — momentum, Nesterov momentum, and the adaptive methods (Adagrad, RMSprop, Adam) this concept covers.
- [Dive into Deep Learning — Adam](https://d2l.ai/chapter_optimization/adam.html) — the first/second moment estimates and bias-correction detail behind the Adam update rule.
