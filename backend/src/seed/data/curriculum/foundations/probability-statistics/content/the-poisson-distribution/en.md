---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- State the Poisson PMF, P(X=k) = (λᵏ·e⁻λ)/k!, and identify what the single parameter λ represents.
- Derive the Poisson PMF as the limiting case of the Binomial(n,p) distribution as n→∞ and p→0 with np=λ held fixed.
- Recognize real-world scenarios (rare events over a fixed interval of time, space, or opportunity) that are well-modeled by a Poisson distribution.
- State and justify E[X] = Var(X) = λ for a Poisson random variable, and explain why this equality is a distinctive signature of the distribution.
- Decide, given a description of a counting scenario, whether a Binomial or a Poisson model is the more appropriate fit.

## Context & Motivation

Many real counting problems don't come with a natural, fixed number of trials the way a Binomial model requires. The number of typos on a page, the number of emails arriving in an inbox in an hour, the number of radioactive decay events in a fixed time window, the number of manufacturing defects per meter of cable — in every one of these, there is no clean "n independent trials, each succeeding with probability p" framing on the surface. There is no fixed n: an email could, in principle, arrive at literally any instant within the hour, and there is no obvious way to divide "the hour" into a fixed number of discrete yes/no trials. The **Poisson distribution** is built exactly to handle this class of problem — counting the number of occurrences of some rare, independent event over a fixed interval — and it turns out, remarkably, not to be a new independent idea at all, but a limiting case of the Binomial distribution already developed, obtained by imagining that fixed interval sliced into an enormous number of vanishingly short sub-intervals.

This derivation — Poisson as the n→∞, p→0 limit of Binomial(n,p), with the product np held fixed at a constant λ — is one of the more genuinely illuminating derivations in introductory probability, and both MIT's 6.041 and Stanford's CS109 treat it as essential precisely because it explains *why* the odd-looking e⁻λ term appears in the Poisson formula (it falls straight out of the well-known limit (1 − λ/n)ⁿ → e⁻λ from calculus) and *why* the Poisson distribution is the right tool exactly when a Binomial model's n is impractically large and p impractically small — which is exactly the situation with "an email could arrive at any instant" reasoning: imagine dividing the hour into n tiny sub-intervals so fine that at most one email could plausibly arrive in any single sub-interval, treat each sub-interval as a Bernoulli trial with small success probability p, and let n grow without bound.

Poisson's practical reach is enormous once this derivation is in hand: computer science applications include modeling request arrival rates at a server, packet arrivals on a network link, cache misses per unit of memory accessed, and rare-event counts in reliability engineering — anywhere "how many times does a rare, roughly-independent thing happen in a fixed window" is the actual question being asked, a Poisson model is very often the appropriate first tool to reach for.

## Core Theory

### The Poisson PMF and its parameter

**Definition.** A random variable X follows a **Poisson(λ)** distribution, for a fixed parameter λ > 0, if

P(X=k) = (λᵏ · e⁻λ) / k!,   for k = 0, 1, 2, 3, …

with no upper bound on k (unlike the Binomial, whose k could never exceed the fixed number of trials n, a Poisson-distributed count can in principle be any non-negative integer, however unlikely the largest ones become).

The single parameter λ represents the **average rate of occurrence** over the fixed interval being modeled — λ = 4 might mean "on average, 4 emails arrive per hour," and the Poisson(4) distribution then describes the full probability of seeing exactly 0, 1, 2, 3, … emails in any given hour, given that average rate.

### Deriving Poisson as a limit of Binomial

**Setup.** Take the fixed interval (say, one hour) being modeled, and divide it into n equal sub-intervals, for very large n. Assume:

1. Each sub-interval independently either has an occurrence ("success," probability p) or doesn't (probability 1−p) — treating each sub-interval as a Bernoulli(p) trial.
2. n is large enough that at most one occurrence could plausibly happen within any single sub-interval (this becomes exactly true in the limit n→∞).
3. The overall average number of occurrences across the whole interval is held fixed at λ, meaning np = λ, i.e., p = λ/n — as n grows and the sub-intervals shrink, p must shrink correspondingly to keep the total expected count constant.

Under these assumptions, the total count of occurrences across the whole interval is exactly Binomial(n, p) with p = λ/n, and the claim is that as n→∞ (with λ fixed), the Binomial PMF converges to the Poisson PMF.

**The derivation.** Start from the Binomial PMF with p = λ/n:

P(X=k) = C(n,k) · pᵏ · (1−p)ⁿ⁻ᵏ = [n! / (k!(n−k)!)] · (λ/n)ᵏ · (1 − λ/n)ⁿ⁻ᵏ

Rearrange into four separate factors, each of which has a clean limit as n→∞ with k and λ held fixed:

P(X=k) = [n(n−1)(n−2)⋯(n−k+1) / nᵏ] · [λᵏ/k!] · (1 − λ/n)ⁿ · (1 − λ/n)⁻ᵏ

Examine each factor's limit as n→∞:

- **First factor**, n(n−1)⋯(n−k+1)/nᵏ: this is a product of k terms, each of the form (n−i)/n = 1 − i/n → 1 as n→∞ (for fixed i, k). So the whole product → 1·1⋯1 = **1**.
- **Second factor**, λᵏ/k!: does not depend on n at all — stays exactly **λᵏ/k!**.
- **Third factor**, (1 − λ/n)ⁿ: this is precisely the standard calculus limit that defines the exponential function, (1 − λ/n)ⁿ → **e⁻λ** as n→∞.
- **Fourth factor**, (1 − λ/n)⁻ᵏ: as n→∞, λ/n → 0, so this factor → (1−0)⁻ᵏ = **1**.

Multiplying the four limits together:

P(X=k) → 1 · (λᵏ/k!) · e⁻λ · 1 = **λᵏ e⁻λ / k!**

which is exactly the Poisson PMF. Every term in the Binomial formula has been accounted for and traced to its limiting contribution — the combinatorial factor C(n,k) contributes nothing extra in the limit (it converges to 1 once divided by nᵏ), and the entire distinctive e⁻λ term of the Poisson distribution comes directly from the (1−p)ⁿ⁻ᵏ "no occurrence" factor of the Binomial, via the standard limit definition of e.

```mermaid
flowchart LR
    A["Binomial(n, p=λ/n)\nn sub-intervals, each\na tiny Bernoulli trial"]
    B["Let n → ∞\n(p → 0, np = λ fixed)"]
    C["Poisson(λ)\nP(X=k) = λ^k e^-λ / k!"]
    A --> B --> C
```

### Mean and variance

Rather than re-deriving E[X] and Var(X) from the Poisson PMF sum directly, both can be read off from the limiting process itself: a Binomial(n,p) has E[X] = np and Var(X) = np(1−p). Substituting p = λ/n:

E[X] = np = n·(λ/n) = **λ**

Var(X) = np(1−p) = n·(λ/n)·(1 − λ/n) = λ·(1 − λ/n) → **λ**   as n→∞ (since λ/n → 0)

So for a Poisson(λ) random variable, **E[X] = Var(X) = λ** — both the mean and the variance equal the very same parameter that defines the distribution. This is a distinctive, easily-checked signature of Poisson-distributed data: if a real dataset's sample mean and sample variance are noticeably different from each other, that's evidence against treating it as Poisson-distributed, since a genuine Poisson process forces those two quantities to agree exactly.

### When to use Poisson versus Binomial

Poisson is the appropriate model when:

- There is no natural fixed number of trials n (events can occur, in principle, at any point in a continuous interval of time, space, or another continuum).
- Occurrences are rare relative to the size of the interval, and roughly independent of each other.
- Only the average rate λ (occurrences per interval) is known or assumed, rather than a trial count and per-trial probability.

Binomial remains the right model when there genuinely is a fixed, known number of discrete trials n, each with its own well-defined success probability p — Poisson is best understood not as a competitor to Binomial but as its extreme limiting case, useful precisely when n is impractically large (or not even meaningfully definable) and p correspondingly small.

## Worked Examples

### Example 1 — direct application of the Poisson PMF

**Problem:** A call center receives, on average, 3 calls per minute (λ=3). What is the probability that exactly 5 calls arrive in a given minute?

**Apply the formula directly.**

P(X=5) = (3⁵ · e⁻³) / 5! = (243 · e⁻³) / 120

Using e⁻³ ≈ 0.0498:

P(X=5) ≈ (243 × 0.0498) / 120 ≈ 12.10 / 120 ≈ 0.1008

So there's roughly a 10.1% chance of exactly 5 calls in a given minute — a fully mechanical application once λ and k are identified, with no combinatorial factor needed (unlike Binomial), since the Poisson PMF already has the counting fully absorbed into its derivation.

### Example 2 — verifying the Binomial-to-Poisson convergence numerically

**Problem:** Confirm the limiting derivation concretely: compute P(X=2) under Binomial(n=1000, p=0.005) and compare it to P(X=2) under Poisson(λ=np=5).

**Poisson value.** λ = 1000 × 0.005 = 5.

P(X=2) = (5² · e⁻⁵) / 2! = (25 × e⁻⁵) / 2

Using e⁻⁵ ≈ 0.006738:

P(X=2) ≈ (25 × 0.006738)/2 ≈ 0.16845/2 ≈ 0.08422

**Binomial value.** P(X=2) = C(1000,2)·(0.005)²·(0.995)⁹⁹⁸.

C(1000,2) = (1000×999)/2 = 499500. (0.005)² = 0.000025. (0.995)⁹⁹⁸ ≈ e^(998·ln(0.995)) ≈ e^(998×(−0.0050125)) ≈ e^(−5.0025) ≈ 0.006706.

P(X=2) ≈ 499500 × 0.000025 × 0.006706 ≈ 12.4875 × 0.006706 ≈ 0.08375

