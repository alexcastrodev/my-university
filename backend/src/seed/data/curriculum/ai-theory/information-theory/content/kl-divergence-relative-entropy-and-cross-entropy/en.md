---
version: 1.0
updatedAt: 2026-09-07
---
## Learning Objectives

- Define KL divergence D(p‖q) as the expected number of extra bits paid for coding data from p using a code optimized for q.
- Prove Gibbs' inequality (D(p‖q) ≥ 0, with equality iff p = q) via Jensen's inequality.
- Define cross-entropy H(p,q) and derive the identity H(p,q) = H(p) + D(p‖q).
- Connect cross-entropy directly to `deep-learning`'s `softmax-and-cross-entropy-loss`, showing it is exactly the H(p,q) defined here between the true label distribution and the model's predicted distribution.
- Explain why D(p‖q) is not a distance metric, despite informally being called "divergence."

## Context & Motivation

Entropy H(X) answers "how many bits, on average, does describing X truly require, given its real distribution?" A closely related and equally important question is: what happens if the code used doesn't quite match reality — if it was built assuming distribution `q`, but the data actually comes from distribution `p`? This is not a hypothetical concern: it is *exactly* the situation every trained classifier is in during training, before it has converged — the model's predicted distribution `q` is only an approximation of the true label distribution `p`, and the training loss needs to measure precisely how far off that approximation is, in bits.

`ai-theory/deep-learning`'s `softmax-and-cross-entropy-loss` derived cross-entropy loss entirely on its own, via maximum likelihood, explicitly noting at the time that it was deferring "the fuller information-theoretic treatment (KL divergence, entropy)" to a future discipline — this is that discipline, and this is that concept. Everything derived here about cross-entropy is compatible with, and directly explains, what that earlier concept already established from a different angle.

## Core Theory

### KL divergence: the cost of using the wrong code

Given two probability distributions `p` and `q` over the same alphabet, the **Kullback-Leibler (KL) divergence**, also called **relative entropy**, is defined as:

```text
D(p‖q) = ∑ₓ p(x)·log₂( p(x) / q(x) )
```

To see why this is "the expected extra bits paid for using q's code on p's data": recall from `the-source-coding-theorem` (a few concepts ahead, but the intuition can be stated now) that an optimal code for a distribution `r` assigns roughly `−log₂r(x)` bits to outcome `x`. If the *true* distribution is `p` but the code was built assuming `q`, outcome `x` (which truly occurs with probability `p(x)`) gets coded using `−log₂q(x)` bits instead of the `−log₂p(x)` bits it would get under its own true distribution's optimal code. The expected number of bits actually used is `∑ₓ p(x)·(−log₂q(x))` — this is exactly cross-entropy, defined formally below — and the expected number of bits that *would* have been used under the correct code is `H(p) = ∑ₓ p(x)·(−log₂p(x))`. The difference between these two is precisely `D(p‖q)`:

```text
D(p‖q) = ∑ₓ p(x)·(−log₂q(x)) − ∑ₓ p(x)·(−log₂p(x)) = ∑ₓ p(x)·log₂(p(x)/q(x))
```

— the average number of *extra*, wasted bits incurred specifically because the code was optimized for the wrong distribution.

### Gibbs' inequality: D(p‖q) ≥ 0, proved via Jensen's inequality

**Claim.** For any two distributions `p`, `q` over the same alphabet, `D(p‖q) ≥ 0`, with equality if and only if `p = q` everywhere.

**Proof.** Write `D(p‖q) = −∑ₓ p(x)·log₂(q(x)/p(x))` (summing only over `x` with `p(x) > 0`, the standard convention). Since `−log₂` is a convex function, Jensen's inequality gives `∑ₓ p(x)·(−log₂(q(x)/p(x))) ≥ −log₂(∑ₓ p(x)·q(x)/p(x))`. The right-hand side simplifies: `∑ₓ p(x)·q(x)/p(x) = ∑ₓ q(x) ≤ 1` (summing `q` only over the `x` where `p(x) > 0`, which is at most the full support of `q`, so the sum is at most 1). Since `−log₂` is a decreasing function, `−log₂(∑ₓ q(x)) ≥ −log₂(1) = 0`. Chaining the two inequalities: `D(p‖q) ≥ −log₂(1) = 0`. Jensen's inequality is an equality exactly when the convex function is applied to a value that doesn't actually vary across the weighted terms — here, exactly when `q(x)/p(x)` is constant across all `x` with `p(x) > 0`, which combined with both being valid probability distributions summing to 1 forces `p(x) = q(x)` for every `x`. ∎

