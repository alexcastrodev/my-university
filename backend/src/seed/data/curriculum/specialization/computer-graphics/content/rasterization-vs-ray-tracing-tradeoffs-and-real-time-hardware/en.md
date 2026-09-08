---
version: 1.0
updatedAt: 2026-09-08
---
## Learning Objectives

- State, precisely and side by side, what rasterization and ray tracing each optimize for, and what each honestly costs.
- Explain why rasterization maps naturally onto SIMT hardware while naive recursive ray tracing traditionally did not.
- Explain what NVIDIA's Turing-generation RT Cores actually accelerate, and why that specific hardware addition is what made real-time ray tracing a shipping reality.
- State honestly that this is a trade-off between two still-coexisting techniques, not a story of one obsoleting the other.

## Context & Motivation

The last several concepts built two structurally different ways of answering the same question, what color should this pixel be: rasterization pushes triangles through a fixed, staged pipeline (`the-graphics-pipeline-from-vertices-to-pixels` through `shading-interpolation-flat-gouraud-and-phong-shading`), while ray tracing works backward from each pixel, recursively following rays through the scene (`ray-casting-generating-and-intersecting-rays` through `recursive-ray-tracing-reflection-refraction-and-shadows`). This concept states, honestly and directly, what each approach actually costs and gains, and closes with the real, recent hardware development, dedicated ray-tracing acceleration silicon, that changed what was practical in real time.

## Core Theory

### What rasterization optimizes for, and its honest limit

Rasterization's fixed pipeline stages, transform, rasterize, shade, are each independently, embarrassingly parallel: every vertex transforms independently of every other vertex, every pixel's edge-function test (`triangle-rasterization-edge-functions-and-barycentric-coordinates`) depends only on that pixel's own coordinates, and every fragment's shading (`local-illumination-lambertian-diffuse-reflection`, `specular-reflection-the-phong-and-blinn-phong-models`) depends only on that fragment's own interpolated attributes. This is exactly the shape of work `gpu-architecture-and-the-simt-execution-model`'s SIMT model was built for: thousands of lanes running the identical instruction sequence on different data, with no data dependency between lanes and minimal branching. The honest limit, made explicit in `the-rendering-equation-and-the-limits-of-real-time-shading`, is that this pipeline only ever evaluates direct light from a small, fixed list of named sources; effects that inherently require following a light path recursively through the scene, sharp reflections of arbitrary geometry, refraction, physically accurate soft shadows from area lights, do not fall out of this pipeline naturally and traditionally needed separate, scene-specific approximation techniques bolted on.

### What ray tracing optimizes for, and its honest limit

Ray tracing's recursive structure (`recursive-ray-tracing-reflection-refraction-and-shadows`) makes reflections, refractions, and shadows fall out of the same single algorithm rather than needing separate techniques, and is more physically accurate in the specific sense that it more directly approximates the recursive rendering equation `the-rendering-equation-and-the-limits-of-real-time-shading` stated. The honest limit is that this recursion is data-dependent in a way rasterization's fixed pipeline is not: which BVH nodes a ray visits (`bounding-volume-hierarchies-and-ray-tracing-acceleration`) depends on that specific ray's own direction, and how many recursive bounces a given pixel needs depends on how many reflective or refractive surfaces that pixel's ray path happens to cross, so different pixels, and even different rays within the same pixel, do genuinely different amounts of work. This irregular, data-dependent branching pattern does not map cleanly onto a fixed, SIMT-style pipeline built for uniform per-lane work, which is precisely why ray tracing was, for decades, primarily an offline (non-real-time) technique, run in software on general-purpose hardware, taking anywhere from seconds to hours per frame for production-quality results.

### Real-time ray tracing hardware, a recent, honest development

NVIDIA's Turing architecture (2018) introduced dedicated RT Cores, hardware units built specifically to accelerate exactly the two operations `bounding-volume-hierarchies-and-ray-tracing-acceleration` and `ray-casting-generating-and-intersecting-rays` derived by hand: BVH traversal and ray-triangle intersection. Running these two specific, previously general-purpose-computed operations on dedicated silicon, in parallel with, and independent of, the GPU's ordinary CUDA cores handling shading work, is the concrete hardware change that made real-time ray tracing (tens of milliseconds per frame, not seconds) a shipping reality rather than a purely offline technique. This is an honest, real, recent (2018 onward) development, not a claim that rasterization has become obsolete: modern real-time renderers commonly use both together, rasterizing most of a scene for speed and casting rays selectively (for reflections, shadows, or ambient occlusion specifically) where ray tracing's structural advantages matter most.

## Worked Examples

### Example 1: illustrative cost shape, rasterization

