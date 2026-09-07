---
version: 1.0
updatedAt: 2026-09-07
---
## Learning Objectives

- Compare every major architecture family covered in this discipline by the structure of data it assumes: grid-structured, sequential, or set-like.
- Apply the training-concern checklist (initialization, regularization, optimizer, normalization, compute) developed across this discipline to a new architecture choice, without re-deriving any of it.
- Trace one concrete example task through the full decision process — architecture choice, training setup, and generative extension if relevant.
- Explain how this discipline's decision guide extends `ai-theory/machine-learning`'s own capstone from classical models into deep architectures.

## Context & Motivation

`choosing-and-validating-a-model-a-decision-guide`, the capstone of `ai-theory/machine-learning`, closed that discipline by comparing every classical model family it covered — regression, generative and discriminative classifiers, trees and ensembles, SVMs, clustering — along interpretability, data size, and nonlinearity, and named neural networks as the frontier that discipline deliberately did not cross. This capstone is the direct continuation: it assembles this discipline's own families — plain multilayer networks, CNNs, RNN/LSTM/GRU, and Transformers — into an equally concrete decision guide, and walks one full example through the choices that guide actually implies.

## Core Theory

### Architecture choice, by data structure

The single most useful first question when choosing among this discipline's architectures is: what structure does the data itself have?

- **Grid-structured data** (images, and other data with strong local spatial correlation) — a CNN's convolution and pooling, built specifically around weight-shared local filters and translation invariance, is the natural fit.
- **Sequential data** (text, audio, time series, where order and variable length matter) — an RNN/LSTM/GRU or a Transformer applies; between the two, sequence length and available compute matter directly: an RNN's sequential (non-parallelizable) processing suits shorter sequences or settings where compute is limited, while a Transformer's parallelizable self-attention scales better with more data and compute, and handles long-range dependencies more directly than even a gated RNN typically can.
- **Fixed-size, unstructured feature vectors** (tabular data with no inherent spatial or sequential structure) — a plain multilayer network (the first concept of this discipline) is often the simplest fit, since neither convolution's spatial weight-sharing nor a recurrence's temporal structure has anything to exploit.

### Training concerns that apply regardless of architecture

Every architecture choice above still faces the same checklist of training concerns developed across this discipline's second cluster, independent of which architecture is chosen: weights need calibrated initialization (Xavier/He) to avoid the vanishing/exploding gradient problem at the start of training; an optimizer beyond plain gradient descent (momentum or Adam) is nearly always used in practice; regularization (dropout, weight decay) is needed whenever the chosen architecture's capacity risks overfitting the available data, exactly as `the-bias-variance-tradeoff` predicts for any sufficiently flexible model; and normalization (batch or layer normalization) stabilizes training as depth increases. None of these concerns is specific to CNNs, RNNs, or Transformers individually — they are properties of training *any* sufficiently deep network by gradient-based optimization, which is why this discipline covered them once, in a dedicated cluster, before ever introducing a specific architecture.

### When to reach for a generative extension

If the task is not to predict a label or value but to produce new, realistic data resembling a training set, the architecture question gains a second dimension: a plain autoencoder suffices when the goal is compression or a moderate-quality reconstruction-based generative baseline, while GANs or diffusion models (covered at survey depth) are the current state of the art for high-fidelity generation, at the cost of the additional training complexity and compute each respectively requires.

## Worked Examples

### Example 1: Choosing an architecture for a genuinely new task

Consider a task: given a patient's sequence of hospital visit records (each visit described by a set of diagnosis codes, ordered chronologically, with a variable number of visits per patient), predict the diagnosis code most likely to appear at the next visit. The data structure is sequential and variable-length — ruling out a plain multilayer network directly (it requires a fixed-size input) and a CNN (there is no meaningful spatial/grid locality between diagnosis codes to exploit). Between an RNN/LSTM/GRU and a Transformer: with typically short sequences (dozens of visits per patient, not thousands) and a real practical need to process new patients' records one visit at a time as they arrive, an LSTM's ability to process a sequence incrementally, one timestep at a time, without needing the entire sequence in memory at once, is a genuine, task-specific reason to consider it over a Transformer — even though a Transformer would likely achieve comparable or better accuracy given enough training data, the incremental-processing requirement is a concrete deciding factor this decision guide's data-structure question alone does not settle, and has to be weighed against the accuracy-versus-parallelism tradeoff established in the attention cluster.

### Example 2: Assembling the full checklist for the chosen architecture

Continuing Example 1 with an LSTM chosen: the model needs weight initialization appropriate to its activation functions (`weight-initialization-and-the-vanishing-exploding-gradient-problem`), Adam as a practical default optimizer given noisy per-batch gradients from variable-length patient sequences (`optimizers-beyond-gradient-descent-momentum-and-adam`), dropout applied between LSTM layers to prevent overfitting to the (typically much smaller than image or text corpora) available patient-record dataset (`regularization-in-deep-networks-dropout-and-weight-decay`), and cross-entropy loss over the softmax-normalized output distribution across possible diagnosis codes (`softmax-and-cross-entropy-loss`) — every single piece of this checklist was covered as its own concept earlier in this discipline, and none of it needed to be re-derived to apply it to this new, previously-unseen task.

## Common Misconceptions & Pitfalls

- **"The most modern architecture (a Transformer) is always the right choice."** Example 1 shows a concrete, legitimate case where an LSTM's incremental processing is a real, task-specific advantage a Transformer's better raw accuracy does not automatically outweigh — architecture choice is a genuine engineering tradeoff, not a strict hierarchy from "old" to "new."
- **"Training concerns like dropout or Adam need to be re-derived or re-justified for each new architecture."** Example 2 demonstrates the opposite: the training checklist developed once, generically, in this discipline's second cluster applies directly to a brand-new task and architecture with no re-derivation needed — this is precisely the payoff of having covered those concerns separately from any specific architecture.
- **"A generative extension is only relevant if the original task was explicitly about generation."** Autoencoders, GANs, and diffusion models can also serve tasks that are not obviously generative on the surface — for instance, an autoencoder's bottleneck representation can be reused as a learned feature extractor (an application of `representation-learning-the-network-learns-its-own-features`) for an otherwise ordinary supervised task with too little labeled data to train a large network from scratch.

## Summary

This discipline's architectures divide cleanly by the data structure they assume — grid-structured for CNNs, sequential for RNN/LSTM/GRU and Transformers, unstructured fixed-size vectors for plain multilayer networks — while the training checklist (initialization, optimizer, regularization, normalization) developed once in this discipline's training cluster applies uniformly regardless of which architecture is chosen, exactly as this capstone's worked example demonstrates end to end. This extends `ai-theory/machine-learning`'s own capstone decision guide directly: where that discipline stopped at the frontier of neural networks, this discipline's capstone picks up with a working decision process across the deep architectures — CNNs, RNNs, Transformers, and their generative extensions — that frontier led into.

## Documentation Links

- [CS231n — Course Schedule (Stanford, Spring 2026)](https://cs231n.stanford.edu/schedule.html) — the full lecture-by-lecture progression (backpropagation → CNNs → RNNs → attention/Transformers → generative models) this capstone's architecture comparison summarizes end to end.
- [Dive into Deep Learning — Home](https://d2l.ai/) — this discipline's second anchor source, whose own chapter structure (multilayer perceptrons through attention/Transformers) independently confirms the same architecture progression this capstone reviews.
