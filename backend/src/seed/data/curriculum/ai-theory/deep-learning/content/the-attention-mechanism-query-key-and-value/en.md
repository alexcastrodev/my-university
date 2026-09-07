---
version: 1.0
updatedAt: 2026-09-07
---
## Learning Objectives

- Explain the specific limitation of recurrent architectures that attention addresses: compressing an entire sequence's history through one fixed-size hidden state.
- Define query, key, and value vectors and explain the role each plays in computing an attention output.
- Compute scaled dot-product attention by hand for a small, concrete example.
- Explain why the dot product — already covered as a basic vector-algebra operation — is exactly the right tool for measuring how well a query matches a key.

## Context & Motivation

The previous concept's LSTM/GRU gating substantially improves how far gradients (and therefore, learned dependencies) can travel across a sequence, but it does so by making the recurrent hidden state's *memory* better — every piece of relevant history from the entire sequence still has to be compressed through one evolving vector, updated one timestep at a time. Attention takes a structurally different approach: instead of relying on a single running summary, let every output position look directly, and individually, back at every input position, and let the network itself learn how much weight to give each one. This is computed with nothing more exotic than the dot product `foundations/mathematics-for-computing` already covered as a basic vector-algebra fact — comparing two vectors by how well they align.

## Core Theory

### Query, key, and value

Attention operates on three sets of vectors, all derived from the input by separate learned linear projections:

- A **query** vector `q` represents "what am I currently looking for" — typically derived from the current output position being computed.
- A **key** vector `k`, one per input position, represents "what does this position offer" — used to be compared against the query.
- A **value** vector `v`, one per input position, represents "what content does this position actually contribute" if it is attended to.

The query is compared against every key to produce a relevance score for every input position; those scores then determine how much of each position's *value* contributes to the attention output — the keys determine *where* to look, the values determine *what* is retrieved once you're looking there.

### Scaled dot-product attention

The relevance score between a query `q` and a key `kᵢ` is their dot product, `q·kᵢ` — precisely the vector-algebra operation already established as a measure of how aligned two vectors are: the more `q` and `kᵢ` point in a similar direction (in the learned embedding space), the larger their dot product, and the more relevant the network has learned position `i` to be to this query. These raw scores are scaled down by `√d` (`d` the dimensionality of the key vectors, to keep the scores from growing too large as `d` increases and destabilizing the softmax that follows), then passed through softmax — the exact function already derived in this discipline — to produce a set of weights summing to 1:

```text
Attention(q, K, V) = softmax(q·K^T / √d) · V
```

where `K` and `V` stack every input position's key and value vectors as rows. The output is a weighted sum of every value vector, with weights determined entirely by how well the query matched each corresponding key.

## Worked Examples

### Example 1: Attention weights for a query against 3 keys

Let the query `q = (1, 0)`, and three keys `k₁ = (1, 0)`, `k₂ = (0, 1)`, `k₃ = (0.5, 0.5)`, with `d = 2` so `√d ≈ 1.414`.

```text
q·k₁ = 1(1) + 0(0) = 1.0        scaled: 1.0 / 1.414 ≈ 0.707
q·k₂ = 1(0) + 0(1) = 0.0        scaled: 0.0 / 1.414 = 0.000
q·k₃ = 1(0.5) + 0(0.5) = 0.5    scaled: 0.5 / 1.414 ≈ 0.354

softmax(0.707, 0.000, 0.354):
  e^0.707 ≈ 2.028,  e^0.000 = 1.000,  e^0.354 ≈ 1.425
  sum ≈ 4.453
  weights ≈ (0.455, 0.225, 0.320)
```

The key most aligned with the query (`k₁`, pointing in the exact same direction) receives the highest weight (≈45.5%), the orthogonal key (`k₂`) receives the lowest (≈22.5%), and the partially-aligned key (`k₃`) receives an intermediate weight — exactly the intuitive behavior expected of "look most at whatever matches best," now computed precisely.

### Example 2: The attention output as a weighted sum of values

Continuing Example 1, suppose the corresponding value vectors are `v₁ = (10, 0)`, `v₂ = (0, 10)`, `v₃ = (5, 5)`. The attention output is the weighted sum, using the weights `(0.455, 0.225, 0.320)` from Example 1:

```text
output = 0.455·(10, 0) + 0.225·(0, 10) + 0.320·(5, 5)
       = (4.55, 0) + (0, 2.25) + (1.60, 1.60)
       = (6.15, 3.85)
```

The output is neither exactly `v₁` nor a simple average of all three values — it is pulled predominantly toward `v₁` (the value corresponding to the best-matching key) while still incorporating some contribution from the other two, in exactly the proportion their keys matched the query.

## Common Misconceptions & Pitfalls

- **"Attention replaces the dot product with some more sophisticated similarity measure."** Scaled dot-product attention uses exactly the dot product already covered as a basic vector-algebra operation — the only additions are the `√d` scaling factor (for numerical stability) and the softmax normalization (already derived in this discipline) turning raw scores into weights.
- **"Keys and values are the same thing, just used differently."** They are typically produced by two separate learned linear projections of the same underlying input, and can end up representing genuinely different information — the key is optimized for being *matched against*, the value for being *retrieved and used*, and there is no requirement that these two roles are best served by identical vectors.
- **"A higher attention weight always means the corresponding value is more important to get the answer right."** The weights reflect what the network has learned makes a query and key "match" for the task it was trained on — this is a learned, task-specific notion of relevance, not a general-purpose measure of importance independent of what the network was trained to do.

## Summary

Attention lets every output position look directly at every input position, using a query, a set of keys, and a set of values all derived by learned projections from the input. The dot product between a query and each key — precisely the vector-algebra operation already established in this curriculum — produces a relevance score for each input position; scaling by `√d` and applying softmax turns these scores into weights summing to 1, and the attention output is the resulting weighted sum of value vectors. This directly avoids the single-hidden-state bottleneck that limited even LSTM/GRU-gated recurrent architectures, setting up the next concept's move to applying this same mechanism across a sequence's own tokens.

## Documentation Links

- [Dive into Deep Learning — Attention Mechanisms and Transformers: Queries, Keys, and Values](https://d2l.ai/chapter_attention-mechanisms-and-transformers/index.html) — the query/key/value framing and scaled dot-product formulation this concept follows directly.
- [CS231n — Course Schedule (Stanford, Spring 2026)](https://cs231n.stanford.edu/schedule.html) — confirms "Self-Attention, Transformers" as this course's own dedicated lecture, reflecting attention's current importance in the field.
