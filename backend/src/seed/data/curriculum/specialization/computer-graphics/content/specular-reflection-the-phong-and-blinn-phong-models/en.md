---
version: 1.0
updatedAt: 2026-09-08
---
## Learning Objectives

- Explain why diffuse reflection alone never produces a highlight, and what a specular highlight physically represents.
- State Phong's 1975 specular term precisely, using the reflection vector, and compute it for a concrete light, view, and normal configuration.
- State Blinn's 1977 refinement, the halfway vector, and explain why it is cheaper to compute per light per pixel than an explicit reflection vector.
- Explain the role of the shininess exponent, and show numerically how a larger exponent produces a tighter, brighter highlight.

## Context & Motivation

`local-illumination-lambertian-diffuse-reflection` modeled a perfectly matte surface, one whose brightness never depends on the viewer's position. Real shiny surfaces, polished metal, wet skin, a glossy apple, show something diffuse reflection cannot: a bright highlight that moves as the viewer moves, appearing only near the direction a mirror-like reflection of the light would take. This concept covers the two classic, real, historically named models built to add that highlight: Phong's 1975 model (Illumination for Computer Generated Pictures) and Blinn's 1977 refinement, the two local illumination terms nearly every real-time renderer shipped for the following three decades.

## Core Theory

### Why a highlight needs the view direction

A specular highlight is the visual result of light reflecting off a surface in a concentrated, mirror-like way rather than scattering equally in all directions the way Lambertian diffuse light does. Whether a given point looks highlighted depends on whether the viewer happens to be standing close to the direction a perfect mirror reflection of the light would travel; move the viewer, and the highlight visibly moves too, a genuinely view-dependent effect diffuse reflection, by construction, can never produce.

### The Phong specular term

Phong's model computes the reflection vector R, the direction the light ray would bounce in if the surface were a perfect mirror at that point (computed from the light direction L and the normal N: R = 2(N . L)N - L, for unit vectors N and L), then compares R against the direction to the viewer V with a dot product, raised to a power called the shininess exponent (often written as a variable like alpha or shininess):

```text
specular_color = specular_reflectance * light_color * light_intensity * max(0, R . V)^shininess
```

The shininess exponent controls how tight or spread out the highlight is: a low exponent (say, 1 or 2) spreads a dim glow across a wide area; a high exponent (say, 128 or higher) concentrates the highlight into a small, bright, sharp spot, which is exactly what a highly polished surface shows.

### The Blinn-Phong refinement: the halfway vector

Blinn's 1977 paper observed that computing an explicit reflection vector R for every light, at every fragment, is more arithmetic than necessary. Instead, Blinn-Phong computes the halfway vector H, the unit vector exactly between the light direction L and the view direction V (H = normalize(L + V)), and compares H against the surface normal N directly:

```text
specular_color = specular_reflectance * light_color * light_intensity * max(0, N . H)^shininess
```

H depends only on L and V (not on N), so, for a scene with multiple lights and one fixed viewer, H can be computed once per light rather than requiring a separate reflection-vector computation per fragment per light; this is a real, concrete performance win, which is exactly why Blinn-Phong, not the original Phong formula, became the far more common implementation in practice, even though the two use N . H and R . V respectively rather than being algebraically identical.

## Worked Examples

### Example 1: computing the reflection vector and Phong specular term

Normal N = (0, 0, 1), light direction L = (0, 0.707, 0.707) (45 degrees from the normal), view direction V = (0, 0.707, 0.707) (viewer positioned exactly where a mirror reflection would send the light back, the case that should produce maximum highlight).

```text
N . L = 0.707
R = 2*(N.L)*N - L = 2*0.707*(0,0,1) - (0,0.707,0.707)
  = (0,0,1.414) - (0,0.707,0.707) = (0,-0.707,0.707)
R . V = (0)(0) + (-0.707)(0.707) + (0.707)(0.707) = -0.5 + 0.5 = 0
```

R . V = 0 here means this particular V is not actually the mirror direction (a deliberately illustrative near-miss, chosen to show the arithmetic clearly); with shininess 32, max(0, 0)^32 = 0, no specular contribution from this term at this exact V.

