---
version: 1.0
updatedAt: 2026-09-07
---
## Learning Objectives

- Trace the general architectural trend from LeNet through AlexNet and VGG: stacking more convolution/pooling blocks and going deeper.
- Explain the empirical "degradation problem" that appeared once networks got very deep, and why it is distinct from overfitting.
- State the residual (skip) connection idea and explain, in terms of backpropagation, why it directly addresses the vanishing gradient problem for very deep networks.
- Explain why the matrix multiplications and convolutions this entire discipline relies on are naturally suited to GPU hardware, connecting to `computer/computer-architecture`'s coverage of SIMD and SIMT.

## Context & Motivation

Every convolutional building block covered so far — convolution, pooling, stride, padding, weight sharing — is a single layer. This concept assembles those blocks into complete, real architectures and follows a genuine historical and technical progression: as CNNs got deeper, they got dramatically more accurate, until depth itself started actively hurting accuracy for reasons that turned out to be exactly the vanishing gradient problem already diagnosed several concepts ago, now appearing in its sharpest, most consequential form. Residual connections are the architectural fix, and they are foundational enough that the same skip-connection idea reappears, essentially unchanged, inside the Transformer architecture covered later in this discipline.

## Core Theory

### From LeNet to VGG: stacking deeper

LeNet (one of the earliest practical CNNs) alternated a small number of convolution and pooling layers before a final classifier — a direct, literal application of this discipline's convolutional building blocks. AlexNet scaled this up substantially (more filters, more layers, ReLU instead of saturating activations, and dropout), demonstrating that a deep CNN trained on a large labeled dataset could dramatically outperform prior, non-neural computer vision approaches. VGG pushed the same idea further with a simple, disciplined design rule — stack many small 3×3 convolutions rather than fewer large ones, since two stacked 3×3 convolutions cover the same receptive field as one 5×5 convolution with fewer total parameters and an extra nonlinearity in between. The trend across all three: more layers, applied with increasing architectural discipline, produced better accuracy.

### The degradation problem: depth stops helping, then starts hurting

That trend broke down at a certain depth. Networks with more layers began performing *worse* than shallower versions of the same architecture — and, crucially, worse even on the *training* set, not just on held-out data. This rules out the usual overfitting explanation from `the-bias-variance-tradeoff` (which predicts good training performance and worse test performance) — a network that cannot even fit its own training data as well as a shallower version of itself has a genuine optimization problem, not a generalization problem. The cause traces directly back to the vanishing gradient issue from several concepts ago: even with careful initialization and batch normalization, gradients propagating back through dozens of stacked convolutional layers can still shrink to the point that the earliest layers barely update, effectively wasting much of the network's depth.

### Residual connections: learning a correction, not a replacement

A residual (or skip) connection adds a direct shortcut path around one or more layers, so that instead of a block of layers computing some desired output `H(x)` directly from input `x`, it computes only the difference:

```text
output = F(x) + x
```

where `F(x)` (the "residual") is whatever the stacked layers inside the block actually compute, and `x` is passed through unchanged via the shortcut. If the best thing a given block can do is nothing at all (`F(x) = 0`), the block can trivially learn that, and the shortcut passes `x` through unmodified — a much easier target for gradient descent to find than having every single layer learn an exact identity mapping through its full weight matrix. The effect on backpropagation is the key mechanism: the gradient flowing backward through a residual block has a direct, unimpeded path through the `+x` shortcut, in addition to the path through `F(x)`'s layers — so even if `F(x)`'s local gradient is small (the vanishing-gradient scenario from before), the shortcut still carries a gradient of magnitude close to 1 straight through the block, letting gradients reach very early layers largely intact even in networks over a hundred layers deep. This is precisely the architectural innovation that let ResNet-style networks scale to depths that previously suffered the degradation problem.

### Why deep learning training runs on GPUs

