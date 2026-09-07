---
version: 1.0
updatedAt: 2026-09-07
---
## Learning Objectives

- Define self-attention: applying attention where the queries, keys, and values all come from the same sequence.
- Explain precisely why self-attention can be computed in parallel across all positions, while an RNN's recurrence fundamentally cannot.
- Explain why positional encoding is necessary for self-attention specifically, and describe how a sinusoidal positional encoding is constructed.
- Explain multi-head attention as running several independent attention computations and combining their results.

## Context & Motivation

The previous concept defined attention generally — a query, compared against a set of keys, retrieving a weighted combination of values — without specifying where those queries, keys, and values come from. **Self-attention** answers that question in the specific way that makes attention a genuine alternative *architecture* to recurrence, not just an add-on to it: every position in a sequence generates its own query, key, and value, all from that same sequence, and attends to every other position (including itself). This concept covers exactly why that design choice matters — the parallelism argument that is the concrete, practical reason self-attention-based architectures have displaced recurrent ones for most large-scale sequence modeling — and the one piece of information self-attention discards that has to be explicitly reintroduced: the order of the sequence itself.

## Core Theory

### Self-attention: queries, keys, and values from the same source

For a sequence of `n` input vectors, self-attention computes queries, keys, and values for *every* position using the same learned projection matrices (`Q = XW_q`, `K = XW_k`, `V = XW_v`, where `X` stacks all `n` input vectors as rows), then applies the scaled dot-product attention from the previous concept between every query and every key:

```text
SelfAttention(X) = softmax(XW_q · (XW_k)^T / √d) · XW_v
```

Every output position is a weighted combination of every input position's value, with the weights determined by how well that position's own query matches every other position's key — including, notably, comparing a position against itself.

### Why this parallelizes and recurrence does not

`recurrent-neural-networks-and-backpropagation-through-time` established that computing `h_t` requires `h_{t-1}` to already be known — an RNN's hidden states must be computed strictly one timestep after another, a genuinely sequential dependency that cannot be broken no matter how much parallel compute is available. Self-attention has no such dependency: computing the attention output for position 5 does not require the attention output for position 4 to be computed first — every position's query, key, and value can be computed independently and simultaneously, and the entire `n × n` matrix of attention scores can be computed in one large matrix multiplication. This is precisely the kind of massively parallel, uniform-operation workload `cnn-architectures-and-residual-connections` already connected to GPU hardware — self-attention exposes far more of that parallelism than a recurrence ever can, which is the concrete computational reason Transformer-based architectures train dramatically faster on the same hardware, for sequences of comparable length, than an equivalently-sized RNN.

### Positional encoding: reinjecting order

Self-attention treats its input as an unordered *set* of vectors — nothing in the computation above uses each position's index at all; swapping two input positions (and their corresponding queries, keys, and values) simply swaps two rows of the output symmetrically, with no other change. But word order plainly matters for language, and position matters for many other sequence tasks. **Positional encoding** fixes this by adding a vector that encodes each position's index directly to that position's input embedding, before self-attention is ever applied. A common construction uses sinusoids of varying frequency:

```text
PE(pos, 2i)   = sin(pos / 10000^(2i/d))
PE(pos, 2i+1) = cos(pos / 10000^(2i/d))
```

