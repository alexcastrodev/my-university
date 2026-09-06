---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- State the gradient descent update rule and explain, geometrically, why stepping opposite the gradient decreases a loss function.
- Explain the role of the learning rate, and describe what happens when it is chosen too large or too small.
- Trace a concrete gradient descent run over several iterations on a simple loss function, by hand.
- Distinguish batch, stochastic, and mini-batch gradient descent, and explain why the stochastic and mini-batch variants matter for the large datasets this discipline's later models are typically trained on.

## Context & Motivation

`foundations/mathematics-for-computing` introduced the gradient as a vector generalization of a single-variable derivative — the direction of steepest ascent of a function of several variables — and used it, informally, to help derive the least-squares normal equation by setting a gradient to zero. That earlier use was a one-time trick specific to a quadratic, convex loss with a closed-form solution. This concept turns the same gradient into the workhorse of a general-purpose iterative optimization algorithm: gradient descent, which works for essentially any differentiable loss function, whether or not a closed form exists.

This matters immediately: logistic regression, the very next concept in this discipline, has no closed-form solution the way linear regression does. Gradient descent (or a close relative) is how logistic regression, and nearly every other model covered later in this discipline — including neural networks — is actually fit in practice.

## Core Theory

### The update rule

To minimize a differentiable loss function `J(θ)`, gradient descent repeatedly updates the parameter vector `θ` by stepping in the direction opposite the gradient:

```text
θ := θ − α · ∇J(θ)
```

where `∇J(θ)` is the gradient of `J` evaluated at the current `θ`, and `α` (the **learning rate**) is a small positive step size chosen in advance. The gradient points in the direction of steepest *increase* of `J`; moving opposite it is therefore the locally best direction to decrease `J`. Repeating this update, `θ` moves progressively toward a point where the gradient is zero — a local minimum, and for a convex loss like linear or logistic regression's, the *global* minimum.

### Choosing the learning rate

The learning rate `α` controls how large each step is. Too small, and convergence is correct but painfully slow, requiring many iterations to make meaningful progress. Too large, and the update can overshoot the minimum entirely, causing the loss to oscillate or even diverge to increasingly large values instead of decreasing. In practice, `α` is chosen by experimentation — often starting large and decreasing it over training, or trying several values on the validation set (introduced later in this discipline's evaluation cluster) and picking the one that converges fastest without diverging.

### Batch, stochastic, and mini-batch variants

The update rule above uses the gradient of the loss summed over the *entire* training set (**batch gradient descent**) — accurate, but expensive per step when the training set is large, since every single update requires a full pass over all the data. **Stochastic gradient descent (SGD)** instead updates `θ` using the gradient computed from just one training example at a time, trading a noisier, less accurate per-step direction for dramatically cheaper and more frequent updates. **Mini-batch gradient descent** is the practical middle ground used almost universally in practice: compute the gradient over a small batch of examples (say 32 or 256) at a time, balancing the stability of batch gradient descent against the speed of SGD.

## Worked Examples

### Example 1: A hand-traced descent on a simple quadratic

Minimize `J(θ) = (θ − 3)²`, a one-dimensional quadratic with a unique minimum at `θ = 3`. Its derivative is `J'(θ) = 2(θ − 3)`. Starting at `θ₀ = 0` with learning rate `α = 0.3`:

```text
Iteration 0: θ = 0.000,   J'(θ) = 2(0 − 3)     = −6.000,   θ ← 0.000 − 0.3(−6.000) = 1.800
Iteration 1: θ = 1.800,   J'(θ) = 2(1.8 − 3)   = −2.400,   θ ← 1.800 − 0.3(−2.400) = 2.520
Iteration 2: θ = 2.520,   J'(θ) = 2(2.52 − 3)  = −0.960,   θ ← 2.520 − 0.3(−0.960) = 2.808
Iteration 3: θ = 2.808,   J'(θ) = 2(2.808 − 3) = −0.384,   θ ← 2.808 − 0.3(−0.384) = 2.9232
Iteration 4: θ = 2.9232,  J'(θ) ≈ −0.1536,               θ ← 2.9232 + 0.04608 ≈ 2.969
```

`θ` is visibly converging toward the true minimum at 3, moving by a shrinking amount each iteration — exactly the expected behavior as the gradient itself shrinks near the minimum.

### Example 2: A learning rate that diverges

Repeating Example 1 with `α = 1.1` (too large for this loss):

```text
Iteration 0: θ = 0.000,  J'(θ) = −6.000,  θ ← 0.000 − 1.1(−6.000) = 6.600
Iteration 1: θ = 6.600,  J'(θ) = +7.200,  θ ← 6.600 − 1.1(7.200)  = −1.320
Iteration 2: θ = −1.320, J'(θ) = −8.640,  θ ← −1.320 − 1.1(−8.640) = 8.184
```

`θ` is oscillating with growing magnitude around the true minimum of 3, instead of converging — a real, computable illustration of why the learning rate cannot simply be set as large as possible for faster progress.

## Common Misconceptions & Pitfalls

- **"Gradient descent always finds the global minimum."** This is guaranteed only when the loss function is convex (as it is for linear and logistic regression) — for non-convex losses, such as the ones neural networks use, gradient descent can converge to a local minimum that is not globally optimal.
- **"A smaller learning rate is always safer and just as good, only slower."** True in the limit, but in practice an unnecessarily tiny learning rate can make training impractically slow or get stuck making negligible progress long before reaching a good solution within a realistic training budget.
- **"Stochastic gradient descent is a worse, approximate version of batch gradient descent."** Its noisier updates are a genuine tradeoff, not strictly a downside — the noise can help escape shallow local minima or saddle points in non-convex losses, and its much lower per-step cost is what makes training on very large datasets practical at all.

## Summary

Gradient descent repeatedly updates parameters by stepping opposite the loss function's gradient, scaled by a learning rate — a direct generalization of the informal gradient already introduced in `foundations/mathematics-for-computing`, now made into a full iterative optimization algorithm that works whether or not a closed-form solution exists. The learning rate must be tuned carefully: too small wastes time, too large can cause divergence. Batch, stochastic, and mini-batch variants trade off gradient accuracy against per-step computational cost, with mini-batch the practical default for the large-dataset training this discipline's later models — logistic regression onward — actually rely on.

## Documentation Links

- [Stanford CS229 — Lecture Notes, Part I: Linear Regression](https://cs229.stanford.edu/main_notes.pdf) — introduces gradient descent (and its stochastic variant) as the general fitting method underlying this discipline's models.
- [MIT 18.065 — Syllabus (OCW)](https://ocw.mit.edu/courses/18-065-matrix-methods-in-data-analysis-signal-processing-and-machine-learning-spring-2018/pages/syllabus/) — covers gradient-based optimization methods in the same applied linear-algebra framing this curriculum already used for gradients.
