---
version: 1.0
updatedAt: 2026-09-08
---
## Learning Objectives

- State Pineda's edge-function test precisely, and use it to decide whether a concrete pixel lies inside a concrete triangle.
- Derive barycentric coordinates from the same three edge-function values, and explain why they sum to 1 for any point inside the triangle.
- Interpolate a per-vertex attribute (color, depth, or texture coordinate) across a triangle's interior using barycentric weights, with real numbers.
- Explain why this per-pixel test is genuinely embarrassingly parallel, and connect that directly to `gpu-architecture-and-the-simt-execution-model`'s SIMT execution model.

## Context & Motivation

`the-projection-matrix-perspective-and-clipping` finished the geometric side of the pipeline: every surviving triangle now has its three vertices in a small, standardized coordinate space, ready to become pixels. This concept covers the real, concrete mechanism, first published by Pineda in 1988, that answers "how does a GPU actually draw a triangle": for a given pixel, decide whether it lies inside the triangle using three simple linear tests, and, at the same time, get the exact interpolation weights needed to blend that triangle's three vertices' attributes at that pixel. `gpu-architecture-and-the-simt-execution-model` (`computer-architecture`) already established that a GPU executes many independent lanes in lockstep under SIMT; this per-pixel edge test is exactly the kind of branch-free, embarrassingly parallel workload that execution model exists to run.

## Core Theory

### The edge function

For a triangle with vertices A, B, and C (in screen space, after the viewport transform maps NDC coordinates to actual pixel coordinates), define an edge function for the edge from A to B, evaluated at a point P:

```text
edge_AB(P) = (Bx - Ax) * (Py - Ay) - (By - Ay) * (Px - Ax)
```

This is a linear function of P's coordinates; it evaluates to zero exactly on the line through A and B, positive on one side, and negative on the other. Pineda's insight is that the same, fixed formula, evaluated once per edge, tells a rasterizer everything it needs: if a triangle's vertices are listed in a consistent winding order (say, counter-clockwise), a point P is inside the triangle exactly when all three of edge_AB(P), edge_BC(P), and edge_CA(P) are non-negative (or all non-positive, for the opposite winding), a simple, uniform sign test with no special-casing for the triangle's shape or orientation.

### Barycentric coordinates

The same three edge-function values, once normalized by the triangle's total (signed) area, become the point's barycentric coordinates (alpha, beta, gamma), one weight per vertex, satisfying alpha + beta + gamma = 1 for any point in the triangle's plane:

```text
alpha = edge_BC(P) / edge_BC(A)      [weight for vertex A]
beta  = edge_CA(P) / edge_CA(B)      [weight for vertex B]
gamma = edge_AB(P) / edge_AB(C)      [weight for vertex C]
```

(Each denominator is that same edge function evaluated at the triangle's own opposite vertex, which equals twice the triangle's signed area and is the same for every point P, so it is computed once per triangle.) Barycentric coordinates are the exact same non-negative-when-inside test as the raw edge functions, plus the ability to weight any per-vertex attribute: interpolated_value = alpha * value_A + beta * value_B + gamma * value_C, for color, depth, texture coordinates, or a surface normal, all using the identical three weights.

### Why this is embarrassingly parallel

Every pixel's inside/outside test and every pixel's attribute interpolation depends only on that pixel's own screen coordinates and the triangle's three fixed vertices; no pixel's computation depends on any other pixel's result. This is precisely the SIMT execution model `gpu-architecture-and-the-simt-execution-model` described: thousands of independent lanes, each evaluating the identical edge-function formula against different input coordinates, with no data dependency between lanes and no branching (the sign test is the only conditional, and it is the same shape of conditional for every lane), letting a GPU's warps execute this stage at extremely high throughput.

## Worked Examples

### Example 1: testing whether a pixel is inside a triangle

Triangle A = (0, 0), B = (4, 0), C = (0, 4) (screen-space, counter-clockwise winding). Test pixel P = (1, 1):

```text
edge_AB(P) = (4-0)*(1-0) - (0-0)*(1-0) = 4*1 - 0*1 = 4
edge_BC(P) = (0-4)*(1-0) - (4-0)*(1-4) = -4*1 - 4*(-3) = -4 + 12 = 8
edge_CA(P) = (0-0)*(1-0) - (0-4)*(1-0) = 0 - (-4) = 4
```