A scene with 1 million triangles rendered at 1920x1080 (about 2.07 million pixels). Rasterization's cost shape is roughly proportional to (triangle count, for the transform stage) plus (covered-pixel count, for the rasterize-and-shade stages), each stage running its own fixed, parallel workload once; this is illustrative reasoning about the shape of the cost, not a specific measured benchmark of any particular renderer or scene.

### Example 2: illustrative cost shape, ray tracing

The same scene, ray traced instead: roughly 2.07 million primary rays (one per pixel), each needing a BVH traversal (`bounding-volume-hierarchies-and-ray-tracing-acceleration` established this as roughly logarithmic in object count per ray, so on the order of log2(1,000,000) =~ 20 box tests per primary ray in this illustrative scenario), plus, for any pixel whose surface is reflective, refractive, or in shadow, one or more additional secondary rays (shadow, reflection, refraction), each needing its own BVH traversal. A scene with many reflective surfaces and several lights can easily multiply the effective ray count several times over the primary-ray count alone; again, illustrative reasoning about the shape of the cost difference between the two techniques, not a precise, universal benchmark number.

### Example 3: what RT Cores specifically remove from that cost

Without dedicated hardware, every one of the BVH box tests and ray-triangle intersections in Example 2 above runs as ordinary, general-purpose shader code on the GPU's CUDA cores, competing for the same compute resources the shading stage also needs. RT Cores run exactly those two operations, BVH traversal and ray-triangle intersection, on separate, dedicated hardware, autonomously, allowing the CUDA cores to continue shading other work concurrently rather than waiting on or sharing time with the ray-intersection math; this is the concrete, named mechanism (not a general claim of "GPUs got faster") behind why Turing-generation hardware made real-time ray tracing viable specifically, rather than ray tracing simply becoming fast due to GPUs' general year-over-year performance improvements.

## Common Misconceptions & Pitfalls

- **"Ray tracing hardware makes rasterization obsolete."** Modern real-time renderers, even ones that use RT Cores, still rasterize most of a scene's primary visibility (the fastest way to answer "what triangle is nearest at this pixel" for opaque geometry with no reflections or refractions involved) and cast rays selectively, for effects rasterization's fixed pipeline genuinely cannot produce naturally; the two techniques are combined in practice, not one replacing the other.
- **"Ray tracing was impossible in real time before 2018, and became easy afterward."** Ray tracing ran in real time on constrained scenes and hardware before Turing, and remains genuinely expensive, requiring careful scene-specific budgeting of ray counts and bounce depth, on Turing-generation and later hardware; RT Cores meaningfully lowered the cost of the two specific, named operations in Example 3, they did not eliminate ray tracing's fundamentally higher, data-dependent cost relative to rasterization.
- **"The SIMT-friendliness argument means rasterization is always faster than ray tracing for identical visual quality."** This concept's illustrative examples compare cost shape, not final image quality; a rasterized image approximating reflections with a separate technique (like a lower-resolution reflection pass) may render faster than a fully ray-traced equivalent while looking visibly less accurate, so "faster" and "equal quality" are two separate axes this concept deliberately does not conflate.

## Summary

Rasterization's fixed, staged pipeline maps naturally onto SIMT hardware because every vertex, pixel, and fragment does structurally uniform, independent work, but only ever evaluates direct light from named sources; ray tracing's recursive structure produces reflections, refractions, and shadows from one unified algorithm and more directly approximates the full rendering equation, but its data-dependent branching, different rays doing genuinely different amounts of work, does not map cleanly onto that same fixed hardware model, which is why it was traditionally an offline technique. NVIDIA's Turing-generation RT Cores (2018) changed this by accelerating exactly two specific operations, BVH traversal and ray-triangle intersection, in dedicated hardware running alongside ordinary shading work, the concrete, named development behind real-time ray tracing's arrival as a shipping reality, not a claim that either technique has replaced the other. `capstone-tracing-one-triangle-through-both-pipelines`, next, traces one concrete scene through both techniques side by side to make this whole comparison completely concrete.

## Documentation Links

- [NVIDIA Turing Architecture In-Depth (NVIDIA Developer Blog, 2018)](https://developer.nvidia.com/blog/nvidia-turing-architecture-in-depth/): the source describing RT Cores' specific acceleration of BVH traversal and ray-triangle intersection, the concrete hardware development this concept's closing section relies on.
- [ACM/IEEE CS2013: Graphics and Interactive Techniques (GV) Knowledge Area](https://csed.acm.org/knowledge-areas-graphics-and-interactive-techniques-git-cs2013-version/): the curriculum source listing GPU architecture considerations as part of the Advanced Rendering knowledge unit this rasterization-versus-ray-tracing comparison belongs to.
