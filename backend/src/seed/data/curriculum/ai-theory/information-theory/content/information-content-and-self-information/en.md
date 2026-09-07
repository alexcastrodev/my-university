---
version: 1.0
updatedAt: 2026-09-07
---
## Learning Objectives

- Define self-information I(x) = −log₂p(x) for a single outcome of a discrete random variable.
- Derive, from a small set of natural requirements, why the logarithm is the only function that can serve as a measure of information.
- Explain why base 2 is chosen (the resulting unit, the bit) and how switching bases only rescales the same quantity.
- Compute self-information by hand for outcomes of varying probability, and explain the resulting ordering intuitively.

## Context & Motivation

The previous concept showed, by pure counting, that compressibility has a hard mathematical ceiling. To go further — to say not just "compression is limited" but "compression is limited to *exactly this many bits*" — requires a way to quantify how much information a single outcome actually carries. Shannon's 1948 paper poses exactly this question at its opening: if a message is chosen from a set of possible messages, how should "the amount of information produced by that choice" be measured? This concept works through Shannon's own answer, which turns out to be forced almost entirely by a short list of properties any reasonable measure of information ought to have — the logarithm isn't picked because it's convenient, it's picked because it's the only function satisfying those properties at all.

This is the atomic building block for the rest of the discipline: entropy (the next concept) is nothing more than the *expected* value of exactly the quantity defined here, applied across an entire probability distribution rather than a single outcome.

## Core Theory

### The intuition: rarer outcomes carry more information

Consider being told the outcome of two different events: "the sun rose this morning" (probability essentially 1) versus "you just won the lottery" (probability minuscule). The first tells you almost nothing you didn't already expect; the second is enormously informative, precisely because it was so unlikely. This suggests information content should be a *decreasing* function of probability: `I(x)` should be large when `p(x)` is small, and `I(x) = 0` when `p(x) = 1` (an outcome you were already certain of carries zero new information).

### Why the logarithm, specifically

Shannon required one more property beyond "decreasing in probability": **additivity for independent events**. If `x` and `y` are outcomes of two independent events, learning both should give exactly the sum of the information each gives individually — `I(x, y) = I(x) + I(y)` — since learning about one event tells you nothing about the other, there should be no "discount" or "bonus" from learning them together. But for independent events, `p(x, y) = p(x)·p(y)` (a direct consequence of independence, already established in `discrete-random-variables-and-pmfs`). The only class of functions turning a *product* of probabilities into a *sum* of information values is the logarithm: `log(p(x)·p(y)) = log(p(x)) + log(p(y))`. Combined with "decreasing in probability" (so a negative sign is needed, since `log(p)` is negative for `p < 1` and decreases as `p` decreases toward 0) and the normalization `I(x) = 0` when `p(x) = 1` (satisfied automatically since `log(1) = 0`), this pins down the measure uniquely up to choice of logarithm base:

```text
I(x) = −log_b(p(x))
```

### Choosing the base: bits

The base `b` only rescales the unit, exactly the way choosing meters versus feet rescales a length without changing what "length" means. Shannon's paper explicitly settles on base 2, naming the resulting unit the **bit** (Tukey's suggested term) — chosen because it matches the most natural physical unit of information storage: a single binary device (a switch, a flip-flop, one bit of memory) has exactly 2 possible states, and `log₂(2) = 1`, so the information content of an outcome with probability exactly `1/2` — a single fair coin flip — is exactly 1 bit. Converting between bases is a pure rescaling: `log₂(p) = ln(p) / ln(2) = log₁₀(p) / log₁₀(2)`, so switching from natural log ("nats") or log base 10 ("dits"/"Hartleys") to bits just multiplies by a fixed constant, never changing the shape of the measure or which outcomes carry more information than which others.

```text
I(x) = −log₂ p(x)   (bits)
```

### Properties that fall out immediately