All three values (4, 8, 4) are non-negative: P = (1, 1) is inside the triangle.

### Example 2: testing a pixel outside the triangle

Same triangle, test pixel P = (3, 3):

```text
edge_AB(P) = (4-0)*(3-0) - (0-0)*(3-0) = 12 - 0 = 12
edge_BC(P) = (0-4)*(3-0) - (4-0)*(3-4) = -12 - 4*(-1) = -12 + 4 = -8
edge_CA(P) = (0-0)*(3-0) - (0-4)*(3-0) = 0 - (-12) = 12
```

edge_BC(P) = -8 is negative while the other two are positive: the signs are not all the same, so P = (3, 3) is outside the triangle (correctly, since (3,3) lies past the hypotenuse from (4,0) to (0,4)).

### Example 3: interpolating a color at the inside pixel

Same triangle, P = (1, 1) from Example 1. Twice the triangle's area (the fixed denominators) are edge_BC(A) = 16, edge_CA(B) = 16, edge_AB(C) = 16 (a right triangle with legs of length 4, area 8, so twice the area is 16). Barycentric weights at P:

```text
alpha = edge_BC(P) / edge_BC(A) = 8 / 16 = 0.5
beta  = edge_CA(P) / edge_CA(B) = 4 / 16 = 0.25
gamma = edge_AB(P) / edge_AB(C) = 4 / 16 = 0.25
(check: 0.5 + 0.25 + 0.25 = 1.0)
```

If vertex A is pure red (1,0,0), vertex B is pure green (0,1,0), and vertex C is pure blue (0,0,1), the interpolated color at P is:

```text
0.5*(1,0,0) + 0.25*(0,1,0) + 0.25*(0,0,1) = (0.5, 0.25, 0.25)
```

A muted red-leaning color, correctly weighted toward vertex A since P sits closer to A than to B or C.

## Common Misconceptions & Pitfalls

- **"The edge function only tests inside-versus-outside; interpolation needs a separate, unrelated calculation."** Example 3 reuses the exact same edge-function values from Example 1's inside test, normalized by a fixed per-triangle constant, to get the interpolation weights; both jobs come from one set of three numbers.
- **"Rasterization has to test every pixel on the screen against every triangle."** Real rasterizers bound the search to each triangle's screen-space bounding box (the smallest rectangle containing A, B, and C) rather than the whole framebuffer, and GPU hardware further tiles this work; the edge-function test itself is still evaluated per candidate pixel, just over a far smaller candidate set than the full screen.
- **"A negative edge-function value always means an error."** A negative value simply means the point is on the opposite side of that edge from the triangle's interior, for a consistently wound triangle; Example 2's single negative value among three is the expected, correct signal that the point is outside, not a bug.

## Summary

Pineda's 1988 edge-function test decides whether a pixel lies inside a triangle with three linear evaluations, one per edge, all non-negative for an inside point given consistent winding; the same three values, normalized by the triangle's fixed area, are exactly the point's barycentric coordinates, which interpolate any per-vertex attribute, color, depth, texture coordinates, with one shared set of weights. Because every pixel's test depends only on that pixel's own coordinates and the triangle's fixed vertices, with no data dependency between pixels, this is genuinely the embarrassingly parallel, branch-free workload `gpu-architecture-and-the-simt-execution-model`'s SIMT execution model was built to run at scale. `z-buffering-and-visibility-determination`, next, uses this same barycentric interpolation to compute each fragment's depth for visibility testing.

## Documentation Links

- [Pineda: A Parallel Algorithm for Polygon Rasterization (SIGGRAPH, 1988)](https://history.siggraph.org/learning/a-parallel-algorithm-for-polygon-rasterization-by-pineda/): the source paper for the edge-function test this concept builds from, including its own emphasis on parallel, hardware-friendly per-pixel evaluation.
- [NVIDIA CUDA Programming Guide: SIMT Execution and Warps](https://docs.nvidia.com/cuda/cuda-programming-guide/03-advanced/advanced-kernel-programming.html): the concrete hardware execution model, warps of lockstep threads, that makes this per-pixel test the natural fit for real GPU rasterizer hardware.
