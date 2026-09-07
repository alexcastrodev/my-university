---
version: 1.0
updatedAt: 2026-09-07
---
## Learning Objectives

- State the generative adversarial network (GAN) setup: a generator and a discriminator trained against each other in a minimax game.
- Explain, at a conceptual level, why GANs can produce sharper samples than a plain autoencoder, and what specific training difficulty this adversarial setup introduces.
- Describe the core idea of a diffusion model — learning to reverse a gradual noising process — at a conceptual level.
- Explain, explicitly, why this concept treats both architectures at survey depth and where a fuller treatment is deliberately deferred.

## Context & Motivation

The previous concept ended by naming a genuine limitation of a plain autoencoder as a generative model: its latent space has no guarantee of being smooth or realistic everywhere, only where real training examples happen to land. GANs and diffusion models are two different, more sophisticated answers to "how do we generate genuinely realistic new samples," and they are also, by a wide margin, the generative architectures behind the most visible recent AI applications — image generation, synthetic media, and the broader wave of generative AI tools. The 2023 revision of the ACM/IEEE/AAAI CS curriculum guidelines added "generative models" and "basics of deep generative models" as explicit expected content for all computer science undergraduates specifically because of this real-world prominence, while still scoping that expectation to *basics*, not the full mathematical derivation of training dynamics — this concept is calibrated to exactly that scope, deliberately.

**A note on scope**: this concept treats both architectures at the level of what they are and why they work, not how their training objectives are fully derived or optimized in practice — the minimax game's saddle-point optimization theory, the specific instability issues (mode collapse) and their fixes, and the full probabilistic derivation of a diffusion model's denoising objective (score matching, the variational bound connecting it to the autoencoder framework) are real, substantial topics genuinely deserving their own dedicated treatment, left explicitly to a future, more advanced generative-modeling discipline. This is a deliberate scope decision, not an oversight: "Dive into Deep Learning," this discipline's second anchor, itself gives GANs one chapter at a similarly introductory level and has no dedicated chapter on diffusion models at all, confirming that a fuller mathematical treatment of both genuinely belongs to more specialized material than an introductory deep learning discipline.

## Core Theory

### GANs: a generator and a discriminator, trained against each other

A GAN consists of two networks trained simultaneously with opposing objectives. The **generator** `G` takes random noise `z` (drawn from some simple, fixed distribution) and transforms it into a synthetic sample `G(z)`, attempting to produce output indistinguishable from real training data. The **discriminator** `D` is a binary classifier — built from exactly the same dense/convolutional building blocks and cross-entropy loss already covered in this discipline — trained to distinguish real training examples from the generator's synthetic ones. The two are trained together in a minimax game: the discriminator tries to get better at telling real from fake, while the generator tries to get better at fooling the discriminator, each one's improvement making the other's task harder. When training succeeds, the generator has learned to produce samples realistic enough that the discriminator can do no better than random guessing at telling them apart from real data.

This adversarial setup is precisely what lets GANs produce sharper, more realistic samples than a plain autoencoder's squared-error reconstruction loss typically achieves — squared error, averaged over many possible plausible reconstructions, tends to produce blurry, "averaged-out" outputs, while a discriminator explicitly penalizes anything that looks unrealistic, regardless of whether it happens to minimize an average pixel-wise error. The real cost of this approach is training stability: because two networks are being optimized against each other rather than one network against a single fixed objective, GAN training can be substantially harder to get to converge reliably than the single-loss training this discipline has used everywhere else.

### Diffusion models: learning to reverse gradual noise

A diffusion model takes a different generative strategy entirely. During training, real data is gradually corrupted by adding a small amount of random noise over many steps, until after enough steps it becomes indistinguishable from pure noise — a fixed, non-learned **forward (noising) process**. A network is then trained to do the reverse: given a noisy version of an image at some step, predict and remove a small amount of that noise, progressively — a learned **reverse (denoising) process**. Once trained, generating a new sample means starting from pure random noise and running the learned denoising process for many steps, gradually turning unstructured noise into a coherent, realistic sample. Unlike a GAN's single-shot generation from noise to output, diffusion generates iteratively, through many small, individually easier-to-learn denoising steps — a structurally different strategy for the same underlying goal of turning simple noise into a realistic sample from the data's distribution.

