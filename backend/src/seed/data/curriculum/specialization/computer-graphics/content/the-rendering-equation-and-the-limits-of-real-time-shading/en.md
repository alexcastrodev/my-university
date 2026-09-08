---
version: 1.0
updatedAt: 2026-09-08
---
## Learning Objectives

- State Kajiya's 1986 rendering equation in plain terms: outgoing light equals emitted light plus an integral, over every incoming direction, of scattered incoming light.
- Explain precisely what "every incoming direction" includes, light bounced off any other surface in the scene, not just direct light from named sources.
- Explain, concretely, what real-time shading (the previous three concepts) actually computes relative to this full equation, and name the specific truncation it makes.
- State honestly why this truncation is a deliberate, cost-driven engineering choice rather than a mistake, and what the honest cost of computing the full integral would be.

## Context & Motivation

Every shading model built so far, Lambertian diffuse, Phong and Blinn-Phong specular, flat, Gouraud, and Phong shading, computes light arriving at a surface directly from a small, fixed list of named light sources: a point light here, a directional light there. Real light does not work this way: light bounces off every surface in a scene, an indirect bounce off a red wall genuinely tints a nearby white object slightly red, a real, physically observable effect (color bleeding) none of the previous concepts' equations can produce, since they never consider light arriving from any direction except straight from a named light. This concept states, honestly and precisely, the full physical problem those models approximate, Kajiya's 1986 rendering equation, and names exactly what real-time rendering leaves out, as the honest bridge to why ray tracing, covered starting with the next concept, exists.

## Core Theory

### The rendering equation, in plain terms

Kajiya's 1986 paper unified essentially every prior rendering algorithm as special cases of one integral equation. In plain terms: the light leaving a point on a surface, in a given outgoing direction, equals whatever light that point emits on its own (zero for nearly every surface except actual light sources), plus a sum, over every possible incoming direction across the entire hemisphere above that point, of how much light arrives from that direction, scattered by the surface's own material properties toward the outgoing direction being asked about. Written compactly:

```text
L_out(p, w_out) = L_emitted(p, w_out)
                + Integral over hemisphere of:
                    f_material(p, w_in, w_out) * L_in(p, w_in) * cos(theta_in) dw_in
```

The crucial, physically real detail is that L_in(p, w_in), the incoming light arriving at point p from direction w_in, is not a constant supplied by a fixed list of lights; it is itself the outgoing light (L_out) leaving whatever other surface happens to be in that direction, which is why this is called an integral equation, not a simple formula, the unknown function appears on both sides.

### What real-time shading actually computes

`local-illumination-lambertian-diffuse-reflection` and `specular-reflection-the-phong-and-blinn-phong-models` compute a deliberately truncated version of this same equation: instead of integrating over every direction in the hemisphere, they sum over only a small, fixed set of named light sources (each one a single, specific w_in direction, rather than a continuous integral), and they typically add one more term, a flat constant "ambient" color, as a crude stand-in for all the indirect, bounced light the truncated sum otherwise ignores entirely. This is local illumination, by name: it only ever considers light traveling directly from a named source to the point being shaded, never light that has bounced off any other surface first (global illumination, the term for approaches that do account for bounced light).

### Why this is a deliberate, honest engineering trade-off

Solving the full rendering equation, even approximately, for every visible point in a scene requires integrating over a continuous hemisphere of incoming directions at every single point, and, because L_in depends recursively on other points' own L_out, that integral must itself be approximated by simulating many light paths bouncing repeatedly around a scene, computation many orders of magnitude more expensive than evaluating a fixed sum over a handful of named lights. Real-time rendering's ambient-plus-direct-lights truncation is a named, explicit, cost-driven approximation, not an oversight: it accepts an honest, visible cost, no color bleeding, no soft indirect shadows, in exchange for running fast enough for interactive frame rates, and ray tracing, starting with the next concept, is the family of techniques built specifically to approximate more of this same integral directly, at a correspondingly higher, but no longer completely fixed, computational cost.

## Worked Examples

### Example 1: why the equation is recursive, a concrete two-surface case