- **I(x) ≥ 0 always**, since `p(x) ∈ (0, 1]` implies `log₂p(x) ≤ 0`, so `−log₂p(x) ≥ 0` — information content is never negative.
- **I(x) = 0 exactly when p(x) = 1** — a certain outcome carries no information, matching intuition exactly.
- **I(x) → ∞ as p(x) → 0** — an outcome that was thought essentially impossible, if it happens anyway, carries unboundedly large information content.
- **I is strictly decreasing in p(x)** — rarer outcomes always carry strictly more information than more common ones, with no exceptions.

## Worked Examples

### Example 1 — a fair coin vs. a biased coin

For a fair coin, `p(heads) = 0.5`, so `I(heads) = −log₂(0.5) = −(−1) = 1` bit — exactly matches the choice of unit above. For a heavily biased coin with `p(heads) = 0.9`: `I(heads) = −log₂(0.9) ≈ −(−0.152) = 0.152` bits — observing the far more likely outcome carries much less information. For the same biased coin's rarer outcome, `p(tails) = 0.1`: `I(tails) = −log₂(0.1) ≈ 3.322` bits — over 20× more information than observing heads on the same coin, exactly reflecting how much more surprising tails is.

### Example 2 — a fair 8-sided die

Each face has probability `p = 1/8`. `I(any face) = −log₂(1/8) = −log₂(2^−3) = 3` bits. This matches the intuitive "how many yes/no questions to pin down the outcome" reading of information: three well-chosen binary questions (is it ≤ 4? is it in the correct half of that? is it the higher or lower of the remaining two?) always suffice to identify one of 8 equally likely outcomes, and `3 = log₂(8)` exactly.

### Example 3 — self-information of a rare event, with a real numeric example

A weather station reports "no rain" on 95% of days and "rain" on 5% of days. Learning it is a "no rain" day: `I = −log₂(0.95) ≈ −(−0.074) = 0.074` bits — barely any information, since it was almost certain anyway. Learning it is a "rain" day: `I = −log₂(0.05) ≈ −(−4.322) = 4.322` bits — nearly 60× as much information from the rarer report, precisely quantifying the everyday sense that "it rained today" is more newsworthy than "it didn't."

## Common Misconceptions & Pitfalls

- **"Self-information measures how meaningful or useful an outcome is."** It measures only how *statistically surprising* the outcome was, given the probability distribution assumed — a truly meaningless but rare string of random characters has high self-information despite carrying no semantic content, and Shannon's framework is explicit that semantic meaning is deliberately excluded from this measure.
- **"A negative sign in the formula means information can be negative."** The negative sign exists precisely to *cancel out* the fact that `log₂p(x)` is itself negative for any probability less than 1 — the final quantity `I(x) = −log₂p(x)` is always non-negative, never negative, as shown in Core Theory.
- **"log base 2 is the mathematically 'correct' choice and other bases are wrong."** Any logarithm base gives a valid, internally consistent information measure — base 2 (bits) is simply the conventional, most practically useful choice, matching the binary devices used to store and transmit information; switching bases only rescales every value by the same constant factor and changes no comparison or ordering between outcomes.

## Summary

Self-information I(x) = −log₂p(x) quantifies how surprising a single outcome is, and the logarithm is not an arbitrary choice: it is the unique function (up to choice of base) satisfying the natural requirements that information content decrease with probability and add up correctly across independent events, since only the logarithm converts the product of independent probabilities into a sum of information values. Base 2 gives the bit as the unit, chosen to match binary storage devices, with a fair coin flip carrying exactly 1 bit by construction. This single-outcome quantity is the atomic ingredient the next concept, entropy, builds directly on top of — entropy is nothing more than self-information's expected value across an entire distribution.

## Documentation Links

- [Shannon — A Mathematical Theory of Communication (1948)](https://people.math.harvard.edu/~ctm/home/text/others/shannon/entropy/entropy.pdf) — doc
- [Stanford EE276 (formerly EE376A) — Reading List](https://web.stanford.edu/class/ee376a/reading.html) — doc
