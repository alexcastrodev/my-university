---
version: 1.0
updatedAt: 2026-09-07
---
## Learning Objectives

- Compute a convolution's output size given stride and padding, and explain what each parameter controls.
- Explain the max-pooling operation and why it is applied after convolutional layers.
- State the exact parameter count of a convolutional layer versus an equivalent fully-connected layer, and explain why weight sharing produces this difference.
- Explain why weight sharing specifically suits image data, in terms of translation invariance.

## Context & Motivation

The previous concept computed one small convolution by hand, sliding a filter one step at a time with no padding — the simplest possible case. Building a real, practical convolutional layer requires two more design choices (stride and padding), and one further operation stacked after convolution (pooling) that most CNN architectures rely on. Underlying all of this is the same idea introduced but not yet quantified in the previous concept: because the filter's weights are shared across every position, a convolutional layer needs vastly fewer parameters than a fully-connected layer processing the same input — this concept makes that saving concrete, and explains precisely why it is the image data's own spatial structure that makes weight sharing such a good fit.

## Core Theory

### Stride: how far the filter moves each step

**Stride** is the number of positions the filter shifts between applications. A stride of 1 (the previous concept's default) slides the filter to every possible position; a stride of 2 skips every other position, computing roughly a quarter as many outputs in two dimensions. For an input of size `n`, filter of size `k`, and stride `s` (with no padding), the output size is:

```text
output size = ⌊(n − k) / s⌋ + 1
```

A larger stride produces a smaller, coarser feature map more cheaply, at the cost of some spatial resolution.

### Padding: controlling the border and the output size

Padding adds extra values (almost always zeros) around the input's border before convolving. Two conventions are common: **valid** padding (no padding at all — the previous concept's examples) shrinks the output relative to the input, while **same** padding adds just enough border to keep the output the same size as the input. For an input of size `n`, filter of size `k`, stride `s`, and padding `p` added to each side, the general output-size formula is:

```text
output size = ⌊(n + 2p − k) / s⌋ + 1
```

Padding also has a secondary effect worth naming: without it, a pixel at the exact corner of an image is touched by far fewer filter positions than a pixel near the center, effectively under-representing border information across many stacked convolutional layers — padding keeps border pixels involved in roughly as many convolution positions as interior ones.

### Pooling: discarding detail on purpose

A pooling layer (most commonly **max pooling**) slides a small window across each feature map — with no learned weights at all — and reduces each window to a single value: typically the maximum (max pooling) or the average (average pooling) of the values in that window. A 2×2 max-pooling window with stride 2, for instance, halves both spatial dimensions of a feature map. The deliberate loss of precise spatial information is the point: pooling gives the network some tolerance to small translations of the input (a feature detected slightly to the left or right of where it appeared in training still survives pooling as long as it falls within the same pooling window) and reduces the spatial size — and therefore the computational cost — of every subsequent layer.

### Weight sharing: the parameter-count argument, made concrete

A convolutional layer with a `k × k` filter (and, say, `c` input channels) has exactly `k · k · c` weights (plus one bias) **regardless of the input's spatial size** — the same filter is applied at every position, so the number of positions the filter is applied to does not add any new parameters. A fully-connected layer processing the same input, by contrast, needs one independent weight per (input pixel, output unit) pair — a number that grows with the input's full spatial size. This is precisely why weight sharing suits image data specifically: an edge detector that is useful in the top-left corner of an image is, by the nature of images, very likely just as useful applied to the bottom-right corner — the *same* pattern can appear anywhere in the image, so it makes sense to detect it with the *same* filter everywhere, rather than learning an independent, unrelated filter for every possible position.

## Worked Examples

### Example 1: Output size across stride and padding choices

For a 32×32 input and a 5×5 filter:

```text
Stride 1, no padding:     ⌊(32 - 5)/1⌋ + 1 = 27 + 1 = 28   → 28×28 output
Stride 1, padding 2:      ⌊(32 + 4 - 5)/1⌋ + 1 = 31 + 1 = 32  → 32×32 output (same padding)
Stride 2, no padding:     ⌊(32 - 5)/2⌋ + 1 = ⌊13.5⌋ + 1 = 13 + 1 = 14  → 14×14 output
```

Padding of exactly 2 on each side (for a 5×5 filter, stride 1) recovers the original 32×32 size — this specific relationship, `p = (k−1)/2` for stride 1, is the standard formula for "same" padding.

### Example 2: Parameter count, convolutional versus fully-connected

Consider a 32×32×3 (RGB) input feeding into a layer producing 16 output feature maps.

```text
Convolutional layer (5×5 filters):
  Parameters = (5 · 5 · 3 + 1) · 16 = (75 + 1) · 16 = 76 · 16 = 1,216 weights

Fully-connected layer (flattened input, 16 output units):
  Input size = 32 · 32 · 3 = 3,072
  Parameters = (3,072 + 1) · 16 = 3,073 · 16 = 49,168 weights
```

The convolutional layer uses roughly 40 times fewer parameters to produce the same number of output feature maps from the same input — and this gap widens further as the input's spatial size grows, since the convolutional layer's parameter count depends only on the filter size, never on the input's height or width.

## Common Misconceptions & Pitfalls

- **"Padding is only about controlling output size, nothing else."** Padding does control output size, but it has a real secondary effect on how evenly information near the image border is processed across many convolutional layers — a detail easy to overlook when only checking arithmetic.
- **"Max pooling has learnable weights, like a convolutional layer."** Pooling has no weights at all — it applies a fixed, non-learned operation (max or average) within each window. This is a common source of confusion since pooling layers are often diagrammed alongside convolutional layers with similar-looking window/stride notation.
- **"Weight sharing would work just as well for any kind of input, not just images."** Weight sharing specifically exploits **translation invariance** — the assumption that a useful local pattern can appear anywhere in the input and should be detected the same way everywhere. Data without this property (say, tabular data where each column has a fixed, non-interchangeable meaning) does not benefit from the same architectural assumption, which is exactly why CNNs are the image-specialized architecture in this discipline, not a universal replacement for the dense layers covered earlier.

## Summary

Stride controls how far a convolutional filter moves between applications, and padding controls the input's border treatment and the resulting output size — together giving precise, formula-driven control over a convolutional layer's output dimensions. Pooling (typically max pooling) discards fine spatial detail on purpose, using no learned weights, to build in some tolerance to small translations and to shrink the computation required by later layers. Underlying all of it, weight sharing is what gives a convolutional layer its dramatic parameter-efficiency advantage over a fully-connected layer processing the same input — an advantage that specifically depends on images' translation-invariance property, which is exactly the property that makes reusing one filter everywhere a good architectural assumption in the first place.

## Documentation Links

- [CS231n — Convolutional Neural Networks: Architectures, Convolution / Pooling Layers](https://cs231n.github.io/convolutional-networks/) — the stride/padding output-size formula and the max-pooling operation this concept covers directly.
- [CS231n — Course Schedule (Stanford, Spring 2026)](https://cs231n.stanford.edu/schedule.html) — confirms "Convolution and pooling for hierarchical feature learning" as this course's own framing of this exact cluster of ideas.