A white wall (albedo close to 1.0 in every color channel) sits one meter from a red wall (albedo close to (0.9, 0.1, 0.1)), both lit by an overhead light. The full rendering equation says the white wall's outgoing light in the direction facing the red wall depends on L_in from every direction, including the direction facing the red wall, which is itself the red wall's own L_out, which itself depends on the light striking the red wall directly. A local-illumination model, by construction, only ever evaluates the direct-light term for the white wall (light straight from the overhead source), so it produces a perfectly neutral white-wall color with no hint of the nearby red wall's real, physical tint; the recursive dependency the full equation describes is simply never evaluated.

### Example 2: the ambient term as a crude, honest stand-in

A real-time renderer approximates the entire hemisphere-of-bounced-light term with one flat constant, say ambient = (0.1, 0.1, 0.1), added regardless of the scene's actual geometry or nearby colors:

```text
final_color = ambient + sum over lights of (diffuse_term + specular_term)
final_color = (0.1,0.1,0.1) + diffuse_and_specular_from_named_lights
```

This ensures a surface facing away from every direct light is not rendered as pure, unlit black (a visibly wrong result for most real scenes, which nearly always have some ambient light from the sky or nearby surfaces), but the constant (0.1, 0.1, 0.1) is identical everywhere in the scene, whether the object sits next to a bright red wall or in an empty gray room, an honest, visible simplification of what the full integral's recursive term would actually compute.

### Example 3: order-of-magnitude cost, illustrative, not a precise benchmark

A local-illumination shader with 3 named lights evaluates roughly 3 diffuse-plus-specular terms per fragment, a small, fixed number of dot products and one multiply-add chain, the arithmetic already worked through in the previous two concepts. A renderer that instead approximates the rendering equation's hemisphere integral by sampling, say, 100 random incoming directions per fragment, tracing a ray for each one to find what it actually hits (the ray-casting mechanism the next several concepts build), and shading each of those hits recursively, does roughly two orders of magnitude more work per fragment, before even accounting for the recursive bounces those 100 rays might themselves need to trace; this is illustrative reasoning about the shape of the cost difference, not a benchmark of any specific renderer's actual measured performance.

## Common Misconceptions & Pitfalls

- **"Adding more named lights eventually reproduces true global illumination."** Example 1's core issue is structural, not a matter of quantity: no finite list of named point or directional lights can represent light that has bounced unpredictably off arbitrary scene geometry, since a named light's direction and intensity are fixed inputs, not something derived from the scene's own current appearance the way the recursive L_in term in the real equation is.
- **"The ambient term in Example 2 is the same thing as global illumination, just simplified."** The ambient term is a single scene-wide (or sometimes per-object) constant with no relationship to actual nearby geometry or colors; genuine global illumination techniques compute a value that does depend on the specific scene around each point (a red wall genuinely tints a nearby white surface), which the flat ambient constant, by construction, cannot do.
- **"The rendering equation is only relevant to offline, non-real-time rendering."** The equation itself is a statement of physical light transport, true regardless of how it is rendered; what changes between real-time and offline rendering is how aggressively the equation gets approximated, and real-time ray tracing (`rasterization-vs-ray-tracing-tradeoffs-and-real-time-hardware`, later in this discipline) is precisely the case of hardware advancing enough to approximate more of this same equation within a real-time budget.

## Summary

Kajiya's 1986 rendering equation states the full physical problem of light transport precisely: outgoing light at a point equals emitted light plus an integral, over every incoming direction, of scattered incoming light, which is itself recursively the outgoing light of whatever other surface sits in that direction. Real-time local illumination, every shading model built earlier in this discipline, computes a deliberate, named truncation of this equation: a fixed sum over a small list of named lights, plus a flat ambient constant standing in for the entire recursive, bounced-light term, an honest, cost-driven approximation rather than an oversight. `ray-casting-generating-and-intersecting-rays`, next, begins the family of techniques built specifically to approximate more of this same integral directly.

## Documentation Links

- [Kajiya: The Rendering Equation (SIGGRAPH, 1986) : history via SIGGRAPH](https://history.siggraph.org/learning/the-rendering-equation-by-kajiya/): the source paper for the integral equation this concept states in plain terms, and the formal foundation for the honest distinction between local and global illumination drawn throughout this concept.
