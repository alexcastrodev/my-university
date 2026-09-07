---
version: 1.0
updatedAt: 2026-09-07
---
## Learning Objectives

- State Shannon's source coding theorem precisely: entropy is both a lower bound on, and an asymptotically achievable target for, the average code length of a lossless code.
- Reproduce the easier direction of the theorem — a real proof that no lossless code can beat entropy on average — via Gibbs' inequality.
- Explain, at an intuition level, why entropy is asymptotically achievable, without the full formal machinery of typical sequences.
- Connect the counting-argument style of this proof to the comparison-sort lower bound already proved in `algorithms`.

## Context & Motivation

Every concept so far has built toward a single number, entropy, that measures a source's inherent uncertainty. The source coding theorem is where that number earns its keep: it states, and this concept proves the easier half of, exactly why entropy is not just *a* useful summary statistic but *the* fundamental limit on lossless compression — no cleverer code, however ingenious, can beat it on average, and (a fact stated here but developed concretely over the next several concepts) codes exist that get arbitrarily close to it. This is the theorem that turns "the limits of compression" — introduced all the way back at the start of this discipline via a bare counting argument — into an exact, quantitative statement: the limit is precisely `H(X)` bits per symbol, not merely "some limit exists."

## Core Theory

### Statement of the theorem

**Shannon's source coding theorem.** For a source emitting symbols independently according to a distribution with entropy `H(X)`:

1. **(Converse / lower bound.)** No uniquely-decodable code can achieve an average codeword length strictly less than `H(X)` bits per symbol.
2. **(Achievability.)** For any `ε > 0`, there exists a uniquely-decodable code with average length less than `H(X) + ε` bits per symbol — entropy can be approached arbitrarily closely, and exactly achieved in the limit of encoding long enough blocks of symbols at once.

Together, these pin entropy down as *exactly* the fundamental compression limit — not just a lower bound with an unknown gap to what's achievable, but a limit that is both unbeatable and (asymptotically) attainable.

### Proving the converse: no code beats entropy

**Claim.** For any uniquely-decodable code assigning length `l(x)` to symbol `x`, the average code length `L = ∑ₓ p(x)·l(x)` satisfies `L ≥ H(X)`.