This is the same style of Jensen's-inequality argument already used in `entropy-the-expected-information-content` to bound entropy above by `log₂n` — Jensen's inequality, applied to the concave or convex logarithm, is the single proof technique underlying nearly every fundamental inequality in this discipline.

### Cross-entropy

The **cross-entropy** between `p` and `q` is defined directly from the quantity identified above as "expected bits actually used under the wrong code":

```text
H(p,q) = −∑ₓ p(x)·log₂ q(x)
```

Rearranging the KL divergence definition gives the identity connecting all three quantities:

```text
H(p,q) = H(p) + D(p‖q)
```

Since `D(p‖q) ≥ 0` (Gibbs' inequality just proved), this identity immediately shows `H(p,q) ≥ H(p)` always — cross-entropy can never be *less* than the true entropy, with equality exactly when `q = p` (the code is already optimal, so there are no wasted bits at all).

### Closing the loop: cross-entropy loss is exactly H(p,q)

`ai-theory/deep-learning`'s `softmax-and-cross-entropy-loss` derived, via maximum likelihood, the loss `L = −log(softmax(z)_y)` for a single training example with true label `y`. That derivation implicitly treats the true label as a **one-hot distribution** `p`: `p(y) = 1` for the true class and `p(x) = 0` for every other class `x`. Substituting this `p` into the cross-entropy formula above, with `q = softmax(z)` as the model's predicted distribution:

```text
H(p,q) = −∑ₓ p(x)·log₂q(x) = −1·log₂q(y) − ∑_{x≠y} 0·log₂q(x) = −log₂ q(y) = −log₂ softmax(z)_y
```

This is exactly `deep-learning`'s cross-entropy loss (up to the base of the logarithm — deep learning frameworks conventionally use the natural logarithm rather than base 2, which only rescales the loss by the constant `ln(2)` and changes no gradient direction or optimization behavior). The loss that concept derived independently via maximum likelihood is, precisely, the cross-entropy `H(p,q)` between the true one-hot label distribution and the model's predicted distribution — and by the identity above, `H(p,q) = H(p) + D(p‖q) = 0 + D(p‖q) = D(p‖q)`, since a one-hot distribution has zero entropy (`H(p) = 0`, matching `entropy-the-expected-information-content`'s result that deterministic variables have zero entropy). So training a classifier by minimizing cross-entropy loss is, exactly, minimizing the KL divergence between the true labels and the model's predictions — driving the model's predicted distribution as close as possible, in bits, to the true one.

## Worked Examples

### Example 1 — KL divergence between two biased coins

Let `p(heads) = 0.9, p(tails) = 0.1` (the true coin) and `q(heads) = 0.5, q(tails) = 0.5` (a wrongly-assumed fair coin).

```text
D(p‖q) = 0.9·log₂(0.9/0.5) + 0.1·log₂(0.1/0.5)
       = 0.9·log₂(1.8) + 0.1·log₂(0.2)
       = 0.9·(0.848) + 0.1·(−2.322)
       = 0.763 − 0.232
       = 0.531 bits
```

Using a fair-coin code on this heavily-biased coin wastes, on average, about 0.531 extra bits per flip compared to the optimal code for the true distribution.

### Example 2 — checking the identity H(p,q) = H(p) + D(p‖q)

Using the same `p` and `q` from Example 1: `H(p) = −(0.9·log₂0.9 + 0.1·log₂0.1) ≈ 0.469` bits (matching `entropy-the-expected-information-content`'s Example 1 exactly, since it's the same biased coin). Direct cross-entropy: `H(p,q) = −(0.9·log₂0.5 + 0.1·log₂0.5) = −(0.9·(−1) + 0.1·(−1)) = 1` bit (using a fair-coin code always costs exactly 1 bit per symbol, regardless of the true distribution, since `q` is uniform). Check: `H(p) + D(p‖q) = 0.469 + 0.531 = 1.0` bit — matches `H(p,q) = 1` exactly.

### Example 3 — cross-entropy loss on a concrete 3-class prediction, matching `deep-learning` exactly

Reusing the exact numbers from `softmax-and-cross-entropy-loss`'s Example 1: true label `y = 0` (one-hot `p = (1, 0, 0)`), predicted `q = softmax(z) ≈ (0.659, 0.242, 0.099)`.

```text
H(p,q) = −(1·log₂0.659 + 0·log₂0.242 + 0·log₂0.099) = −log₂(0.659) ≈ 0.602 bits
```

Converting to natural log (as `deep-learning` used): `0.602 bits × ln(2) ≈ 0.602 × 0.693 ≈ 0.417 nats` — matching `softmax-and-cross-entropy-loss`'s computed loss of `≈ 0.417` exactly (that concept worked in natural log throughout, this one in base 2; the two numbers differ only by the constant `ln(2)` conversion factor from `information-content-and-self-information`). The two concepts' derivations — one via maximum likelihood, one via information-theoretic cross-entropy — arrive at the identical loss function, confirming they were always describing the same quantity from two different, equally valid angles.

## Common Misconceptions & Pitfalls

- **"KL divergence is a distance metric between distributions, like Euclidean distance."** D(p‖q) is not symmetric in general (D(p‖q) ≠ D(q‖p) except in special cases) and does not satisfy the triangle inequality — calling it "divergence" rather than "distance" is deliberate; it measures a directional cost (coding p's data with q's code), not a symmetric notion of closeness.
- **"Cross-entropy and KL divergence are basically the same thing, so it doesn't matter which is minimized during training."** They differ by exactly H(p) — the entropy of the true label distribution. When p is a fixed one-hot distribution (as in classification with hard labels), H(p) = 0 is a constant with no gradient with respect to model parameters, so minimizing H(p,q) and minimizing D(p‖q) are equivalent optimization problems in that specific case — but this equivalence relies on H(p) being constant, which is not true in general (e.g., with soft/smoothed labels, where H(p) > 0 and the two objectives differ by that nonzero constant).
- **"Gibbs' inequality only holds approximately, or only for 'nice' distributions."** The proof in Core Theory is a complete, general proof for any two valid discrete probability distributions over the same alphabet — it is not an approximation or a special-case result, which is exactly why cross-entropy can be used with total confidence as a training loss: it is provably bounded below by the true entropy, and can only decrease as the predicted distribution improves.

## Summary

KL divergence D(p‖q) = ∑ₓp(x)log₂(p(x)/q(x)) measures the expected extra bits paid for coding data from the true distribution p using a code built for a different distribution q, and Gibbs' inequality — proved here via Jensen's inequality on the convex −log₂, the same technique used to bound entropy in the previous concept — guarantees D(p‖q) ≥ 0 always, with equality exactly when p = q. Cross-entropy H(p,q) = H(p) + D(p‖q) is the total expected bits actually used under the mismatched code, and substituting a one-hot true-label distribution into this formula reproduces, exactly, the cross-entropy loss `deep-learning`'s `softmax-and-cross-entropy-loss` derived independently via maximum likelihood — closing the loop that concept deliberately left open, and confirming that training a classifier by minimizing cross-entropy loss is precisely minimizing the KL divergence between true labels and model predictions.

## Documentation Links

- [Stanford EE276 — Course Outline](https://web.stanford.edu/class/ee276/outline.html) — doc
- [Shannon — A Mathematical Theory of Communication (1948)](https://people.math.harvard.edu/~ctm/home/text/others/shannon/entropy/entropy.pdf) — doc