### Example 2: the same configuration, view direction exactly at the mirror angle

Same N and L. The true mirror-reflection direction, computed above, is R = (0, -0.707, 0.707). Set V = R = (0, -0.707, 0.707) exactly (the viewer positioned precisely along the reflection):

```text
R . V = (0)(0) + (-0.707)(-0.707) + (0.707)(0.707) = 0.5 + 0.5 = 1.0
With shininess = 32: specular_term = 1.0^32 = 1.0 (maximum highlight)
With shininess = 4:  specular_term = 1.0^4  = 1.0 (still maximum, exactly at the peak)
```

At the exact mirror direction, any shininess exponent gives the maximum value of 1.0; the exponent's effect shows up away from this exact peak, computed next.

### Example 3: shininess exponent controls highlight tightness, slightly off the peak

Same peak configuration, but now consider a point slightly off the mirror direction, where R . V = 0.9 instead of 1.0 (a small, one-fragment-over deviation):

```text
shininess = 4:   0.9^4   = 0.656  (still fairly bright)
shininess = 32:  0.9^32  = 0.034  (much dimmer)
shininess = 128: 0.9^128 = 0.0000014 (essentially black)
```

A higher shininess exponent makes the specular term fall off far more sharply as the angle moves away from the exact mirror direction, which is exactly the visible difference between a dull, matte-ish gloss (low exponent, wide, dim highlight) and a polished, mirror-like surface (high exponent, small, sharp, bright highlight).

## Common Misconceptions & Pitfalls

- **"The specular term replaces the diffuse term on shiny surfaces."** The two are added together, not substituted: a shiny surface still has the base Lambertian diffuse color from `local-illumination-lambertian-diffuse-reflection` across its whole visible area, with the specular term adding a bright highlight only near the mirror-reflection direction, on top of that diffuse base.
- **"Blinn-Phong and Phong always produce identical highlights."** Example 1 and 2 use R . V (Phong); Blinn-Phong instead uses N . H with the halfway vector, and while both peak at the same physical configuration (the true mirror direction), the two formulas fall off at different rates away from that peak for the same shininess exponent, so the same numeric shininess value produces visibly different highlight shapes between the two models, a real, documented difference practitioners account for when tuning material parameters.
- **"A higher shininess exponent always makes a surface look brighter overall."** Example 3 shows the opposite away from the exact peak, a higher exponent makes the surface dimmer everywhere except very close to the mirror direction; total highlight brightness stays similar or lower, but concentrated into a much smaller area, which is precisely why it reads visually as "shinier" rather than merely "brighter."

## Summary

A specular highlight is a genuinely view-dependent effect diffuse reflection cannot produce; Phong's 1975 model adds it by comparing an explicit reflection vector against the view direction, raised to a shininess exponent, while Blinn's 1977 refinement computes the same peak behavior more cheaply using the halfway vector between the light and view directions compared against the normal directly, which is why Blinn-Phong became the far more common real-time implementation. Both models are added on top of, never substituted for, the diffuse term `local-illumination-lambertian-diffuse-reflection` already built, and the shininess exponent controls how tightly the highlight concentrates around the exact mirror-reflection direction. `shading-interpolation-flat-gouraud-and-phong-shading`, next, covers the separate, real question of exactly where in the pipeline this lighting equation gets evaluated.

## Documentation Links

- [Phong: Illumination for Computer Generated Pictures (Commun. ACM, 1975) : history via SIGGRAPH](https://history.siggraph.org/learning/the-life-and-legacy-of-bui-tuong-phong-by-kim-oh-and-tran/): the historical source confirming the original 1975 paper's citation details and its introduction of the specular reflection-vector term this concept builds from.
- [Blinn: Models of Light Reflection for Computer Synthesized Pictures (SIGGRAPH, 1977)](https://history.siggraph.org/learning/models-of-light-reflection-for-computer-synthesized-pictures-by-blinn/): the source paper for the halfway-vector refinement this concept covers as the more commonly implemented alternative to the original Phong formula.
