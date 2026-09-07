---
version: 1.0
updatedAt: 2026-09-07
---
## Learning Objectives

- Explain precisely why a vanilla RNN's gradient shrinks (or explodes) exponentially with the number of timesteps separating two points in a sequence.
- State the LSTM's memory cell and its three gates (forget, input, output), and explain what each gate controls.
- Explain why the LSTM's memory-cell update creates a near-uninterrupted gradient path across time, directly addressing the vanishing gradient problem.
- Contrast LSTM and GRU at the level of what each simplifies, without claiming one strictly dominates the other.

## Context & Motivation

The previous concept ended by naming the exact mechanism at fault: because the same weight matrix `W_hh` is reused at every timestep, the gradient reaching an early timestep has effectively been multiplied by `W_hh` (and the activation function's local derivative) once per timestep of separation — the identical exponential-compounding argument already made for very deep feedforward networks in `weight-initialization-and-the-vanishing-exploding-gradient-problem`, but here driven by *sequence length* rather than layer count. For long sequences (dozens or hundreds of timesteps — the exact regime RNNs were introduced to handle), this makes a vanilla RNN unable to learn dependencies spanning more than a short window, no matter how it is initialized. LSTM (long short-term memory) and its simplified relative GRU (gated recurrent unit) were designed specifically to fix this, and they do so with a genuinely different mechanism than initialization or normalization — a gated memory cell.

## Core Theory

### Why the vanilla RNN's gradient vanishes across time

Backpropagation through time computes the gradient of the loss at some late timestep `T` with respect to an early hidden state `h_t` by repeatedly applying the chain rule backward through every intermediate timestep, each contributing a factor involving `W_hh` and the activation function's derivative. Across `T − t` timesteps, this produces a product of `T − t` such factors — exactly the same `c^L`-style exponential compounding already quantified for deep feedforward networks, with sequence distance now playing the role depth played before. A dependency spanning 50 timesteps back requires backpropagating through 50 repeated multiplications by essentially the same factor; if that factor is even slightly below 1, the gradient reaching timestep 1 from a loss at timestep 50 is vanishingly small, and the network effectively cannot learn that a token from 50 steps ago mattered.

### LSTM's memory cell and its three gates

An LSTM introduces a separate **memory cell** `C_t`, alongside the hidden state, and controls how it is updated using three learned **gates** — each a small neural network layer (typically a sigmoid) producing values between 0 and 1 that act as continuous "how much" switches:

```text
Forget gate:  F_t = σ(W_f·[h_{t-1}, x_t] + b_f)      — how much of the old cell state to keep
Input gate:   I_t = σ(W_i·[h_{t-1}, x_t] + b_i)      — how much new information to add
Output gate:  O_t = σ(W_o·[h_{t-1}, x_t] + b_o)      — how much of the cell to expose as the hidden state

Candidate:    C̃_t = tanh(W_c·[h_{t-1}, x_t] + b_c)   — the new information being proposed
Cell update:  C_t = F_t ⊙ C_{t-1} + I_t ⊙ C̃_t         — combine old memory and new information
Hidden state: h_t = O_t ⊙ tanh(C_t)
```

(`⊙` denotes element-wise multiplication.) The forget gate decides what to discard from the previous memory; the input gate decides how much of the newly-proposed content to write in; the output gate decides how much of the resulting memory to actually expose to the rest of the network at this timestep.

### Why this fixes the vanishing gradient: an (almost) additive path

The critical design choice is the cell update equation itself: `C_t = F_t⊙C_{t-1} + I_t⊙C̃_t` is an **addition**, not a repeated multiplication by a shared weight matrix the way the vanilla RNN's hidden state update was. When the forget gate `F_t` is close to 1 (the network has learned that this information should be retained), the gradient of `C_t` with respect to `C_{t-1}` is close to 1 as well — the memory cell provides a path across time where the gradient is neither systematically shrunk nor amplified by repeated matrix multiplication, in sharp contrast to the vanilla RNN's hidden state, which is recomputed from scratch (via a matrix multiply and a squashing nonlinearity) at every single timestep. This additive, gate-controlled path is precisely why LSTMs can learn dependencies spanning far more timesteps than a vanilla RNN reliably can.

### GRU: a simplified gating scheme

GRU merges the forget and input gates into a single **update gate**, and removes the separate memory cell entirely, folding its role directly into the hidden state:

```text
Update gate: Z_t = σ(W_z·[h_{t-1}, x_t] + b_z)
Reset gate:  R_t = σ(W_r·[h_{t-1}, x_t] + b_r)
Candidate:   H̃_t = tanh(W_h·[R_t⊙h_{t-1}, x_t] + b_h)
Hidden state: H_t = Z_t⊙H_{t-1} + (1−Z_t)⊙H̃_t
```

GRU's hidden-state update is structurally the same idea as LSTM's cell update — a gated interpolation between "keep the old state" and "write in new content" — with fewer parameters and one fewer gate. Neither architecture strictly dominates the other in practice: GRU is cheaper to train and often performs comparably, while LSTM's extra gate and separate memory cell give it slightly more representational flexibility, and the better choice for a specific task is typically settled empirically rather than by a general rule.

## Worked Examples

### Example 1: A vanilla RNN's compounding factor over 50 timesteps

Suppose a vanilla RNN's per-timestep gradient factor (combining `W_hh` and the tanh derivative) is typically `0.85`. Across 50 timesteps of separation:

```text
0.85^50 ≈ 0.000296   (about 0.03%)
```

A gradient signal from a loss 50 timesteps in the future arrives at the earliest relevant timestep attenuated to roughly three hundredths of one percent of its original size — in practice, small enough that the network effectively cannot learn that timestep mattered at all, regardless of how important it actually was to the correct output.

### Example 2: An LSTM's near-preserved gradient with a forget gate close to 1

Suppose an LSTM has learned `F_t = 0.95` consistently across the same 50 timesteps (a reasonable value for information the network has learned is worth remembering). The cell state's gradient path multiplies by `F_t` (not by a full weight matrix and nonlinearity) at each step:

```text
0.95^50 ≈ 0.077   (about 7.7%)
```

Even without any additional correction, a gate value close to (but not exactly) 1 already preserves dramatically more gradient magnitude across 50 timesteps (about 7.7%) than the vanilla RNN's compounding matrix multiplication (about 0.03%) — and when the network learns `F_t` even closer to 1 for genuinely long-range dependencies, this preservation improves further still, which is the concrete, numeric version of why gating solves a problem plain weight tuning could not.

## Common Misconceptions & Pitfalls

- **"LSTM and GRU eliminate the vanishing gradient problem entirely."** They substantially mitigate it by providing an additive, gate-controlled path for the memory/hidden state, but very long sequences (hundreds or thousands of timesteps) can still pose real difficulty — this is one of the concrete practical motivations, developed in the next concept, for the attention mechanism's very different approach of not compressing all history through one recurrent state at all.
- **"The three LSTM gates are separate networks with independent purposes."** All three gates are small, independently-parameterized layers, but they all take the same inputs (`h_{t-1}` and `x_t`) and jointly determine one thing: how the memory cell is updated and exposed at this timestep. They act together, not as three unrelated subsystems.
- **"GRU is simply a strictly worse, cut-down LSTM."** GRU removes a gate and the separate cell state, but it is not a strictly worse approximation — its update-gate design is a considered, alternative parameterization of the same core idea (gated, mostly-additive memory), and it frequently matches LSTM's performance with fewer parameters to train.

## Summary

A vanilla RNN's hidden state is recomputed via matrix multiplication and a squashing nonlinearity at every timestep, so gradients backpropagated across many timesteps compound exponentially — the same vanishing/exploding gradient mechanism already diagnosed for very deep feedforward networks, now driven by sequence length. LSTM addresses this with a separate memory cell updated by an addition (`F_t⊙C_{t-1} + I_t⊙C̃_t`) rather than a repeated matrix multiplication, controlled by forget, input, and output gates; when the forget gate is close to 1, the gradient path across time is nearly preserved rather than compounding away. GRU simplifies this into a single update gate and no separate cell state, trading some representational flexibility for fewer parameters, with neither variant strictly dominating the other in practice.

## Documentation Links

- [Dive into Deep Learning — Long Short-Term Memory (LSTM)](https://d2l.ai/chapter_recurrent-modern/lstm.html) — the forget/input/output gate equations and the "gradient can pass across many time steps without vanishing or exploding" mechanism this concept derives numerically.
- [CS231n — Course Schedule (Stanford, Spring 2026)](https://cs231n.stanford.edu/schedule.html) — confirms "RNN, LSTM, GRU" as one lecture's real, combined scope, consistent with this concept's framing of LSTM/GRU as the direct fix to the vanilla RNN's own limitation.