## Worked Examples

### Example 1: The GAN training loop, traced conceptually

Consider one round of GAN training on a dataset of real images. First, the discriminator is shown a batch of real images (labeled "real") and a batch of the generator's current fake images (labeled "fake"), and updated by gradient descent (backpropagation, already covered) to improve its real-versus-fake classification accuracy — exactly the cross-entropy-loss classifier training already covered, with generated images simply providing one of the two classes' training examples. Next, the generator is updated — not to directly resemble real images, but to make its *next* batch of outputs score higher when passed through the (just-updated) discriminator, using the discriminator's own gradient with respect to its input, backpropagated further into the generator's weights. These two updates alternate, round after round: as the discriminator gets better at spotting the generator's current weaknesses, the generator is pushed to correct exactly those weaknesses, and the cycle continues.

### Example 2: Denoising as one small learnable step, repeated

Consider a diffusion model generating a 2D point meant to resemble points from some target distribution, starting from a random point `z_T` drawn from pure Gaussian noise. Denoising proceeds step by step, `z_T → z_{T-1} → ... → z_1 → z_0`, where at each step the network predicts a small correction (an estimate of the noise present at that step) and subtracts an appropriately-scaled fraction of it, nudging the point slightly closer to something the training data's distribution would actually produce. No single step attempts the (much harder) task of jumping directly from pure noise to a finished sample — each individual step is a comparatively easy, local denoising prediction, and it is only the composition of many such small steps that produces the final, realistic result. This "break one hard problem into many easy ones" structure is the core strategic idea distinguishing diffusion's iterative generation from a GAN's single-pass generation.

## Common Misconceptions & Pitfalls

- **"GANs and diffusion models are unrelated, competing techniques for the exact same problem."** Both address the same underlying goal (transform simple noise into realistic data), but through structurally different mechanisms — one-shot adversarial generation versus iterative denoising — and each has real, documented tradeoffs (GAN training instability versus diffusion's typically much slower, many-step generation process) rather than one strictly dominating the other.
- **"This concept has now fully covered generative modeling."** This concept is deliberately survey-level, by explicit design — the minimax game's optimization theory, mode collapse and its mitigations, and the probabilistic derivation behind diffusion's denoising objective are real, substantial topics intentionally left to a more advanced, dedicated discipline, not covered here.
- **"A GAN's discriminator is a fundamentally new kind of model, unrelated to earlier concepts in this discipline."** The discriminator is an ordinary binary classifier, built and trained with the exact same dense/convolutional layers, backpropagation, and cross-entropy loss already covered — what is genuinely new is the training *procedure* (two networks optimized against each other), not the discriminator's own architecture or loss function.

## Summary

GANs pit a generator against a discriminator in a minimax game, producing sharper samples than a plain autoencoder's averaged reconstructions at the real cost of a harder, less stable training procedure; diffusion models instead learn to reverse a gradual, fixed noising process through many small, individually tractable denoising steps. Both are covered here at a deliberately survey level — what each architecture is and why it works, using nothing but building blocks already covered elsewhere in this discipline (classifiers, cross-entropy, backpropagation) — with the full mathematical training theory for both explicitly and deliberately deferred to a future, more advanced generative-modeling discipline, a scope decision grounded directly in how even this discipline's own anchor sources (CS231n's own generative-models lectures, "Dive into Deep Learning"'s single GAN chapter with no dedicated diffusion chapter) treat this material at the introductory level.

## Documentation Links

- [Dive into Deep Learning — Generative Adversarial Networks](https://d2l.ai/chapter_generative-adversarial-networks/gan.html) — the minimax objective, generator, and discriminator roles this concept covers directly.
- [Eaton & Epstein — Artificial Intelligence in the CS2023 Undergraduate Computer Science Curriculum](https://ojs.aaai.org/index.php/AAAI/article/view/30352/32394) — the explicit basis for this concept's survey-level scope: "basics of deep generative models" as CS Core content for all undergraduates, not a full derivation.