**Compare.** Binomial gives ≈0.0838, Poisson gives ≈0.0842 — agreeing to within about half a percent, with n=1000 nowhere near infinity yet. This is a direct numerical confirmation of the derivation above: even a "merely large" n, not a literal limit, already makes Binomial(n, λ/n) and Poisson(λ) nearly indistinguishable, which is exactly why Poisson is used as a practical approximation to Binomial whenever n is large and p is small, without needing to take n literally to infinity.

```python
import math

def binomial_pmf(n, p, k):
    return math.comb(n, k) * p**k * (1 - p)**(n - k)

def poisson_pmf(lam, k):
    return (lam**k * math.exp(-lam)) / math.factorial(k)

n, p, k = 1000, 0.005, 2
print(binomial_pmf(n, p, k))   # ≈ 0.08383
print(poisson_pmf(n * p, k))   # ≈ 0.08422
```

### Example 3 — using the E[X]=Var(X)=λ signature to sanity-check a modeling assumption

**Problem:** A website logs the number of failed login attempts per hour over 100 hours. The sample mean is 4.1 and the sample variance is 4.05. Is a Poisson model plausible? A second dataset (number of failed logins under a coordinated attack) has sample mean 4.1 but sample variance 38.7 — is Poisson still plausible there?

**First dataset.** Mean ≈4.1 and variance ≈4.05 are very close to each other, consistent with the theoretical Poisson requirement E[X]=Var(X)=λ. A Poisson(λ≈4.1) model is entirely plausible here — this is exactly the pattern expected from independent, randomly-timed rare events (ordinary failed logins from typos and forgotten passwords, roughly memoryless and independent of each other).

**Second dataset.** Mean ≈4.1 but variance ≈38.7 — far larger than the mean, a serious mismatch with the E[X]=Var(X) signature. This is strong evidence *against* a Poisson model: a coordinated attack likely produces failed logins in bursts (many attempts clustered together in short windows, followed by quiet periods) rather than independently and uniformly across the hour, violating the independence assumption baked into the Poisson derivation. This kind of "variance much bigger than the mean" pattern (called overdispersion) is a standard diagnostic red flag that a naive Poisson model is missing real structure — here, the dependence between successive login attempts during an attack.

## Common Misconceptions & Pitfalls

- **"Poisson requires knowing n and p, just like Binomial does."** Poisson requires only a single parameter, λ, the average rate — it deliberately does not require (and often cannot even define) a specific trial count n or per-trial probability p. This is precisely its advantage in situations, like emails arriving continuously, where n and p have no natural meaning.
- **"e⁻λ appears in the formula for no particular reason — it's just part of the definition."** As derived above, e⁻λ is not arbitrary: it falls directly out of the standard limit (1 − λ/n)ⁿ → e⁻λ, which is exactly the "no occurrence in this tiny sub-interval" factor from the underlying Binomial model, taken to its limit. Seeing this derivation once demystifies why e shows up in a discrete counting distribution at all.
- **"Since Poisson comes from Binomial with p→0, Poisson only applies to 'unlikely' events in some vague sense."** The precise condition is that the derivation requires many (n→∞) trials each with small probability p, holding np=λ fixed — "rare per sub-interval, but with a well-defined, possibly large, average total count λ" is the correct reading, not "an unlikely event overall." λ itself can be large (e.g., λ=1000 emails per day is a perfectly good Poisson parameter), even though each infinitesimal sub-interval has a tiny per-sub-interval probability.
- **"If the sample mean and sample variance of some count data are equal, the data must be Poisson-distributed."** E[X]=Var(X)=λ is a necessary consequence of the Poisson model, not a sufficient proof of it — Example 3's diagnostic works well as evidence *against* Poisson when the two disagree sharply, but a close match is only supportive, not conclusive; other distributions can occasionally produce similar mean/variance agreement by coincidence.
- **"A Poisson random variable is bounded above, the same way a Binomial one is bounded by n."** Poisson has no upper bound on k at all — every non-negative integer has strictly positive probability, however small for large k, since there is no finite n limiting the count in the Poisson formulation (n was sent to infinity precisely to remove that limit).

## Summary

The Poisson(λ) distribution, P(X=k) = λᵏe⁻λ/k!, models the count of rare, roughly independent occurrences over a fixed interval, and is derived rigorously as the limit of Binomial(n, p=λ/n) as n→∞ — every term in the Poisson formula, including the otherwise-mysterious e⁻λ, traces directly back to a term in the Binomial PMF taken to its limit. Unlike Binomial, Poisson requires only a single rate parameter λ and places no upper bound on the count, making it the right tool exactly when a fixed trial count n has no natural meaning. E[X] = Var(X) = λ is a signature consequence of the derivation (both quantities inherited directly from np and np(1−p) as p→0), and serves as a practical diagnostic: real count data whose sample mean and sample variance diverge sharply is likely violating the independence or fixed-rate assumptions the Poisson model depends on.

## Documentation Links

- [MIT 6.041 — Lecture Notes (OCW)](https://ocw.mit.edu/courses/6-041-probabilistic-systems-analysis-and-applied-probability-fall-2010/pages/lecture-notes/) — doc
- [Stanford CS109 — Course Schedule](http://web.stanford.edu/class/cs109/schedule.html) — doc