**Proof sketch, via Gibbs' inequality.** Any uniquely-decodable code's lengths satisfy the Kraft inequality `∑ₓ 2^(−l(x)) ≤ 1` (proved fully in the next concept — assumed here). Define `q(x) = 2^(−l(x)) / K` where `K = ∑ₓ2^(−l(x)) ≤ 1`; this `q` is a valid probability distribution (it's non-negative and sums to 1 by construction). Gibbs' inequality (`kl-divergence-relative-entropy-and-cross-entropy`) gives `D(p‖q) ≥ 0`, i.e., `∑ₓ p(x)log₂(p(x)/q(x)) ≥ 0`, which rearranges to `∑ₓ p(x)log₂p(x) ≥ ∑ₓ p(x)log₂q(x)`. Substituting `q(x) = 2^(−l(x))/K`:

```text
−H(X) ≥ ∑ₓ p(x)·[−l(x) − log₂K] = −L − log₂K
```

Since `K ≤ 1`, `log₂K ≤ 0`, so `−log₂K ≥ 0`, giving `−H(X) ≥ −L − log₂K ≥ −L`, i.e., `H(X) ≤ L`. ∎

This is, structurally, exactly the same proof technique as `entropy-the-expected-information-content`'s and `mutual-information`'s bounds: a Gibbs'/Jensen's-inequality argument comparing the true distribution against a cleverly-constructed comparison distribution, here built directly from the code's own lengths.

### Why entropy is achievable: the intuition (not the full proof)

The achievability direction's full proof (via typical sequences and, in the general case, random coding arguments) is genuinely graduate-level machinery — appropriate for a course like MIT 6.441 or the advanced chapters of Cover & Thomas, but more than a CS-oriented introduction needs to reproduce in full. The core intuition, however, is straightforward and worth stating precisely: encode not one symbol at a time, but long blocks of `n` symbols at once. As `n` grows, the law of large numbers (already covered in `foundations/probability-statistics`) guarantees that the *actual* sequence of symbols observed becomes overwhelmingly likely to be one of a relatively small set of "typical" sequences — ones whose empirical symbol frequencies are close to the true probabilities — and there are only about `2^(nH(X))` such typical sequences, out of the vastly larger `|alphabet|ⁿ` total possible sequences. Assigning short codewords (about `nH(X)` bits total) to just this typical set, and accepting a vanishingly small probability of failure on the rare atypical sequences, drives the *average* bits-per-symbol down to `H(X) + ε` for any desired `ε`, as `n` grows large enough. `huffman-coding-construction`, several concepts ahead, will show a concrete, fully rigorous construction that gets close to this bound (though not always achieving it exactly) without any of this asymptotic block-length machinery — the achievability sketch here is about *why* the limit is reachable in principle, not the algorithm that reaches it.

### The parallel to the comparison-sort lower bound

`algorithms`'s `the-comparison-sort-lower-bound` proves that any comparison-based sort needs at least `log₂(n!)` comparisons, via a decision-tree argument: a comparison sort's execution corresponds to a path down a binary decision tree, and a tree distinguishing `n!` possible orderings needs depth at least `log₂(n!)`. The source coding converse proved above is a close cousin of exactly this style of argument: both are, at heart, counting arguments showing that a fixed structure (a decision tree of comparisons; a uniquely-decodable code) cannot do better than a bound derived from how much genuine uncertainty (the number of orderings; the entropy of the source) must be resolved.

## Worked Examples

### Example 1 — checking the converse against a real fixed-length code

For the 4-symbol source from `entropy-the-expected-information-content`'s Example 3 (`p(A)=0.5, p(B)=0.25, p(C)=p(D)=0.125`, `H(X) = 1.75` bits), a naive fixed-length code assigns every symbol exactly 2 bits (`00, 01, 10, 11`, enough to distinguish 4 symbols). Average length: `L = 2` bits, since every codeword has the same length regardless of probability. This satisfies the converse (`L = 2 ≥ H(X) = 1.75`) but wastes `2 − 1.75 = 0.25` bits per symbol on average compared to the theoretical limit — exactly the gap `huffman-coding-construction`'s variable-length code will close.

### Example 2 — a code that (almost) beats naive fixed-length, still respecting the bound

For the same source, consider the variable-length code `A→0, B→10, C→110, D→111` (lengths 1, 2, 3, 3). Average length: `L = 0.5·1 + 0.25·2 + 0.125·3 + 0.125·3 = 0.5 + 0.5 + 0.375 + 0.375 = 1.75` bits — exactly equal to `H(X) = 1.75`. This confirms the converse's bound is tight for this particular distribution (whose probabilities happen to be exact powers of 2) — this specific code will reappear, constructed systematically rather than guessed, in `huffman-coding-construction`.

### Example 3 — why a distribution with non-power-of-2 probabilities cannot hit the bound exactly with single-symbol codes

For a 3-symbol source with `p(A)=0.5, p(B)=0.3, p(C)=0.2`: `H(X) = −(0.5log₂0.5 + 0.3log₂0.3 + 0.2log₂0.2) ≈ −(−0.5 − 0.521 − 0.464) = 1.485` bits. Since codeword lengths must be positive integers, no single-symbol code can achieve fractional average length exactly matching `1.485` — the best achievable with single-symbol codes will be strictly greater than `H(X)` (this gap is exactly what the achievability direction's block-coding intuition closes: encoding pairs, triples, or longer blocks of symbols together allows the average bits-per-symbol to approach `1.485` arbitrarily closely, even though no single-symbol assignment can hit it exactly).

## Common Misconceptions & Pitfalls

- **"The source coding theorem says entropy bits per symbol is always achievable with a simple code."** The converse (no code beats entropy) is achievable and proved concretely here; the achievability direction is genuinely asymptotic — it requires encoding long blocks of symbols, or accepting a small gap, as Example 3 shows concretely for a distribution whose probabilities aren't exact powers of 2.
- **"This theorem only applies to specially-constructed 'nice' distributions."** The proof of the converse in Core Theory places no restriction on `p(x)` beyond being a valid probability distribution — it holds for every discrete source, which is exactly why it functions as a universal fundamental limit rather than a special-case result.
- **"Achieving the entropy bound requires knowing something clever about the specific symbols, not just their probabilities."** The bound and the achievability argument depend only on the probability distribution `p(x)`, never on what the symbols represent — exactly the same posture toward semantics already established starting with `information-content-and-self-information`.

## Summary

Shannon's source coding theorem establishes entropy as the exact fundamental limit on lossless compression: no uniquely-decodable code can beat `H(X)` bits per symbol on average (proved here via Gibbs' inequality applied to a comparison distribution built from the code's own lengths — the same proof technique used throughout this discipline), and entropy can be approached arbitrarily closely by encoding sufficiently long blocks of symbols together (stated here at the intuition level of typical sequences, with the full asymptotic proof left to more advanced treatments). The proof technique is a close cousin of the decision-tree counting argument `algorithms` already used for the comparison-sort lower bound. The next several concepts turn this abstract limit into concrete, buildable codes — starting with exactly which sets of codeword lengths are even achievable at all.

## Documentation Links

- [Shannon — A Mathematical Theory of Communication (1948)](https://people.math.harvard.edu/~ctm/home/text/others/shannon/entropy/entropy.pdf) — doc
- [Stanford EE276 — Course Outline](https://web.stanford.edu/class/ee276/outline.html) — doc
- [MIT 6.441 — Information Theory, Syllabus](https://ocw.mit.edu/courses/6-441-information-theory-spring-2016/pages/syllabus/) — doc
