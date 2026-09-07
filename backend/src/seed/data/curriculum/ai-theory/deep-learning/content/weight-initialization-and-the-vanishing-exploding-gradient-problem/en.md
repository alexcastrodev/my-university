---
version: 1.0
updatedAt: 2026-09-07
---
## Learning Objectives

- Explain why initializing every weight in a network to zero (or to the same value) is a fatal mistake, independent of depth.
- Explain, quantitatively, why a deep network's gradients can shrink toward zero or grow without bound as depth increases, purely as a consequence of repeated multiplication in the chain rule.
- State the Xavier and He initialization schemes and explain what property of the forward pass each is specifically designed to preserve.
- Trace a small numeric example showing how a systematic bias in per-layer gradient scale compounds multiplicatively with depth.

## Context & Motivation

Backpropagation, from two concepts ago, computes each layer's gradient by multiplying together a chain of local gradients — one per layer between the loss and that parameter. This concept asks the obvious next question: what happens to that product as the number of layers grows? The answer is not neutral. If each local gradient in the chain is systematically a little smaller than 1, their product shrinks toward zero exponentially with depth; if each is systematically a little larger than 1, the product grows without bound. This is the **vanishing/exploding gradient problem**, and it is a direct, unavoidable consequence of the chain rule applied repeatedly — not a bug in any specific implementation.

Weight initialization is the first, and cheapest, defense against this problem: choosing the *scale* (not just avoiding degenerate values) of a network's initial weights so that the per-layer multiplicative factor in this chain stays close to 1 as training begins.

## Core Theory

### Why all-zero (or all-equal) initialization fails immediately

If every weight in a layer is initialized to the exact same value (zero or otherwise), every unit in that layer computes the exact same pre-activation from the same input, and therefore receives the exact same gradient during backpropagation. Every unit in the layer updates identically, forever — the layer behaves as if it had only one unit, no matter how many it was given. This failure has nothing to do with depth: it happens even in a single hidden layer, and it is why every network in this discipline is initialized with independent random weights, breaking this symmetry from the very first step.

### The vanishing/exploding gradient, quantified

Consider a very deep network where each layer's local gradient (the factor backpropagation multiplies at that layer, combining the weight matrix's scale and the activation function's derivative) has some typical magnitude `c`. After `L` layers, the total multiplicative factor accumulated in the chain rule is approximately `c^L`. If `c < 1` (even, say, `c = 0.9`), then `c^L` shrinks toward zero exponentially fast as `L` grows — after 50 layers, `0.9^50 ≈ 0.005`, and after 100 layers, `0.9^100 ≈ 0.00003`: the gradient reaching the earliest layers is negligibly small, and those layers effectively stop learning. If `c > 1` (say `c = 1.1`), `c^L` grows exponentially instead — `1.1^50 ≈ 117`, `1.1^100 ≈ 13,781` — and gradients (and often the corresponding weight updates) blow up to numerically unusable magnitudes. Either failure mode is a direct, provable consequence of repeated multiplication, not something specific to any one architecture; it is the reason the previous concept's ReLU "dying unit" case matters so much once many layers are involved — a single systematically-zero local gradient anywhere in the chain zeroes out everything upstream of it.

### Calibrated initialization: Xavier and He

The fix targets `c` directly: choose the initial weights' variance so that the variance of activations (forward pass) and of gradients (backward pass) stays roughly constant from layer to layer, rather than shrinking or growing. For a layer with `n` inputs, **Xavier/Glorot initialization** (designed for sigmoid/tanh activations) draws each weight from a distribution scaled by `1/√n`:

```text
w ~ Normal(0, 1/n)     (equivalently, sample from a standard normal, then divide by √n)
```

**He initialization** (designed specifically for ReLU, which zeroes out roughly half its inputs and so needs a larger scale to compensate) instead scales by `√(2/n)`:

```text
w ~ Normal(0, 2/n)
```

Both schemes serve exactly the same purpose — keeping the typical layer-to-layer multiplicative factor `c` close to 1 at the start of training — with the specific constant tuned to the activation function actually used.

## Worked Examples

### Example 1: Compounding a systematic gradient scale across depth

Suppose every layer in a 20-layer network has a local gradient magnitude of exactly `0.8` (a plausible value for saturating sigmoid units far from zero). The accumulated factor through backpropagation to the first layer is:

```text
0.8^20 = 0.0115...  (about 1.15%)
```

A gradient of magnitude 1 arriving at the output layer arrives at the first layer scaled down to roughly 1.15% of its original size — in practice, this is often small enough that the first layer's weights barely move during training, even though the loss the network is trying to reduce depends on them just as much as on any other layer's weights.

### Example 2: Choosing He initialization's scale for a concrete layer

For a dense layer with `n = 512` inputs feeding into ReLU units, He initialization draws weights from `Normal(0, 2/512) = Normal(0, 0.0039)`, i.e., a standard deviation of `√0.0039 ≈ 0.0625`. Compare this to naively drawing from `Normal(0, 1)` (standard deviation 1): a pre-activation `z = Σᵢ wᵢxᵢ` summed over 512 such large, unscaled weights would have a variance roughly 512 times larger than intended, very likely pushing many units into extreme, poorly-conditioned regions before training even begins. Scaling by `√(2/n)` is precisely the correction that keeps the pre-activation variance stable regardless of how many inputs a given layer happens to have.

## Common Misconceptions & Pitfalls

- **"Initializing weights to zero is safe, since training will move them anyway."** Example demonstrates otherwise: zero (or any perfectly symmetric) initialization causes every unit in a layer to receive an identical gradient forever, permanently wasting the layer's capacity regardless of how long training runs.
- **"The vanishing gradient problem is a property of a specific activation function, not a general phenomenon."** It is a general consequence of the chain rule multiplying many local gradients together — Example 1 makes no assumption about which activation function produced the 0.8 factor. Certain activations (sigmoid, tanh) simply make a `c < 1` factor more likely, which is why ReLU became the default and why He initialization specifically compensates for ReLU's own behavior.
- **"A good initialization scheme solves the vanishing/exploding gradient problem completely, for any depth."** Initialization only calibrates the *starting point* of training — it does not guarantee the multiplicative factor stays near 1 as weights change during training. `batch-normalization`, several concepts ahead, and residual connections (`cnn-architectures-and-residual-connections`) are additional, complementary techniques specifically because initialization alone is not always sufficient at very large depths.

## Summary

All-zero or perfectly symmetric weight initialization is a fatal, depth-independent failure (every unit in a layer updates identically forever); the vanishing/exploding gradient problem is depth-dependent and arises because backpropagation's chain rule multiplies one local gradient per layer, so a systematic per-layer factor below or above 1 compounds exponentially with network depth. Xavier and He initialization address this by scaling each layer's initial weight variance to keep that multiplicative factor close to 1 at the start of training, calibrated to the sigmoid/tanh and ReLU activation functions respectively — the first, cheapest line of defense among several this discipline covers for training genuinely deep networks.

## Documentation Links

- [CS231n — Neural Networks Part 2: Weight Initialization](https://cs231n.github.io/neural-networks-2/) — the `1/√n` and He (`√(2/n)`) initialization schemes this concept derives directly.
- [CS231n — Neural Networks Part 1: Setting up the Architecture](https://cs231n.github.io/neural-networks-1/) — the activation-function context (sigmoid/tanh vs. ReLU) that motivates why the two schemes use different constants.
