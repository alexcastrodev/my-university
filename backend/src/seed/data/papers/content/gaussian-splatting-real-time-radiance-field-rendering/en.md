---
title: "3D Gaussian Splatting for Real-Time Radiance Field Rendering"
summary: A scene captured in photos is turned into millions of 3D Gaussians that are optimized by gradient descent and drawn with a fast GPU rasterizer, reaching real-time rendering at 1080p with quality close to the slowest and best radiance field methods.
researchArea: Computer Graphics
keywords: gaussian splatting, radiance fields, novel view synthesis, real-time rendering, differentiable rendering, rasterization
version: 1.0
updatedAt: 2026-11-01
---

## Overview

Novel view synthesis is the task of showing a scene from a camera position nobody photographed, given a set of photos of it. Neural Radiance Fields (NeRF) made this work with striking quality by storing the scene in a neural network and rendering by ray marching, which samples many points along every ray. The best quality methods are slow to train and to render, and the faster ones lose quality. For unbounded scenes at 1080p, the authors say no earlier method reached real-time display rates.

This paper, published in ACM Transactions on Graphics in 2023, by Bernhard Kerbl, Georgios Kopanas, Thomas Leimkühler and George Drettakis, proposes an explicit alternative. The connection to machine learning is real, since the scene is fitted to photos by gradient descent, but the paper's contribution is a scene representation and a rendering algorithm. There is no neural network in the representation, and what makes it fast is the GPU rasterization pipeline that graphics has used for decades.

Worth knowing first: rasterization against ray tracing, alpha blending, structure-from-motion (how camera positions are recovered from photos), and the peak signal-to-noise ratio (PSNR) as an image quality measure.

## Contribution

- **Anisotropic 3D Gaussians** as the scene representation. Each has a position, an opacity, a covariance (so it can be stretched in any direction) and color as spherical harmonics, which lets the color depend on the view direction.
- **Optimization with adaptive density control.** The Gaussians' parameters are optimized from photos, while the number of Gaussians is changed on the way: new ones are added where detail is missing and others are removed.
- **A fast, visibility-aware, differentiable rasterizer** that sorts splats per screen tile, supports anisotropic splatting and back-propagation through many overlapping splats, which speeds up both training and rendering.
- **The first approach, according to the authors, that gives real-time (30 fps or more) 1080p rendering of radiance fields** with quality that matches the best previous methods and training times competitive with the fastest.

## Methodology

The input is a set of photos with camera poses from structure-from-motion, which also yields a sparse point cloud. The Gaussians start at those points. In each iteration a view is rendered, compared with the real photo using a loss that combines L1 and structural similarity, and the Gaussians' parameters are updated. Periodically, Gaussians with large gradients are split or cloned and nearly transparent ones are removed. Rendering projects each Gaussian to the image, sorts the splats for each 16x16 tile and blends them front to back.

The authors evaluate on 13 real scenes from three datasets (Mip-NeRF360, Tanks and Temples, Deep Blending) and on the synthetic NeRF dataset, with every eighth photo held out for testing, on an A6000 GPU. They compare with Mip-NeRF360 for quality, and with InstantNGP and Plenoxels for speed. Ablations remove one design choice at a time: initialization from the sparse points, densification, anisotropy, the number of splats that receive gradients and spherical harmonics.

## Findings

These are the authors' reported results.

- On the Mip-NeRF360 dataset the 30K-iteration model has a PSNR of 27.21, trains in 41 minutes and renders at 134 fps. Mip-NeRF360 has a PSNR of 27.69 (a value taken from its paper), takes 48 hours and renders at 0.06 fps. The 7K-iteration model reaches 25.60 PSNR in about 6.5 minutes at 160 fps, against 25.30 for InstantNGP-Base at 11.7 fps.
- On Tanks and Temples the 30K model has a PSNR of 23.14 against 22.22 for Mip-NeRF360, and on Deep Blending 29.41 against 29.40, both at over 130 fps.
- The scenes use 1 to 5 million Gaussians. Memory is higher than in NeRF-based methods: 734 MB on Mip-NeRF360 scenes against 8.6 MB for Mip-NeRF360 and 13 to 48 MB for InstantNGP.
- On the synthetic NeRF dataset, starting from 100,000 random points, the average PSNR is 33.32, in line with the compared methods, with rendering at 180 to 300 fps.
- Ablations show that anisotropy matters for thin structures and that limiting how many front-most splats receive gradients lowers quality sharply. Starting from random points instead of the sparse points mostly hurts the background.

## Critical Analysis

The paper combines a clear idea with careful engineering, and it reports its own weaknesses. Points to consider:

- **Quality is "matching", not better, on its main dataset.** Mip-NeRF360 still has the higher PSNR and SSIM on the Mip-NeRF360 dataset, and the new method wins on speed, on some datasets and on some metrics. The title claim of real-time rendering is the solid one.
- **Baselines are partly the authors' runs.** Most numbers come from the authors' own experiments, with the Mip-NeRF360 results taken from its paper and its training time estimated from a 12-hour run on four A100 GPUs. This is normal, but it is not a neutral benchmark.
- **Limits the authors state.** There are artifacts where a scene is poorly observed, elongated or splotchy Gaussians, popping when large Gaussians appear, no regularization, and a simple visibility algorithm that can switch the blending order. Training memory in the prototype can pass 20 GB for large scenes, and about 80% of training time is spent in Python.
- **The task is narrow.** The method assumes a static scene with calibrated cameras and is judged by how well new views look. In our reading, it says little yet about the quality of the underlying geometry, which the authors themselves raise by suggesting mesh reconstruction as a next step.

## Further Research

- Regularization, better culling and antialiasing, to reduce the popping and the artifacts in unseen regions.
- Compression of the representation, using ideas from point cloud compression, and a lower-level implementation of the optimization to cut memory and time.
- Reconstructing meshes from the Gaussians, to understand where the representation sits between volumes and surfaces.
- Very large scenes such as urban datasets, where the authors note in early experiments that the position learning rate may need to be lowered for the optimization to converge.