Every operation this discipline has covered so far — a dense layer's matrix multiply, a convolution's many independent dot products, a batch's worth of forward and backward passes computed together — shares one structural property: the *same* small operation (a multiply-add, a dot product) repeated an enormous number of times, independently, over different pieces of data. `computer/computer-architecture`'s `flynns-taxonomy-and-simd` already classified this exact pattern — a single instruction applied across many data elements simultaneously — and `gpu-architecture-and-the-simt-execution-model` covered the hardware built specifically to exploit it: thousands of simple cores executing the same instruction stream over different data (single-instruction, multiple-thread), rather than the handful of complex, general-purpose cores a CPU provides. A convolution sliding one filter over thousands of image positions, or a dense layer multiplying a weight matrix against a batch of many input vectors at once, is exactly the data-parallel workload GPUs were designed for — which is the concrete, hardware-level reason training modern deep networks on CPUs alone is impractically slow, and why this discipline's models are trained on GPUs (or specialized accelerators built on the same SIMT principle) as a matter of course, not an optional optimization.

## Worked Examples

### Example 1: The gradient path through a residual block, traced

Consider a residual block `output = F(x) + x`, where the gradient of the loss with respect to the block's output is some value `g`. By the sum rule of differentiation (applied through backpropagation):

```text
∂L/∂x = ∂L/∂output · ∂output/∂x
      = g · (∂F(x)/∂x + 1)
      = g·∂F(x)/∂x + g
```

Even if `∂F(x)/∂x` is very small (the vanishing-gradient case for the block's internal layers), the second term, `g`, still passes through completely unattenuated via the `+1` from the identity shortcut. Compare this to a plain (non-residual) block computing `output = F(x)` directly: `∂L/∂x = g · ∂F(x)/∂x` — with no shortcut term, a small `∂F(x)/∂x` fully attenuates the gradient with nothing to compensate.

### Example 2: Two stacked 3×3 convolutions versus one 5×5

For a single output position, a 5×5 convolution over `c` input channels uses `5 · 5 · c = 25c` weights per output channel. Two stacked 3×3 convolutions covering the same 5×5 receptive field (the first 3×3 convolution's output already depends on a 3×3 input region; stacking a second 3×3 convolution on top extends the effective receptive field to 5×5) use `3·3·c + 3·3·c = 9c + 9c = 18c` weights total — fewer parameters (`18c` versus `25c`) while also inserting an extra nonlinearity between the two smaller convolutions, exactly VGG's design argument for preferring several small filters over one large one.

## Common Misconceptions & Pitfalls

- **"Deeper networks always perform better, given enough data."** The degradation problem is a real, documented counterexample: past a certain depth, plain (non-residual) networks got measurably worse even on their own training data, which is exactly the empirical finding that motivated residual connections.
- **"Residual connections are a form of regularization, like dropout."** They address an optimization problem (gradients vanishing across many stacked layers), not an overfitting problem — a residual network with the degradation problem removed does not perform worse on training data.
- **"Deep learning specifically needs a GPU because CPUs can't do the arithmetic."** CPUs can perform every operation involved in training a network correctly — the issue is throughput, not capability. A CPU's design (few complex cores optimized for varied, sequential work) is simply a poor structural match for training's actual workload (the same simple operation repeated across enormous amounts of independent data), which is precisely the SIMD/SIMT distinction `computer/computer-architecture` already covers.

## Summary

CNN architectures evolved from LeNet's few-layer design through AlexNet's and VGG's disciplined depth increases, until depth itself began actively hurting training accuracy — the degradation problem, traced directly to the vanishing gradient problem sharpened by many stacked layers. Residual connections fix this by having each block learn a correction added to a direct identity shortcut, giving backpropagation an unimpeded gradient path through every block regardless of how small that block's own local gradient might be — the same skip-connection idea reused later in this discipline's Transformer architecture. Separately, the matrix multiplications and convolutions underlying every architecture in this discipline are exactly the massively data-parallel, same-operation-repeated-many-times workload GPUs (`computer/computer-architecture`'s SIMT execution model) were built for, which is the concrete hardware reason deep learning training runs on GPUs as standard practice.

## Documentation Links

- [CS231n — Course Schedule (Stanford, Spring 2026)](https://cs231n.stanford.edu/schedule.html) — "CNN Architectures" (batch normalization and landmark models AlexNet, VGG, ResNet) and "Large Scale Distributed Training" as this course's own lecture topics for this material.
- [CS231n — Transfer Learning and Fine-tuning Convolutional Neural Networks](https://cs231n.github.io/transfer-learning/) — the layer-by-layer feature progression (generic early filters, task-specific later filters) these landmark architectures produce, picked up again in `representation-learning-the-network-learns-its-own-features`.