for position `pos` and embedding dimension index `i` (out of `d` total dimensions). Different dimensions oscillate at different frequencies, so the resulting vector is unique to each position (up to the encoding's period) and — because sine and cosine of a sum can be expressed in terms of sine and cosine of the individual angles — encodes *relative* position information in a form the network's linear layers can learn to exploit, not just an arbitrary index.

### Multi-head attention: several attention computations, combined

Rather than computing one attention output per position, **multi-head attention** runs several independent attention computations ("heads") in parallel, each with its own learned `W_q`, `W_k`, `W_v` projections (typically into a smaller dimensionality than the full model, so the total compute stays comparable to one large attention computation), then concatenates all the heads' outputs and passes the result through one more learned linear layer. Each head is free to learn a different notion of "relevance" — one head might specialize in tracking short-range syntactic relationships, another in longer-range semantic ones — giving the model several independent perspectives on the same sequence rather than being limited to a single learned similarity function.

## Worked Examples

### Example 1: Positional encoding values for two nearby positions

Using the sinusoidal formula with `d = 4` (so `i` ranges over 0 and 1), compare position 0 and position 1:

```text
PE(0, 0) = sin(0 / 10000^0)     = sin(0) = 0.000
PE(0, 1) = cos(0 / 10000^0)     = cos(0) = 1.000
PE(0, 2) = sin(0 / 10000^0.5)   = sin(0) = 0.000
PE(0, 3) = cos(0 / 10000^0.5)   = cos(0) = 1.000
PE(0, :) = (0.000, 1.000, 0.000, 1.000)

PE(1, 0) = sin(1 / 10000^0)     = sin(1) ≈ 0.841
PE(1, 1) = cos(1 / 10000^0)     = cos(1) ≈ 0.540
PE(1, 2) = sin(1 / 10000^0.5)   = sin(0.01) ≈ 0.010
PE(1, 3) = cos(1 / 10000^0.5)   = cos(0.01) ≈ 1.000
PE(1, :) = (0.841, 0.540, 0.010, 1.000)
```

The two positions produce distinctly different vectors, with the low-frequency dimensions (index 2, 3) barely changing between adjacent positions while the high-frequency dimensions (index 0, 1) change substantially — giving the encoding fine-grained sensitivity to nearby positions and coarser, slower-changing structure for distinguishing far-apart ones, all within the same fixed-size vector.

### Example 2: Parallel versus sequential compute, counted directly

For a sequence of length `n = 100`, computing every hidden state of an RNN requires 100 sequential steps — step 50 genuinely cannot begin before step 49 has finished, regardless of how many processors are available. Computing self-attention over the same sequence requires forming one `100 × 100` matrix of pairwise scores (`Q·K^T`) — a single large matrix multiplication that a GPU can compute with its many cores working simultaneously on different entries, with no step-by-step dependency between them. The RNN's total compute is not necessarily larger, but its critical path (the minimum number of sequential steps that must happen one after another) is exactly `n`; self-attention's critical path is a small, constant number of matrix operations regardless of `n` — this is the precise sense in which self-attention parallelizes and recurrence cannot.

## Common Misconceptions & Pitfalls

- **"Self-attention does strictly less total computation than an RNN, which is why it's faster."** Self-attention's total FLOPs for a sequence of length `n` actually scale as `n²` (every position attends to every other), often *more* total computation than an RNN's `n` sequential steps — the speed advantage in practice comes entirely from parallelizability (a short critical path), not from doing less work overall.
- **"Positional encoding is only a minor implementation detail."** Without it, self-attention genuinely cannot distinguish "the dog bit the man" from "the man bit the dog" — the mechanism is fundamentally order-blind, and positional encoding is the specific, necessary fix, not an optional refinement.
- **"Multi-head attention uses the full model dimensionality in every head, so it's proportionally more expensive than single-head attention."** Each head typically operates in a reduced dimensionality (the model dimension divided by the number of heads), so the total compute across all heads combined is comparable to one full-dimensionality attention computation — multiple heads are a way of restructuring the same total compute into several independent perspectives, not simply multiplying the cost.

## Summary

Self-attention applies attention where every position's query, key, and value all come from the same sequence, letting every position attend to every other position in one large, dependency-free matrix computation — in sharp contrast to an RNN's inherently sequential hidden-state recurrence, which cannot be parallelized across timesteps at all. This parallelism is the concrete, hardware-level reason self-attention-based architectures train faster than equivalently-sized RNNs on the same GPU hardware. Because self-attention has no built-in notion of order, positional encoding must explicitly inject each position's index into its embedding before attention is applied; multi-head attention runs several independent attention computations in parallel and combines them, giving the model several simultaneous notions of relevance rather than just one.

## Documentation Links

- [Dive into Deep Learning — Self-Attention and Positional Encoding](https://d2l.ai/chapter_attention-mechanisms-and-transformers/index.html) — the sinusoidal positional encoding formula and the parallel-versus-sequential framing this concept covers directly.
- [CS231n — Course Schedule (Stanford, Spring 2026)](https://cs231n.stanford.edu/schedule.html) — "Self-Attention, Transformers" listed alongside vision-transformer applications, confirming self-attention's role as this course's own bridge into modern architectures.
