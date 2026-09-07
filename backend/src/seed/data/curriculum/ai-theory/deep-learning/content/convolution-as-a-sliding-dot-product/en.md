---
version: 1.0
updatedAt: 2026-09-07
---
## Learning Objectives

- Explain why a fully-connected layer is a poor architectural fit for image input, in terms of parameter count and the spatial structure it discards.
- Define convolution (as implemented in deep learning frameworks, technically cross-correlation) as a filter sliding over an input, computing a dot product at every position.
- Compute the output feature map of a small convolution by hand, given a filter and an input.
- Explain what a learned convolutional filter can detect, using a concrete edge-detection example.

## Context & Motivation

Every network covered so far in this discipline treats its input as one flat vector. Applying that directly to an image is possible but wasteful: a fully-connected layer processing a modest 224×224 RGB image (150,528 input values) into a single hidden layer of just 1,000 units already requires over 150 million weights in that one layer alone — before counting any additional layers — and worse, treating each pixel as an independent input entry throws away the fact that nearby pixels are related in a way that matters visually (an edge, a texture, a shape), while pixels far apart in the image usually are not. `ai-theory/machine-learning`'s `the-kernel-trick` faced a related problem for SVMs — the input space itself didn't have the right structure for a linear model — and solved it very differently, by implicitly mapping into a higher-dimensional space. CNNs solve the image problem with an architectural change instead: a layer that is deliberately restricted to only ever combine *nearby* pixels, using the *same* small set of weights at every position in the image. Stanford's CS231n exists specifically to teach this operation, and the architectures built from it, in depth.

## Core Theory

### The convolution (cross-correlation) operation

A convolutional layer replaces a fully-connected layer's "every output connects to every input" with a small learned **filter** (or **kernel**) — a small matrix of weights, typically 3×3 or 5×5 — that slides across the input, computing one dot product at each position:

```text
output[i,j] = Σ_u Σ_v filter[u,v] · input[i+u, j+v]
```

At each position `(i,j)`, the filter is overlaid on the corresponding patch of the input, every aligned pair of values is multiplied, and the products are summed — exactly the dot product already covered as a scalar vector-algebra operation, computed once for every position the filter can occupy. (What deep learning frameworks call "convolution" is, mathematically, cross-correlation — the filter is not flipped before sliding, unlike the strict signal-processing definition of convolution — but the deep learning field's terminology calls it convolution regardless, and this discipline follows that convention.) The full grid of outputs produced by sliding one filter across the entire input is called a **feature map**.

### Why one filter, reused everywhere, is the whole point

The same filter's weights are used at every position — this is the concrete meaning of **weight sharing**, developed fully as its own concept next. For now, the key consequence: whatever pattern a filter has learned to detect (an edge, a corner, a color transition), it detects that pattern wherever it appears in the image, using one small, fixed set of weights rather than a separate set of weights for every possible image location.

### Output size: how big is the feature map?

For a 1D input of size `n` and a filter of size `k`, sliding the filter across every valid position (no padding, moving one step at a time) produces an output of size `n − k + 1`. In two dimensions, an `n × n` input convolved with a `k × k` filter produces an `(n−k+1) × (n−k+1)` output. This shrinking is a direct, mechanical consequence of the filter needing to fit entirely within the input at every position it occupies — `pooling-strides-padding-and-weight-sharing`, next, covers how stride and padding give explicit control over this output size.

## Worked Examples

### Example 1: A hand-computed 2D convolution

Input (4×4):

```text
1  2  0  1
0  1  3  1
2  1  0  2
1  0  1  1
```

Filter (2×2):

```text
1  0
0  -1
```

Sliding the filter over every valid 2×2 patch, computing the dot product at each position (output is 3×3, since `4 − 2 + 1 = 3`):

```text
Position (0,0): patch [[1,2],[0,1]] → 1(1)+2(0)+0(0)+1(-1) = 1 - 1 = 0
Position (0,1): patch [[2,0],[1,3]] → 2(1)+0(0)+1(0)+3(-1) = 2 - 3 = -1
Position (0,2): patch [[0,1],[3,1]] → 0(1)+1(0)+3(0)+1(-1) = 0 - 1 = -1
Position (1,0): patch [[0,1],[2,1]] → 0(1)+1(0)+2(0)+1(-1) = 0 - 1 = -1
Position (1,1): patch [[1,3],[1,0]] → 1(1)+3(0)+1(0)+0(-1) = 1 - 0 = 1
Position (1,2): patch [[3,1],[0,2]] → 3(1)+1(0)+0(0)+2(-1) = 3 - 2 = 1
Position (2,0): patch [[2,1],[1,0]] → 2(1)+1(0)+1(0)+0(-1) = 2 - 0 = 2
Position (2,1): patch [[1,0],[0,1]] → 1(1)+0(0)+0(0)+1(-1) = 1 - 1 = 0
Position (2,2): patch [[0,2],[1,1]] → 0(1)+2(0)+1(0)+1(-1) = 0 - 1 = -1

Output feature map (3×3):
 0  -1  -1
-1   1   1
 2   0  -1
```

Every entry required exactly one small dot product between the filter and the corresponding input patch — the entire feature map is this same operation, repeated at every valid position.

### Example 2: A filter that detects a vertical edge

Consider a 1×2 filter `[1, -1]` sliding across a 1D row of pixel intensities representing a vertical stripe boundary: `input = (10, 10, 10, 0, 0, 0)` (bright, then dark).

```text
Position 0: [10,10] → 1(10) + (-1)(10) = 0
Position 1: [10,10] → 1(10) + (-1)(10) = 0
Position 2: [10,0]  → 1(10) + (-1)(0)  = 10
Position 3: [0,0]   → 1(0)  + (-1)(0)  = 0
Position 4: [0,0]   → 1(0)  + (-1)(0)  = 0

Output: (0, 0, 10, 0, 0)
```

The filter's output is zero everywhere the input is locally constant, and spikes to 10 exactly at the one position straddling the bright-to-dark transition — this is the same mechanism, at a small hand-computable scale, behind how a real trained CNN's early-layer filters learn to detect edges: a filter's output is large precisely where the input pattern the filter's weights encode is actually present.

## Common Misconceptions & Pitfalls

- **"A convolutional filter is a fixed, hand-designed edge detector."** Example 2 uses a hand-chosen filter for illustration, but in a real CNN, every filter's weights are learned by backpropagation and gradient descent, exactly like any other weight in this discipline — the network discovers which patterns are useful to detect, it is not told them in advance.
- **"Convolution in deep learning is the strict mathematical convolution from signal processing."** Deep learning frameworks implement cross-correlation (no flipping of the filter) and call it "convolution" by field convention — the distinction rarely matters in practice since the filter's weights are learned either way, but the terminology is a common point of confusion when consulting signal-processing references.
- **"The output feature map is always smaller than the input, with no way around it."** The shrinkage in this concept's examples comes specifically from using no padding — `pooling-strides-padding-and-weight-sharing`, next, covers how padding the input before convolving can keep the output the same size as the input, when that is desired.

## Summary

A convolutional layer replaces a fully-connected layer's dense, position-specific connections with one small, learned filter that slides across the input, computing a dot product — the same scalar vector-algebra operation already covered — at every position, producing a feature map that responds strongly wherever the pattern the filter has learned to detect is present. Reusing the identical filter weights at every position (weight sharing) is what makes this dramatically more parameter-efficient than a fully-connected layer for image-shaped input, and what CS231n, this discipline's anchor course, exists specifically to teach in depth.

## Documentation Links

- [CS231n — Convolutional Neural Networks: Architectures, Convolution / Pooling Layers](https://cs231n.github.io/convolutional-networks/) — the convolutional layer's local, weight-shared connectivity this concept follows directly.
- [Dive into Deep Learning — Convolutions for Images](https://d2l.ai/chapter_convolutional-neural-networks/conv-layer.html) — the cross-correlation operation and edge-detection worked example this concept's Example 2 mirrors.
